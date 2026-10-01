import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { computeTotals } from '../src/modules/cart.ts';
import {
  adjustmentFor,
  paymentAdjustmentCents,
  readPaymentAdjustments,
} from '../src/modules/payment-adjustments.ts';
import { upsertConnection } from '../src/modules/payments/connections.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

describe('paymentAdjustmentCents', () => {
  test('percent, fixed and both, signed', () => {
    expect(paymentAdjustmentCents(10_000, 0, { percentBps: 250 })).toBe(250);
    expect(paymentAdjustmentCents(10_000, 0, { fixedCents: 199 })).toBe(199);
    expect(paymentAdjustmentCents(10_000, 0, { percentBps: -1000, fixedCents: 50 })).toBe(-950);
    expect(paymentAdjustmentCents(10_000, 0, { fixedCents: -300 })).toBe(-300);
    expect(paymentAdjustmentCents(10_000, 0, null)).toBe(0);
    expect(paymentAdjustmentCents(10_000, 0, {})).toBe(0);
  });

  test('base is the subtotal after the coupon item discount', () => {
    expect(paymentAdjustmentCents(10_000, 2000, { percentBps: -1000 })).toBe(-800);
    expect(paymentAdjustmentCents(10_000, 2000, { percentBps: 500 })).toBe(400);
  });

  test('half rounds away from zero, on integers', () => {
    expect(paymentAdjustmentCents(1005, 0, { percentBps: 1000 })).toBe(101);
    expect(paymentAdjustmentCents(1005, 0, { percentBps: -1000 })).toBe(-101);
    expect(paymentAdjustmentCents(1004, 0, { percentBps: 1000 })).toBe(100);
    expect(paymentAdjustmentCents(1006, 0, { percentBps: -1000 })).toBe(-101);
    expect(paymentAdjustmentCents(4590, 0, { percentBps: -500 })).toBe(-230);
    expect(paymentAdjustmentCents(3, 0, { percentBps: 1 })).toBe(0);
  });

  test('a discount never takes the items below zero; an empty cart has none', () => {
    expect(paymentAdjustmentCents(1000, 0, { fixedCents: -5000 })).toBe(-1000);
    expect(paymentAdjustmentCents(1000, 0, { percentBps: -5000, fixedCents: -900 })).toBe(-1000);
    expect(paymentAdjustmentCents(1000, 1000, { fixedCents: -100 })).toBe(0);
    expect(paymentAdjustmentCents(1000, 1000, { fixedCents: 100 })).toBe(100);
    expect(paymentAdjustmentCents(0, 0, { fixedCents: 100 })).toBe(0);
  });

  test('computeTotals adds it and never totals below zero', () => {
    const t = computeTotals([{ qty: 1, lineTotalCents: 1000 }], 500, 0, 200, null, -150);
    expect(t).toMatchObject({ paymentAdjustmentCents: -150, totalCents: 1150 });
    expect(computeTotals([{ qty: 1, lineTotalCents: 1000 }], 500, 0).paymentAdjustmentCents).toBe(
      0,
    );
    const floor = computeTotals([{ qty: 1, lineTotalCents: 1000 }], 500, 0, 0, null, -5000);
    expect(floor).toMatchObject({ paymentAdjustmentCents: -1500, totalCents: 0 });
  });

  test('stored rules are read defensively; only offered methods adjust', () => {
    expect(
      readPaymentAdjustments({
        pix: { percentBps: -500, junk: 1 },
        cash: { fixedCents: 1.5 },
        bitcoin: { fixedCents: 10 },
        card_on_delivery: { percentBps: 9999 },
        meal_voucher: { fixedCents: 100 },
      }),
    ).toEqual({ pix: { percentBps: -500 }, meal_voucher: { fixedCents: 100 } });
    expect(readPaymentAdjustments([])).toEqual({});
    expect(readPaymentAdjustments(null)).toEqual({});
    const rules = { meal_voucher: { fixedCents: 100 }, pix: { percentBps: -500 } };
    // no payment_methods = the three offline defaults: meal voucher stays off
    expect(adjustmentFor({ payment_adjustments: rules }, 'meal_voucher')).toBeNull();
    expect(adjustmentFor({ payment_adjustments: rules }, 'pix')).toEqual({ percentBps: -500 });
    expect(
      adjustmentFor({ payment_methods: ['meal_voucher'], payment_adjustments: rules }, 'pix'),
    ).toBeNull();
    expect(adjustmentFor({ payment_adjustments: rules }, 'nope')).toBeNull();
    expect(adjustmentFor({ payment_adjustments: rules }, null)).toBeNull();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('payment adjustments (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => void codes.set(phone, /(\d{6})/.exec(text)![1]!),
    paymentProvider: fake,
    notify: { whatsapp: async () => {}, email: async () => {} },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `padj-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `228${String(Date.now()).slice(-8)}`;
  const managerPhone = `227${String(Date.now()).slice(-8)}`;
  let tenantId = '';
  let productId = '';
  let idem = 0;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const h = headers.host ?? 'core.localhost';
    const res = await app.request(`http://${h}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        host: h,
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
      headers: res.headers,
    };
  };
  const login = async (phone: string) => {
    await call('POST', '/admin/v1/auth/otp/start', { phone });
    const v = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(v.headers.get('set-cookie') ?? '')![1]}`;
    return (m: string, p: string, b?: unknown) => call(m, `/admin/v1${p}`, b, { cookie });
  };
  let owner: Awaited<ReturnType<typeof login>>;
  let manager: Awaited<ReturnType<typeof login>>;

  const shopper = async (qty = 2) => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    expect(s.status).toBe(201);
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    expect((await call('POST', '/checkout/v1/cart/items', { productId, qty }, auth)).status).toBe(
      200,
    );
    return auth;
  };
  const input = (method: string, delivery: Record<string, unknown> = { mode: 'pickup' }) => ({
    customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
    delivery,
    payment: { method },
  });
  const centro = { mode: 'delivery', neighborhood: 'Centro', street: 'Rua A', number: '10' };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, 'Doces Ajuste') returning id
      `
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city,
                                  pix_key, pix_key_type, pix_beneficiary, pix_city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema', 'loja@exemplo.com', 'email', 'Doces Ajuste', 'Saquarema')
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 500, 30, 50)
    `;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id
      `
    )[0]!.id;
    productId = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${cat}, 'pudim', 'Pudim', 2295) returning id
      `
    )[0]!.id;
    await sql`
      insert into coupons (tenant_id, code, kind, value) values
        (${tenantId}, 'DEZ', 'percent', 10), (${tenantId}, 'FRETE', 'free_delivery', 0)
    `;
    await sql`
      insert into merchant_users (tenant_id, name, phone, role) values
        (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner'),
        (${tenantId}, 'Ana Lima', ${managerPhone}, 'manager')
    `;
    owner = await login(ownerPhone);
    manager = await login(managerPhone);
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('admin: owner sets adjustments, manager may not, bad rules are 422', async () => {
    expect((await owner('GET', '/payments')).body.adjustments).toEqual({});
    const rules = {
      pix: { percentBps: -500 },
      cash: { fixedCents: 150 },
      card_on_delivery: { percentBps: 333, fixedCents: 10 },
      meal_voucher: { fixedCents: 0, percentBps: 200 },
    };
    const denied = await manager('PATCH', '/payments', { adjustments: rules });
    expect(denied.status).toBe(403);
    const ok = await owner('PATCH', '/payments', { adjustments: rules });
    expect(ok.status).toBe(200);
    expect(ok.body.adjustments).toEqual({
      pix: { percentBps: -500 },
      cash: { fixedCents: 150 },
      card_on_delivery: { percentBps: 333, fixedCents: 10 },
      meal_voucher: { percentBps: 200 },
    });
    expect((await manager('GET', '/payments')).body.adjustments).toEqual(ok.body.adjustments);
    const audit = await sql`
      select summary from audit_log where tenant_id = ${tenantId} and action = 'payments.update'
    `;
    expect(audit.length).toBe(1);

    for (const [adjustments, field] of [
      [{ bitcoin: { fixedCents: 10 } }, 'adjustments'],
      [{ pix: { percent: 5 } }, 'adjustments.pix.percent'],
      [{ pix: { percentBps: 5001 } }, 'adjustments.pix.percentBps'],
      [{ pix: { percentBps: -5001 } }, 'adjustments.pix.percentBps'],
      [{ pix: { fixedCents: 1_000_001 } }, 'adjustments.pix.fixedCents'],
      [{ pix: { fixedCents: 1.5 } }, 'adjustments.pix.fixedCents'],
      [{ pix: { fixedCents: '10' } }, 'adjustments.pix.fixedCents'],
      [{ pix: 5 }, 'adjustments.pix'],
      [[], 'adjustments'],
      ['x', 'adjustments'],
    ] as const) {
      const r = await owner('PATCH', '/payments', { adjustments });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({ code: 'INVALID_ADJUSTMENT', details: { field } });
    }
    // the boundaries themselves are fine; nothing above changed the stored rules
    const edge = await owner('PATCH', '/payments', {
      adjustments: { ...rules, cash: { percentBps: -5000, fixedCents: -1_000_000 } },
    });
    expect(edge.status).toBe(200);
    expect(
      (await owner('PATCH', '/payments', { adjustments: { ...rules, meal_voucher: null } })).body
        .adjustments,
    ).toEqual({
      pix: { percentBps: -500 },
      cash: { fixedCents: 150 },
      card_on_delivery: { percentBps: 333, fixedCents: 10 },
    });
  });

  test('storefront /store labels the offered methods only', async () => {
    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.paymentMethods).toEqual(['pix', 'card_on_delivery', 'cash']);
    expect(store.body.paymentAdjustments).toEqual({
      pix: { percentBps: -500 },
      cash: { fixedCents: 150 },
      card_on_delivery: { percentBps: 333, fixedCents: 10 },
    });
  });

  test('quote and cart preview the adjusted total; the order charges exactly that', async () => {
    const auth = await shopper(2); // 4590
    const plain = await call('POST', '/checkout/v1/quote', { neighborhood: 'Centro' }, auth);
    expect(plain.status).toBe(200);
    expect(plain.body).toMatchObject({ eligible: true, feeCents: 500 });
    expect(plain.body.totals).toMatchObject({
      subtotalCents: 4590,
      deliveryFeeCents: 500,
      paymentAdjustmentCents: 0,
      totalCents: 5090,
    });
    const quote = await call(
      'POST',
      '/checkout/v1/quote',
      { neighborhood: 'Centro', paymentMethod: 'pix' },
      auth,
    );
    expect(quote.body.totals).toMatchObject({ paymentAdjustmentCents: -230, totalCents: 4860 });
    const bad = await call(
      'POST',
      '/checkout/v1/quote',
      { neighborhood: 'Centro', paymentMethod: 'bitcoin' },
      auth,
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INVALID_PAYMENT');
    // no cart session: the zone answer alone
    const anon = await call('POST', '/checkout/v1/quote', { neighborhood: 'Centro' }, { host });
    expect(anon.body.eligible).toBe(true);
    expect(anon.body.totals).toBeUndefined();

    const cart = await call('GET', '/checkout/v1/cart?paymentMethod=cash', undefined, auth);
    expect(cart.body.cart.totals).toMatchObject({ paymentAdjustmentCents: 150, totalCents: 4740 });
    const noMethod = await call('GET', '/checkout/v1/cart', undefined, auth);
    expect(noMethod.body.cart.totals).toMatchObject({
      paymentAdjustmentCents: 0,
      totalCents: 4590,
    });
    const badCart = await call('GET', '/checkout/v1/cart?paymentMethod=x', undefined, auth);
    expect(badCart.status).toBe(422);

    const o = await call('POST', '/checkout/v1/checkout', input('pix', centro), auth);
    expect(o.status).toBe(201);
    expect(o.body.order).toMatchObject({
      subtotalCents: 4590,
      deliveryFeeCents: 500,
      discountCents: 0,
      paymentAdjustmentCents: -230,
      totalCents: quote.body.totals.totalCents,
    });
    // offline Pix: the static QR carries the adjusted amount
    expect(o.body.order.payment.pix.copyPaste).toContain('540548.60');
    expect(o.body.order.payment.instructions).toContain('48,60');
    const row = (
      await sql<{ payment_adjustment_cents: number; total_cents: number }[]>`
        select payment_adjustment_cents, total_cents from orders where id = ${o.body.order.id}
      `
    )[0]!;
    expect(row).toEqual({ payment_adjustment_cents: -230, total_cents: 4860 });
    const ev = await sql<{ props: any }[]>`
      select props from analytics_events where tenant_id = ${tenantId} and name = 'order_placed'
        and props ->> 'order_id' = ${o.body.order.id}
    `;
    expect(ev[0]!.props).toMatchObject({ value: 4860, payment_adjustment: -230 });
  });

  test('coupons: the percent discount shrinks the base, free delivery does not', async () => {
    const a = await shopper(2);
    expect((await call('POST', '/checkout/v1/cart/coupon', { code: 'DEZ' }, a)).status).toBe(200);
    const q = await call(
      'POST',
      '/checkout/v1/quote',
      { neighborhood: 'Centro', paymentMethod: 'pix' },
      a,
    );
    // base 4590 - 459 = 4131 → -206.55 → -207
    expect(q.body.totals).toMatchObject({
      discountCents: 459,
      paymentAdjustmentCents: -207,
      totalCents: 4590 + 500 - 459 - 207,
    });
    const o = await call('POST', '/checkout/v1/checkout', input('pix', centro), a);
    expect(o.body.order).toMatchObject({
      discountCents: 459,
      paymentAdjustmentCents: -207,
      totalCents: q.body.totals.totalCents,
    });

    const b = await shopper(2);
    expect((await call('POST', '/checkout/v1/cart/coupon', { code: 'FRETE' }, b)).status).toBe(200);
    const ob = await call('POST', '/checkout/v1/checkout', input('pix', centro), b);
    expect(ob.body.order).toMatchObject({
      deliveryFeeCents: 500,
      discountCents: 500,
      paymentAdjustmentCents: -230,
      totalCents: 4590 - 230,
    });
  });

  test('meal voucher: refused until the store turns it on', async () => {
    const a = await shopper(1);
    const refused = await call('POST', '/checkout/v1/checkout', input('meal_voucher'), a);
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const on = await owner('PATCH', '/payments', {
      methods: ['pix', 'card_on_delivery', 'cash', 'meal_voucher'],
      adjustments: { pix: { percentBps: -500 }, meal_voucher: { percentBps: 300 } },
    });
    expect(on.status).toBe(200);
    expect(on.body.methods).toContain('meal_voucher');
    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.paymentMethods).toContain('meal_voucher');
    expect(store.body.paymentAdjustments.meal_voucher).toEqual({ percentBps: 300 });
    const o = await call('POST', '/checkout/v1/checkout', input('meal_voucher'), a);
    expect(o.status).toBe(201);
    // 2295 × 3% = 68.85 → 69
    expect(o.body.order).toMatchObject({ paymentAdjustmentCents: 69, totalCents: 2364 });
    expect(o.body.order.payment).toMatchObject({ method: 'meal_voucher', online: false });
    expect(o.body.order.payment.instructions).toContain('vale-refeição');
    const bogus = await call('POST', '/checkout/v1/checkout', input('voucher'), await shopper(1));
    expect(bogus.status).toBe(422);
    expect(bogus.body.error.code).toBe('INVALID_PAYMENT');
  });

  test('a double checkout still makes one order', async () => {
    const auth = await shopper(2);
    const key = `${nonce}-double`;
    const body = input('pix');
    const one = await call('POST', '/checkout/v1/checkout', body, {
      ...auth,
      'idempotency-key': key,
    });
    const two = await call('POST', '/checkout/v1/checkout', body, {
      ...auth,
      'idempotency-key': key,
    });
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(two.headers.get('x-idempotent-replay')).toBe('true');
    expect(two.body.order.id).toBe(one.body.order.id);
    expect(one.body.order).toMatchObject({ paymentAdjustmentCents: -230, totalCents: 4360 });
    const three = await call('POST', '/checkout/v1/checkout', body, auth);
    expect(three.status).toBe(409);
    expect(three.body.error.code).toBe('CART_NOT_OPEN');
    const cartId = (
      await sql<{ cart_id: string }[]>`select cart_id from orders where id = ${one.body.order.id}`
    )[0]!.cart_id;
    const n = await sql`select 1 from orders where cart_id = ${cartId}`;
    expect(n.length).toBe(1);
  });

  test('a stale price still refuses with PRICES_CHANGED; the retry adjusts the new total', async () => {
    const auth = await shopper(2);
    await sql`update products set base_price_cents = 2600 where id = ${productId}`;
    try {
      const r = await call('POST', '/checkout/v1/checkout', input('pix'), auth);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'PRICES_CHANGED', details: { changedLines: 1 } });
      const cart = await call('GET', '/checkout/v1/cart?paymentMethod=pix', undefined, auth);
      expect(cart.body.cart.totals).toMatchObject({
        subtotalCents: 5200,
        paymentAdjustmentCents: -260,
        totalCents: 4940,
      });
      const ok = await call('POST', '/checkout/v1/checkout', input('pix'), auth);
      expect(ok.status).toBe(201);
      expect(ok.body.order.totalCents).toBe(cart.body.cart.totals.totalCents);
    } finally {
      await sql`update products set base_price_cents = 2295 where id = ${productId}`;
    }
  });

  test('online Pix: Mercado Pago charges the adjusted total', async () => {
    await withTenant(sql, tenantId, (tx) =>
      upsertConnection(tx, tenantId, 'fake', fake.tokens('424242'), 's', null),
    );
    const auth = await shopper(2);
    const o = await call('POST', '/checkout/v1/checkout', input('pix'), auth);
    expect(o.status).toBe(201);
    expect(o.body.order).toMatchObject({ paymentAdjustmentCents: -230, totalCents: 4360 });
    expect(o.body.order.payment).toMatchObject({ online: true, provider: 'fake' });
    expect(o.body.order.payment.instructions).toContain('43,60');
    const p = await call('POST', `/checkout/v1/orders/${o.body.order.id}/pay`, undefined, auth);
    expect(p.status).toBe(200);
    const row = (
      await sql<{ provider_payment_id: string; amount_cents: number }[]>`
        select provider_payment_id, amount_cents from payments where order_id = ${o.body.order.id}
      `
    )[0]!;
    expect(row.amount_cents).toBe(4360);
    expect(fake.payments.get(row.provider_payment_id)!.amountCents).toBe(4360);
  });
});
