import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { mountBundleManifest, mountBundleZip } from '../src/admin/app-bundle.ts';
import { clientOf } from '../src/admin/auth.ts';
import type { MerchantNotify } from '../src/admin/context.ts';
import { apnsPayload, fcmMessage } from '../src/admin/nativepush.ts';
import { appleAppSiteAssociation } from '../src/admin/well-known.ts';
import { pushManagers } from '../src/admin/workers.ts';

// The merchant admin as an iOS/Android app (ADR 0044): the session as a bearer token, CORS for
// the app's two origins, the shell's version floor, the over-the-air bundle, native alerts, the
// App Review sign-in and the links into the app.

const fakeCtx = (h: Record<string, string>) =>
  ({ req: { header: (n: string) => h[n.toLowerCase()] } }) as unknown as Context;

describe('x-vendua-client (unit)', () => {
  test('the app names its platform, version, native level and bundle; anything else is web', () => {
    expect(clientOf(fakeCtx({ 'x-vendua-client': 'ios/1.0.0/1/1.0.0-abc123' }))).toEqual({
      kind: 'ios',
      version: '1.0.0',
      native: 1,
      bundle: '1.0.0-abc123',
    });
    expect(clientOf(fakeCtx({ 'x-vendua-client': 'android/1.2.0/3/b' })).kind).toBe('android');
    expect(clientOf(fakeCtx({ 'x-vendua-client': 'web/0123456789ab' }))).toEqual({
      kind: 'web',
      build: '0123456789ab',
    });
    for (const odd of [
      'ios/1.0.0/x/b',
      'ios/1.0.0/1',
      'ios/1/1/b/extra',
      'ios/a b/1/c',
      'x'.repeat(300),
    ])
      expect(clientOf(fakeCtx({ 'x-vendua-client': odd })).kind).toBe('web');
    expect(clientOf(fakeCtx({})).kind).toBe('web');
  });
});

describe('native alert payloads (unit)', () => {
  const order = {
    title: 'Pedido #12 chegou',
    body: 'Ana · R$ 30,00 · entrega',
    tag: 'order-o1',
    url: '/admin/pedidos/o1',
    orderId: 'o1',
    actions: [{ action: 'accept', title: 'aceitar' }],
  };
  test('APNs: the chime and time-sensitive for an order, its "Aceitar" category, collapse by tag', () => {
    const p = apnsPayload(order);
    expect(p.aps).toMatchObject({
      sound: 'pedido-novo.caf',
      'interruption-level': 'time-sensitive',
      category: 'ORDER',
      'thread-id': 'order-o1',
    });
    expect(p).toMatchObject({ url: '/admin/pedidos/o1', orderId: 'o1', tag: 'order-o1' });
    const plain = apnsPayload({ title: 't', body: 'b', tag: 'payment-o1', url: '/admin/' });
    expect(plain.aps.sound).toBe('default');
    expect(plain.aps['interruption-level']).toBe('active');
    expect('category' in plain.aps).toBe(false);
  });
  test('FCM: data only (the app draws it), strings, high priority, collapsed by tag', () => {
    const m = fcmMessage('tok', order).message;
    expect('notification' in m).toBe(false);
    expect(m.data).toEqual({
      title: order.title,
      body: order.body,
      tag: 'order-o1',
      url: '/admin/pedidos/o1',
      orderId: 'o1',
      actions: JSON.stringify(order.actions),
    });
    expect(m.android).toEqual({ priority: 'high', ttl: '3600s', collapse_key: 'order-o1' });
  });
});

