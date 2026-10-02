import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import type { MerchantNotify } from '../src/admin/context.ts';
import { pushOrder, pushPayment, sweepAdmin } from '../src/admin/workers.ts';
import {
  availabilityLabel,
  parseAvailabilitySchedule,
  scheduleOpen,
} from '../src/modules/catalog.ts';
import { migrate } from '../src/platform/db.ts';

const Img = (
  Bun as unknown as {
    Image: new (b: Uint8Array) => {
      metadata(): Promise<{ width: number; height: number; format: string }>;
      jpeg(o?: { quality?: number }): { bytes(): Promise<Uint8Array> };
    };
  }
).Image;

describe('scheduled availability (unit)', () => {
  test('labels read like a person wrote them', () => {
    expect(
      availabilityLabel({
        windows: [{ days: [6], from: '09:00', to: '13:00' }],
        outside: 'hidden',
      }),
    ).toBe('Só sábados, 9h–13h');
    expect(
      availabilityLabel({
        windows: [{ days: [1, 2, 3, 4, 5], from: '11:00', to: '15:30' }],
        outside: 'unavailable',
      }),
    ).toBe('Seg a sex, 11h–15h30');
    expect(
      availabilityLabel({
        windows: [{ days: [0, 6] }, { days: [3], from: '18:00', to: '22:00' }],
        outside: 'unavailable',
      }),
    ).toBe('Dom e sáb · qua, 18h–22h');
  });

  test('validation and the clock in the store timezone', () => {
    const bad = [
      { windows: [] },
      { windows: [{ days: [1, 1] }] },
      { windows: [{ days: [7] }] },
      { windows: [{ days: [1], from: '10:00' }] },
      { windows: [{ days: [1], from: '12:00', to: '10:00' }] },
      { windows: Array.from({ length: 8 }, () => ({ days: [1] })) },
      { windows: [{ days: [1] }], outside: 'maybe' },
    ];
    for (const b of bad) expect(() => parseAvailabilitySchedule(b)).toThrow();
    expect(parseAvailabilitySchedule(null)).toBeNull();
    const s = parseAvailabilitySchedule({
      windows: [{ days: [6, 5], from: '09:00', to: '13:00' }],
    })!;
    expect(s).toEqual({
      windows: [{ days: [5, 6], from: '09:00', to: '13:00' }],
      outside: 'unavailable',
    });
    // 2026-10-03 is a Saturday; 12:00 UTC = 09:00 in São Paulo
    expect(scheduleOpen(s, new Date('2026-10-03T12:00:00Z'), 'America/Sao_Paulo')).toBe(true);
    expect(scheduleOpen(s, new Date('2026-10-03T11:59:00Z'), 'America/Sao_Paulo')).toBe(false);
    expect(scheduleOpen(s, new Date('2026-10-03T16:00:00Z'), 'America/Sao_Paulo')).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('merchant admin, Track A (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;

  const codes = new Map<string, string>();
  const emails: { to: string; subject: string; text: string; idemKey: string }[] = [];
  const lastMail = (to: string) => [...emails].reverse().find((e) => e.to === to);
  const whatsapps: { phone: string; text: string }[] = [];
  const failWhatsapp = new Set<string>();
  const notify: MerchantNotify = {
    whatsapp: async (phone, text) => {
      if (failWhatsapp.has(phone)) throw new Error('number not on WhatsApp');
      whatsapps.push({ phone, text });
    },
    email: async (to, subject, text, idemKey) => {
      if (to.includes('bounce')) throw new Error('mailbox full');
      emails.push({ to, subject, text, idemKey });
    },
  };
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    notify,
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });

  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `ta-${nonce}`;
  const slug2 = `ta2-${nonce}`;
  const host = `${slug}.localhost`;
  const stamp = String(Date.now()).slice(-7);
  const ownerPhone = `2197${stamp}`;
  const managerPhone = `2196${stamp}`;
  const quietPhone = `2195${stamp}`;
  const ownerEmail = `ta-${nonce}@exemplo.com`;
  let tenantId = '';
  let tenant2 = '';
  let catId = '';
  let idem = 0;
  const incidentIds: string[] = [];

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined
        ? {
            body:
              typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
          }
        : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json')
        ? await res.json()
        : new Uint8Array(await res.arrayBuffer())) as any,
      cookie: res.headers.get('set-cookie'),
      headers: res.headers,
    };
  };

  const asCookie = (setCookie: string | null) => {
    const value = /vendua_admin=([^;]+)/.exec(setCookie ?? '')![1]!;
    const fn = (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}`, ...h });
    return Object.assign(fn, { cookie: `vendua_admin=${value}` });
  };

  const signIn = async (phone: string, storeId = tenantId) => {
    await call('POST', '/admin/v1/auth/otp/start', { phone });
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.status).toBe(200);
    if (r.body.signedIn) return asCookie(r.cookie);
    const pick = await call('POST', '/admin/v1/auth/select', {
      pickerToken: r.body.pickerToken,
      storeId,
    });
    expect(pick.status).toBe(200);
    return asCookie(pick.cookie);
  };

  let owner: Awaited<ReturnType<typeof signIn>>;

  // fake push service: endpoints under /ok/ accept, /gone/ are unsubscribed, the rest fail
  const realFetch = globalThis.fetch;
  const pushHits: string[] = [];
  const saved = {
    pub: process.env.VAPID_PUBLIC_KEY,
    priv: process.env.VAPID_PRIVATE_KEY,
  };
  const device = async (kind: 'ok' | 'gone' | 'err') => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    return {
      endpoint: `https://fcm.googleapis.com/ta/${kind}/${crypto.randomUUID()}`,
      keys: {
        p256dh: Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString(
          'base64url',
        ),
        auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url'),
      },
    };
  };

  const checkout = async (delivery: unknown = { mode: 'pickup' }, productId?: string) => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    const add = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: productId ?? basicProduct, qty: 1 },
      auth,
    );
    expect(add.status).toBe(200);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Rita Alves', phone: '(22) 97777-6666' },
        delivery,
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(placed.status).toBe(201);
    return { order: placed.body.order, cartId: s.body.cart.id as string, auth };
  };
  let basicProduct = '';

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const mk = async (s: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id`
      )[0]!.id;
    tenantId = await mk(slug);
    tenant2 = await mk(slug2);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city, accept_target_minutes)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema', 5)
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 500, 30, 50)
    `;
    catId = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    basicProduct = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${catId}, 'brigadeiro', 'Brigadeiro', 500) returning id
      `
    )[0]!.id;
    await sql`insert into merchant_users (tenant_id, name, phone, email, role) values (${tenantId}, 'Ana Prado', ${ownerPhone}, ${ownerEmail}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, email, role) values (${tenant2}, 'Ana Prado', ${ownerPhone}, ${ownerEmail.toUpperCase()}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, email, role) values (${tenantId}, 'Bruno Gerente', ${managerPhone}, ${`ta-m-${nonce}@exemplo.com`}, 'manager')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role, prefs) values (${tenantId}, 'Célia Quieta', ${quietPhone}, 'manager', ${sql.json({ whatsappAlerts: false, pushPayments: false })})`;

    const vapid = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
    ])) as CryptoKeyPair;
    process.env.VAPID_PUBLIC_KEY = Buffer.from(
      await crypto.subtle.exportKey('raw', vapid.publicKey),
    ).toString('base64url');
    process.env.VAPID_PRIVATE_KEY = (await crypto.subtle.exportKey('jwk', vapid.privateKey)).d!;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith('https://fcm.googleapis.com/ta/')) return realFetch(input as never, init);
      pushHits.push(url);
      const kind = new URL(url).pathname.split('/')[2];
      return new Response(null, { status: kind === 'ok' ? 201 : kind === 'gone' ? 410 : 500 });
    }) as typeof fetch;
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    if (saved.pub === undefined) delete process.env.VAPID_PUBLIC_KEY;
    else process.env.VAPID_PUBLIC_KEY = saved.pub;
    if (saved.priv === undefined) delete process.env.VAPID_PRIVATE_KEY;
    else process.env.VAPID_PRIVATE_KEY = saved.priv;
    if (incidentIds.length)
      await sql`delete from platform_incidents where id = any(${incidentIds}::uuid[])`;
    await sql`delete from merchant_login_links where email = ${ownerEmail} or email like ${`ta-%-${nonce}@exemplo.com`}`;
    if (tenantId) await sql`delete from tenants where id in (${tenantId}, ${tenant2})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('email link: same answer for strangers, single use, expiry, picker across stores', async () => {
    const unknown = await call('POST', '/admin/v1/auth/email/start', {
      email: `ta-nobody-${nonce}@exemplo.com`,
    });
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ sent: true });
    // a delivery that fails still answers the same (and doesn't wait for it)
    await sql`update merchant_users set email = ${`ta-bounce-${nonce}@exemplo.com`} where tenant_id = ${tenantId} and phone = ${managerPhone}`;
    expect(
      (
        await call('POST', '/admin/v1/auth/email/start', {
          email: `ta-bounce-${nonce}@exemplo.com`,
        })
      ).body,
    ).toEqual({ sent: true });
    await sql`update merchant_users set email = ${`ta-m-${nonce}@exemplo.com`} where tenant_id = ${tenantId} and phone = ${managerPhone}`;
    expect(emails.some((e) => e.to.includes('nobody'))).toBe(false);
    expect(
      (await call('POST', '/admin/v1/auth/email/start', { email: 'not-an-email' })).body.error.code,
    ).toBe('INVALID_EMAIL');

    const prevDev = process.env.VENDUA_ADMIN_DEV_OTP;
    process.env.VENDUA_ADMIN_DEV_OTP = '1';
    const start = await call('POST', '/admin/v1/auth/email/start', {
      email: `  ${ownerEmail.toUpperCase()} `,
    });
    if (prevDev === undefined) delete process.env.VENDUA_ADMIN_DEV_OTP;
    else process.env.VENDUA_ADMIN_DEV_OTP = prevDev;
    expect(start.body.sent).toBe(true);
    const mail = lastMail(ownerEmail)!;
    expect(mail).toBeDefined();
    const link = /(http\S+\/admin\/entrar\?link=([A-Za-z0-9_-]{43}))/.exec(mail.text)!;
    expect(link[1]).toStartWith('http://core.localhost/admin/entrar?link=');
    expect(start.body.devLink).toBe(link[1]);
    const token = link[2]!;
    // only the hash is stored
    const stored = await sql<{ token_hash: string }[]>`
      select token_hash from merchant_login_links where email = ${ownerEmail} order by created_at desc limit 1
    `;
    expect(stored[0]!.token_hash).toBe(createHash('sha256').update(token).digest('hex'));

    const v = await call('POST', '/admin/v1/auth/email/verify', { token });
    expect(v.status).toBe(200);
    expect(v.body.signedIn).toBe(false);
    expect(v.body.stores.map((s: any) => s.id).sort()).toEqual([tenantId, tenant2].sort());
    const again = await call('POST', '/admin/v1/auth/email/verify', { token });
    expect(again.body.error.code).toBe('INVALID_LINK');
    // the picker token is bound to the address, not a phone — and can't be retargeted
    const [kind, subject, exp, sig] = v.body.pickerToken.split('.');
    expect(kind).toBe('e');
    const forged = `p.${Buffer.from(ownerPhone).toString('base64url')}.${exp}.${sig}`;
    expect(
      (await call('POST', '/admin/v1/auth/select', { pickerToken: forged, storeId: tenantId }))
        .status,
    ).toBe(401);
    expect(subject).toBeTruthy();
    const pick = await call('POST', '/admin/v1/auth/select', {
      pickerToken: v.body.pickerToken,
      storeId: tenant2,
    });
    expect(pick.status).toBe(200);
    expect(pick.body.store.id).toBe(tenant2);
    const me = await asCookie(pick.cookie)('GET', '/session');
    expect(me.body.store.id).toBe(tenant2);
    expect(me.body.user.email).toBe(ownerEmail.toUpperCase());

    // expired
    await call('POST', '/admin/v1/auth/email/start', { email: ownerEmail });
    const t2 = /link=([A-Za-z0-9_-]{43})/.exec(lastMail(ownerEmail)!.text)![1]!;
    await sql`update merchant_login_links set expires_at = now() - interval '1 minute' where token_hash = ${createHash('sha256').update(t2).digest('hex')}`;
    expect((await call('POST', '/admin/v1/auth/email/verify', { token: t2 })).body.error.code).toBe(
      'INVALID_LINK',
    );
    expect(
      (await call('POST', '/admin/v1/auth/email/verify', { token: 'short' })).body.error.code,
    ).toBe('INVALID_LINK');

    // one store: straight in
    const managerEmail = `ta-m-${nonce}@exemplo.com`;
    await call('POST', '/admin/v1/auth/email/start', { email: managerEmail });
    const t3 = /link=([A-Za-z0-9_-]{43})/.exec(lastMail(managerEmail)!.text)![1]!;
    const one = await call('POST', '/admin/v1/auth/email/verify', { token: t3 });
    expect(one.body.signedIn).toBe(true);
    expect(one.body.store.id).toBe(tenantId);
    expect(one.cookie).toContain('vendua_admin=');
  });

  test('login OTP ignores signup codes in the same table', async () => {
    await sql`
      insert into merchant_login_codes (phone, code_hash, expires_at, purpose)
      values (${managerPhone}, ${createHash('sha256').update(`${managerPhone}|424242`).digest('hex')},
              now() + interval '10 minutes', 'signup')
    `;
    const r = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: managerPhone,
      code: '424242',
    });
    expect(r.body.error.code).toBe('INVALID_CODE');
    owner = await signIn(ownerPhone);
    expect((await owner('GET', '/session')).body.store.id).toBe(tenantId);
    const row = await sql<{ purpose: string }[]>`
      select purpose from merchant_login_codes where phone = ${ownerPhone} order by created_at desc limit 1
    `;
    expect(row[0]!.purpose).toBe('login');
  });

  test('invites: sent by WhatsApp and email, recorded, replay-safe, resend capped', async () => {
    const before = whatsapps.length;
    const key = `${nonce}-invite`;
    const phone = `2194${stamp}`;
    const add = await owner(
      'POST',
      '/team',
      { name: 'Davi Atendente', phone, role: 'attendant', email: `ta-d-${nonce}@exemplo.com` },
      { 'idempotency-key': key },
    );
    expect(add.status).toBe(201);
    expect(add.body.invite).toEqual({ whatsapp: 'sent', email: 'sent' });
    expect(add.body.signInUrl).toBe('/admin/');
    const wa = whatsapps.slice(before);
    expect(wa).toHaveLength(1);
    expect(wa[0]!.phone).toBe(phone);
    expect(wa[0]!.text).toBe(
      `Ana Prado adicionou você à equipe da Loja ${slug} na Venduá. Entre com este número em http://core.localhost/admin/`,
    );
    expect(lastMail(`ta-d-${nonce}@exemplo.com`)).toBeDefined();
    const member = add.body.members.find((x: any) => x.phone === phone);
    expect(member.inviteChannels).toEqual(['whatsapp', 'email']);
    expect(member.inviteSentAt).toBeTruthy();
    expect(member.inviteError).toBeNull();

    const replay = await owner(
      'POST',
      '/team',
      { name: 'Davi Atendente', phone, role: 'attendant' },
      { 'idempotency-key': key },
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');
    expect(replay.body.invite).toEqual({ whatsapp: 'sent', email: 'sent' });
    expect(whatsapps.length).toBe(before + 1);

    // a number that isn't on WhatsApp: the member is added, the failure is recorded
    const lost = `2193${stamp}`;
    failWhatsapp.add(lost);
    const f = await owner('POST', '/team', { name: 'Eva Sem Zap', phone: lost, role: 'manager' });
    expect(f.status).toBe(201);
    expect(f.body.invite).toEqual({ whatsapp: 'failed', email: 'skipped' });
    const fm = f.body.members.find((x: any) => x.phone === lost);
    expect(fm.inviteError).toContain('whatsapp');
    expect(fm.inviteSentAt).toBeNull();
    failWhatsapp.delete(lost);

    for (let i = 0; i < 3; i++) {
      const r = await owner('POST', `/team/${fm.id}/invite`);
      expect(r.status).toBe(200);
      expect(r.body.invite.whatsapp).toBe('sent');
    }
    expect((await owner('POST', `/team/${fm.id}/invite`)).status).toBe(429);
    expect((await owner('POST', `/team/${crypto.randomUUID()}/invite`)).status).toBe(404);
    const t = await owner('GET', '/team');
    expect(t.body.members.find((x: any) => x.id === fm.id).inviteChannels).toEqual(['whatsapp']);
    // these two must not get alert WhatsApps later
    await sql`update merchant_users set status = 'revoked' where tenant_id = ${tenantId} and phone in (${phone}, ${lost})`;
  });

  let orderId = '';
  test('alerts: devices, test push recorded, order push, WhatsApp fallback once', async () => {
    const empty = await owner('GET', '/alerts');
    expect(empty.status).toBe(200);
    expect(empty.body.devices).toEqual([]);
    expect(typeof empty.body.whatsappFallback).toBe('boolean');

    const good = await device('ok');
    const bad = await device('err');
    expect((await owner('POST', '/push/subscribe', good)).status).toBe(201);
    expect((await owner('POST', '/push/subscribe', bad)).status).toBe(201);
    const hits0 = pushHits.length;
    const test1 = await owner('POST', '/alerts/test', undefined, {
      'idempotency-key': `${nonce}-alert-test`,
    });
    expect(test1.body).toEqual({ devices: 2, ok: 1, failed: 1 });
    expect(pushHits.length).toBe(hits0 + 2);
    // a retry answers from the recorded attempts and pushes nothing
    const retry = await owner('POST', '/alerts/test', undefined, {
      'idempotency-key': `${nonce}-alert-test`,
    });
    expect(retry.headers.get('x-idempotent-replay')).toBe('true');
    expect(retry.body).toEqual({ devices: 2, ok: 1, failed: 1 });
    expect(pushHits.length).toBe(hits0 + 2);
    const alerts = await owner('GET', '/alerts');
    expect(alerts.body.devices).toHaveLength(2);
    const byResult = Object.fromEntries(alerts.body.devices.map((d: any) => [d.lastResult, d]));
    expect(byResult.ok.lastOkAt).toBeTruthy();
    expect(byResult.error.lastError).toBe('push service 500');
    expect(byResult.error.userName).toBe('Ana Prado');
    expect(alerts.body.recent.filter((r: any) => r.event === 'test')).toHaveLength(2);
    expect(alerts.body.recent[0].channel).toBe('push');

    // a new order that rang one working device: no WhatsApp later
    const rang = await checkout();
    await pushOrder(appSql, tenantId, rang.order.id);
    await pushOrder(appSql, tenantId, rang.order.id); // a second replica loses the claim
    const rangAttempts = await sql`
      select result from push_attempts where tenant_id = ${tenantId} and event = 'order.placed' and ref = ${rang.order.id}
    `;
    expect(rangAttempts.map((r) => r.result).sort()).toEqual(['error', 'ok']);

    // drop the working device: the next order reaches nobody
    await owner('POST', '/push/unsubscribe', { endpoint: good.endpoint });
    const missed = await checkout();
    orderId = missed.order.id;
    await pushOrder(appSql, tenantId, orderId);
    const home = await owner('GET', '/home');
    const failing = home.body.attention.find((a: any) => a.kind === 'alerts_failing');
    expect(failing).toMatchObject({ count: 1, href: '/perfil' });

    await sql`update orders set placed_at = now() - interval '10 minutes' where id in (${orderId}, ${rang.order.id})`;
    const before = whatsapps.length;
    await sweepAdmin(appSql, { notify, adminOrigin: 'https://admin.ta.test' });
    const sent = whatsapps.slice(before).filter((w) => w.text.includes(`Loja ${slug}`));
    expect(sent.map((w) => w.phone).sort()).toEqual([managerPhone, ownerPhone].sort());
    expect(sent[0]!.text).toContain(`#${missed.order.number}`);
    expect(sent[0]!.text).toContain(`https://admin.ta.test/admin/pedidos/${orderId}`);
    await sweepAdmin(appSql, { notify, adminOrigin: null });
    expect(whatsapps.slice(before).filter((w) => w.text.includes(`Loja ${slug}`))).toHaveLength(2);
    const wa = (await owner('GET', '/alerts')).body.recent.filter(
      (r: any) => r.channel === 'whatsapp',
    );
    expect(wa).toHaveLength(2);
    expect(wa.every((r: any) => r.result === 'ok' && r.ref === orderId)).toBe(true);
  });

  test('payment push: once per order, respects pushPayments', async () => {
    const quiet = await signIn(quietPhone);
    const mine = await device('ok');
    await quiet('POST', '/push/subscribe', mine);
    const ownerDevice = await device('ok');
    await owner('POST', '/push/subscribe', ownerDevice);
    const hits = pushHits.length;
    await pushPayment(appSql, tenantId, orderId);
    await pushPayment(appSql, tenantId, orderId);
    const got = pushHits.slice(hits);
    expect(got).toContain(ownerDevice.endpoint);
    expect(got).not.toContain(mine.endpoint);
    const rows = await sql`
      select result from push_attempts where tenant_id = ${tenantId} and event = 'payment.received' and ref = ${orderId}
    `;
    // owner's two devices (one ok, one failing); the quiet manager is left out
    expect(rows).toHaveLength(2);
  });

  test('media: EXIF/GPS stripped, upright, capped, variants and ?w=', async () => {
    // 3000×1500, left red / right blue, plus an Exif APP1 with orientation 6 and a GPS IFD
    const w = 3000;
    const h = 1500;
    const row = Math.ceil((w * 3) / 4) * 4;
    const bmp = Buffer.alloc(54 + row * h);
    bmp.write('BM', 0);
    bmp.writeUInt32LE(bmp.length, 2);
    bmp.writeUInt32LE(54, 10);
    bmp.writeUInt32LE(40, 14);
    bmp.writeInt32LE(w, 18);
    bmp.writeInt32LE(h, 22);
    bmp.writeUInt16LE(1, 26);
    bmp.writeUInt16LE(24, 28);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const o = 54 + y * row + x * 3;
        if (x < w / 2) bmp[o + 2] = 255;
        else bmp[o] = 255;
      }
    const jpg = await new Img(new Uint8Array(bmp)).jpeg({ quality: 80 }).bytes();
    const tiff = Buffer.alloc(80);
    tiff.write('MM', 0);
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(2, 8);
    tiff.writeUInt16BE(0x0112, 10);
    tiff.writeUInt16BE(3, 12);
    tiff.writeUInt32BE(1, 14);
    tiff.writeUInt16BE(6, 18);
    tiff.writeUInt16BE(0x8825, 22);
    tiff.writeUInt16BE(4, 24);
    tiff.writeUInt32BE(1, 26);
    tiff.writeUInt32BE(38, 30);
    tiff.writeUInt16BE(1, 38);
    tiff.writeUInt16BE(0x0001, 40);
    tiff.writeUInt16BE(2, 42);
    tiff.writeUInt32BE(2, 44);
    tiff.write('S\0', 48);
    tiff.write('GPS-22.9S-42.5W', 56);
    const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
    const app1 = Buffer.from([0xff, 0xe1, 0, 0]);
    app1.writeUInt16BE(payload.length + 2, 2);
    const withExif = new Uint8Array(
      Buffer.concat([Buffer.from(jpg.slice(0, 2)), app1, payload, Buffer.from(jpg.slice(2))]),
    );
    expect(Buffer.from(withExif).includes('GPS-22.9S')).toBe(true);

    const mediaKey = `${nonce}-media`;
    const res = await owner('POST', '/media?w=9&h=9', withExif, {
      'content-type': 'image/jpeg',
      'idempotency-key': mediaKey,
    });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/v1\/media\/.+\.webp$/);
    // orientation 6 → portrait; long edge capped at 2048; the query's w/h are ignored
    expect([res.body.width, res.body.height]).toEqual([1024, 2048]);
    expect(res.body.variants).toEqual([320, 480, 640, 960]);

    const full = await call('GET', res.body.url);
    expect(full.headers.get('content-type')).toBe('image/webp');
    expect(full.headers.get('cache-control')).toContain('immutable');
    const bytes = Buffer.from(full.body as Uint8Array);
    expect(bytes.includes('GPS-22.9S')).toBe(false);
    expect(bytes.includes('Exif')).toBe(false);
    expect(await new Img(new Uint8Array(bytes)).metadata()).toMatchObject({
      width: 1024,
      height: 2048,
      format: 'webp',
    });
    const v500 = await call('GET', `${res.body.url}?w=500`);
    expect((await new Img(v500.body).metadata()).width).toBe(640);
    const v9999 = await call('GET', `${res.body.url}?w=9999`);
    expect((await new Img(v9999.body).metadata()).width).toBe(1024);
    const stored =
      await sql`select width from media_variants where media_id = ${res.body.id} order by width`;
    expect(stored.map((r) => r.width)).toEqual([320, 480, 640, 960]);

    // a retry replays without reading (or decoding) the body again
    const again = await owner('POST', '/media', new Uint8Array([1]), {
      'content-type': 'image/jpeg',
      'idempotency-key': mediaKey,
    });
    expect(again.status).toBe(201);
    expect(again.headers.get('x-idempotent-replay')).toBe('true');
    expect(again.body.id).toBe(res.body.id);
    expect(
      (
        await owner('POST', '/media', withExif, {
          'content-type': 'image/jpeg',
          'idempotency-key': '',
        })
      ).status,
    ).toBe(400);

    // > 2 MB streamed without a Content-Length is refused while reading
    const chunk = new Uint8Array(512 * 1024);
    chunk.set([0xff, 0xd8, 0xff], 0);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent++ >= 6) return ctl.close();
        ctl.enqueue(chunk);
      },
    });
    const big = await app.request('http://core.localhost/admin/v1/media', {
      method: 'POST',
      headers: {
        host: 'core.localhost',
        'content-type': 'image/jpeg',
        'idempotency-key': `${nonce}-big`,
        'x-vendua-admin': '1',
        cookie: owner.cookie,
      },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(big.status).toBe(413);

    // a tiny file claiming a huge canvas is refused before it is decoded
    const pngChunk = (t: string, d: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(d.length);
      const td = Buffer.concat([Buffer.from(t), d]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(td) >>> 0);
      return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(7000, 0);
    ihdr.writeUInt32BE(7000, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const bomb = new Uint8Array(
      Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(Buffer.alloc(1000))),
        pngChunk('IEND', Buffer.alloc(0)),
      ]),
    );
    const t0 = performance.now();
    expect((await owner('POST', '/media', bomb, { 'content-type': 'image/png' })).status).toBe(413);
    expect(performance.now() - t0).toBeLessThan(500);

    const junk = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await owner('POST', '/media', junk, { 'content-type': 'image/jpeg' })).status).toBe(
      415,
    );
  });

  test('scheduled products: label, sold out outside, hidden, cart 409, checkout recheck', async () => {
    const p = await owner('POST', '/products', {
      name: 'Pão de sábado',
      categoryId: catId,
      priceCents: 1200,
    });
    const id = p.body.product.id;
    const slugP = p.body.product.slug;
    const today = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    ).getDay();
    const notToday = (today + 3) % 7;
    expect(
      (
        await owner('PATCH', `/products/${id}`, {
          availabilitySchedule: { windows: [{ days: [1, 1] }] },
        })
      ).status,
    ).toBe(422);

    // open while the shopper carts it…
    const open = await owner('PATCH', `/products/${id}`, {
      availabilitySchedule: { windows: [{ days: [today] }], outside: 'unavailable' },
    });
    expect(open.body.product.availableNow).toBe(true);
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    expect(
      (await call('POST', '/checkout/v1/cart/items', { productId: id, qty: 1 }, auth)).status,
    ).toBe(200);

    // …then the window closes
    const closed = await owner('PATCH', `/products/${id}`, {
      availabilitySchedule: {
        windows: [{ days: [notToday], from: '09:00', to: '13:00' }],
        outside: 'unavailable',
      },
    });
    expect(closed.status).toBe(200);
    expect(closed.body.product.availableNow).toBe(false);
    expect(closed.body.product.availabilitySchedule.windows[0].days).toEqual([notToday]);
    const cat = await call('GET', '/storefront/v1/catalog', undefined, { host });
    const listed = cat.body.categories
      .flatMap((c: any) => c.products)
      .find((x: any) => x.id === id);
    expect(listed.status).toBe('sold_out');
    expect(listed.availabilityLabel).toMatch(/^Só .+, 9h–13h$/);
    const page = await call('GET', `/storefront/v1/products/${slugP}`, undefined, { host });
    expect(page.body.product.status).toBe('sold_out');

    const add = await call('POST', '/checkout/v1/cart/items', { productId: id, qty: 1 }, auth);
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe('SOLD_OUT');
    expect(add.body.error.details.reason).toBe('schedule');
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Rita Alves', phone: '(22) 97777-6666' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(placed.status).toBe(409);
    expect(placed.body.error.code).toBe('SOLD_OUT');
    expect(placed.body.error.details.reason).toBe('schedule');

    await owner('PATCH', `/products/${id}`, {
      availabilitySchedule: { windows: [{ days: [notToday] }], outside: 'hidden' },
    });
    const cat2 = await call('GET', '/storefront/v1/catalog', undefined, { host });
    expect(cat2.body.categories.flatMap((c: any) => c.products).some((x: any) => x.id === id)).toBe(
      false,
    );
    const cleared = await owner('PATCH', `/products/${id}`, { availabilitySchedule: null });
    expect(cleared.body.product.availabilitySchedule).toBeNull();
    expect(cleared.body.product.availableNow).toBe(true);
  });

  test('kits: a pick outside its own schedule is sold out, hidden, and 409 at add and checkout', async () => {
    const today = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }),
    ).getDay();
    const mk = async (slugP: string, name: string, kind = 'simple') =>
      (
        await sql<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, base_price_cents, kind)
          values (${tenantId}, ${catId}, ${slugP}, ${name}, 300, ${kind}) returning id
        `
      )[0]!.id;
    const kit = await mk('kit-cafe', 'Kit café', 'combo');
    const pao = await mk('pao-kit', 'Pão de queijo');
    const bolo = await mk('bolo-kit', 'Bolo do dia');
    const slot = (
      await sql<{ id: string }[]>`
        insert into combo_slots (tenant_id, product_id, name, min_select, max_select)
        values (${tenantId}, ${kit}, 'Escolha 1', 1, 1) returning id
      `
    )[0]!.id;
    await sql`
      insert into combo_slot_items (tenant_id, slot_id, product_id, sort)
      values (${tenantId}, ${slot}, ${pao}, 0), (${tenantId}, ${slot}, ${bolo}, 1)
    `;
    const sched = (days: number[], outside: string) =>
      owner('PATCH', `/products/${bolo}`, {
        availabilitySchedule: { windows: [{ days }], outside },
      });

    // bolo open while carted…
    await sched([today], 'unavailable');
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    const pick = (productId: string) => ({
      productId: kit,
      qty: 1,
      comboSelections: [{ slotId: slot, productId, qty: 1 }],
    });
    expect((await call('POST', '/checkout/v1/cart/items', pick(bolo), auth)).status).toBe(200);

    // …then outside its window
    await sched([(today + 2) % 7], 'unavailable');
    const page = await call('GET', '/storefront/v1/products/kit-cafe', undefined, { host });
    const item = page.body.product.comboSlots[0].items.find((i: any) => i.productId === bolo);
    expect(item.status).toBe('sold_out');
    expect(item.availabilityLabel).toMatch(/^Só /);
    const cart = await call('POST', '/checkout/v1/session', undefined, auth);
    expect(cart.body.cart.items[0].combo[0].status).toBe('sold_out');
    const add = await call('POST', '/checkout/v1/cart/items', pick(bolo), auth);
    expect(add.status).toBe(409);
    expect(add.body.error).toMatchObject({ code: 'SOLD_OUT', details: { reason: 'schedule' } });
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Rita Alves', phone: '(22) 97777-6666' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(placed.status).toBe(409);
    expect(placed.body.error).toMatchObject({ code: 'SOLD_OUT', details: { reason: 'schedule' } });

    // 'hidden': the product page doesn't offer it, a stale pick still gets the schedule answer
    await sched([(today + 2) % 7], 'hidden');
    const page2 = await call('GET', '/storefront/v1/products/kit-cafe', undefined, { host });
    expect(page2.body.product.comboSlots[0].items.map((i: any) => i.productId)).toEqual([pao]);
    const stale = await call('POST', '/checkout/v1/cart/items', pick(bolo), auth);
    expect(stale.body.error).toMatchObject({ code: 'SOLD_OUT', details: { reason: 'schedule' } });
    expect((await call('POST', '/checkout/v1/cart/items', pick(pao), auth)).status).toBe(200);
  });

  test('Loja: pickup details, billing hold keeps the store closed', async () => {
    const r = await owner('PATCH', '/store', {
      operations: { pickupAddress: 'Rua do Porto, 12', pickupInstructions: 'Toque a campainha' },
    });
    expect(r.status).toBe(200);
    expect(r.body.operations.pickupAddress).toBe('Rua do Porto, 12');
    expect(r.body.operations.pickupInstructions).toBe('Toque a campainha');
    expect(r.body.status.billingHold).toBe(false);
    expect(
      (await owner('PATCH', '/store', { operations: { pickupAddress: 'x'.repeat(201) } })).status,
    ).toBe(422);
    const pub = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(pub.body.pickup.address).toBe('Rua do Porto, 12');

    await sql`update store_settings set billing_hold = true, status_override = 'paused' where tenant_id = ${tenantId}`;
    const view = await owner('GET', '/store');
    expect(view.body.status.billingHold).toBe(true);
    expect((await owner('POST', '/store/resume', {})).body.error.code).toBe('BILLING_HOLD');
    expect((await owner('POST', '/store/pause', { for: '15m' })).body.error.code).toBe(
      'BILLING_HOLD',
    );
    expect((await owner('POST', '/store/pause', { for: 'indefinite' })).status).toBe(200);
    // a timer that ran out doesn't open it either
    await sql`update store_settings set resumes_at = now() - interval '1 minute' where tenant_id = ${tenantId}`;
    await sweepAdmin(appSql);
    expect((await owner('GET', '/store')).body.status.override).toBe('paused');
  });

  test('Início: billing, Mercado Pago and incident items', async () => {
    await sql`
      insert into subscriptions (tenant_id, plan_id, method, status, provider)
      values (${tenantId}, 'basic', 'pix', 'pending', 'fake')
    `;
    await sql`
      insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end, method, provider, due_at)
      values (${tenantId}, 1, 'basic', 3990, now(), now() + interval '1 month', 'pix', 'fake', now() + interval '2 days')
    `;
    await sql`
      insert into payment_connections (tenant_id, provider, provider_user_id, status, access_token, expires_at)
      values (${tenantId}, 'fake', 'ta-1', 'expiring', ${sql.json({})}, now() + interval '3 days')
    `;
    const kinds = async () =>
      ((await owner('GET', '/home')).body.attention as any[]).map((a) => a.kind);
    let k = await kinds();
    expect(k).toContain('billing_pending');
    expect(k).toContain('mp_expiring');
    expect(k).not.toContain('invoice_open');

    await sql`update store_settings set billing_hold = false where tenant_id = ${tenantId}`;
    await sql`update subscriptions set status = 'past_due' where tenant_id = ${tenantId}`;
    await sql`update payment_connections set status = 'disconnected' where tenant_id = ${tenantId}`;
    const home = (await owner('GET', '/home')).body.attention as any[];
    k = home.map((a) => a.kind);
    expect(k).toContain('billing_past_due');
    expect(k).toContain('mp_disconnected');
    const inv = home.find((a) => a.kind === 'invoice_open');
    expect(inv.title).toBe('A fatura do plano vence em 2 dias');
    expect(inv.detail).toContain('39,90');
    expect(inv.href).toBe('/conta');

    await sql`update payment_connections set status = 'restricted' where tenant_id = ${tenantId}`;
    expect(await kinds()).toContain('mp_restricted');
    await sql`delete from payment_connections where tenant_id = ${tenantId}`;
    await sql`delete from invoices where tenant_id = ${tenantId}`;
    await sql`delete from subscriptions where tenant_id = ${tenantId}`;
  });

  test('Relatórios: zone conversion from delivery quotes, places outside every zone', async () => {
    const converted = await checkout();
    const ev = (session: string, props: object) => sql`
      insert into analytics_events (tenant_id, name, at, session_id, props)
      values (${tenantId}, 'delivery_quoted', now(), ${session}, ${sql.json(props as never)})
    `;
    await ev(converted.cartId, { zone: 'Centro', neighborhood: 'Centro', eligible: true });
    await ev(converted.cartId, { zone: 'Centro', neighborhood: 'Centro', eligible: true });
    await ev(crypto.randomUUID(), { zone: 'Centro', neighborhood: 'Centro', eligible: true });
    const lost = crypto.randomUUID();
    await ev(lost, { zone: null, neighborhood: 'Itaúna', eligible: false });
    await ev(lost, { zone: null, neighborhood: 'itaúna', eligible: false });
    await ev(crypto.randomUUID(), { zone: null, neighborhood: 'Itaúna', eligible: false });
    await ev(crypto.randomUUID(), { zone: null, neighborhood: 'Jaconé', eligible: false });

    // the quote that app.ts records for a real cart
    const q = await call('POST', '/checkout/v1/quote', { neighborhood: 'Centro' }, converted.auth);
    expect(q.status).toBe(200);

    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const r = await owner('GET', `/reports?from=${day}&to=${day}`);
    expect(r.status).toBe(200);
    const centro = r.body.zones.find((z: any) => z.name === 'Centro');
    expect(centro.quotes).toBe(2);
    expect(centro.conversion).toBe(0.5);
    const pickup = r.body.zones.find((z: any) => z.name === 'Retirada');
    expect(pickup.quotes).toBe(0);
    expect(pickup.conversion).toBeNull();
    expect(r.body.outOfZone[0]).toMatchObject({ quotes: 2 });
    expect(r.body.outOfZone[0].neighborhood.toLowerCase()).toBe('itaúna');
    expect(r.body.outOfZone[1]).toEqual({ neighborhood: 'Jaconé', quotes: 1 });
  });

  test('incidents: staff post and resolve, Ajuda and Início show them', async () => {
    const ctl = (method: string, path: string, body?: unknown, key = `${nonce}-${++idem}`) =>
      call(method, `/control/v1${path}`, body, {
        'x-vendua-control': 'ctl',
        'idempotency-key': key,
      });
    expect((await call('GET', '/control/v1/incidents')).status).toBe(404);
    expect((await ctl('POST', '/incidents', { title: 'x', severity: 'degraded' })).status).toBe(
      422,
    );
    const key = `${nonce}-inc`;
    const made = await ctl(
      'POST',
      '/incidents',
      { title: `ta-${nonce} Pix atrasando`, body: 'Os Pix estão demorando.', severity: 'degraded' },
      key,
    );
    expect(made.status).toBe(201);
    const inc = made.body.incident;
    incidentIds.push(inc.id);
    expect(inc).toMatchObject({ severity: 'degraded', resolvedAt: null });
    const again = await ctl(
      'POST',
      '/incidents',
      { title: `ta-${nonce} outra`, severity: 'info' },
      key,
    );
    expect(again.body.incident.id).toBe(inc.id);
    // the same key on PATCH is its own request, and PATCH keys are per incident
    const patched = await ctl('PATCH', `/incidents/${inc.id}`, { severity: 'outage' }, key);
    expect(patched.status).toBe(200);
    expect(patched.body.incident.severity).toBe('outage');
    const other = await ctl('POST', '/incidents', {
      title: `ta-${nonce} segundo`,
      severity: 'info',
    });
    incidentIds.push(other.body.incident.id);
    const patched2 = await ctl(
      'PATCH',
      `/incidents/${other.body.incident.id}`,
      { severity: 'degraded' },
      key,
    );
    expect(patched2.body.incident.id).toBe(other.body.incident.id);
    expect(patched2.body.incident.severity).toBe('degraded');
    await ctl('PATCH', `/incidents/${other.body.incident.id}`, { resolved: true });

    // status.vendua.com.br probes the fleet, not one hardcoded tenant
    const feed = await call('GET', '/admin/v1/status');
    expect(feed.status).toBe(200);
    expect(feed.body.stores.length).toBeGreaterThan(0);
    expect(feed.body.stores.length).toBeLessThanOrEqual(3);
    for (const h of feed.body.stores) expect(h).toMatch(/^[a-z0-9-]+\.[a-z0-9.-]+$/);

    const help = await owner('GET', '/help/status');
    expect(help.body.incidents.some((i: any) => i.id === inc.id)).toBe(true);
    const home = await owner('GET', '/home');
    expect(home.body.attention.some((a: any) => a.kind === 'incident' && a.href === '/ajuda')).toBe(
      true,
    );

    const list = await ctl('GET', '/incidents');
    expect(list.body.incidents.some((i: any) => i.id === inc.id)).toBe(true);
    const done = await ctl('PATCH', `/incidents/${inc.id}`, { resolved: true, severity: 'info' });
    expect(done.status).toBe(200);
    expect(done.body.incident.resolvedAt).toBeTruthy();
    expect(done.body.incident.severity).toBe('info');
    expect(
      (await ctl('PATCH', `/incidents/${crypto.randomUUID()}`, { resolved: true })).status,
    ).toBe(404);
    expect((await ctl('PATCH', '/incidents/nope', { resolved: true })).status).toBe(400);
    const after = await owner('GET', '/help/status');
    expect(after.body.incidents.find((i: any) => i.id === inc.id).resolvedAt).toBeTruthy();

    // status.vendua.com.br: no session, the same public fields
    const pub = await call('GET', '/admin/v1/status');
    expect(pub.status).toBe(200);
    const shown = pub.body.incidents.find((i: any) => i.id === inc.id);
    expect(Object.keys(shown).sort()).toEqual(
      ['body', 'id', 'resolvedAt', 'severity', 'startedAt', 'title'].sort(),
    );
    expect(shown.resolvedAt).toBeTruthy();
  });

  test('prefs keep the alert and invoice switches', async () => {
    const r = await owner('PATCH', '/me', {
      prefs: { pushPayments: false, whatsappAlerts: false, emailInvoices: true, junk: 1 },
    });
    expect(r.body.user.prefs).toMatchObject({
      pushPayments: false,
      whatsappAlerts: false,
      emailInvoices: true,
    });
    expect(r.body.user.prefs.junk).toBeUndefined();
  });
});
