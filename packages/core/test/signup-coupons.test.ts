import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import {
  describeCoupon,
  generateCouponCode,
  normalizeCouponCode,
} from '../src/modules/billing/coupons.ts';
import { runBillingTick } from '../src/modules/billing/jobs.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

// ADR 0042: coupons for Venduá signups — free days and/or a % or R$ discount on the first paid
// months, one-time or with max uses, made in the CRM.

const DAY = 86_400_000;

describe('signup coupon units', () => {
  test('codes: any case and spacing in, the stored form out; junk is not a code', () => {
    expect(normalizeCouponCode(' amigo-7kq2 ')).toBe('AMIGO-7KQ2');
    expect(normalizeCouponCode('am igo')).toBe('AMIGO');
    for (const bad of ['', 'ab', '-ABC', 'AB_C', 'x'.repeat(41), 42, null])
      expect(normalizeCouponCode(bad)).toBe('');
  });

  test('generated codes: unambiguous letters, an optional prefix', () => {
    expect(generateCouponCode(null)).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(generateCouponCode('FEIRA')).toMatch(/^FEIRA-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });

  test('what a coupon gives, in words', () => {
    expect(describeCoupon({ code: 'X', freeDays: 30, discount: null })).toBe('30 dias grátis');
    expect(
      describeCoupon({
        code: 'X',
        freeDays: 0,
        discount: { kind: 'percent', value: 50, months: 3 },
      }),
    ).toBe('50% de desconto nos 3 primeiros meses');
    expect(
      describeCoupon({
        code: 'X',
        freeDays: 1,
        discount: { kind: 'amount', value: 2000, months: 1 },
      }),
    ).toMatch(/^1 dia grátis e R\$\s?20,00 de desconto no primeiro mês$/);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('signup coupons (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const notify = {
    whatsapp: async (phone: string, text: string) => void wa.push({ phone, text }),
    email: async () => {},
  };
  const deps = {
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    paymentProvider: fake,
    signupReady: async () => ({ on: true, whatsapp: true, email: true, billing: true, open: true }),
    notify,
  };
  // signup's per-IP limits live in each app: every test gets its own budget
  let app = createApp(deps);
  const tick = (now = new Date()) =>
    runBillingTick(
      appSql,
      {
        provider: fake,
        notify,
        adminOrigin: 'https://painel.vendua.test',
        storeDomain: 'vendua.test',
      },
      now,
    );
  const nonce = crypto.randomUUID().slice(0, 6).toUpperCase();
  let seq = 0;
  const mkPhone = () => `217${String(Date.now() + ++seq * 41).slice(-8)}`;
  const created: string[] = [];
  let idem = 0;

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
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };
  const control = (method: string, path: string, body?: unknown, key = crypto.randomUUID()) =>
    call(method, `/control/v1${path}`, body, { 'x-vendua-control': 'ctl', 'idempotency-key': key });

  const coupon = async (body: Record<string, unknown>) => {
    const r = await control('POST', '/signup-coupons', body);
    expect(r.status).toBe(201);
    return r.body.coupons[0] as { id: string; code: string };
  };

  const verified = async (phone: string) => {
    expect((await call('POST', '/admin/v1/signup/otp/start', { phone })).status).toBe(200);
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const v = await call('POST', '/admin/v1/signup/otp/verify', { phone, code });
    expect(v.status).toBe(200);
    return v.body.signupToken as string;
  };

  const signup = async (token: string, slug: string, extra: Record<string, unknown> = {}) => {
    const r = await call('POST', '/admin/v1/signup', {
      signupToken: token,
      planId: 'mirim',
      method: 'pix',
      storeName: 'Doces da Bia',
      slug,
      ownerName: 'Bia Rocha',
      email: 'bia@example.com',
      document: '529.982.247-25',
      ...extra,
    });
    if (r.body?.store?.id && !created.includes(r.body.store.id)) created.push(r.body.store.id);
    return r;
  };
  const session = (cookie: string | null) => {
    const value = /vendua_admin=([^;]+)/.exec(cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}` });
  };
  const invoices = (tenant: string) =>
    sql<
      { id: string; number: number; amount_cents: number; discount_cents: number; status: string }[]
    >`
      select id, number, amount_cents, discount_cents, status from invoices
      where tenant_id = ${tenant} and kind = 'period' order by number
    `;
  /** the period ends in two days: the next tick issues its renewal */
  const renewSoon = async (tenant: string) => {
    await sql`
      update subscriptions set current_period_end = now() + interval '2 days',
        current_period_start = now() - interval '28 days'
      where tenant_id = ${tenant}
    `;
    await tick();
  };
  const payOpen = async (tenant: string) => {
    const open = (await invoices(tenant)).find((i) => i.status === 'open')!;
    expect((await call('POST', `/admin/v1/dev/billing/invoices/${open.id}/pay`, {})).status).toBe(
      200,
    );
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });
  beforeEach(() => {
    app = createApp(deps);
  });
  afterAll(async () => {
    // with the stores that redeemed them, tracked or not (a failed run's half-made store)
    await sql`
      delete from tenants where id in (
        select r.tenant_id from signup_coupon_redemptions r
          join signup_coupons c on c.id = r.coupon_id
        where c.code like ${`%${nonce}%`})
    `;
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    await sql`delete from signup_coupons where code like ${`%${nonce}%`}`;
    await sql`delete from plans where id = ${`cp_${nonce.toLowerCase()}`}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('the CRM makes, lists and switches off coupons; bad terms are refused', async () => {
    const typed = await control('POST', '/signup-coupons', {
      code: `amigo-${nonce}`,
      note: 'parceiros da feira',
      freeDays: 30,
      maxUses: null,
    });
    expect(typed.status).toBe(201);
    expect(typed.body.coupons[0]).toMatchObject({
      code: `AMIGO-${nonce}`,
      freeDays: 30,
      discount: null,
      maxUses: null,
      uses: 0,
      active: true,
      label: '30 dias grátis',
    });
    const again = await control('POST', '/signup-coupons', { code: `AMIGO-${nonce}`, freeDays: 7 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('COUPON_CODE_TAKEN');
    // a replayed request answers the same, and makes nothing new
    const key = crypto.randomUUID();
    const batchBody = {
      prefix: `B${nonce}`,
      quantity: 3,
      discount: { kind: 'percent', value: 20, months: 2 },
    };
    const batch = await control('POST', '/signup-coupons', batchBody, key);
    expect(batch.status).toBe(201);
    expect(batch.body.coupons).toHaveLength(3);
    for (const c of batch.body.coupons) {
      expect(c.code).toMatch(new RegExp(`^B${nonce}-[A-Z2-9]{4}-[A-Z2-9]{4}$`));
      // generated codes default to one use each
      expect(c.maxUses).toBe(1);
    }
    const replay = await control('POST', '/signup-coupons', batchBody, key);
    expect(replay.body.coupons.map((c: any) => c.code)).toEqual(
      batch.body.coupons.map((c: any) => c.code),
    );
    expect(
      (
        await sql`select count(*)::int as n from signup_coupons where code like ${`B${nonce}-%`}`
      )[0]!.n,
    ).toBe(3);

    for (const [body, field] of [
      [{ code: `NADA-${nonce}` }, 'freeDays'],
      [{ freeDays: 0 }, 'freeDays'],
      [{ freeDays: 400 }, 'freeDays'],
      [{ discount: { kind: 'percent', value: 100, months: 1 } }, 'discount.value'],
      [{ discount: { kind: 'amount', value: 500, months: 0 } }, 'discount.months'],
      [{ freeDays: 7, planIds: ['nope'] }, 'planIds'],
      [{ freeDays: 7, expiresAt: '2001-01-01' }, 'expiresAt'],
      [{ freeDays: 7, code: 'abc', quantity: 2 }, 'quantity'],
      [{ freeDays: 7, code: '-bad' }, 'code'],
    ] as const) {
      const r = await control('POST', '/signup-coupons', body);
      expect(r.status).toBe(422);
      expect(r.body.error.details?.field ?? r.body.error.field).toBe(field);
    }

    const off = await control('PATCH', `/signup-coupons/${typed.body.coupons[0].id}`, {
      active: false,
      maxUses: 10,
    });
    expect(off.status).toBe(200);
    expect(off.body.coupon).toMatchObject({ active: false, maxUses: 10, freeDays: 30 });
    const list = await call('GET', '/control/v1/signup-coupons', undefined, {
      'x-vendua-control': 'ctl',
    });
    expect(list.status).toBe(200);
    expect(list.body.coupons.find((c: any) => c.code === `AMIGO-${nonce}`)).toMatchObject({
      active: false,
      stores: [],
    });
    // the CRM only: outside it the route isn't there
    expect((await call('GET', '/control/v1/signup-coupons')).status).toBe(404);
  });

  test('preview: the discounted price on a plan; unknown, off, expired and wrong-plan codes', async () => {
    const c = await coupon({
      code: `META-${nonce}`,
      discount: { kind: 'percent', value: 50, months: 2 },
      planIds: ['mirim', 'bandeira'],
      expiresAt: new Date(Date.now() + 10 * DAY).toISOString(),
    });
    const ok = await call('GET', `/admin/v1/signup/coupon?code=meta-${nonce}&planId=mirim`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      coupon: {
        code: `META-${nonce}`,
        freeDays: 0,
        discount: { kind: 'percent', value: 50, months: 2 },
        planIds: ['mirim', 'bandeira'],
        label: '50% de desconto nos 2 primeiros meses',
      },
      priceCents: 6990,
      discountedCents: 3495,
    });
    const plan = await call('GET', `/admin/v1/signup/coupon?code=META-${nonce}&planId=pangolim`);
    expect(plan.status).toBe(422);
    expect(plan.body.error.code).toBe('COUPON_PLAN');
    const unknown = await call('GET', `/admin/v1/signup/coupon?code=NOPE-${nonce}`);
    expect(unknown.body.error.code).toBe('COUPON_INVALID');
    await sql`update signup_coupons set expires_at = now() - interval '1 minute' where id = ${c.id}`;
    const expired = await call('GET', `/admin/v1/signup/coupon?code=META-${nonce}`);
    expect(expired.body.error.code).toBe('COUPON_EXPIRED');
    await sql`update signup_coupons set expires_at = null, active = false where id = ${c.id}`;
    expect((await call('GET', `/admin/v1/signup/coupon?code=META-${nonce}`)).body.error.code).toBe(
      'COUPON_INVALID',
    );
  });

  test('Pix: the first months at the coupon price, then the plan price; one-time means once', async () => {
    const c = await coupon({
      code: `MEIA-${nonce}`,
      discount: { kind: 'percent', value: 50, months: 2 },
    });
    const token = await verified(mkPhone());
    const r = await signup(token, `cupom-${nonce.toLowerCase()}-pix`, {
      coupon: ` meia-${nonce} `,
    });
    expect(r.status).toBe(201);
    expect(r.body.next.kind).toBe('pix');
    const store = r.body.store.id as string;
    expect(await invoices(store)).toMatchObject([
      { number: 1, amount_cents: 3495, discount_cents: 3495, status: 'open' },
    ]);
    // the same signup again is the same store, though the code is used up by now
    const replay = await signup(token, `cupom-${nonce.toLowerCase()}-pix`, {
      coupon: `MEIA-${nonce}`,
    });
    expect(replay.status).toBe(201);
    expect(replay.body.store.id).toBe(store);
    expect((await sql`select uses from signup_coupons where id = ${c.id}`)[0]!.uses).toBe(1);

    const acct = await session(r.cookie)('GET', '/account');
    expect(acct.body.coupon).toMatchObject({
      code: `MEIA-${nonce}`,
      label: '50% de desconto nos 2 primeiros meses',
      // the first is issued, not paid yet
      discountMonthsLeft: 2,
    });
    expect(acct.body.invoices[0]).toMatchObject({ amountCents: 3495, discountCents: 3495 });

    await payOpen(store);
    await renewSoon(store);
    expect((await invoices(store)).at(-1)).toMatchObject({
      number: 2,
      amount_cents: 3495,
      discount_cents: 3495,
    });
    await payOpen(store);
    await renewSoon(store);
    expect((await invoices(store)).at(-1)).toMatchObject({
      number: 3,
      amount_cents: 6990,
      discount_cents: 0,
    });
    expect((await session(r.cookie)('GET', '/account')).body.coupon.discountMonthsLeft).toBe(0);

    // one use: another owner can't take it, and nothing is created
    const other = await signup(await verified(mkPhone()), `cupom-${nonce.toLowerCase()}-pix2`, {
      coupon: `MEIA-${nonce}`,
    });
    expect(other.status).toBe(422);
    expect(other.body.error).toMatchObject({ code: 'COUPON_USED_UP' });
    expect(
      await sql`select 1 from tenants where slug = ${`cupom-${nonce.toLowerCase()}-pix2`}`,
    ).toHaveLength(0);
    // the CRM sees who used it
    const list = await call('GET', '/control/v1/signup-coupons', undefined, {
      'x-vendua-control': 'ctl',
    });
    expect(list.body.coupons.find((x: any) => x.id === c.id)).toMatchObject({
      uses: 1,
      stores: [{ id: store, slug: `cupom-${nonce.toLowerCase()}-pix` }],
    });
  });

  test('a multi-use coupon: once per owner phone, plan-bound, and a parallel race takes one use', async () => {
    const multi = await coupon({
      code: `TURMA-${nonce}`,
      discount: { kind: 'amount', value: 1000, months: 1 },
      planIds: ['mirim'],
      maxUses: null,
    });
    const phone = mkPhone();
    const token = await verified(phone);
    expect(
      (await signup(token, `cupom-${nonce.toLowerCase()}-m1`, { coupon: multi.code })).status,
    ).toBe(201);
    const twice = await signup(token, `cupom-${nonce.toLowerCase()}-m2`, { coupon: multi.code });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('COUPON_ALREADY_USED');
    const wrongPlan = await signup(await verified(mkPhone()), `cupom-${nonce.toLowerCase()}-m3`, {
      coupon: multi.code,
      planId: 'bandeira',
    });
    expect(wrongPlan.body.error.code).toBe('COUPON_PLAN');

    const once = await coupon({ code: `UNICO-${nonce}`, freeDays: 10 });
    const [a, b] = [mkPhone(), mkPhone()];
    const [ta, tb] = [await verified(a), await verified(b)];
    const raced = await Promise.all([
      signup(ta, `cupom-${nonce.toLowerCase()}-ra`, { coupon: once.code }),
      signup(tb, `cupom-${nonce.toLowerCase()}-rb`, { coupon: once.code }),
    ]);
    expect(raced.map((x) => x.status).sort()).toEqual([201, 422]);
    expect((await sql`select uses from signup_coupons where id = ${once.id}`)[0]!.uses).toBe(1);
  });

  test('free days: the store opens at once on any plan, even for a phone that had its trial', async () => {
    const days = await coupon({
      code: `GRATIS-${nonce}`,
      freeDays: 30,
      discount: { kind: 'amount', value: 1000, months: 1 },
    });
    const phone = mkPhone();
    const token = await verified(phone);
    // the phone's one plan trial first
    const trial = await signup(token, `cupom-${nonce.toLowerCase()}-t0`, {
      planId: 'bandeira',
      trial: true,
      method: undefined,
    });
    expect(trial.status).toBe(201);
    expect(trial.body.next.kind).toBe('trial');
    // no method asked, no plan trial on Mirim, the trial already taken: the coupon still opens it
    const r = await signup(token, `cupom-${nonce.toLowerCase()}-t1`, {
      coupon: days.code,
      method: undefined,
    });
    expect(r.status).toBe(201);
    expect(r.body.next.kind).toBe('trial');
    const left = new Date(r.body.next.endsAt).getTime() - Date.now();
    expect(left).toBeGreaterThan(29 * DAY);
    expect(left).toBeLessThan(31 * DAY);
    const store = r.body.store.id as string;
    const st = (await sql`select billing_hold from store_settings where tenant_id = ${store}`)[0]!;
    expect(st.billing_hold).toBe(false);
    expect(
      (await sql`select status from subscriptions where tenant_id = ${store}`)[0]!.status,
    ).toBe('trialing');
    const audit = await sql`
      select summary from audit_log where tenant_id = ${store} and action = 'store.signup'
    `;
    expect(audit[0]!.summary).toContain(`cupom ${days.code}`);
    const event = (
      await sql`select data from staff_events where tenant_id = ${store} and kind = 'store.created'`
    )[0];
    expect(event?.data.coupon).toContain(days.code);

    // the free days end unpaid: the first month carries the coupon's R$ 10 off
    await sql`
      update subscriptions set trial_ends_at = now() - interval '1 minute',
        current_period_end = now() - interval '1 minute'
      where tenant_id = ${store}
    `;
    await tick();
    expect(await invoices(store)).toMatchObject([{ amount_cents: 5990, discount_cents: 1000 }]);
  });

  test('a plan price that rounds to the same coupon charge keeps the Pix and fixes the discount', async () => {
    const planId = `cp_${nonce.toLowerCase()}`;
    await sql`
      insert into plans (id, name, price_cents, features, public, sort)
      values (${planId}, 'Plano cupom', 6990, '{}', false, 99)
    `;
    await coupon({ code: `METADE-${nonce}`, discount: { kind: 'percent', value: 50, months: 2 } });
    const r = await signup(await verified(mkPhone()), `cupom-${nonce.toLowerCase()}-round`, {
      coupon: `METADE-${nonce}`,
    });
    expect(r.status).toBe(201);
    const store = r.body.store.id as string;
    await sql`update subscriptions set plan_id = ${planId} where tenant_id = ${store}`;
    await sql`update invoices set plan_id = ${planId} where tenant_id = ${store}`;
    const before = (
      await sql`select provider_payment_id from invoices where tenant_id = ${store}`
    )[0]!.provider_payment_id;
    expect(before).toBeTruthy();
    // 50% of 6990 and of 6991 both charge 3495
    await sql`update plans set price_cents = 6991 where id = ${planId}`;
    await tick();
    expect(await invoices(store)).toMatchObject([
      { amount_cents: 3495, discount_cents: 3496, status: 'open' },
    ]);
    expect(
      (await sql`select provider_payment_id from invoices where tenant_id = ${store}`)[0]!
        .provider_payment_id,
    ).toBe(before);
  });

  test('card: the assinatura starts at the coupon price and goes back to the plan price', async () => {
    const c = await coupon({
      code: `CARTAO-${nonce}`,
      discount: { kind: 'amount', value: 2000, months: 1 },
    });
    const r = await signup(await verified(mkPhone()), `cupom-${nonce.toLowerCase()}-card`, {
      method: 'card',
      coupon: c.code,
    });
    expect(r.status).toBe(201);
    const store = r.body.store.id as string;
    const pre = (
      await sql`select provider_subscription_id as id, charge_cents from subscriptions where tenant_id = ${store}`
    )[0]!;
    expect(pre.charge_cents).toBe(4990);
    expect(fake.subscriptions.get(pre.id)!.amountCents).toBe(4990);
    const settled = await call('POST', `/admin/v1/dev/billing/subscriptions/${pre.id}/settle`, {
      status: 'approved',
    });
    expect(settled.status).toBe(200);
    expect(await invoices(store)).toMatchObject([
      { amount_cents: 4990, discount_cents: 2000, status: 'paid' },
    ]);
    // its one month is used: the price sync puts the next charge back at the plan's price
    await tick();
    expect(fake.subscriptions.get(pre.id)!.amountCents).toBe(6990);
    expect(
      (await sql`select charge_cents from subscriptions where tenant_id = ${store}`)[0]!
        .charge_cents,
    ).toBe(6990);
  });

  test('bad coupon input: a stable 4xx, and nothing created', async () => {
    const token = await verified(mkPhone());
    for (const v of ['x', 12, { a: 1 }, 'y'.repeat(300)]) {
      const r = await signup(token, `cupom-${nonce.toLowerCase()}-bad`, { coupon: v });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('COUPON_INVALID');
    }
    expect(
      await sql`select 1 from tenants where slug = ${`cupom-${nonce.toLowerCase()}-bad`}`,
    ).toHaveLength(0);
    expect((await call('GET', '/admin/v1/signup/coupon')).status).toBe(422);
  });
});
