import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import {
  normalizeSlug,
  readSignupToken,
  signupToken,
  startSignupOtp,
} from '../src/modules/billing/signup.ts';
import { billingStaff } from '../src/modules/billing/subscriptions.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

describe('signup units', () => {
  test('slugs normalize like slugify, capped at 40', () => {
    expect(normalizeSlug('Açaí da Praia!!')).toBe('acai-da-praia');
    expect(normalizeSlug('  --Doces   da Maria-- ')).toBe('doces-da-maria');
    expect(normalizeSlug('!!!')).toBe('');
    expect(normalizeSlug('a'.repeat(50))).toHaveLength(40);
  });

  test('signup tokens are signed, bound to the phone, and expire', () => {
    const t = signupToken('s', '21999990000');
    expect(readSignupToken('s', t)).toBe('21999990000');
    expect(readSignupToken('other', t)).toBeNull();
    expect(readSignupToken('s', t.replace('21999990000', '21999990001'))).toBeNull();
    expect(
      readSignupToken('s', signupToken('s', '21999990000', Date.now() - 31 * 60_000)),
    ).toBeNull();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('self-serve signup (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  // provider ids are process-local counters; start past anything another run left behind
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const staff: { subject: string; body: string }[] = [];
  const deps = {
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    paymentProvider: fake,
    notify: {
      whatsapp: async (phone: string, text: string) => void wa.push({ phone, text }),
      email: async () => {},
    },
  };
  const app = createApp(deps);
  const nonce = crypto.randomUUID().slice(0, 6);
  const mkPhone = (n: number) => `219${String(Date.now() + n * 17).slice(-8)}`;
  const created: string[] = [];
  let idem = 0;
  const originalStaff = billingStaff.notify;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    via = app,
  ) => {
    const res = await via.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };

  const verified = async (phone: string, via = app) => {
    const start = await call('POST', '/admin/v1/signup/otp/start', { phone }, {}, via);
    expect(start.status).toBe(200);
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const v = await call('POST', '/admin/v1/signup/otp/verify', { phone, code }, {}, via);
    expect(v.status).toBe(200);
    return v.body as { signupToken: string; existingStores: any[] };
  };

  const signup = async (
    token: string,
    slug: string,
    extra: Record<string, unknown> = {},
    via = app,
  ) => {
    const r = await call(
      'POST',
      '/admin/v1/signup',
      {
        signupToken: token,
        planId: 'basic',
        method: 'pix',
        storeName: 'Doces da Praia',
        slug,
        ownerName: 'Ana Lima',
        email: 'ana@example.com',
        ...extra,
      },
      {},
      via,
    );
    if (r.body?.store?.id && !created.includes(r.body.store.id)) created.push(r.body.store.id);
    return r;
  };

  const session = (cookie: string | null) => {
    const value = /vendua_admin=([^;]+)/.exec(cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}` });
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    billingStaff.notify = async (_sql, n) => void staff.push({ subject: n.subject, body: n.body });
  });

  afterAll(async () => {
    billingStaff.notify = originalStaff;
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('plans and slug check', async () => {
    const plans = await call('GET', '/admin/v1/signup/plans');
    expect(plans.status).toBe(200);
    expect(plans.body.storeDomain).toBe('vendua.test');
    expect(plans.body.billing.available).toBe(true);
    const basic = plans.body.plans.find((p: any) => p.id === 'basic');
    expect(basic).toEqual({
      id: 'basic',
      name: 'Venduá Basic',
      priceCents: 3990,
      feeBps: 0,
      features: { customDomain: false, customSite: false },
    });
    expect(plans.body.plans.find((p: any) => p.id === 'pro_plus').priceCents).toBe(9900);

    const reserved = await call('GET', '/admin/v1/signup/slug?slug=Admin');
    expect(reserved.body).toMatchObject({ slug: 'admin', available: false, reason: 'reserved' });
    expect(reserved.body.suggestion).toMatch(/^admin-\d+$/);
    expect((await call('GET', '/admin/v1/signup/slug?slug=ab')).body.reason).toBe('invalid');
    const free = await call('GET', `/admin/v1/signup/slug?slug=Signup ${nonce} Açaí`);
    expect(free.body).toEqual({ slug: `signup-${nonce}-acai`, available: true });
  });

  test('otp: wrong codes fail, a login code never verifies a signup', async () => {
    const phone = mkPhone(1);
    await call('POST', '/admin/v1/signup/otp/start', { phone });
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const bad = await call('POST', '/admin/v1/signup/otp/verify', {
      phone,
      code: code === '000000' ? '111111' : '000000',
    });
    expect(bad.body.error.code).toBe('INVALID_CODE');
    const ok = await call('POST', '/admin/v1/signup/otp/verify', { phone, code });
    expect(ok.status).toBe(200);
    expect(ok.body.existingStores).toEqual([]);
    const replay = await call('POST', '/admin/v1/signup/otp/verify', { phone, code });
    expect(replay.body.error.code).toBe('INVALID_CODE');
    expect((await call('POST', '/admin/v1/signup', { signupToken: 'x.1.y' })).status).toBe(401);
  });

  let pixStore = '';
  let pixToken = '';
  let pixCookie: string | null = null;
  const pixSlug = `signup-${nonce}-pix`;

  test('pix signup: store paused behind the hold → pay → open, period set', async () => {
    const phone = mkPhone(2);
    pixToken = (await verified(phone)).signupToken;
    const r = await signup(pixToken, pixSlug.toUpperCase());
    expect(r.status).toBe(201);
    expect(r.body.signedIn).toBe(true);
    expect(r.body.store).toMatchObject({ slug: pixSlug, name: 'Doces da Praia', role: 'owner' });
    expect(r.body.next.kind).toBe('pix');
    pixStore = r.body.store.id;
    pixCookie = r.cookie;
    expect(pixCookie).toContain('vendua_admin=');

    const st = (
      await sql`select billing_hold, status_override, pause_message from store_settings where tenant_id = ${pixStore}`
    )[0]!;
    expect(st).toMatchObject({ billing_hold: true, status_override: 'paused' });
    const owner = session(pixCookie);
    const acct = await owner('GET', '/account');
    expect(acct.status).toBe(200);
    expect(acct.body.plan).toMatchObject({ id: 'basic', priceCents: 3990 });
    expect(acct.body.subscription).toMatchObject({
      status: 'pending',
      method: 'pix',
      planId: 'basic',
      payerEmail: 'ana@example.com',
    });
    expect(acct.body.invoices).toHaveLength(1);
    const inv = acct.body.invoices[0];
    expect(inv).toMatchObject({ id: r.body.next.invoiceId, number: 1, amountCents: 3990 });
    expect(inv.pix.copyPaste).toContain('FAKEPIX');
    expect(acct.body.address).toBe(`https://${pixSlug}.vendua.test`);
    const audit =
      await sql`select action, actor_label from audit_log where tenant_id = ${pixStore}`;
    expect(audit.map((a) => a.action)).toContain('store.signup');

    const paid = await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {});
    expect(paid.status).toBe(200);
    const after = await owner('GET', '/account');
    expect(after.body.subscription.status).toBe('active');
    expect(after.body.invoices[0].status).toBe('paid');
    const end = new Date(after.body.subscription.currentPeriodEnd).getTime();
    expect(end - Date.now()).toBeGreaterThan(27 * 86_400_000);
    expect(end - Date.now()).toBeLessThan(32 * 86_400_000);
    const st2 = (
      await sql`select billing_hold, status_override from store_settings where tenant_id = ${pixStore}`
    )[0]!;
    expect(st2).toEqual({ billing_hold: false, status_override: null });
    // the owner can open and close the store as usual
    expect((await owner('POST', '/store/pause', { for: '1h' })).status).toBe(200);
    expect((await owner('POST', '/store/resume', {})).status).toBe(200);

    // a replayed webhook changes nothing
    expect((await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {})).status).toBe(
      200,
    );
    const inv2 = await sql`select status, paid_at from invoices where tenant_id = ${pixStore}`;
    expect(inv2).toHaveLength(1);
  });

  test('the same token+slug again is the same store — no second store, no second charge', async () => {
    const again = await signup(pixToken, pixSlug);
    expect(again.status).toBe(201);
    expect(again.body.store.id).toBe(pixStore);
    expect(again.body.next).toEqual({ kind: 'pix', invoiceId: expect.any(String) });
    expect((await sql`select 1 from tenants where slug = ${pixSlug}`).length).toBe(1);
    expect((await sql`select 1 from invoices where tenant_id = ${pixStore}`).length).toBe(1);
  });

  test('taken and reserved slugs', async () => {
    const other = (await verified(mkPhone(3))).signupToken;
    const taken = await signup(other, pixSlug);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLUG_TAKEN');
    const reserved = await signup(other, 'painel');
    expect(reserved.status).toBe(422);
    expect(reserved.body.error.code).toBe('INVALID_SLUG');
    const slug = await call('GET', `/admin/v1/signup/slug?slug=${pixSlug}`);
    expect(slug.body).toMatchObject({
      available: false,
      reason: 'taken',
      suggestion: `${pixSlug}-2`,
    });
    const bad = await signup(other, `signup-${nonce}-x`, { storeName: 'x' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.field).toBe('storeName');
    const badPlan = await signup(other, `signup-${nonce}-x`, { planId: 'spike' });
    expect(badPlan.body.error.code).toBe('UNKNOWN_PLAN');
  });

  test('card signup → assinatura authorized → active', async () => {
    const token = (await verified(mkPhone(4))).signupToken;
    const r = await signup(token, `signup-${nonce}-card`, { method: 'card' });
    expect(r.status).toBe(201);
    expect(r.body.next.kind).toBe('card');
    expect(r.body.next.url).toContain('/admin/?assinatura=retorno');
    const tenant = r.body.store.id;
    const sub = (
      await sql`select provider_subscription_id, status from subscriptions where tenant_id = ${tenant}`
    )[0]!;
    expect(sub.status).toBe('pending');
    expect(fake.subscriptions.get(sub.provider_subscription_id)!.amountCents).toBe(3990);
    expect(fake.subscriptions.get(sub.provider_subscription_id)!.externalReference).toBe(tenant);
    const s = await call(
      'POST',
      `/admin/v1/dev/billing/subscriptions/${sub.provider_subscription_id}/settle`,
      { status: 'approved' },
    );
    expect(s.status).toBe(200);
    const acct = await session(r.cookie)('GET', '/account');
    expect(acct.body.subscription).toMatchObject({
      status: 'active',
      method: 'card',
      checkoutUrl: null,
    });
    expect(acct.body.invoices[0]).toMatchObject({
      method: 'card',
      status: 'paid',
      amountCents: 3990,
    });
    const st = (await sql`select billing_hold from store_settings where tenant_id = ${tenant}`)[0]!;
    expect(st.billing_hold).toBe(false);
  });

  test('PRO+ signup opens a site request for the team once paid', async () => {
    const token = (await verified(mkPhone(5))).signupToken;
    const r = await signup(token, `signup-${nonce}-pro`, { planId: 'pro_plus' });
    expect(r.status).toBe(201);
    const tenant = r.body.store.id;
    await call('POST', `/admin/v1/dev/billing/invoices/${r.body.next.invoiceId}/pay`, {});
    const reqs = await sql`select status from site_requests where tenant_id = ${tenant}`;
    expect([...reqs]).toEqual([{ status: 'requested' }]);
    expect(staff.some((n) => n.subject.includes('Site PRO+'))).toBe(true);
    const acct = await session(r.cookie)('GET', '/account');
    expect(acct.body.plan.features).toEqual({ customDomain: true, customSite: true });
    expect(acct.body.siteRequest.status).toBe('requested');
  });

  test('signup codes: a durable daily cap per IP', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${nonce}`;
    const notify = { whatsapp: async () => {}, email: async () => {} };
    await startSignupOtp(appSql, mkPhone(7), notify, { ip, perIpDay: 2 });
    await startSignupOtp(appSql, mkPhone(8), notify, { ip, perIpDay: 2 });
    await expect(
      startSignupOtp(appSql, mkPhone(9), notify, { ip, perIpDay: 2 }),
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  test('at most 3 stores per phone per day; billing off → 503', async () => {
    const other = createApp(deps);
    const phone = mkPhone(6);
    const token = (await verified(phone, other)).signupToken;
    // four at once: the per-phone lock lets exactly three through
    const res = await Promise.all(
      [1, 2, 3, 4].map((n) => signup(token, `signup-${nonce}-cap${n}`, {}, other)),
    );
    expect(res.map((r) => r.status).sort()).toEqual([201, 201, 201, 429]);
    expect(res.find((r) => r.status === 429)!.body.error.code).toBe('SIGNUP_LIMIT');
    // the verified phone now sees its stores
    const again = await verified(phone, other);
    expect(again.existingStores).toHaveLength(3);

    fake.platformConfigured = false;
    try {
      const off = await signup(token, `signup-${nonce}-off`, {}, other);
      expect(off.status).toBe(503);
      expect(off.body.error.code).toBe('BILLING_UNAVAILABLE');
    } finally {
      fake.platformConfigured = true;
    }
  });

  test('access code: billing off, the store opens with no subscription; wrong or short codes fail', async () => {
    const other = createApp(deps);
    const token = (await verified(mkPhone(7), other)).signupToken;
    const slug = `signup-${nonce}-code`;
    const before = process.env.VENDUA_SIGNUP_ACCESS_CODE;
    fake.platformConfigured = false;
    try {
      process.env.VENDUA_SIGNUP_ACCESS_CODE = 'short-code';
      expect((await call('GET', '/admin/v1/signup/plans')).body.billing).toEqual({
        available: false,
        accessCode: false,
      });
      const short = await signup(token, slug, { accessCode: 'short-code' }, other);
      expect(short.body.error.code).toBe('INVALID_ACCESS_CODE');

      process.env.VENDUA_SIGNUP_ACCESS_CODE = ' abre-sem-mp-1234 ';
      expect((await call('GET', '/admin/v1/signup/plans')).body.billing.accessCode).toBe(true);
      const wrong = await signup(token, slug, { accessCode: 'abre-sem-mp-0000' }, other);
      expect(wrong.status).toBe(422);
      expect(wrong.body.error).toMatchObject({
        code: 'INVALID_ACCESS_CODE',
        details: { field: 'accessCode' },
      });
      // no code still needs billing
      expect((await signup(token, slug, {}, other)).status).toBe(503);

      const r = await signup(
        token,
        slug,
        { accessCode: 'abre-sem-mp-1234', method: undefined },
        other,
      );
      expect(r.status).toBe(201);
      expect(r.body.next).toEqual({ kind: 'open' });
      const id = r.body.store.id;
      const st = (
        await sql`select billing_hold, status_override from store_settings where tenant_id = ${id}`
      )[0]!;
      expect(st).toEqual({ billing_hold: false, status_override: null });
      expect((await sql`select 1 from subscriptions where tenant_id = ${id}`).length).toBe(0);
      expect((await sql`select 1 from invoices where tenant_id = ${id}`).length).toBe(0);
      const acct = await session(r.cookie)('GET', '/account');
      expect(acct.body.plan.id).toBe('basic');
      expect(acct.body.subscription).toBeNull();

      // a replay finds the same store and audits once
      const again = await signup(token, slug, { accessCode: 'abre-sem-mp-1234' }, other);
      expect(again.status).toBe(201);
      expect(again.body.store.id).toBe(id);
      const audit =
        await sql`select action from audit_log where tenant_id = ${id} and action = 'store.signup'`;
      expect(audit).toHaveLength(1);

      // a store already on the paid path never opens by code
      fake.platformConfigured = true;
      const paidSlug = `signup-${nonce}-code-paid`;
      const paid = await signup(token, paidSlug, {}, other);
      expect(paid.status).toBe(201);
      const sneak = await signup(token, paidSlug, { accessCode: 'abre-sem-mp-1234' }, other);
      expect(sneak.status).toBe(409);
      const held = (
        await sql`select billing_hold from store_settings where tenant_id = ${paid.body.store.id}`
      )[0]!;
      expect(held.billing_hold).toBe(true);
    } finally {
      fake.platformConfigured = true;
      if (before === undefined) delete process.env.VENDUA_SIGNUP_ACCESS_CODE;
      else process.env.VENDUA_SIGNUP_ACCESS_CODE = before;
    }
  });
});