describe('the app bundle and links (unit)', () => {
  let dir = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'vendua-bundle-'));
    writeFileSync(join(dir, '1.0.0-abc.zip'), 'zipbytes');
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({ version: '1.0.0-abc', sha256: 'a'.repeat(64), requiresNative: 2 }),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const app = () => {
    const a = new Hono();
    a.onError((e, c) => c.json({}, ((e as { status?: number }).status ?? 500) as 404));
    const admin = new Hono();
    mountBundleManifest(admin, dir);
    a.route('/admin/v1', admin);
    mountBundleZip(a, dir);
    return a;
  };

  test('a shell at the native level gets the bundle; an older one is told to update in the store', async () => {
    const ok: any = await (await app().request('/admin/v1/app/bundle?native=2')).json();
    expect(ok).toEqual({
      version: '1.0.0-abc',
      url: '/admin/app/bundle/1.0.0-abc.zip',
      sha256: 'a'.repeat(64),
      requiresNative: 2,
    });
    const old: any = await (await app().request('/admin/v1/app/bundle?native=1')).json();
    expect(old).toEqual({ version: null, url: null, sha256: null, requiresNative: 2 });
    // the shell's level also comes from its x-vendua-client
    const byHeader: any = await (
      await app().request('/admin/v1/app/bundle', {
        headers: { 'x-vendua-client': 'android/1.0.0/2/builtin' },
      })
    ).json();
    expect(byHeader.version).toBe('1.0.0-abc');
  });

  test('only the version this image carries is served', async () => {
    const zip = await app().request('/admin/app/bundle/1.0.0-abc.zip');
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(await zip.text()).toBe('zipbytes');
    expect((await app().request('/admin/app/bundle/0.9.0-old.zip')).status).toBe(404);
    expect((await app().request('/admin/app/bundle/..%2Fmanifest.json')).status).toBe(404);
  });

  test('Universal Links skip the API, the bundle and the website-only signup', () => {
    const aasa = appleAppSiteAssociation(['TEAM.br.com.vendua.painel']);
    const comps = aasa.applinks.details[0]!.components as Record<string, unknown>[];
    const excluded = comps.filter((c) => c.exclude).map((c) => c['/'] ?? c['?']);
    expect(excluded).toContainEqual('/admin/v1/*');
    expect(excluded).toContainEqual('/admin/comecar*');
    // the excludes come before the catch-all: the first match wins
    const firstInclude = comps.findIndex((c) => !c.exclude);
    expect(comps.slice(firstInclude).some((c) => c.exclude)).toBe(false);
    expect(comps.slice(firstInclude).map((c) => c['/'])).toContain('/admin/*');
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('the admin as an app (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const codes = new Map<string, string>();
  const notify: MerchantNotify = { whatsapp: async () => {}, email: async () => {} };
  const otpSender = async (phone: string, text: string) => {
    codes.set(phone, /(\d{6})/.exec(text)![1]!);
  };
  const mkApp = () =>
    createApp({
      sql: appSql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      cepLookup: async () => null,
      storeDomain: 'vendua.test',
      notify,
      otpSender,
    });

  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const ownerPhone = `2181${stamp}`;
  const managerPhone = `2182${stamp}`;
  const demoPhone = `2183${stamp}`;
  const mixedPhone = `2184${stamp}`;
  let store = '';
  let demo = '';
  let managerId = '';
  let idem = 0;
  const APP = 'ios/1.0.0/1/test';
  const saved = { ...process.env };

  type Call = {
    status: number;
    body: any;
    cookie: string | undefined;
    headers: Headers;
  };
  const call = async (
    app: ReturnType<typeof mkApp>,
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Call> => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET' || method === 'OPTIONS'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...opts.headers,
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const cookieOut = /vendua_admin=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return {
      status: res.status,
      body,
      cookie: cookieOut ? `vendua_admin=${cookieOut}` : undefined,
      headers: res.headers,
    };
  };

  /** OTP sign-in as the app: the session comes back as a token, never a cookie */
  const appSignIn = async (app: ReturnType<typeof mkApp>, phone: string, storeId = store) => {
    const h = { 'x-vendua-client': APP };
    // many sign-ins of one phone here: the per-hour code cap isn't what's under test
    await sql`update merchant_login_codes set created_at = created_at - interval '2 hours' where phone = ${phone}`;
    await call(app, 'POST', '/admin/v1/auth/otp/start', { body: { phone }, headers: h });
    let r = await call(app, 'POST', '/admin/v1/auth/otp/verify', {
      body: { phone, code: codes.get(phone) },
      headers: h,
    });
    expect(r.status).toBe(200);
    if (!r.body.signedIn)
      r = await call(app, 'POST', '/admin/v1/auth/select', {
        body: { pickerToken: r.body.pickerToken, storeId },
        headers: h,
      });
    expect(r.body.signedIn).toBe(true);
    expect(r.cookie).toBeUndefined();
    expect(typeof r.body.token).toBe('string');
    return r.body.token as string;
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'x-vendua-client': APP });

  beforeAll(async () => {
    const mk = async (s: string, isDemo = false) =>
      (
        await sql<{ id: string }[]>`
          insert into tenants (slug, name, is_demo) values (${s}, ${'Loja ' + s}, ${isDemo}) returning id`
      )[0]!.id;
    store = await mk(`appx-${nonce}`);
    demo = await mk(`appdemo-${nonce}`, true);
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${store}, 'Dona', ${ownerPhone}, 'owner')`;
    managerId = (
      await sql<{ id: string }[]>`
        insert into merchant_users (tenant_id, name, phone, role)
        values (${store}, 'Gerente', ${managerPhone}, 'manager') returning id`
    )[0]!.id;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${demo}, 'Revisão', ${demoPhone}, 'owner')`;
    // a phone in a demo store AND a real one: the review code must not open either
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${demo}, 'Misto', ${mixedPhone}, 'manager')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${store}, 'Misto', ${mixedPhone}, 'attendant')`;
  });

  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  afterAll(async () => {
    const phones = [ownerPhone, managerPhone, demoPhone, mixedPhone];
    await sql`delete from merchant_login_failures where phone = any(${phones})`;
    await sql`delete from merchant_login_codes where phone = any(${phones})`;
    await sql`delete from staff_events where tenant_id in (${store}, ${demo})`;
    if (store) await sql`delete from tenants where id in (${store}, ${demo})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('the app signs in with a token: same session row, bearer on every call, never a cookie', async () => {
    const app = mkApp();
    const token = await appSignIn(app, ownerPhone);
    const me = await call(app, 'GET', '/admin/v1/session', { headers: bearer(token) });
    expect(me.status).toBe(200);
    expect(me.body.store.id).toBe(store);
    expect(me.body.push).toEqual({ publicKey: null, ios: false, android: false });
    // "Aparelhos conectados" names the app
    const sessions = await call(app, 'GET', '/admin/v1/me/sessions', { headers: bearer(token) });
    expect(sessions.body.sessions[0].device).toMatch(/^VenduaApp\/ios 1\.0\.0 /);
    // the cookie value works as a bearer and vice versa: one session, two transports
    expect(
      (
        await call(app, 'GET', '/admin/v1/session', {
          headers: { cookie: `vendua_admin=${token}` },
        })
      ).status,
    ).toBe(200);
  });

  test('a bearer mutation needs x-vendua-admin but no same-host Origin; a cookie one still does', async () => {
    const app = mkApp();
    const token = await appSignIn(app, ownerPhone);
    const fromApp = await call(app, 'PATCH', '/admin/v1/me', {
      body: { name: 'Dona' },
      headers: { ...bearer(token), origin: 'capacitor://localhost' },
    });
    expect(fromApp.status).toBe(200);
    const noMarker = await app.request('http://core.localhost/admin/v1/me', {
      method: 'PATCH',
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-${++idem}`,
        ...bearer(token),
      },
      body: JSON.stringify({ name: 'Dona' }),
    });
    expect(noMarker.status).toBe(403);
    const cookieCross = await call(app, 'PATCH', '/admin/v1/me', {
      body: { name: 'Dona' },
      headers: { cookie: `vendua_admin=${token}`, origin: 'https://evil.example' },
    });
    expect(cookieCross.status).toBe(403);
    expect(cookieCross.body.error.code).toBe('CSRF');
  });

  test('a request never uses both: a bad Authorization is a 401 even with a good cookie', async () => {
    const app = mkApp();
    const token = await appSignIn(app, ownerPhone);
    for (const auth of ['Bearer ', 'Basic abc', `Bearer ${token}x`, `bearer ${token}`]) {
      const r = await call(app, 'GET', '/admin/v1/session', {
        headers: { authorization: auth, cookie: `vendua_admin=${token}` },
      });
      expect(r.status).toBe(401);
    }
  });

  test('CORS: the two app origins on the admin API, without credentials; no one else gains', async () => {
    const app = mkApp();
    for (const origin of ['capacitor://localhost', 'https://localhost']) {
      const pre = await call(app, 'OPTIONS', '/admin/v1/session', {
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,x-vendua-admin,idempotency-key',
        },
      });
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe(origin);
      expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
      expect(pre.headers.get('access-control-allow-credentials')).toBeNull();
      const get = await call(app, 'GET', '/admin/v1/session', { headers: { origin } });
      expect(get.status).toBe(401);
      // the app reads the 401 to show sign-in
      expect(get.headers.get('access-control-allow-origin')).toBe(origin);
      expect(get.headers.get('access-control-allow-credentials')).toBeNull();
    }
    const evil = await call(app, 'GET', '/admin/v1/session', {
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    // a storefront's API stays same-host only, app origin or not
    const shop = await call(app, 'OPTIONS', '/checkout/v1/session', {
      headers: { origin: 'capacitor://localhost', 'access-control-request-method': 'POST' },
    });
    expect(shop.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('an app shell below VENDUA_ADMIN_MIN_NATIVE gets 426 CLIENT_TOO_OLD; the web never does', async () => {
    process.env.VENDUA_ADMIN_MIN_NATIVE = '2';
    const app = mkApp();
    const old = await call(app, 'POST', '/admin/v1/auth/otp/start', {
      body: { phone: ownerPhone },
      headers: { 'x-vendua-client': 'android/1.0.0/1/b', origin: 'https://localhost' },
    });
    expect(old.status).toBe(426);
    expect(old.body.error.code).toBe('CLIENT_TOO_OLD');
    expect(old.headers.get('access-control-allow-origin')).toBe('https://localhost');
    const now = await call(app, 'POST', '/admin/v1/auth/otp/start', {
      body: { phone: ownerPhone },
      headers: { 'x-vendua-client': 'android/1.1.0/2/b' },
    });
    expect(now.status).toBe(200);
    const web = await call(app, 'POST', '/admin/v1/auth/otp/start', {
      body: { phone: ownerPhone },
      headers: { 'x-vendua-client': 'web/abc' },
    });
    expect(web.status).toBe(200);
  });

  test('push devices follow the session: sair, encerrar sessão and leaving the team drop them', async () => {
    const app = mkApp();
    const register = async (token: string, device: string) => {
      const r = await call(app, 'POST', '/admin/v1/push/devices', {
        body: { platform: 'ios', token: device, appVersion: '1.0.0' },
        headers: bearer(token),
      });
      expect(r.status).toBe(201);
    };
    const count = async (device: string) =>
      (
        await sql<
          { n: number }[]
        >`select count(*)::int as n from push_devices where token = ${device}`
      )[0]!.n;
    const bad = await call(app, 'POST', '/admin/v1/push/devices', {
      body: { platform: 'symbian', token: 'x'.repeat(64) },
      headers: bearer(await appSignIn(app, ownerPhone)),
    });
    expect(bad.status).toBe(422);

    // sair
    const a = await appSignIn(app, ownerPhone);
    await register(a, `dev-a-${nonce}`);
    expect(await count(`dev-a-${nonce}`)).toBe(1);
    expect((await call(app, 'POST', '/admin/v1/auth/logout', { headers: bearer(a) })).status).toBe(
      200,
    );
    expect(await count(`dev-a-${nonce}`)).toBe(0);
    expect((await call(app, 'GET', '/admin/v1/session', { headers: bearer(a) })).status).toBe(401);

    // encerrar sessão, from another device
    const b = await appSignIn(app, ownerPhone);
    await register(b, `dev-b-${nonce}`);
    const other = await appSignIn(app, ownerPhone);
    const list = await call(app, 'GET', '/admin/v1/me/sessions', { headers: bearer(other) });
    const bId = list.body.sessions.find((s: any) => !s.current && b.split('.')[1] === s.id)?.id;
    expect(bId).toBe(b.split('.')[1]);
    expect(
      (await call(app, 'DELETE', `/admin/v1/me/sessions/${bId}`, { headers: bearer(other) }))
        .status,
    ).toBe(200);
    expect(await count(`dev-b-${nonce}`)).toBe(0);

    // removed from the team
    const m = await appSignIn(app, managerPhone);
    await register(m, `dev-m-${nonce}`);
    expect(
      (await call(app, 'DELETE', `/admin/v1/team/${managerId}`, { headers: bearer(other) })).status,
    ).toBe(200);
    expect(await count(`dev-m-${nonce}`)).toBe(0);
    // an alert attempt for a device keeps its row (device_id goes null when the device does)
    await sql`update merchant_users set status = 'active' where id = ${managerId}`;
  });

  test('alerts reach the app through FCM; an uninstalled app is deleted, the attempt kept', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({
      project_id: 'vendua-test',
      client_email: 'push@vendua-test.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    });
    const app = mkApp();
    const token = await appSignIn(app, ownerPhone);
    const live = `fcm-live-${nonce}`;
    const dead = `fcm-dead-${nonce}`;
    for (const device of [live, dead])
      expect(
        (
          await call(app, 'POST', '/admin/v1/push/devices', {
            body: { platform: 'android', token: device },
            headers: bearer(token),
          })
        ).status,
      ).toBe(201);
    const me = await call(app, 'GET', '/admin/v1/session', { headers: bearer(token) });
    expect(me.body.push.android).toBe(true);

    const sent: { url: string; body: any }[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://oauth2.googleapis.com/'))
        return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
      if (url.startsWith('https://fcm.googleapis.com/')) {
        const body = JSON.parse(String(init?.body));
        sent.push({ url, body });
        return body.message.token === dead
          ? Response.json(
              { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
              { status: 404 },
            )
          : Response.json({ name: 'projects/vendua-test/messages/1' });
      }
      return realFetch(input, init);
    }) as typeof fetch;
    try {
      await pushManagers(
        appSql,
        store,
        `app-test:${nonce}`,
        {
          title: 'Status do dia pronto',
          body: 'b',
          tag: 'status-do-dia',
          url: '/admin/marketing/status',
        },
        'status.ready',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(sent.map((s) => s.url)).toEqual([
      'https://fcm.googleapis.com/v1/projects/vendua-test/messages:send',
      'https://fcm.googleapis.com/v1/projects/vendua-test/messages:send',
    ]);
    expect(sent[0]!.body.message.data.url).toBe('/admin/marketing/status');
    const rows = await sql<{ token: string; last_ok_at: Date | null }[]>`
      select token, last_ok_at from push_devices where token in (${live}, ${dead})`;
    expect(rows.map((r) => r.token)).toEqual([live]);
    expect(rows[0]!.last_ok_at).not.toBeNull();
    const attempts = await sql<{ result: string; device_id: string | null }[]>`
      select result, device_id from push_attempts
      where tenant_id = ${store} and ref = ${`app-test:${nonce}`} order by result`;
    expect(attempts.map((a) => a.result)).toEqual(['gone', 'ok']);
    expect(attempts.find((a) => a.result === 'ok')!.device_id).not.toBeNull();
    // Perfil › Avisos lists it as the app
    const alerts = await call(app, 'GET', '/admin/v1/alerts', { headers: bearer(token) });
    expect(alerts.body.devices.some((d: any) => d.device === 'VenduaApp/android')).toBe(true);
    await sql`delete from push_devices where tenant_id = ${store}`;
  });

  test('the review sign-in opens a demo store only, counts wrong codes, and the team hears it', async () => {
    process.env.VENDUA_REVIEW_LOGIN = `${demoPhone}:246810`;
    const app = mkApp();
    const h = { 'x-vendua-client': APP };
    // nothing is sent for the review phone: its code is fixed
    codes.delete(demoPhone);
    await call(app, 'POST', '/admin/v1/auth/otp/start', { body: { phone: demoPhone }, headers: h });
    expect(codes.has(demoPhone)).toBe(false);
    const wrong = await call(app, 'POST', '/admin/v1/auth/otp/verify', {
      body: { phone: demoPhone, code: '111111' },
      headers: h,
    });
    expect(wrong.status).toBe(422);
    expect(
      (
        await sql<
          { n: number }[]
        >`select count(*)::int as n from merchant_login_failures where phone = ${demoPhone}`
      )[0]!.n,
    ).toBe(1);
    const ok = await call(app, 'POST', '/admin/v1/auth/otp/verify', {
      body: { phone: demoPhone, code: '246810' },
      headers: h,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.signedIn).toBe(true);
    expect(ok.body.store.id).toBe(demo);
    const ev = await sql<{ kind: string; data: Record<string, unknown> }[]>`
      select kind, data from staff_events where tenant_id = ${demo} and kind = 'auth.review_login'`;
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0]!.data)).not.toContain(demoPhone);

    // a phone that also reaches a real store: the fixed code opens nothing
    process.env.VENDUA_REVIEW_LOGIN = `${mixedPhone}:246810`;
    const mixed = await call(app, 'POST', '/admin/v1/auth/otp/verify', {
      body: { phone: mixedPhone, code: '246810' },
      headers: h,
    });
    expect(mixed.status).toBe(422);

    // the IP's ceiling holds for the review phone too
    process.env.VENDUA_REVIEW_LOGIN = `${demoPhone}:246810`;
    await sql`
      insert into merchant_login_failures (phone, ip_hash)
      select ${demoPhone}, 'other-ip' from generate_series(1, 30)`;
    const locked = await call(mkApp(), 'POST', '/admin/v1/auth/otp/verify', {
      body: { phone: demoPhone, code: '246810' },
      headers: h,
    });
    expect(locked.status).toBe(422);
  });

  test('/.well-known: the app links once the app ids are set, 404 before', async () => {
    const app = mkApp();
    expect((await call(app, 'GET', '/.well-known/apple-app-site-association')).status).toBe(404);
    expect((await call(app, 'GET', '/.well-known/assetlinks.json')).status).toBe(404);
    process.env.VENDUA_IOS_APP_IDS = 'TEAM123456.br.com.vendua.painel';
    process.env.VENDUA_ANDROID_CERT_SHA256 = 'AA:BB';
    const aasa = await call(app, 'GET', '/.well-known/apple-app-site-association');
    expect(aasa.status).toBe(200);
    expect(aasa.body.applinks.details[0].appIDs).toEqual(['TEAM123456.br.com.vendua.painel']);
    const links = await call(app, 'GET', '/.well-known/assetlinks.json');
    expect(links.body[0].target).toEqual({
      namespace: 'android_app',
      package_name: 'br.com.vendua.painel',
      sha256_cert_fingerprints: ['AA:BB'],
    });
  });
});
