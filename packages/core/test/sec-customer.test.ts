import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';

// Security regressions (audit 2026-09-30): H2 customer tokens need a delivered anchor order,
// M8 public limiters honour VENDUA_PROXY_HOPS, stale cart prices refresh at checkout.
describe.skipIf(!process.env.TEST_DATABASE_URL)('customer / storefront security (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl', autoDrain: false });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `sc-${nonce}`;
  const host = `${slug}.localhost`;
  const VICTIM = '22911110000';
  let tenantId = '';
  let productId = '';
  let idem = 0;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    via = app,
  ) => {
    const res = await via.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        ...(method === 'GET' ? {} : { 'idempotency-key': `${nonce}-${++idem}` }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const ctl = (method: string, path: string, body?: unknown) =>
    call(method, `/control/v1/storefronts/${slug}/commerce${path}`, body, {
      'x-vendua-control': 'ctl',
    });
  const session = async () => {
    const r = await call('POST', '/checkout/v1/session');
    expect(r.status).toBe(201);
    return { authorization: `Bearer ${r.body.sessionToken}` };
  };
  const placeOrder = async (phone: string, headers: Record<string, string> = {}) => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, auth);
    const r = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Xana', phone },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      { ...auth, ...headers },
    );
    expect(r.body.error ?? null).toBeNull();
    return { order: r.body.order, token: r.body.customerToken as string };
  };
  const deliver = async (orderId: string) => {
    for (const to of ['confirmed', 'preparing', 'ready', 'delivered'])
      expect((await ctl('POST', `/orders/${orderId}/transition`, { to })).status).toBe(200);
  };
  const as = (token: string) => ({ 'x-vendua-customer': token });

  let victimToken = '';
  let victimOrders: string[] = [];
  let fiel = '';

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city, loyalty)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema',
              ${sql.json({ stampsRequired: 2, minOrderCents: 0, reward: { kind: 'fixed', value: 500, label: 'R$ 5' }, rewardValidDays: 60 })})
    `;
    const cat = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    productId = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${cat}, 'pudim', 'Pudim', 2000) returning id
      `
    )[0]!.id;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('H2: the victim earns a reward; their checkout token is proven once delivered', async () => {
    const a = await placeOrder(VICTIM);
    const b = await placeOrder(VICTIM);
    victimToken = a.token;
    victimOrders = [a.order.id, b.order.id];
    // pending: only the anchor order, no codes
    const pending = await call('GET', '/checkout/v1/customer/orders', undefined, as(a.token));
    expect(pending.body.orders.map((o: any) => o.id)).toEqual([a.order.id]);
    await deliver(a.order.id);
    await deliver(b.order.id);
    const loyalty = await call('GET', '/checkout/v1/customer/loyalty', undefined, as(a.token));
    expect(loyalty.body.loyalty.rewards).toHaveLength(1);
    fiel = loyalty.body.loyalty.rewards[0].code;
    expect(fiel).toStartWith('FIEL-');
    const full = await call('GET', '/checkout/v1/customer/orders', undefined, as(a.token));
    expect(full.body.orders).toHaveLength(2);
  });

  let attacker: { order: any; token: string };
  test('H2: checkout with the victim phone sees only its own order and no reward codes', async () => {
    attacker = await placeOrder(VICTIM);
    const orders = await call('GET', '/checkout/v1/customer/orders', undefined, as(attacker.token));
    expect(orders.status).toBe(200);
    expect(orders.body.orders.map((o: any) => o.id)).toEqual([attacker.order.id]);
    const loyalty = await call(
      'GET',
      '/checkout/v1/customer/loyalty',
      undefined,
      as(attacker.token),
    );
    expect(loyalty.status).toBe(200);
    expect(loyalty.body.loyalty.rewards).toEqual([]);
    expect(JSON.stringify(loyalty.body)).not.toContain(fiel);
    // nor reorder the victim's orders (its own anchor is fine)
    const s = await session();
    const reorder = await call(
      'POST',
      '/checkout/v1/cart/reorder',
      { orderId: victimOrders[0] },
      { ...s, ...as(attacker.token) },
    );
    expect(reorder.status).toBe(404);
    const own = await call(
      'POST',
      '/checkout/v1/cart/reorder',
      { orderId: attacker.order.id },
      { ...s, ...as(attacker.token) },
    );
    expect(own.status).toBe(200);
  });

  test("H2: the attacker cannot redeem the victim's FIEL code", async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, auth);
    const apply = await call(
      'POST',
      '/checkout/v1/cart/coupon',
      { code: fiel },
      { ...auth, ...as(attacker.token) },
    );
    expect(apply.status).toBe(422);
    expect(apply.body.error.code).toBe('COUPON_NOT_YOURS');
    // even with the code forced onto the cart, checkout re-checks it
    const cartId = (
      await sql<{ id: string }[]>`
        select id from carts where tenant_id = ${tenantId} and status = 'open'
        order by created_at desc limit 1
      `
    )[0]!.id;
    await sql`update carts set coupon_code = ${fiel} where id = ${cartId}`;
    const input = {
      customer: { name: 'Xana', phone: VICTIM },
      delivery: { mode: 'pickup' },
      payment: { method: 'cash' },
    };
    const r = await call('POST', '/checkout/v1/checkout', input, {
      ...auth,
      ...as(attacker.token),
    });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'COUPON_NOT_YOURS', details: { field: 'coupon' } });
    // the real customer, with their proven token, redeems it
    const ok = await call('POST', '/checkout/v1/checkout', input, { ...auth, ...as(victimToken) });
    expect(ok.status).toBe(201);
    expect(ok.body.order.discountCents).toBe(500);
    // and keeps a proven token after ordering again
    const hist = await call(
      'GET',
      '/checkout/v1/customer/orders',
      undefined,
      as(ok.body.customerToken),
    );
    expect(hist.body.orders.length).toBeGreaterThanOrEqual(4);
  });

  test("H2: once the attacker's anchor order is delivered the token is proven", async () => {
    await deliver(attacker.order.id);
    const orders = await call('GET', '/checkout/v1/customer/orders', undefined, as(attacker.token));
    expect(orders.body.orders.length).toBeGreaterThanOrEqual(4);
  });

  test('H2: old-format tokens and cancelled anchors answer 401', async () => {
    const old = await call(
      'GET',
      '/checkout/v1/customer/orders',
      undefined,
      as(`vcu.${VICTIM}.9999999999.x`),
    );
    expect(old.status).toBe(401);
    expect(old.body.error.code).toBe('CUSTOMER_REQUIRED');
    const p = await placeOrder('22933334444');
    await ctl('POST', `/orders/${p.order.id}/transition`, { to: 'cancelled' });
    const r = await call('GET', '/checkout/v1/customer/loyalty', undefined, as(p.token));
    expect(r.status).toBe(401);
  });

  test('H2: /customer/session caps wrong guesses per phone', async () => {
    const phone = '22955556666';
    const p = await placeOrder(phone);
    const guess = (ph: string, orderNumber: number) =>
      call('POST', '/checkout/v1/customer/session', { phone: ph, orderNumber });
    // wrong phone and missing order look the same
    const wrongPhone = await guess('22900000000', p.order.number);
    const missing = await guess(phone, 99_999);
    expect(wrongPhone.status).toBe(404);
    expect(missing.body).toEqual(wrongPhone.body);
    for (let i = 0; i < 4; i++) expect((await guess(phone, 90_000 + i)).status).toBe(404);
    const capped = await guess(phone, p.order.number);
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('RATE_LIMITED');
    const rows = await sql`
      select count(*)::int as n from customer_session_failures
      where tenant_id = ${tenantId} and phone = ${phone}
    `;
    expect(rows[0]!.n).toBe(5);
  });

  test('Low: a stale cart price is refreshed and the checkout refused once', async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId, qty: 2 }, auth);
    await sql`update products set base_price_cents = 2600 where id = ${productId}`;
    try {
      const input = {
        customer: { name: 'Xana', phone: '22977778888' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      };
      const r = await call('POST', '/checkout/v1/checkout', input, auth);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({ code: 'PRICES_CHANGED', details: { changedLines: 1 } });
      const cart = await call('GET', '/checkout/v1/cart', undefined, auth);
      expect(cart.body.cart.items[0].unitPriceCents).toBe(2600);
      expect(cart.body.cart.totals.subtotalCents).toBe(5200);
      const ok = await call('POST', '/checkout/v1/checkout', input, auth);
      expect(ok.status).toBe(201);
      expect(ok.body.order.totalCents).toBe(5200);
    } finally {
      await sql`update products set base_price_cents = 2000 where id = ${productId}`;
    }
  });

  test('M8: behind a proxy hop each shopper gets their own limiter bucket', async () => {
    const prev = { trust: process.env.VENDUA_TRUST_PROXY, hops: process.env.VENDUA_PROXY_HOPS };
    process.env.VENDUA_TRUST_PROXY = '1';
    process.env.VENDUA_PROXY_HOPS = '1';
    const proxied = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl', autoDrain: false });
    process.env.VENDUA_TRUST_PROXY = prev.trust;
    process.env.VENDUA_PROXY_HOPS = prev.hops;
    if (prev.trust === undefined) delete process.env.VENDUA_TRUST_PROXY;
    if (prev.hops === undefined) delete process.env.VENDUA_PROXY_HOPS;
    const from = (ip: string) =>
      call(
        'POST',
        '/checkout/v1/customer/session',
        {},
        { 'x-forwarded-for': `${ip}, 10.0.0.9` },
        proxied,
      );
    // /customer/session allows 10/min per client; the bodies are invalid (422), the limit isn't
    for (let i = 0; i < 10; i++) expect((await from('203.0.113.1')).status).toBe(422);
    expect((await from('203.0.113.1')).status).toBe(429);
    expect((await from('203.0.113.2')).status).toBe(422);
  });
});
