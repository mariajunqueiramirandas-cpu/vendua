import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { methodsForMode, readMethodsOff } from '../src/modules/payment-adjustments.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { pickupMinOrderCents } from '../src/modules/store.ts';
import { migrate } from '../src/platform/db.ts';

// 0133: delivery and pickup each with their own minimum order and payment methods

describe('mode rules (pure)', () => {
  test('pickup minimum: its own once set (0 = none), else the store minimum', () => {
    expect(pickupMinOrderCents({ min_order_cents: 2000 })).toBe(2000);
    expect(pickupMinOrderCents({ min_order_cents: 2000, pickup_min_order_cents: null })).toBe(2000);
    expect(pickupMinOrderCents({ min_order_cents: 2000, pickup_min_order_cents: 0 })).toBe(0);
    expect(pickupMinOrderCents(null)).toBe(0);
  });

  test('methods per mode: exclusions, the online card, never empty', () => {
    const s = {
      payment_methods: ['pix', 'card_online', 'cash'],
      payment_methods_off: { pickup: ['cash'], delivery: ['pix', 'bitcoin'], dine_in: ['pix'] },
    };
    expect(readMethodsOff(s.payment_methods_off)).toEqual({
      pickup: ['cash'],
      delivery: ['pix'],
    });
    expect(methodsForMode(s, 'pickup', true)).toEqual(['pix', 'card_online']);
    expect(methodsForMode(s, 'pickup', false)).toEqual(['pix']);
    expect(methodsForMode(s, 'delivery', true)).toEqual(['card_online', 'cash']);
    expect(methodsForMode(s, null, false)).toEqual(['pix', 'cash']);
    // only the card left, and Mercado Pago is off: the mode takes the store's list
    const lone = { ...s, payment_methods_off: { pickup: ['pix', 'cash'] } };
    expect(methodsForMode(lone, 'pickup', false)).toEqual(['pix', 'cash']);
    expect(readMethodsOff('x')).toEqual({});
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('mode rules (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => void codes.set(phone, /(\d{6})/.exec(text)![1]!),
    paymentProvider: new FakeProvider(),
    notify: { whatsapp: async () => {}, email: async () => {} },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `modes-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `226${String(Date.now()).slice(-8)}`;
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
    };
  };
  let owner: (m: string, p: string, b?: unknown) => ReturnType<typeof call>;

  const shopper = async (qty: number) => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    expect(s.status).toBe(201);
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    const add = await call('POST', '/checkout/v1/cart/items', { productId, qty }, auth);
    expect(add.status).toBe(200);
    return { auth, cart: add.body.cart };
  };
  const input = (method: string, delivery: Record<string, unknown>) => ({
    customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
    delivery,
    payment: { method },
  });
  const pickup = { mode: 'pickup' };
  const centro = { mode: 'delivery', neighborhood: 'Centro', street: 'Rua A', number: '10' };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, 'Pastel da Vila') returning id
      `
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city,
                                  pix_key, pix_key_type, pix_beneficiary, pix_city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 3000, 'BRL', ${sql.json({})}, 'Saquarema', 'loja@exemplo.com', 'email', 'Pastel da Vila', 'Saquarema')
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 500, 30, 50)
    `;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'pasteis', 'Pastéis') returning id
      `
    )[0]!.id;
    productId = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${cat}, 'pastel', 'Pastel', 1000) returning id
      `
    )[0]!.id;
    await sql`
      insert into merchant_users (tenant_id, name, phone, role) values
        (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner')
    `;
    await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const v = await app.request('http://core.localhost/admin/v1/auth/otp/verify', {
      method: 'POST',
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-${++idem}`,
        'x-vendua-admin': '1',
      },
      body: JSON.stringify({ phone: ownerPhone, code: codes.get(ownerPhone) }),
    });
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(v.headers.get('set-cookie') ?? '')![1]}`;
    owner = (m, p, b) => call(m, `/admin/v1${p}`, b, { cookie });
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('a store that never set it: pickup follows the store minimum', async () => {
    const store = await owner('GET', '/store');
    expect(store.body.operations).toMatchObject({ minOrderCents: 3000, pickupMinOrderCents: 3000 });
    const { auth } = await shopper(2);
    const r = await call('POST', '/checkout/v1/checkout', input('pix', pickup), auth);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('ORDER_MIN_NOT_MET');
  });

  test('changing the delivery minimum keeps what pickup had', async () => {
    const r = await owner('PATCH', '/store', { operations: { minOrderCents: 4000 } });
    expect(r.status).toBe(200);
    expect(r.body.operations).toMatchObject({ minOrderCents: 4000, pickupMinOrderCents: 3000 });
    const bad = await owner('PATCH', '/store', { operations: { pickupMinOrderCents: -1 } });
    expect(bad.status).toBe(422);
  });

  test('no pickup minimum: the cart can go to checkout, delivery still asks its own', async () => {
    const r = await owner('PATCH', '/store', { operations: { pickupMinOrderCents: 0 } });
    expect(r.body.operations).toMatchObject({ minOrderCents: 4000, pickupMinOrderCents: 0 });
    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body).toMatchObject({ minOrderCents: 4000, pickupMinOrderCents: 0 });

    const { auth, cart } = await shopper(1);
    // no mode yet: reads as delivery, but pickup would take it
    expect(cart.totals).toMatchObject({
      minOrderCents: 4000,
      belowMinOrder: true,
      belowEveryMinOrder: false,
    });
    const asPickup = await call('POST', '/checkout/v1/cart/delivery', pickup, auth);
    expect(asPickup.body.cart.totals).toMatchObject({ minOrderCents: 0, belowMinOrder: false });
    const asDelivery = await call('POST', '/checkout/v1/cart/delivery', centro, auth);
    expect(asDelivery.body.cart.totals).toMatchObject({
      minOrderCents: 4000,
      belowMinOrder: true,
      belowEveryMinOrder: false,
    });
    const refused = await call('POST', '/checkout/v1/checkout', input('pix', centro), auth);
    expect(refused.body.error.code).toBe('ORDER_MIN_NOT_MET');
    const placed = await call('POST', '/checkout/v1/checkout', input('pix', pickup), auth);
    expect(placed.status).toBe(201);
  });

  test('payment methods per mode: admin, storefront and checkout agree', async () => {
    const view = await owner('GET', '/payments');
    expect(view.body.methodsOff).toEqual({ delivery: [], pickup: [] });
    expect(view.body.modes).toEqual({ delivery: true, pickup: true });

    const ok = await owner('PATCH', '/payments', {
      methodsOff: { pickup: ['cash'], delivery: ['pix'] },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.methodsOff).toEqual({ delivery: ['pix'], pickup: ['cash'] });
    expect(ok.body.methods).toEqual(['pix', 'card_on_delivery', 'cash']);

    for (const body of [
      { methodsOff: { pickup: ['pix', 'card_on_delivery', 'cash'] } },
      // Pix alone: delivery, which turned Pix off, would have nothing
      { methods: ['pix'] },
      { methodsOff: { pickup: ['bitcoin'] } },
      { methodsOff: [] },
    ]) {
      const r = await owner('PATCH', '/payments', body);
      expect(r.status).toBe(422);
      expect(r.body.error.details.field).toMatch(/^methods/);
    }

    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.paymentMethods).toEqual(['pix', 'card_on_delivery', 'cash']);
    expect(store.body.paymentMethodsByMode).toEqual({
      delivery: ['card_on_delivery', 'cash'],
      pickup: ['pix', 'card_on_delivery'],
    });

    const a = (await shopper(5)).auth;
    const cashPickup = await call('POST', '/checkout/v1/checkout', input('cash', pickup), a);
    expect(cashPickup.status).toBe(422);
    expect(cashPickup.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const pixDelivery = await call('POST', '/checkout/v1/checkout', input('pix', centro), a);
    expect(pixDelivery.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const cashDelivery = await call('POST', '/checkout/v1/checkout', input('cash', centro), a);
    expect(cashDelivery.status).toBe(201);
  });
});
