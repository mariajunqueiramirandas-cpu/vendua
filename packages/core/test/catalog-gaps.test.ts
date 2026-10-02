import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';

// Menu-import model gaps 1–5 over HTTP: promo price, option quantity, per-group pricing rule,
// category description, option description and photo.
describe.skipIf(!process.env.TEST_DATABASE_URL)('catalog model gaps (db)', () => {
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
  const slug = `cg-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `219${String(Date.now() + 31).slice(-8)}`;
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
  const session = async () => {
    const r = await call('POST', '/checkout/v1/session');
    expect(r.status).toBe(201);
    return { authorization: `Bearer ${r.body.sessionToken}` };
  };
  const addItem = (auth: Record<string, string>, body: Record<string, unknown>) =>
    call('POST', '/checkout/v1/cart/items', body, auth);

  let categoryId = '';
  let pizzaId = '';
  const opt: Record<string, string> = {};
  let groups: any[] = [];

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
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema')
    `;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Ana', ${ownerPhone}, 'owner')`;
    await request('core.localhost', 'POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const r = await request('core.localhost', 'POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    expect(r.body.signedIn).toBe(true);
    cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('category description: create, patch, list, storefront; bounded', async () => {
    const created = await admin('POST', '/categories', {
      name: 'Pizzas',
      description: 'Massa de fermentação natural',
    });
    expect(created.status).toBe(201);
    expect(created.body.category.description).toBe('Massa de fermentação natural');
    categoryId = created.body.category.id;

    const patched = await admin('PATCH', `/categories/${categoryId}`, {
      description: 'Forno a lenha',
    });
    expect(patched.status).toBe(200);
    expect(patched.body.category).toMatchObject({ name: 'Pizzas', description: 'Forno a lenha' });
    expect(
      (await admin('PATCH', `/categories/${categoryId}`, { description: 'x'.repeat(501) })).status,
    ).toBe(422);
    expect((await admin('PATCH', `/categories/${categoryId}`, {})).status).toBe(422);
    expect(
      (await admin('PATCH', `/categories/${crypto.randomUUID()}`, { description: 'a' })).status,
    ).toBe(404);
    expect((await admin('PATCH', '/categories/not-a-uuid', { description: 'a' })).status).toBe(400);
    const list = await admin('GET', '/catalog');
    expect(list.body.categories[0].description).toBe('Forno a lenha');
    // renaming keeps the description; clearing it with null
    await admin('PATCH', `/categories/${categoryId}`, { name: 'Pizzas da casa' });
    const sf = await call('GET', '/storefront/v1/catalog');
    expect(sf.body.categories[0]).toMatchObject({
      name: 'Pizzas da casa',
      description: 'Forno a lenha',
    });
  });

  test('compare-at price: above the price or 422; null clears; duplicate keeps it', async () => {
    expect(
      (
        await admin('POST', '/products', {
          name: 'Margherita',
          categoryId,
          priceCents: 4000,
          compareAtPriceCents: 4000,
        })
      ).body.error.code,
    ).toBe('BAD_REQUEST');
    const p = await admin('POST', '/products', {
      name: 'Margherita',
      categoryId,
      priceCents: 4000,
      compareAtPriceCents: 5000,
    });
    expect(p.status).toBe(201);
    expect(p.body.product.compareAtPriceCents).toBe(5000);
    pizzaId = p.body.product.id;

    // raising the price to the "de" price is refused, not silently cleared
    const up = await admin('PATCH', `/products/${pizzaId}`, { priceCents: 5000 });
    expect(up.status).toBe(422);
    expect(up.body.error.details.field).toBe('compareAtPriceCents');
    expect(
      (await admin('PATCH', `/products/${pizzaId}`, { compareAtPriceCents: 'x' })).status,
    ).toBe(422);
    const both = await admin('PATCH', `/products/${pizzaId}`, {
      priceCents: 5000,
      compareAtPriceCents: 6000,
    });
    expect(both.body.product).toMatchObject({ priceCents: 5000, compareAtPriceCents: 6000 });
    const sf = await call('GET', '/storefront/v1/catalog');
    expect(sf.body.categories[0].products[0]).toMatchObject({
      basePriceCents: 5000,
      compareAtPriceCents: 6000,
    });

    const dup = await admin('POST', `/products/${pizzaId}/duplicate`);
    expect(dup.body.product.compareAtPriceCents).toBe(6000);
    // bulk +10% moves both; a cut that crosses the "de" price drops it
    await admin('POST', '/products/bulk', {
      ids: [dup.body.product.id],
      action: 'price_percent',
      percent: 10,
    });
    expect((await admin('GET', `/products/${dup.body.product.id}`)).body.product).toMatchObject({
      priceCents: 5500,
      compareAtPriceCents: 6600,
    });
    await sql`update products set compare_at_price_cents = 5505 where id = ${dup.body.product.id}`;
    await admin('POST', '/products/bulk', {
      ids: [dup.body.product.id],
      action: 'price_percent',
      percent: -10,
    });
    expect((await admin('GET', `/products/${dup.body.product.id}`)).body.product).toMatchObject({
      priceCents: 4950,
      compareAtPriceCents: null,
    });

    const cleared = await admin('PATCH', `/products/${pizzaId}`, {
      priceCents: 4000,
      compareAtPriceCents: null,
    });
    expect(cleared.body.product.compareAtPriceCents).toBeNull();
    await admin('PATCH', `/products/${pizzaId}`, { compareAtPriceCents: 4500 });
  });

  test('options: maxQty, pricingRule, description and photo; bad input is 422', async () => {
    const body = (over: Record<string, unknown> = {}) => ({
      groups: [
        {
          name: 'Sabores',
          minSelect: 1,
          maxSelect: 2,
          pricingRule: 'most_expensive',
          options: [
            { name: 'Calabresa', priceDeltaCents: 1000 },
            { name: 'Camarão', priceDeltaCents: 1501, description: 'Camarão rosa' },
          ],
        },
        {
          name: 'Extras',
          minSelect: 0,
          maxSelect: 3,
          options: [
            {
              name: 'Queijo',
              priceDeltaCents: 300,
              maxQty: 3,
              imageUrl: '/v1/media/abc.webp',
              ...over,
            },
            { name: 'Bacon', priceDeltaCents: 500 },
          ],
        },
      ],
    });
    for (const bad of [
      { maxQty: 0 },
      { maxQty: 21 },
      { imageUrl: 'javascript:alert(1)' },
      { imageUrl: '//evil.example/x.png' },
      { description: 'x'.repeat(201) },
    ])
      expect((await admin('PUT', `/products/${pizzaId}/options`, body(bad))).status).toBe(422);
    const badRule = body();
    (badRule.groups[0] as any).pricingRule = 'cheapest';
    expect((await admin('PUT', `/products/${pizzaId}/options`, badRule)).status).toBe(422);

    const r = await admin('PUT', `/products/${pizzaId}/options`, body());
    expect(r.status).toBe(200);
    groups = r.body.product.groups;
    expect(groups.map((g: any) => g.pricingRule)).toEqual(['most_expensive', 'sum']);
    expect(groups[1].options[0]).toMatchObject({
      name: 'Queijo',
      maxQty: 3,
      imageUrl: '/v1/media/abc.webp',
      description: null,
    });
    expect(groups[0].options[1].description).toBe('Camarão rosa');
    for (const g of groups) for (const o of g.options) opt[o.name] = o.id;

    const sf = await call('GET', `/storefront/v1/products/${r.body.product.slug}`);
    const mg = sf.body.product.modifierGroups;
    expect(mg[0].pricingRule).toBe('most_expensive');
    expect(mg[1].modifiers[0]).toMatchObject({
      name: 'Queijo',
      maxQty: 3,
      description: null,
      imageUrl: '/v1/media/abc.webp',
    });
    expect(mg[1].modifiers[1]).toMatchObject({ maxQty: 1, description: null, imageUrl: null });
  });

  test('a discount option cannot be repeated, and never prices a line below zero', async () => {
    const p = await admin('POST', '/products', { name: 'Brinde', categoryId, priceCents: 100 });
    expect(p.status).toBe(201);
    const id = p.body.product.id;
    const put = (maxQty: number) =>
      admin('PUT', `/products/${id}/options`, {
        groups: [
          {
            name: 'Cupom',
            minSelect: 0,
            maxSelect: 5,
            options: [{ name: 'Desconto', priceDeltaCents: -300, maxQty }],
          },
        ],
      });
    expect((await put(5)).status).toBe(422);
    const ok = await put(1);
    expect(ok.status).toBe(200);
    const discount = ok.body.product.groups[0].options[0].id;

    const auth = await session();
    const r = await addItem(auth, { productId: id, qty: 1, modifierIds: [discount] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('INVALID_MODIFIER');
  });

  let orderId = '';
  let orderToken = '';

  test('cart: option qty prices per rule, merges by qty, 4xx on bad picks', async () => {
    const auth = await session();
    orderToken = auth.authorization.slice(7);
    const half = [opt.Calabresa!, opt['Camarão']!];
    // most_expensive half-and-half (1501) + 2× Queijo (600)
    const add = await addItem(auth, {
      productId: pizzaId,
      qty: 1,
      modifierIds: half,
      modifiers: [{ id: opt.Queijo, qty: 2 }],
    });
    expect(add.status).toBe(200);
    const line = add.body.cart.items[0];
    expect(line.unitPriceCents).toBe(4000 + 1501 + 600);
    expect(line.modifierQty).toEqual({ [opt.Queijo!]: 2 });
    expect(line.modifiers.find((m: any) => m.id === opt.Queijo)).toMatchObject({
      qty: 2,
      priceDeltaCents: 300,
    });
    expect(line.modifiers.find((m: any) => m.id === opt.Calabresa).qty).toBe(1);

    // the same picks merge; a different qty is its own line
    const again = await addItem(auth, {
      productId: pizzaId,
      qty: 1,
      modifiers: [...half.map((id) => ({ id })), { id: opt.Queijo, qty: 2 }],
    });
    expect(again.body.cart.items).toHaveLength(1);
    expect(again.body.cart.items[0].qty).toBe(2);
    const other = await addItem(auth, {
      productId: pizzaId,
      qty: 1,
      modifierIds: [...half, opt.Queijo],
    });
    expect(other.body.cart.items).toHaveLength(2);
    expect(other.body.cart.items[1].unitPriceCents).toBe(4000 + 1501 + 300);

    const err = async (b: Record<string, unknown>) =>
      (await addItem(auth, { productId: pizzaId, qty: 1, modifierIds: half, ...b })).body.error;
    expect(await err({ modifiers: [{ id: opt.Queijo, qty: 4 }] })).toMatchObject({
      code: 'MODIFIER_LIMIT',
      details: { modifierId: opt.Queijo, maxQty: 3 },
    });
    expect((await err({ modifiers: [{ id: opt.Bacon, qty: 2 }] })).code).toBe('MODIFIER_LIMIT');
    expect((await err({ modifiers: [{ id: opt.Queijo, qty: 0 }] })).code).toBe('INVALID_MODIFIER');
    expect((await err({ modifiers: [{ id: opt.Queijo, qty: 'x' }] })).code).toBe(
      'INVALID_MODIFIER',
    );
    expect((await err({ modifiers: [{ id: 'nope', qty: 2 }] })).code).toBe('INVALID_MODIFIER');
    expect((await err({ modifiers: [{ id: crypto.randomUUID() }] })).code).toBe('INVALID_MODIFIER');
    expect((await err({ modifiers: [{ qty: 2 }] })).code).toBe('BAD_REQUEST');
    expect(
      (await err({ modifiers: Array.from({ length: 33 }, () => ({ id: opt.Bacon })) })).code,
    ).toBe('BAD_REQUEST');
    // group limits count units: 3× Queijo fills Extras (max 3), Bacon on top is one too many
    expect(
      (
        await addItem(auth, {
          productId: pizzaId,
          qty: 1,
          modifierIds: [opt.Calabresa],
          modifiers: [{ id: opt.Queijo, qty: 3 }],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await err({
          modifiers: [
            { id: opt.Queijo, qty: 3 },
            { id: opt.Bacon, qty: 1 },
          ],
        })
      ).code,
    ).toBe('MODIFIER_LIMIT');
  });

  test('checkout reprices when the group rule changes; the order keeps option qty', async () => {
    const auth = { authorization: `Bearer ${orderToken}` };
    // drop the extra lines so the order holds the 2× Queijo pizza only
    const cart = (await call('GET', '/checkout/v1/cart', undefined, auth)).body.cart;
    for (const item of cart.items.slice(1))
      await call('PATCH', `/checkout/v1/cart/items/${item.id}`, { qty: 0 }, auth);

    // the merchant switches the flavours to the average rule: (1000 + 1501) / 2 → 1251
    const put = await admin('PUT', `/products/${pizzaId}/options`, {
      groups: groups.map((g: any, i: number) => ({
        ...g,
        pricingRule: i === 0 ? 'average' : g.pricingRule,
      })),
    });
    expect(put.status).toBe(200);
    const input = {
      customer: { name: 'Bia', phone: '21988887777' },
      delivery: { mode: 'pickup' },
      payment: { method: 'cash' },
    };
    const first = await call('POST', '/checkout/v1/checkout', input, auth);
    expect(first.body.error.code).toBe('PRICES_CHANGED');
    const repriced = (await call('GET', '/checkout/v1/cart', undefined, auth)).body.cart.items[0];
    expect(repriced.unitPriceCents).toBe(4000 + 1251 + 600);
    expect(repriced.modifiers.find((m: any) => m.id === opt.Queijo).qty).toBe(2);

    const placed = await call('POST', '/checkout/v1/checkout', input, auth);
    expect(placed.status).toBe(201);
    orderId = placed.body.order.id;
    const item = placed.body.order.items[0];
    expect(item.unitPriceCents).toBe(5851);
    expect(item.lineTotalCents).toBe(5851 * 2);
    expect(item.modifiers.find((m: any) => m.name === 'Queijo')).toEqual({
      name: 'Queijo',
      priceDeltaCents: 300,
      qty: 2,
    });
    expect(item.modifiers.find((m: any) => m.name === 'Calabresa').qty).toBe(1);
    const stored = (
      await sql<
        { modifiers: any[] }[]
      >`select modifiers from order_items where order_id = ${orderId}`
    )[0]!.modifiers;
    expect(stored.find((m) => m.id === opt.Queijo).qty).toBe(2);
  });

  test('reorder, share and import carry option qty', async () => {
    const c = await session();
    const re = await call('POST', '/checkout/v1/cart/reorder', { orderId, orderToken }, c);
    expect(re.status).toBe(200);
    expect(re.body.cart.items[0].modifierQty).toEqual({ [opt.Queijo!]: 2 });
    expect(re.body.cart.items[0].unitPriceCents).toBe(5851);

    const share = await call('POST', '/checkout/v1/cart/share', undefined, c);
    const d = await session();
    const imported = await call(
      'POST',
      '/checkout/v1/cart/import',
      { shareCode: share.body.code },
      d,
    );
    expect(imported.body.report).toEqual({ added: 1, skipped: [] });
    expect(imported.body.cart.items[0].modifierQty).toEqual({ [opt.Queijo!]: 2 });

    const e = await session();
    const items = await call(
      'POST',
      '/checkout/v1/cart/import',
      {
        items: [
          {
            productId: pizzaId,
            qty: 1,
            modifierIds: [opt.Calabresa],
            modifiers: [{ id: opt.Queijo, qty: 3 }],
          },
          {
            productId: pizzaId,
            qty: 1,
            modifierIds: [opt.Calabresa],
            modifiers: [{ id: opt.Bacon, qty: 2 }],
          },
        ],
      },
      e,
    );
    expect(items.body.report.added).toBe(1);
    expect(items.body.report.skipped.map((s: any) => s.code)).toEqual(['MODIFIER_LIMIT']);
    expect(items.body.cart.items[0].unitPriceCents).toBe(4000 + 1000 + 900);
    expect(
      (
        await call(
          'POST',
          '/checkout/v1/cart/import',
          { items: [{ productId: pizzaId, modifiers: [{ id: opt.Queijo, qty: 99 }] }] },
          e,
        )
      ).body.error.code,
    ).toBe('INVALID_IMPORT');
  });
});
