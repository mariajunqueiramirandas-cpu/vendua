import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { addItem } from '../src/modules/cart.ts';
import { createCartTx } from '../src/modules/cart-ops.ts';
import { getProductById } from '../src/modules/catalog.ts';
import { transitionOrder } from '../src/modules/orders.ts';
import { placeOrderTx } from '../src/modules/place-order.ts';
import {
  costOf,
  marginBpAt,
  parsePricing,
  suggestedPriceCents,
} from '../src/modules/pricing-calc.ts';
import { modifierDemand } from '../src/modules/stock.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { HttpError } from '../src/platform/http.ts';

describe('pricing calculator math', () => {
  test('suggested price and the margin a price really leaves', () => {
    const p = parsePricing({
      lines: [
        { label: 'Ingredientes', cents: 600 },
        { label: 'Embalagem', cents: 150 },
      ],
      feeBp: 500,
      taxBp: 600,
      marginBp: 3000,
    });
    expect(costOf(p)).toBe(750);
    // 750 / (1 − 0.41) = 1271.18… → up to the cent
    expect(suggestedPriceCents(750, p)).toBe(1272);
    // at R$ 15: 1500 − 750 − 165 = 585 → 39%
    expect(marginBpAt(1500, 750, p)).toBe(3900);
    expect(marginBpAt(500, 750, p)).toBeLessThan(0);
    expect(marginBpAt(0, 750, p)).toBeNull();
    expect(marginBpAt(1000, 400, null)).toBe(6000);
  });

  test('bad input is a 422 on the field', () => {
    const bad = (v: unknown) => {
      try {
        parsePricing(v);
      } catch (e) {
        return (e as HttpError).details?.field;
      }
      return null;
    };
    const ok = { lines: [], feeBp: 0, taxBp: 0, marginBp: 3000 };
    expect(bad(ok)).toBeNull();
    expect(bad({ ...ok, feeBp: 4000, taxBp: 3000, marginBp: 3000 })).toBe('pricing.marginBp');
    expect(bad({ ...ok, feeBp: -1 })).toBe('pricing.feeBp');
    expect(bad({ ...ok, lines: [{ label: '', cents: 1 }] })).toBe('pricing.lines[0].label');
    expect(bad({ ...ok, lines: [{ label: 'x', cents: 1.5 }] })).toBe('pricing.lines[0].cents');
    expect(
      bad({ ...ok, lines: Array.from({ length: 13 }, () => ({ label: 'x', cents: 1 })) }),
    ).toBe('pricing.lines');
    expect(bad(null)).toBe('pricing.lines');
  });

  test('modifier demand: line qty × option units', () => {
    expect(
      modifierDemand([
        { qty: 2, modifierIds: ['a', 'b'], modifierQty: { b: 3 } },
        { qty: 1, modifierIds: ['a'] },
        { qty: 4 },
      ]),
    ).toEqual(
      new Map([
        ['a', 3],
        ['b', 6],
      ]),
    );
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('stock manager (db)', () => {
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
  const slug = `sm-${nonce}`;
  const ownerPhone = `219${String(Date.now() + 23).slice(-8)}`;
  let tenantId = '';
  let idem = 0;
  const ids: Record<string, string> = {};
  const opt: Record<string, string> = {};
  let owner: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: any }>;
  const tx = <T>(fn: (tx: postgres.Sql) => Promise<T>) =>
    withTenant(sql as never, tenantId, fn as never) as Promise<T>;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (err) {
      if (err instanceof HttpError)
        return { status: err.status, code: err.code, details: err.details };
      throw err;
    }
    return null;
  };

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    h: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://core.localhost${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...h,
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

  const line = (product: string, qty: number, mods: [string, number][] = []) => ({
    productId: ids[product]!,
    qty,
    modifiers: mods.map(([id, n]) => ({ id: opt[id]!, qty: n })),
  });
  const cartWith = (...lines: ReturnType<typeof line>[]) =>
    tx(async (t) => {
      const { cartId } = await createCartTx(t, tenantId, 's');
      for (const l of lines) await addItem(t, tenantId, cartId, l, getProductById);
      return cartId;
    });
  const place = (cartId: string) =>
    tx((t) =>
      placeOrderTx(
        t,
        tenantId,
        cartId,
        {
          customer: { name: 'Ana Teste', phone: '21999990000' },
          delivery: { mode: 'pickup' },
          payment: { method: 'cash' },
        },
        new Date(),
      ),
    );
  const baconOf = async (product: string) =>
    (await tx((t) =>
      getProductById(t, tenantId, ids[product]!),
    ))!.modifierGroups[0]!.modifiers.find((m) => m.name.toLowerCase().includes('bacon'))!;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id
      `
    )[0]!.id;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL')
    `;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Dona', ${ownerPhone}, 'owner')`;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'lanches', 'Lanches') returning id
      `
    )[0]!.id;
    for (const [s, name] of [
      ['burger', 'X-Burger'],
      ['salada', 'X-Salada'],
    ] as const) {
      ids[s] = (
        await sql<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, base_price_cents)
          values (${tenantId}, ${cat}, ${s}, ${name}, 2000) returning id
        `
      )[0]!.id;
      const g = (
        await sql<{ id: string }[]>`
          insert into modifier_groups (tenant_id, product_id, name, min_select, max_select)
          values (${tenantId}, ${ids[s]!}, 'Adicionais', 0, 5) returning id
        `
      )[0]!.id;
      // the same adicional, spelled two ways: one count
      opt[`${s}-bacon`] = (
        await sql<{ id: string }[]>`
          insert into modifiers (tenant_id, group_id, name, price_delta_cents, max_qty)
          values (${tenantId}, ${g}, ${s === 'burger' ? 'Bacon extra' : ' bacon  Extra '}, 400, 3)
          returning id
        `
      )[0]!.id;
      opt[`${s}-ovo`] = (
        await sql<{ id: string }[]>`
          insert into modifiers (tenant_id, group_id, name, price_delta_cents)
          values (${tenantId}, ${g}, 'Ovo', 200) returning id
        `
      )[0]!.id;
    }
    const start = await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    expect(start.status).toBe(200);
    const r = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    const cookie = /vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!;
    owner = (method, path, body) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${cookie}` });
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
    if (appSql !== sql) await appSql.end();
  });

  test('an adicional counts by name across products: drawn at checkout, given back on cancel', async () => {
    const list = await owner('GET', '/stock/addons');
    expect(list.status).toBe(200);
    const bacon = list.body.addons.find((a: any) => a.key === 'bacon extra');
    expect(bacon).toMatchObject({
      name: 'Bacon extra',
      tracked: false,
      stockQuantity: null,
      productCount: 2,
      priceDeltaCents: 400,
      status: 'active',
    });
    expect(bacon.products.map((p: any) => p.name).sort()).toEqual(['X-Burger', 'X-Salada']);

    const start = await owner('PATCH', '/stock/addons', {
      key: 'bacon extra',
      stockQuantity: 3,
      lowStockThreshold: 1,
      costCents: 150,
    });
    expect(start.status).toBe(200);
    expect(start.body.addon).toMatchObject({ tracked: true, stockQuantity: 3, costCents: 150 });

    // 2 units on one product plus 2 on the other is more than the 3 there are
    const cartId = await cartWith(line('burger', 1, [['burger-bacon', 2]]));
    expect(
      await code(
        tx((t) =>
          addItem(t, tenantId, cartId, line('salada', 2, [['salada-bacon', 1]]), getProductById),
        ),
      ),
    ).toMatchObject({ status: 409, code: 'MODIFIER_SOLD_OUT', details: { available: 3 } });
    await tx((t) =>
      addItem(t, tenantId, cartId, line('salada', 1, [['salada-bacon', 1]]), getProductById),
    );
    const orderId = await place(cartId);

    const [order] = await sql`select addon_stock_drawn, number from orders where id = ${orderId}`;
    expect(order!.addon_stock_drawn).toEqual({ 'bacon extra': 3 });
    expect(
      (await sql`select stock_quantity from addon_stock where tenant_id = ${tenantId}`)[0]!
        .stock_quantity,
    ).toBe(0);
    // at 0 it reads sold out on every product that offers it; the egg is untouched
    expect((await baconOf('burger')).status).toBe('sold_out');
    expect((await baconOf('salada')).status).toBe('sold_out');
    expect(await code(cartWith(line('burger', 1, [['burger-bacon', 1]])))).toMatchObject({
      code: 'MODIFIER_SOLD_OUT',
    });
    await cartWith(line('burger', 1, [['burger-ovo', 1]]));

    await tx((t) => transitionOrder(t, tenantId, orderId, 'cancelled', 'merchant'));
    expect(
      (await sql`select stock_quantity from addon_stock where tenant_id = ${tenantId}`)[0]!
        .stock_quantity,
    ).toBe(3);
    expect((await baconOf('salada')).status).toBe('active');

    const moves = await owner(
      'GET',
      `/stock/movements?addonKey=${encodeURIComponent('bacon extra')}`,
    );
    expect(moves.status).toBe(200);
    expect(
      moves.body.movements.map((m: any) => [
        m.reason,
        m.delta,
        m.after,
        m.order?.number ?? null,
        m.by,
      ]),
    ).toEqual([
      ['cancel', 3, 3, order!.number, null],
      ['sale', -3, 0, order!.number, null],
      ['start', 3, 3, null, 'Dona'],
    ]);
    expect(moves.body.next).toBeNull();
  });

  test('relative changes with a reason, history paging, stop counting', async () => {
    const key = 'bacon extra';
    const delivery = await owner('POST', '/stock/addons/adjust', {
      changes: [
        { key, add: 5, reason: 'delivery' },
        { key: 'ovo', add: 2 },
      ],
    });
    expect(delivery.status).toBe(200);
    // the egg isn't counted: left alone
    expect(delivery.body.stock).toEqual({ [key]: 8 });
    const loss = await owner('POST', '/stock/addons/adjust', {
      changes: [{ key, add: -20, reason: 'loss' }],
    });
    expect(loss.body.stock).toEqual({ [key]: 0 });
    for (const bad of [
      {},
      { changes: [] },
      { changes: [{ key: '', add: 1 }] },
      { changes: [{ key, add: 1, reason: 'theft' }] },
      { changes: [{ key, add: 0.5 }] },
    ])
      expect((await owner('POST', '/stock/addons/adjust', bad)).status).toBe(422);

    // 30 a page, newest first, the cursor continues it
    // two taps on one adicional in a batch are one move
    for (let i = 0; i < 26; i++)
      await owner('POST', '/stock/addons/adjust', {
        changes: [
          { key, add: 2 },
          { key, add: -1 },
        ],
      });
    const first = await owner('GET', `/stock/movements?addonKey=${encodeURIComponent(key)}`);
    expect(first.body.movements).toHaveLength(30);
    expect(first.body.movements[0]).toMatchObject({ reason: 'adjust', delta: 1, after: 26 });
    const rest = await owner(
      'GET',
      `/stock/movements?addonKey=${encodeURIComponent(key)}&before=${encodeURIComponent(first.body.next)}`,
    );
    expect(rest.body.movements.map((m: any) => m.reason)).toEqual(['start']);
    expect(rest.body.next).toBeNull();
    for (const q of [
      '',
      `?productId=nope`,
      `?productId=${ids.burger}&addonKey=x`,
      `?addonKey=${encodeURIComponent(key)}&before=garbage`,
    ])
      expect((await owner('GET', `/stock/movements${q}`)).status).toBe(422);

    expect(
      (await owner('PATCH', '/stock/addons', { key: 'nada disso', stockQuantity: 1 })).status,
    ).toBe(404);
    expect(
      (await owner('PATCH', '/stock/addons', { key: 'ovo', lowStockThreshold: 2 })).status,
    ).toBe(409);
    expect((await owner('PATCH', '/stock/addons', { key })).status).toBe(422);

    const stop = await owner('PATCH', '/stock/addons', { key, stockQuantity: null });
    expect(stop.status).toBe(200);
    expect(stop.body.addon).toMatchObject({ tracked: false, stockQuantity: null, costCents: null });
    const last = await owner('GET', `/stock/movements?addonKey=${encodeURIComponent(key)}`);
    expect(last.body.movements[0]).toMatchObject({ reason: 'stop', delta: 0, after: null });
  });

  test('product costs, the calculator and the stock overview', async () => {
    const id = ids.burger!;
    const priced = await owner('PATCH', `/products/${id}`, {
      pricing: {
        lines: [
          { label: 'Ingredientes', cents: 600 },
          { label: 'Embalagem', cents: 150 },
        ],
        feeBp: 500,
        taxBp: 600,
        marginBp: 3000,
      },
    });
    expect(priced.status).toBe(200);
    expect(priced.body.product).toMatchObject({
      costCents: 750,
      suggestedPriceCents: 1272,
      // R$ 20: 2000 − 750 − 220 = 1030 → 51.5%
      marginBp: 5150,
    });
    // the next product's calculator starts from these percentages
    const other = await owner('GET', `/products/${ids.salada}`);
    expect(other.body.pricingDefaults).toEqual({ feeBp: 500, taxBp: 600, marginBp: 3000 });
    expect(other.body.product).toMatchObject({ costCents: null, pricing: null, marginBp: null });

    // a cost typed in Estoque replaces the lines and keeps the percentages
    const typed = await owner('PATCH', `/products/${id}`, { costCents: 900 });
    expect(typed.body.product.pricing).toEqual({
      lines: [{ label: 'Custo', cents: 900 }],
      feeBp: 500,
      taxBp: 600,
      marginBp: 3000,
    });
    expect((await owner('PATCH', `/products/${id}`, { costCents: 1, pricing: null })).status).toBe(
      422,
    );
    expect(
      (
        await owner('PATCH', `/products/${id}`, {
          pricing: { lines: [], feeBp: 5000, taxBp: 5000, marginBp: 0 },
        })
      ).status,
    ).toBe(422);
    expect((await owner('PATCH', `/products/${id}`, { costCents: -1 })).status).toBe(422);

    // a product's history: start, a delivery with who did it, a sale
    await owner('PATCH', `/products/${id}`, { stockQuantity: 4 });
    const d = await owner('POST', '/products/stock', {
      changes: [{ productId: id, add: 6, reason: 'delivery' }],
    });
    expect(d.body.stock).toEqual({ [id]: 10 });
    await place(await cartWith(line('burger', 2)));
    const moves = await owner('GET', `/stock/movements?productId=${id}`);
    expect(moves.body.movements.map((m: any) => [m.reason, m.delta, m.after, m.by])).toEqual([
      ['sale', -2, 8, null],
      ['delivery', 6, 10, 'Dona'],
      ['start', 4, 4, 'Dona'],
    ]);

    await owner('PATCH', '/stock/addons', { key: 'ovo', stockQuantity: 10, costCents: 50 });
    await owner('PATCH', `/products/${ids.salada}`, { stockQuantity: 5 });
    const ov = await owner('GET', '/stock/overview');
    expect(ov.status).toBe(200);
    // 8 × 900 + 10 × 50; the salad has no cost yet
    expect(ov.body).toMatchObject({ valueCents: 7700, costedItems: 2, uncostedItems: 1 });
    expect(ov.body.sold7d.products[id]).toBe(2);
    expect(ov.body.sold7d.addons['bacon extra']).toBe(3);

    // clearing the calculator clears the cost
    const cleared = await owner('PATCH', `/products/${id}`, { pricing: null });
    expect(cleared.body.product).toMatchObject({ costCents: null, pricing: null, marginBp: null });
  });
});
