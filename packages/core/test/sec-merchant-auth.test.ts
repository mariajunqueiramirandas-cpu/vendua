import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, startOtp, verifyOtp } from '../src/admin/auth.ts';
import type { MerchantNotify } from '../src/admin/context.ts';
import { isPushEndpoint, sendPushResult } from '../src/admin/webpush.ts';

describe('web push endpoints (unit)', () => {
  test('only browser push services, https on the default port, no userinfo', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:443/wp/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QGx',
      'https://wns2-bl2p.notify.windows.com/w/?token=abc',
    ])
      expect(isPushEndpoint(ok)).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://user:pw@fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilfcm.googleapis.com/x',
      'https://notify.windows.com.evil.example/x',
      'https://push.apple.com.evil.example/x',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost:8787/admin/v1',
      'not a url',
    ])
      expect(isPushEndpoint(bad)).toBe(false);
  });

  test('redirects are not followed; unknown hosts are never fetched', async () => {
    const saved = {
      fetch: globalThis.fetch,
      pub: process.env.VAPID_PUBLIC_KEY,
      priv: process.env.VAPID_PRIVATE_KEY,
    };
    const vapid = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair;
    process.env.VAPID_PUBLIC_KEY = Buffer.from(
      await crypto.subtle.exportKey('raw', vapid.publicKey),
    ).toString('base64url');
    process.env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!;
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const keys = {
      p256dh: Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString('base64url'),
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
    };
    const seen: { url: string; redirect: RequestInit['redirect'] }[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(input), redirect: init?.redirect });
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1:5432/' },
      });
    }) as typeof fetch;
    try {
      const r = await sendPushResult(
        { endpoint: 'https://fcm.googleapis.com/fcm/send/x', ...keys },
        { title: 't' },
      );
      expect(r).toEqual({ result: 'error', detail: 'redirect' });
      expect(seen).toEqual([{ url: 'https://fcm.googleapis.com/fcm/send/x', redirect: 'manual' }]);
      const legacy = await sendPushResult(
        { endpoint: 'https://10.0.0.5:6379/', ...keys },
        { title: 't' },
      );
      expect(legacy.result).toBe('gone');
      expect(seen).toHaveLength(1);
    } finally {
      globalThis.fetch = saved.fetch;
      if (saved.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = saved.pub;
      if (saved.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = saved.priv;
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('merchant auth hardening (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;

  const codes = new Map<string, string>();
  const emails: { to: string; text: string }[] = [];
  const notify: MerchantNotify = {
    whatsapp: async () => {},
    email: async (to, _subject, text) => {
      emails.push({ to, text });
    },
  };
  const otpSender = async (phone: string, text: string) => {
    codes.set(phone, /(\d{6})/.exec(text)![1]!);
  };
  // a fresh app per test: the auth routes share one per-IP bucket
  const mkApp = () =>
    createApp({
      sql: appSql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
      cepLookup: async () => null,
      storeDomain: 'vendua.test',
      notify,
      otpSender,
    });

  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const attackerPhone = `2193${stamp}`;
  const victimPhone = `2192${stamp}`;
  const capPhone = `2191${stamp}`;
  const attackerMail = `sec-atk-${nonce}@exemplo.com`;
  let storeX = '';
  let storeY = '';
  let idem = 0;

  const client = (app: ReturnType<typeof mkApp>) => {
    const call = async (method: string, path: string, body?: unknown, cookie?: string) => {
      const res = await app.request(`http://core.localhost/admin/v1${path}`, {
        method,
        headers: {
          host: 'core.localhost',
          'content-type': 'application/json',
          ...(method === 'GET'
            ? {}
            : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
          ...(cookie ? { cookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const cookieOut = /vendua_admin=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
      return {
        status: res.status,
        body: (await res.json()) as any,
        cookie: cookieOut ? `vendua_admin=${cookieOut}` : undefined,
      };
    };
    return call;
  };

  beforeAll(async () => {
    const mk = async (s: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id`
      )[0]!.id;
    storeX = await mk(`secx-${nonce}`);
    storeY = await mk(`secy-${nonce}`);
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${storeX}, 'Atacante', ${attackerPhone}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${storeY}, 'Vítima', ${victimPhone}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${storeY}, 'Cap', ${capPhone}, 'manager')`;
  });

  afterAll(async () => {
    await sql`delete from merchant_login_links where email = ${attackerMail}`;
    await sql`delete from merchant_login_codes where phone in (${attackerPhone}, ${victimPhone}, ${capPhone})`;
    if (storeX) await sql`delete from tenants where id in (${storeX}, ${storeY})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  const otpSignIn = async (call: ReturnType<typeof client>, phone: string, storeId: string) => {
    await call('POST', '/auth/otp/start', { phone });
    const r = await call('POST', '/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.status).toBe(200);
    if (r.body.signedIn) return r.cookie!;
    const pick = await call('POST', '/auth/select', { pickerToken: r.body.pickerToken, storeId });
    expect(pick.status).toBe(200);
    return pick.cookie!;
  };

  test('C1: an invited row with the victim phone + email login cannot reach the victim store', async () => {
    const call = client(mkApp());
    const atk = await otpSignIn(call, attackerPhone, storeX);
    const invite = await call(
      'POST',
      '/team',
      { name: 'Laranja', phone: victimPhone, email: attackerMail, role: 'owner' },
      atk,
    );
    expect(invite.status).toBe(201);

    // the email link proves the address only: the one row that carries it
    await call('POST', '/auth/email/start', { email: attackerMail });
    const token = /link=([A-Za-z0-9_-]{43})/.exec(
      [...emails].reverse().find((e) => e.to === attackerMail)!.text,
    )![1]!;
    const v = await call('POST', '/auth/email/verify', { token });
    expect(v.body.signedIn).toBe(true);
    expect(v.body.store.id).toBe(storeX);
    const mailSession = v.cookie!;

    const me = await call('GET', '/session', undefined, mailSession);
    expect(me.status).toBe(200);
    expect(me.body.stores.map((s: any) => s.id)).toEqual([storeX]);
    const sw = await call('POST', '/session/switch', { storeId: storeY }, mailSession);
    expect(sw.status).toBe(404);
    expect(sw.body.error.code).toBe('STORE_NOT_FOUND');
    expect(sw.cookie).toBeUndefined();
  });

  test('C1: a phone-proven session switches, and the proof carries to the new session', async () => {
    const call = client(mkApp());
    // the victim's own phone does reach both rows (store X put it there) — that is theirs
    const vic = await otpSignIn(call, victimPhone, storeY);
    const me = await call('GET', '/session', undefined, vic);
    expect(me.body.stores.map((s: any) => s.id).sort()).toEqual([storeX, storeY].sort());
    const toX = await call('POST', '/session/switch', { storeId: storeX }, vic);
    expect(toX.status).toBe(200);
    const back = await call('POST', '/session/switch', { storeId: storeY }, toX.cookie);
    expect(back.status).toBe(200);
    expect(back.body.store.id).toBe(storeY);
  });

  test('C1: a session with no recorded proof stays in its own store', async () => {
    const call = client(mkApp());
    const row = (
      await sql<{ id: string }[]>`
        select id from merchant_users where tenant_id = ${storeX} and phone = ${victimPhone}
      `
    )[0]!;
    const legacy = `vendua_admin=${await createSession(
      appSql,
      { tenant_id: storeX, slug: `secx-${nonce}`, name: 'x', user_id: row.id, role: 'owner' },
      'legacy',
    )}`;
    const me = await call('GET', '/session', undefined, legacy);
    expect(me.body.stores.map((s: any) => s.id)).toEqual([storeX]);
    expect((await call('POST', '/session/switch', { storeId: storeY }, legacy)).status).toBe(404);
  });

  test('admin OTP: 10 wrong codes in a day lock the phone, with the same answer', async () => {
    for (let n = 0; n < 2; n++) {
      await startOtp(appSql, capPhone, otpSender);
      const right = codes.get(capPhone)!;
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expect(await verifyOtp(appSql, capPhone, wrong)).toBe(false);
    }
    await startOtp(appSql, capPhone, otpSender);
    expect(await verifyOtp(appSql, capPhone, codes.get(capPhone)!)).toBe(false);
    const call = client(mkApp());
    const r = await call('POST', '/auth/otp/verify', {
      phone: capPhone,
      code: codes.get(capPhone),
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_CODE');

    // the window passes
    await sql`
      update merchant_login_codes set created_at = now() - interval '25 hours'
      where phone = ${capPhone} and attempts > 0
    `;
    expect(await verifyOtp(appSql, capPhone, codes.get(capPhone)!)).toBe(true);
  });

  test('push: only push-service endpoints; at most 10 devices per member', async () => {
    const call = client(mkApp());
    const atk = await otpSignIn(call, attackerPhone, storeX);
    const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
    for (const endpoint of [
      'https://169.254.169.254/latest/meta-data/',
      'https://core.internal:8787/x',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://u:p@fcm.googleapis.com/fcm/send/x',
      'https://fcm.googleapis.com.evil.example/x',
      'http://updates.push.services.mozilla.com/wpush/v2/x',
    ]) {
      const r = await call('POST', '/push/subscribe', { endpoint, keys }, atk);
      expect(r.status).toBe(422);
    }
    const eps = Array.from(
      { length: 12 },
      (_, i) => `https://fcm.googleapis.com/fcm/send/${nonce}-${i}`,
    );
    for (const endpoint of eps)
      expect((await call('POST', '/push/subscribe', { endpoint, keys }, atk)).status).toBe(201);
    expect(
      (
        await call(
          'POST',
          '/push/subscribe',
          { endpoint: 'https://wns2-bl2p.notify.windows.com/w/?token=abc', keys },
          atk,
        )
      ).status,
    ).toBe(201);
    const rows = await sql<{ endpoint: string }[]>`
      select endpoint from push_subscriptions where tenant_id = ${storeX} order by created_at
    `;
    expect(rows).toHaveLength(10);
    expect(rows.map((r) => r.endpoint)).not.toContain(eps[0]);
    expect(rows.map((r) => r.endpoint)).toContain(
      'https://wns2-bl2p.notify.windows.com/w/?token=abc',
    );
  });
});
