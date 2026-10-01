import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';
import { localParts } from '../src/platform/tz.ts';

// Timed promotions and "a partir de" over HTTP: Core prices the promotion in its windows, the
// cart and checkout agree with it, the catalog says when it next changes.
describe.skipIf(!process.env.TEST_DATABASE_URL)('timed promotions and from-price (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const codes = new Map<string, string>();
  const app = createApp({
    sql,
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
  const slug = `pr-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `219${String(Date.now() + 47).slice(-8)}`;
  let tenantId = '';
  let idem = 0;
  const request = async (
    h: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://${h}${path}`, {
      method,
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
    return {
      status: res.status,
      body: (await res.json()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };
  const call = (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    request(host, method, path, body, headers);
  let cookie = '';
  const admin = (method: string, path: string, body?: unknown) =>
    request('core.localhost', method, `/admin/v1${path}`, body, { cookie });
  const catalogProduct = async (name: string) => {
    const r = await call('GET', '/storefront/v1/catalog');
    return {
      body: r.body,
      product: r.body.categories.flatMap((c: any) => c.products).find((p: any) => p.name === name),
    };
  };

  // today and tomorrow in the store's clock
  const today = localParts(new Date(), 'America/Sao_Paulo').weekday;
  const tomorrow = (today + 1) % 7;
  let categoryId = '';
  let rodizio = '';

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema')
    `;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Ana', ${ownerPhone}, 'owner')`;
    await request('core.localhost', 'POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const r = await request('core.localhost', 'POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
    categoryId = (await admin('POST', '/categories', { name: 'Pratos' })).body.category.id;
    rodizio = (await admin('POST', '/products', { name: 'Rodízio', categoryId, priceCents: 5000 }))
      .body.product.id;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('a promotion must sit below the price and have windows', async () => {
    const at = (body: unknown) => admin('PATCH', `/products/${rodizio}`, { promoSchedule: body });
    const below = await at({ priceCents: 5000, windows: [{ days: [today] }] });
    expect(below.status).toBe(422);
    expect(below.body.error.details.field).toBe('promoSchedule.priceCents');
    expect((await at({ priceCents: 3990, windows: [] })).status).toBe(422);
    expect(
      (await at({ priceCents: 3990, windows: [{ days: [today], from: '20:00', to: '18:00' }] }))
        .status,
    ).toBe(422);
    expect((await at({ priceCents: -1, windows: [{ days: [today] }] })).status).toBe(422);
    expect((await at('3990')).status).toBe(422);
  });

  test('inside its window the shopper pays the promotion, the regular price struck through', async () => {
    const r = await admin('PATCH', `/products/${rodizio}`, {
      promoSchedule: { priceCents: 3990, windows: [{ days: [today] }] },
    });
    expect(r.status).toBe(200);
    expect(r.body.product).toMatchObject({
      priceCents: 5000,
      promoSchedule: { priceCents: 3990, windows: [{ days: [today] }] },
      promoNow: true,
    });
    const { product, body } = await catalogProduct('Rodízio');
    expect(product).toMatchObject({ basePriceCents: 3990, compareAtPriceCents: 5000 });
    expect(product.promoLabel).toBeTruthy();
    // a day-only window turns at the store's next midnight
    const next = Date.parse(body.nextChangeAt);
    expect(next).toBeGreaterThan(Date.now());
    expect(next - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);
    const detail = (await call('GET', `/storefront/v1/products/${product.slug}`)).body.product;
    expect(detail).toMatchObject({ basePriceCents: 3990, compareAtPriceCents: 5000 });
  });

  test('the cart keeps what was shown; checkout reprices when the window has closed', async () => {
    const session = await call('POST', '/checkout/v1/session');
    const auth = { authorization: `Bearer ${session.body.sessionToken}` };
    const added = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: rodizio, qty: 2 },
      auth,
    );
    expect(added.body.cart.items[0].unitPriceCents).toBe(3990);
    // the promotion moves to tomorrow
    await admin('PATCH', `/products/${rodizio}`, {
      promoSchedule: { priceCents: 3990, windows: [{ days: [tomorrow] }] },
    });
    const { product } = await catalogProduct('Rodízio');
    expect(product).toMatchObject({ basePriceCents: 5000, compareAtPriceCents: null });
    expect(product.promoLabel).toBeTruthy();
    const input = {
      customer: { name: 'Bia', phone: '21988887777' },
      delivery: { mode: 'pickup' },
      payment: { method: 'cash' },
    };
    const first = await call('POST', '/checkout/v1/checkout', input, auth);
    expect(first.body.error.code).toBe('PRICES_CHANGED');
    const placed = await call('POST', '/checkout/v1/checkout', input, auth);
    expect(placed.status).toBe(201);
    expect(placed.body.order.items[0].unitPriceCents).toBe(5000);
  });

  test("the price can't drop to the promotion; bulk price moves it; duplicate keeps it; null clears", async () => {
    const low = await admin('PATCH', `/products/${rodizio}`, { priceCents: 3990 });
    expect(low.status).toBe(422);
    expect(low.body.error.details.field).toBe('promoSchedule.priceCents');
    const bulk = await admin('POST', '/products/bulk', {
      ids: [rodizio],
      action: 'price_percent',
      percent: 10,
    });
    expect(bulk.status).toBe(200);
    expect((await admin('GET', `/products/${rodizio}`)).body.product).toMatchObject({
      priceCents: 5500,
      promoSchedule: { priceCents: 4390 },
    });
    const dup = await admin('POST', `/products/${rodizio}/duplicate`);
    expect(dup.body.product.promoSchedule).toMatchObject({ priceCents: 4390 });
    const cleared = await admin('PATCH', `/products/${rodizio}`, { promoSchedule: null });
    expect(cleared.body.product).toMatchObject({ promoSchedule: null, promoNow: false });
    expect((await catalogProduct('Rodízio')).product.promoLabel).toBeUndefined();
  });

  test('a promotion stored malformed is ignored, never a 500', async () => {
    for (const bad of [
      { priceCents: 100, windows: [{}] },
      { priceCents: 100, windows: 'x' },
      { priceCents: -5, windows: [{ days: [today] }] },
      { priceCents: '100', windows: [{ days: [today] }] },
    ]) {
      await sql`update products set promo_schedule = ${sql.json(bad as never)} where id = ${rodizio}`;
      const r = await call('GET', '/storefront/v1/catalog');
      expect(r.status).toBe(200);
      const p = r.body.categories
        .flatMap((c: any) => c.products)
        .find((x: any) => x.name === 'Rodízio');
      expect(p.basePriceCents).toBe(5500);
      expect(p.promoLabel).toBeUndefined();
    }
    await sql`update products set promo_schedule = null where id = ${rodizio}`;
  });

  test('"a partir de": a product priced by a required list shows its cheapest configuration', async () => {
    const id = (
      await admin('POST', '/products', { name: 'Mini pastéis', categoryId, priceCents: 0 })
    ).body.product.id;
    const put = await admin('PUT', `/products/${id}/options`, {
      groups: [
        {
          name: 'Sabores',
          minSelect: 1,
          maxSelect: 10,
          options: [
            { name: 'Carne', priceDeltaCents: 2590, maxQty: 10 },
            { name: 'Queijo', priceDeltaCents: 2290, maxQty: 10 },
          ],
        },
      ],
    });
    expect(put.status).toBe(200);
    const { product } = await catalogProduct('Mini pastéis');
    expect(product).toMatchObject({ basePriceCents: 0, fromPriceCents: 2290 });
    const detail = (await call('GET', `/storefront/v1/products/${product.slug}`)).body.product;
    expect(detail.fromPriceCents).toBe(2290);
    // a product whose price is its own: no "a partir de"
    expect((await catalogProduct('Rodízio')).product.fromPriceCents).toBeNull();
  });
});
