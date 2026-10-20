import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { restockOf } from '../src/admin/routes-insumos.ts';
import { createApp } from '../src/app.ts';
import { addItem } from '../src/modules/cart.ts';
import { createCartTx } from '../src/modules/cart-ops.ts';
import { getProductById } from '../src/modules/catalog.ts';
import { averageCost, costPerK, explode, type Fichas } from '../src/modules/insumos.ts';
import { transitionOrder } from '../src/modules/orders.ts';
import { placeOrderTx } from '../src/modules/place-order.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

describe('insumos math', () => {
  const f: Fichas = {
    ingredients: new Map([
      [
        'mayo',
        {
          id: 'mayo',
          kind: 'insumo',
          name: 'Maionese',
          unit: 'g',
          stock: 0,
          cpk: 2000,
          yield: null,
        },
      ],
      [
        'garlic',
        {
          id: 'garlic',
          kind: 'insumo',
          name: 'Alho',
          unit: 'g',
          stock: null,
          cpk: 3000,
          yield: null,
        },
      ],
      [
        'sauce',
        {
          id: 'sauce',
          kind: 'preparo',
          name: 'Molho',
          unit: 'ml',
          stock: null,
          cpk: null,
          yield: 1_000_000,
        },
      ],
      [
        'loop',
        {
          id: 'loop',
          kind: 'preparo',
          name: 'Laço',
          unit: 'g',
          stock: null,
          cpk: null,
          yield: 1000,
        },
      ],
    ]),
    product: new Map(),
    modifier: new Map(),
    preparo: new Map([
      [
        'sauce',
        [
          { ingredientId: 'mayo', qty: 800_000, mode: null },
          { ingredientId: 'garlic', qty: 50_000, mode: null },
        ],
      ],
      ['loop', [{ ingredientId: 'loop', qty: 1000, mode: null }]],
    ]),
    perOrder: [],
  };

  test('a preparo costs its ficha over its yield; an uncounted one passes through to a sale', () => {
    // (800 g × R$ 20/kg + 50 g × R$ 30/kg) per litre
    expect(costPerK(f, 'sauce')).toBe(1750);
    const out = new Map<string, number>();
    explode(f, [{ ingredientId: 'sauce', qty: 20_000, mode: null }], 2, out);
    // 40 ml of sauce = 32 g of mayo; the garlic isn't counted
    expect(out).toEqual(new Map([['mayo', 32_000]]));
    // a cycle costs nothing and draws nothing, rather than recursing forever
    expect(costPerK(f, 'loop')).toBe(0);
    const none = new Map<string, number>();
    explode(f, [{ ingredientId: 'loop', qty: 1, mode: null }], 1, none);
    expect(none.size).toBe(0);
  });

  test('weighted average cost, and a count at or below zero starts over', () => {
    // 5 kg at R$ 40/kg, then 5 kg bought for R$ 250
    expect(averageCost(5_000_000, 4000, 5_000_000, 25_000)).toBe(4500);
    expect(averageCost(-200_000, 4000, 1_000_000, 6000)).toBe(6000);
    expect(averageCost(null, 4000, 2_000_000, 9000)).toBe(4500);
  });

  test('the shopping list buys up to the ideal level, in whole packs', () => {
    expect(restockOf({ stock: 1000, low: 2000, par: 10_000, sold7d: 0, pack: 4000 })).toEqual({
      buyMilli: 12_000,
      buyPacks: 3,
    });
    expect(restockOf({ stock: -500, low: 1000, par: null, sold7d: 0, pack: null })).toEqual({
      buyMilli: 2000,
      buyPacks: null,
    });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('insumos (db)', () => {
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
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const ownerPhone = `219${String(Date.now() + 41).slice(-8)}`;
  let tenantId = '';
  let idem = 0;
  const ids: Record<string, string> = {};
  const opt: Record<string, string> = {};
  const ing: Record<string, string> = {};
  let owner: (
    method: string,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: any }>;
  const tx = <T>(fn: (tx: postgres.Sql) => Promise<T>) =>
    withTenant(sql as never, tenantId, fn as never) as Promise<T>;

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

  const order = (qty: number, bacon: boolean) =>
    tx(async (t) => {
      const { cartId } = await createCartTx(t, tenantId, 's');
      await addItem(
        t,
        tenantId,
        cartId,
        { productId: ids.burger!, qty, modifiers: bacon ? [{ id: opt.bacon!, qty: 1 }] : [] },
        getProductById,
      );
      return placeOrderTx(
        t,
        tenantId,
        cartId,
        {
          customer: { name: 'Ana Teste', phone: '21999990000' },
          delivery: { mode: 'pickup' },
          payment: { method: 'cash' },
        },
        new Date(),
      );
    });
  const stock = async () =>
    Object.fromEntries(
      (
        await sql<{ name: string; s: string | null }[]>`
          select name, stock_milli::text as s from ingredients where tenant_id = ${tenantId}
        `
      ).map((r) => [r.name, r.s == null ? null : Number(r.s)]),
    );
  const create = async (body: Record<string, unknown>) => {
    const r = await owner('POST', '/insumos', body);
    expect(r.status).toBe(201);
    return r.body.insumo.id as string;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${`ins-${nonce}`}, 'Loja insumos') returning id
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
          values (${tenantId}, ${cat}, ${s}, ${name}, 2500) returning id
        `
      )[0]!.id;
      const g = (
        await sql<{ id: string }[]>`
          insert into modifier_groups (tenant_id, product_id, name, min_select, max_select)
          values (${tenantId}, ${ids[s]!}, 'Adicionais', 0, 5) returning id
        `
      )[0]!.id;
      opt[s === 'burger' ? 'bacon' : 'saladaBacon'] = (
        await sql<{ id: string }[]>`
          insert into modifiers (tenant_id, group_id, name, price_delta_cents, max_qty)
          values (${tenantId}, ${g}, 'Bacon extra', 400, 3) returning id
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

    // costs as the screens send them: what an amount cost
    ing.pao = await create({
      name: 'Pão',
      unit: 'un',
      cost: { cents: 120, milli: 1000 },
      stockMilli: 100_000,
    });
    ing.carne = await create({
      name: 'Carne',
      unit: 'g',
      cost: { cents: 4000, milli: 1_000_000 },
      stockMilli: 5_000_000,
    });
    ing.queijo = await create({
      name: 'Queijo',
      unit: 'g',
      cost: { cents: 5000, milli: 1_000_000 },
    });
    ing.maionese = await create({
      name: 'Maionese',
      unit: 'g',
      cost: { cents: 2000, milli: 1_000_000 },
      stockMilli: 2_000_000,
    });
    ing.alho = await create({ name: 'Alho', unit: 'g', cost: { cents: 300, milli: 100_000 } });
    ing.caixa = await create({
      name: 'Caixa',
      unit: 'un',
      cost: { cents: 80, milli: 1000 },
      stockMilli: 50_000,
    });
    ing.guardanapo = await create({
      name: 'Guardanapo',
      unit: 'un',
      cost: { cents: 500, milli: 100_000 },
      stockMilli: 100_000,
    });
    ing.sacola = await create({
      name: 'Sacola',
      unit: 'un',
      cost: { cents: 30, milli: 1000 },
      stockMilli: 100_000,
    });
    ing.bacon = await create({
      name: 'Bacon',
      unit: 'g',
      cost: { cents: 6000, milli: 1_000_000 },
      stockMilli: 1_000_000,
      lowMilli: 900_000,
    });
    ing.molho = await create({
      kind: 'preparo',
      name: 'Molho da casa',
      unit: 'ml',
      yieldMilli: 1_000_000,
      lines: [
        { ingredientId: ing.maionese, qtyMilli: 800_000 },
        { ingredientId: ing.alho, qtyMilli: 50_000 },
      ],
    });
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
    if (appSql !== sql) await appSql.end();
  });

  test('a ficha costs per mode, its options apart, and feeds the product margin', async () => {
    const put = await owner('PUT', `/products/${ids.burger}/ficha`, {
      lines: [
        { ingredientId: ing.pao, qtyMilli: 1000 },
        { ingredientId: ing.carne, qtyMilli: 150_000 },
        { ingredientId: ing.queijo, qtyMilli: 30_000 },
        { ingredientId: ing.molho, qtyMilli: 20_000 },
        { ingredientId: ing.caixa, qtyMilli: 1000, mode: 'delivery' },
        { ingredientId: ing.guardanapo, qtyMilli: 1000, mode: 'pickup' },
      ],
      options: [
        { id: opt.bacon, lines: [{ ingredientId: ing.bacon, qtyMilli: 30_000 }], sameName: true },
      ],
    });
    expect(put.status).toBe(200);
    // pão 120 + carne 600 + queijo 150 + molho 35 (20 ml at R$ 17,50/L)
    expect(put.body.ficha.cost).toEqual({
      baseCents: 905,
      byMode: { delivery: 985, pickup: 910, dine_in: 905 },
      maxCents: 985,
    });
    expect(put.body.ficha.options[0]).toMatchObject({
      name: 'Bacon extra',
      costCents: 180,
      sameName: 2,
    });
    // sameName: X-Salada's "Bacon extra" got the same ficha
    const salada = await owner('GET', `/products/${ids.salada}/ficha`);
    expect(salada.body.ficha.options[0].lines).toMatchObject([
      { name: 'Bacon', qtyMilli: 30_000, costCents: 180 },
    ]);

    const catalog = await owner('GET', '/catalog');
    const burger = catalog.body.categories[0].products.find((p: any) => p.id === ids.burger);
    expect(burger.fichaCostCents).toBe(985);
    // (2500 − 985) / 2500, no fee or tax stated
    expect(burger.marginBp).toBe(6060);

    const list = await owner('GET', '/insumos');
    const molho = list.body.insumos.find((i: any) => i.id === ing.molho);
    expect(molho).toMatchObject({ kind: 'preparo', costPerKCents: 1750, uses: 1, missingCost: [] });
  });

  test('a sale draws counted insumos through uncounted preparos, costs the order, a cancel gives back', async () => {
    await owner('PUT', '/insumos/por-pedido', {
      lines: [{ ingredientId: ing.sacola, qtyMilli: 1000 }],
    });
    const before = await stock();
    const orderId = await order(2, true);
    const [o] = await sql<{ ingredients_drawn: Record<string, number>; cost_cents: number }[]>`
      select ingredients_drawn, cost_cents from orders where id = ${orderId}
    `;
    expect(o!.ingredients_drawn).toEqual({
      [ing.pao!]: 2000,
      [ing.carne!]: 300_000,
      [ing.maionese!]: 32_000,
      [ing.guardanapo!]: 2000,
      [ing.bacon!]: 60_000,
      [ing.sacola!]: 1000,
    });
    // (910 pickup + 180 bacon) × 2, plus the bag
    const [item] = await sql<
      { cost_cents: number }[]
    >`select cost_cents from order_items where order_id = ${orderId}`;
    expect(item!.cost_cents).toBe(2180);
    expect(o!.cost_cents).toBe(2210);
    const after = await stock();
    expect(after.Carne).toBe(before.Carne! - 300_000);
    expect(after.Caixa).toBe(before.Caixa);
    expect(after.Queijo).toBeNull();

    const moves = await owner('GET', `/insumos/${ing.carne}/movements`);
    expect(moves.body.movements[0]).toMatchObject({
      reason: 'sale',
      deltaMilli: -300_000,
      costCents: -1200,
    });

    await tx((t) => transitionOrder(t, tenantId, orderId, 'cancelled', 'merchant'));
    expect(await stock()).toEqual(before);
    const back = await owner('GET', `/insumos/${ing.carne}/movements`);
    expect(back.body.movements[0]).toMatchObject({
      reason: 'cancel',
      deltaMilli: 300_000,
      costCents: 1200,
    });
  });

  test('a shortfall never stops a sale: the count goes below zero and reads low', async () => {
    expect((await owner('PATCH', `/insumos/${ing.pao}`, { stockMilli: 1000 })).status).toBe(200);
    await order(2, false);
    const list = await owner('GET', '/insumos');
    const pao = list.body.insumos.find((i: any) => i.id === ing.pao);
    expect(pao).toMatchObject({ stockMilli: -1000, low: true, valueCents: null });
    expect(pao.buyMilli).toBeGreaterThan(0);
  });

  test('purchases move the average cost; losses and taps are relative', async () => {
    const buy = await owner('POST', '/insumos/purchases', {
      items: [{ id: ing.carne, qtyMilli: 5_000_000, costCents: 25_000 }],
      note: 'Açougue do Zé',
    });
    expect(buy.status).toBe(200);
    const carne = buy.body.insumos[0];
    // 4,7 kg at R$ 40 + 5 kg for R$ 250 → R$ 45,15/kg
    expect(carne.stockMilli).toBe(9_700_000);
    expect(carne.costPerKCents).toBe(Math.round((4_700_000 * 4000 + 25_000 * 1e6) / 9_700_000));
    const loss = await owner('POST', '/insumos/adjust', {
      changes: [
        { id: ing.carne, addMilli: -200_000, reason: 'loss' },
        { id: ing.queijo, addMilli: 5 },
      ],
    });
    // the cheese isn't counted: left alone
    expect(loss.body.stock).toEqual({ [ing.carne!]: 9_500_000 });
    const moves = (await owner('GET', `/insumos/${ing.carne}/movements`)).body.movements;
    expect(moves.slice(0, 2).map((m: any) => [m.reason, m.deltaMilli, m.note])).toEqual([
      ['loss', -200_000, null],
      ['purchase', 5_000_000, 'Açougue do Zé'],
    ]);
    expect(moves[1].costCents).toBe(25_000);
    const preparo = await owner('POST', '/insumos/purchases', {
      items: [{ id: ing.molho, qtyMilli: 1, costCents: 1 }],
    });
    expect([preparo.status, preparo.body.error.code]).toEqual([422, 'PREPARO_NOT_BOUGHT']);
  });

  test('a counted preparo is made in batches and then sold as itself', async () => {
    expect(
      (await owner('POST', `/insumos/${ing.molho}/made`, { qtyMilli: 500_000 })).body.error.code,
    ).toBe('PREPARO_NOT_COUNTED');
    await owner('PATCH', `/insumos/${ing.molho}`, { stockMilli: 0 });
    const before = await stock();
    const made = await owner('POST', `/insumos/${ing.molho}/made`, { qtyMilli: 500_000 });
    expect(made.status).toBe(200);
    const after = await stock();
    expect(after['Molho da casa']).toBe(500_000);
    expect(after.Maionese).toBe(before.Maionese! - 400_000);
    const orderId = await order(1, false);
    const [o] = await sql<{ ingredients_drawn: Record<string, number> }[]>`
      select ingredients_drawn from orders where id = ${orderId}
    `;
    expect(o!.ingredients_drawn[ing.molho!]).toBe(20_000);
    expect(o!.ingredients_drawn[ing.maionese!]).toBeUndefined();
  });

  test('fichas refuse cycles, unknown insumos and bad ids with stable 4xx', async () => {
    const outer = await create({
      kind: 'preparo',
      name: 'Base',
      unit: 'g',
      yieldMilli: 1000,
      lines: [{ ingredientId: ing.molho, qtyMilli: 100 }],
    });
    const cycle = await owner('PUT', `/insumos/${ing.molho}/ficha`, {
      lines: [{ ingredientId: outer, qtyMilli: 10 }],
    });
    expect([cycle.status, cycle.body.error.code]).toEqual([422, 'FICHA_CYCLE']);
    const self = await owner('PUT', `/insumos/${ing.molho}/ficha`, {
      lines: [{ ingredientId: ing.molho, qtyMilli: 10 }],
    });
    expect(self.body.error.code).toBe('FICHA_CYCLE');
    const ghost = await owner('PUT', `/products/${ids.burger}/ficha`, {
      lines: [{ ingredientId: crypto.randomUUID(), qtyMilli: 10 }],
    });
    expect([ghost.status, ghost.body.error.code]).toEqual([422, 'INGREDIENT_NOT_FOUND']);
    expect((await owner('GET', '/insumos/nope/movements')).status).toBeLessThan(500);
    expect((await owner('PATCH', `/insumos/${crypto.randomUUID()}`, { name: 'x' })).status).toBe(
      404,
    );
    const twin = await owner('POST', '/insumos', { name: ' pão ', unit: 'un' });
    expect([twin.status, twin.body.error.code]).toEqual([409, 'INGREDIENT_EXISTS']);
    const unit = await owner('PATCH', `/insumos/${ing.carne}`, { unit: 'un' });
    expect(unit.body.error.code).toBe('INGREDIENT_IN_USE');
    const other = await owner('PUT', `/products/${ids.burger}/ficha`, {
      options: [{ id: opt.saladaBacon, lines: [] }],
    });
    expect(other.body.error.code).toBe('OPTION_NOT_FOUND');
  });

  test('the CMV report reads the snapshots, purchases and losses', async () => {
    const r = await owner('GET', '/reports/cmv?period=hoje');
    expect(r.status).toBe(200);
    // the cancelled order is out; the two kept ones cost what their snapshots say
    const [kept] = await sql<{ items: number; orders: number }[]>`
      select coalesce(sum(i.cost_cents), 0)::int as items, count(distinct o.id)::int as orders
      from orders o join order_items i on i.order_id = o.id
      where o.tenant_id = ${tenantId} and o.state <> 'cancelled'
    `;
    expect(r.body.current).toMatchObject({
      itemsCostCents: kept!.items,
      orders: kept!.orders,
      coverageBp: 10_000,
    });
    expect(r.body.current.packagingCents).toBe(60);
    const c = r.body.current;
    expect(c.costCents).toBe(c.itemsCostCents + 60);
    expect(c.grossCents).toBe(c.costedSalesCents - c.costCents);
    expect(r.body.purchasesCents).toBe(25_000);
    const [loss] = await sql<{ c: number }[]>`
      select -cost_cents as c from ingredient_movements where tenant_id = ${tenantId} and reason = 'loss'
    `;
    expect(r.body.lossesCents).toBe(loss!.c);
    // 200 g at the new average, about R$ 45,15/kg
    expect(loss!.c).toBe(903);
    expect(r.body.products[0]).toMatchObject({ name: 'X-Burger', qty: 3 });
    expect(r.body.products[0].marginBp).toBeGreaterThan(0);
  });

  test('an absurd ficha cost still sells: the snapshot clamps to the int columns', async () => {
    const [was] = await sql<{ cpk: number }[]>`
      select cost_per_k_cents as cpk from ingredients where id = ${ing.carne!}`;
    await sql`update ingredients set cost_per_k_cents = 1000000000 where id = ${ing.carne!}`;
    await sql`update recipe_lines set qty_milli = 1000000000
              where product_id = ${ids.burger!} and ingredient_id = ${ing.carne!}`;
    try {
      const orderId = await order(3, false);
      const [row] = await sql<{ cost: number }[]>`
        select cost_cents as cost from orders where id = ${orderId}`;
      expect(row!.cost).toBe(2_000_000_000);
    } finally {
      await sql`update ingredients set cost_per_k_cents = ${was!.cpk} where id = ${ing.carne!}`;
    }
  });

  test('deleting an insumo takes its ficha lines with it', async () => {
    const uses = await owner('GET', `/insumos/${ing.guardanapo}/uses`);
    expect(uses.body.products).toEqual([{ id: ids.burger, name: 'X-Burger', option: null }]);
    expect((await owner('DELETE', `/insumos/${ing.guardanapo}`)).status).toBe(200);
    const ficha = await owner('GET', `/products/${ids.burger}/ficha`);
    expect(ficha.body.ficha.lines.map((l: any) => l.name)).not.toContain('Guardanapo');
  });
});
