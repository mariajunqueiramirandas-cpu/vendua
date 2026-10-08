import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { MAX_FIXED_CENTS, MAX_PERCENT_BPS } from '../src/modules/payment-adjustments.ts';
import { migrate } from '../src/platform/db.ts';

// Decisions Core serves the admin so it stops re-deriving them: which order steps a delivery
// mode allows, the encomendas day totals, payment totals and bounds, coupon and reward labels,
// and the normalised store address.
describe.skipIf(!process.env.TEST_DATABASE_URL)('admin: Core-derived fields (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `dv-${nonce}`;
  const host = `${slug}.localhost`;
  const stamp = String(Date.now()).slice(-7);
  const ownerPhone = `2194${stamp}`;
  const shopperPhone = `2293${stamp}`;
  let tenantId = '';
  let idem = 0;
  let number = 0;

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
  let cookie = '';
  const owner = (method: string, path: string, body?: unknown) =>
    call(method, `/admin/v1${path}`, body, { cookie });

  const order = async (o: {
    mode: 'pickup' | 'delivery';
    state?: string;
    totalCents?: number;
    scheduledFor?: string;
    phone?: string;
    placedAt?: Date;
    method?: string;
  }) => {
    const cart = (
      await sql<{ id: string }[]>`
        insert into carts (tenant_id, session_hash) values (${tenantId}, ${`dv-${nonce}-${++number}`})
        returning id
      `
    )[0]!.id;
    const total = o.totalCents ?? 1000;
    return (
      await sql<{ id: string }[]>`
        insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                            state, subtotal_cents, total_cents, scheduled_for, placed_at)
        values (${tenantId}, ${cart}, ${number}, ${sql.json({ name: 'Bia', phone: o.phone ?? shopperPhone })},
                ${o.phone ?? shopperPhone}, ${sql.json({ mode: o.mode })},
                ${sql.json({ provider: 'sandbox', method: o.method ?? 'pix', status: 'pending' })},
                ${o.state ?? 'ready'}, ${total}, ${total}, ${o.scheduledFor ?? null},
                ${o.placedAt ?? new Date()})
        returning id
      `
    )[0]!.id;
  };
  const move = (id: string, to: string, reason?: string) =>
    owner('POST', `/orders/${id}/transition`, { to, ...(reason ? { reason } : {}) });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id
      `
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})})
    `;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Rita', ${ownerPhone}, 'owner')`;
    await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const r = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    expect(r.body.signedIn).toBe(true);
    cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('a pickup order is never out for delivery (422); a stale step stays a 409', async () => {
    const pickup = await order({ mode: 'pickup' });
    const out = await move(pickup, 'out_for_delivery');
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe('INVALID_ORDER_TRANSITION');
    expect((await move(pickup, 'delivered')).body.order.state).toBe('delivered');

    const delivery = await order({ mode: 'delivery' });
    expect((await move(delivery, 'out_for_delivery')).body.order.state).toBe('out_for_delivery');
    expect((await move(delivery, 'delivered')).body.order.state).toBe('delivered');

    const fresh = await order({ mode: 'pickup', state: 'placed' });
    const skip = await move(fresh, 'delivered');
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('INVALID_ORDER_TRANSITION');

    // the CRM goes through the same rule
    const crm = await app.request(
      `http://core.localhost/control/v1/storefronts/${slug}/commerce/orders/${fresh}/transition`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vendua-control': 'ctl',
          'idempotency-key': `${nonce}-crm`,
        },
        body: JSON.stringify({ to: 'out_for_delivery' }),
      },
    );
    expect(crm.status).toBe(422);
    expect(((await crm.json()) as any).error.code).toBe('INVALID_ORDER_TRANSITION');

    // a pickup order moved out before the rule can still be finished
    const legacy = await order({ mode: 'pickup', state: 'out_for_delivery' });
    expect((await move(legacy, 'delivered')).status).toBe(200);
  });

  test('encomendas: per-day count and total, summed by Core over the whole range', async () => {
    await order({
      mode: 'pickup',
      state: 'confirmed',
      scheduledFor: '2031-03-10',
      totalCents: 1000,
    });
    await order({
      mode: 'delivery',
      state: 'placed',
      scheduledFor: '2031-03-10',
      totalCents: 2550,
    });
    await order({
      mode: 'pickup',
      state: 'cancelled',
      scheduledFor: '2031-03-10',
      totalCents: 9999,
    });
    await order({ mode: 'pickup', state: 'placed', scheduledFor: '2031-03-12', totalCents: 700 });
    await order({ mode: 'pickup', state: 'placed', scheduledFor: '2031-03-14', totalCents: 400 });
    const r = await owner('GET', '/orders/scheduled?from=2031-03-10&to=2031-03-12');
    expect(r.status).toBe(200);
    expect(r.body.orders).toHaveLength(3);
    expect(r.body.days).toEqual([
      { date: '2031-03-10', count: 2, totalCents: 3550 },
      { date: '2031-03-12', count: 1, totalCents: 700 },
    ]);
    expect((await owner('GET', '/orders/scheduled?from=2031-04-01&to=2031-04-02')).body).toEqual({
      orders: [],
      days: [],
    });
  });

  test('payments: adjustment bounds and the last-30-days total come from Core', async () => {
    await order({ mode: 'pickup', state: 'delivered', totalCents: 1234, method: 'cash' });
    await order({ mode: 'pickup', state: 'confirmed', totalCents: 66, method: 'cash' });
    await order({ mode: 'pickup', state: 'refunded', totalCents: 5000 });
    await order({
      mode: 'pickup',
      state: 'delivered',
      totalCents: 8000,
      placedAt: new Date(Date.now() - 40 * 86_400_000),
    });
    const r = await owner('GET', '/payments');
    expect(r.status).toBe(200);
    expect(r.body.adjustmentBounds).toEqual({
      maxPercentBps: MAX_PERCENT_BPS,
      maxFixedCents: MAX_FIXED_CENTS,
    });
    const want = (
      await sql<{ n: number }[]>`
        select coalesce(sum(total_cents), 0)::int as n from orders
        where tenant_id = ${tenantId} and state not in ('cancelled', 'refunded')
          and placed_at > now() - interval '30 days'
      `
    )[0]!.n;
    expect(want).toBeGreaterThan(1234);
    expect(r.body.last30TotalCents).toBe(want);
    expect(r.body.last30TotalCents).toBe(
      r.body.last30.reduce((a: number, x: { cents: number }) => a + x.cents, 0),
    );
    const methods = await sql<{ method: string; cents: number; orders: number }[]>`
      select payment ->> 'method' as method, sum(total_cents)::int as cents, count(*)::int as orders
      from orders
      where tenant_id = ${tenantId} and state not in ('cancelled', 'refunded')
        and placed_at > now() - interval '30 days'
      group by 1
      order by cents desc, method
    `;
    expect(methods.length).toBeGreaterThan(1);
    expect(r.body.last30ByMethod).toEqual(methods.map((m) => ({ ...m })));
    expect(r.body.last30Orders).toBe(methods.reduce((a, m) => a + m.orders, 0));
  });

  test('coupons: displayLabel is couponLabel, the raw label stays', async () => {
    await owner('POST', '/coupons', { code: `P${nonce}`, kind: 'percent', value: 10 });
    await owner('POST', '/coupons', { code: `F${nonce}`, kind: 'fixed', value: 1550 });
    const r = await owner('POST', '/coupons', {
      code: `D${nonce}`,
      kind: 'free_delivery',
      label: 'Frete por nossa conta',
    });
    expect(r.status).toBe(201);
    const by = (code: string) =>
      r.body.coupons.find((c: { code: string }) => c.code === code.toUpperCase());
    expect(by(`P${nonce}`)).toMatchObject({ label: null, displayLabel: '10% off' });
    expect(by(`F${nonce}`)).toMatchObject({ label: null, displayLabel: 'R$ 15,50 off' });
    expect(by(`D${nonce}`)).toMatchObject({
      label: 'Frete por nossa conta',
      displayLabel: 'Frete por nossa conta',
    });
    const m = await owner('GET', '/marketing');
    expect(
      m.body.coupons.find((c: { code: string }) => c.code === `P${nonce}`.toUpperCase())
        .displayLabel,
    ).toBe('10% off');
  });

  test('loyalty: an unnamed reward is named like a coupon, everywhere it shows', async () => {
    // a reward no coupon could hold (it would fail at the delivery that mints it) is refused now
    for (const reward of [
      { kind: 'fixed', value: 12.5 },
      { kind: 'percent', value: 150 },
      { kind: 'fixed', value: 20_000_000 },
    ]) {
      const bad = await owner('PUT', '/loyalty', {
        program: { stampsRequired: 2, minOrderCents: 0, reward, rewardValidDays: 30 },
      });
      expect(bad.status).toBe(422);
      expect(bad.body.error.details.field).toBe('program.reward.value');
    }
    const put = await owner('PUT', '/loyalty', {
      program: {
        stampsRequired: 2,
        minOrderCents: 0,
        reward: { kind: 'fixed', value: 500, label: '   ' },
        rewardValidDays: 30,
      },
    });
    expect(put.status).toBe(200);
    expect(put.body.program.reward).toEqual({
      kind: 'fixed',
      value: 500,
      label: null,
      displayLabel: 'R$ 5,00 off',
    });
    const stored = (
      await sql<
        { loyalty: any }[]
      >`select loyalty from store_settings where tenant_id = ${tenantId}`
    )[0]!.loyalty;
    expect(stored.reward.label).toBeNull();
    expect((await owner('GET', '/marketing')).body.loyalty.program.reward).toEqual(
      put.body.program.reward,
    );
    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.loyalty.rewardLabel).toBe('R$ 5,00 off');

    // two delivered orders earn one reward: the coupon keeps no label of its own
    const phone = `2192${stamp}`;
    for (let i = 0; i < 2; i++)
      expect((await move(await order({ mode: 'pickup', phone }), 'delivered')).status).toBe(200);
    const minted = await sql<{ label: string | null }[]>`
      select label from coupons where tenant_id = ${tenantId} and source = 'loyalty' and phone = ${phone}
    `;
    expect(minted.map((c) => c.label)).toEqual([null]);
    const card = (await owner('GET', `/customers/${phone}`)).body.loyalty;
    expect(card.rewardLabel).toBe('R$ 5,00 off');
    expect(card.rewards.map((x: { label: string }) => x.label)).toEqual(['R$ 5,00 off']);

    // a label the merchant typed wins; rewards already minted keep their own
    const named = await owner('PUT', '/loyalty', {
      program: {
        stampsRequired: 2,
        minOrderCents: 0,
        reward: { kind: 'percent', value: 15, label: 'Um brigadeiro' },
        rewardValidDays: 30,
      },
    });
    expect(named.body.program.reward).toMatchObject({
      label: 'Um brigadeiro',
      displayLabel: 'Um brigadeiro',
    });
    expect(
      (await call('GET', '/storefront/v1/store', undefined, { host })).body.loyalty.rewardLabel,
    ).toBe('Um brigadeiro');
    const after = (await owner('GET', `/customers/${phone}`)).body.loyalty;
    expect(after.rewardLabel).toBe('Um brigadeiro');
    expect(after.rewards.map((x: { label: string }) => x.label)).toEqual(['R$ 5,00 off']);
  });

  test('slugs: both checks return the normalised address, & read as "e"', async () => {
    const raw = encodeURIComponent(`Pão & Mel ${nonce}`);
    const signup = await call('GET', `/admin/v1/signup/slug?slug=${raw}`);
    expect(signup.body).toEqual({ slug: `pao-e-mel-${nonce}`, available: true });
    const fleet = await app.request(`http://core.localhost/control/v1/fleet/slug?slug=${raw}`, {
      headers: { 'x-vendua-control': 'ctl' },
    });
    expect(await fleet.json()).toEqual({ slug: `pao-e-mel-${nonce}`, available: true });
  });
});
