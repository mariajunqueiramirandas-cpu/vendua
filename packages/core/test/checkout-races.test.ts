import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';

// Checkout under concurrent requests, all at once over HTTP: one order per cart whatever the keys,
// never more units sold than counted, never more redemptions than a coupon allows.
describe.skipIf(!process.env.TEST_DATABASE_URL)('checkout races (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const app = createApp({
    sql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `race-${nonce}`;
  const host = `${slug}.localhost`;
  let tenantId = '';
  let productId = '';
  let idem = 0;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://${host}${path}`, {
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
  const cartWith = async (qty: number, coupon?: string) => {
    const s = await call('POST', '/checkout/v1/session');
    expect(s.status).toBe(201);
    const auth = { authorization: `Bearer ${s.body.sessionToken}` };
    expect((await call('POST', '/checkout/v1/cart/items', { productId, qty }, auth)).status).toBe(
      200,
    );
    if (coupon) {
      expect((await call('POST', '/checkout/v1/cart/coupon', { code: coupon }, auth)).status).toBe(
        200,
      );
    }
    return auth;
  };
  const checkout = (auth: Record<string, string>, i: number, key?: string) =>
    call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: `Cliente ${i}`, phone: `2299${String(1000000 + i).slice(-7)}` },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      { ...auth, ...(key ? { 'idempotency-key': key } : {}) },
    );
  const codes = (rs: { status: number; body: any }[]) =>
    rs.map((r) => (r.status === 201 ? 201 : r.body.error?.code)).sort();

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})})
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

  test('one cart, ten checkouts at once with ten keys: one order', async () => {
    const auth = await cartWith(2);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => checkout(auth, i)));
    expect(codes(rs)).toEqual([201, ...Array(9).fill('CART_NOT_OPEN')]);
    const cartId = auth.authorization.split('.')[1]!;
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from orders where tenant_id = ${tenantId} and cart_id = ${cartId}
    `;
    expect(n).toBe(1);
  });

  test('one cart, ten checkouts at once with one key: one order, nine replays of it', async () => {
    const auth = await cartWith(1);
    const key = `${nonce}-same`;
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => checkout(auth, i, key)));
    expect(rs.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect(new Set(rs.map((r) => r.body.order.id)).size).toBe(1);
  });

  test('the last units: eight carts for three left sell three', async () => {
    const carts = await Promise.all(Array.from({ length: 8 }, () => cartWith(1)));
    await sql`update products set stock_quantity = 3 where id = ${productId}`;
    try {
      const rs = await Promise.all(carts.map((a, i) => checkout(a, 100 + i)));
      expect(codes(rs)).toEqual([201, 201, 201, ...Array(5).fill('SOLD_OUT')]);
      const [p] = await sql<{ stock_quantity: number }[]>`
        select stock_quantity from products where id = ${productId}
      `;
      expect(p!.stock_quantity).toBe(0);
    } finally {
      await sql`update products set stock_quantity = null, status = 'active' where id = ${productId}`;
    }
  });

  test('a coupon good for two, applied in six carts checked out at once, is redeemed twice', async () => {
    const created = await call(
      'POST',
      `/control/v1/storefronts/${slug}/commerce/coupons`,
      { code: 'DUAS', kind: 'fixed', value: 100, maxRedemptions: 2 },
      { 'x-vendua-control': 'ctl' },
    );
    expect(created.status).toBe(201);
    const carts = await Promise.all(Array.from({ length: 6 }, () => cartWith(1, 'duas')));
    const rs = await Promise.all(carts.map((a, i) => checkout(a, 200 + i)));
    expect(codes(rs)).toEqual([201, 201, ...Array(4).fill('COUPON_EXHAUSTED')]);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int n from coupon_redemptions r join coupons c on c.id = r.coupon_id
      where c.tenant_id = ${tenantId} and c.code = 'DUAS'
    `;
    expect(n).toBe(2);
  });

  test('twenty adds to one cart at once all land', async () => {
    const s = await call('POST', '/checkout/v1/session');
    const auth = { authorization: `Bearer ${s.body.sessionToken}` };
    const rs = await Promise.all(
      Array.from({ length: 20 }, () =>
        call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, auth),
      ),
    );
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const cart = await call('GET', '/checkout/v1/cart', undefined, auth);
    expect(cart.body.cart.items.reduce((n: number, i: { qty: number }) => n + i.qty, 0)).toBe(20);
  });
});
