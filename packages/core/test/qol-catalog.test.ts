import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { searchCatalog } from '../src/modules/catalog-search.ts';
import { deriveStatus, specialDayOn, upcomingSpecialDays } from '../src/modules/store.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

const TZ = 'America/Sao_Paulo';
const at = (iso: string) => new Date(iso);
const daily9to18 = {
  timezone: TZ,
  windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '18:00' }],
};

describe('special days: ranges and yearly repeats (unit)', () => {
  const xmas = { date: '2026-12-24', until: '2026-12-26', closed: true, label: 'Natal' };

  test('a range closes every day it covers and reopens the day after', () => {
    // 2026-12-25 15:00 in São Paulo (18:00Z): inside the range
    const mid = deriveStatus(daily9to18, null, null, at('2026-12-25T18:00:00Z'), [xmas]);
    expect(mid.status).toBe('closed');
    // reopens on the 27th at 09:00 local (12:00Z)
    expect(mid.resumesAt).toBe('2026-12-27T12:00:00.000Z');
    expect(deriveStatus(daily9to18, null, null, at('2026-12-23T18:00:00Z'), [xmas]).status).toBe(
      'open',
    );
    expect(deriveStatus(daily9to18, null, null, at('2026-12-27T18:00:00Z'), [xmas]).status).toBe(
      'open',
    );
  });

  test('a yearly day repeats every year from its first, a range across new year wraps', () => {
    const natal = { date: '2025-12-25', closed: true, yearly: true, label: 'Natal' };
    const ferias = { date: '2026-12-30', until: '2027-01-03', closed: true, yearly: true };
    expect(specialDayOn([natal], '2031-12-25')).toBe(natal);
    expect(specialDayOn([natal], '2024-12-25')).toBeUndefined();
    expect(specialDayOn([ferias], '2028-01-02')).toBe(ferias);
    expect(specialDayOn([ferias], '2028-12-31')).toBe(ferias);
    expect(specialDayOn([ferias], '2028-01-04')).toBeUndefined();
    expect(specialDayOn([ferias], '2026-01-02')).toBeUndefined();
    expect(deriveStatus(daily9to18, null, null, at('2030-12-25T15:00:00Z'), [natal]).status).toBe(
      'closed',
    );
  });

  test('a one-off day wins over a range, a range over a yearly day', () => {
    const today = { date: '2026-12-25', closed: false, open: '10:00', close: '12:00' };
    const yearly = {
      date: '2020-12-25',
      closed: false,
      open: '08:00',
      close: '09:00',
      yearly: true,
    };
    expect(specialDayOn([yearly, xmas, today], '2026-12-25')).toBe(today);
    expect(specialDayOn([yearly, xmas], '2026-12-25')).toBe(xmas);
    // 11:00 local: open on the one-off's hours inside a closed range
    expect(
      deriveStatus(daily9to18, null, null, at('2026-12-25T14:00:00Z'), [xmas, today]).status,
    ).toBe('open');
  });

  test('a month away reopens: the look-ahead reaches past the longest range', () => {
    const vacation = { date: '2027-01-01', until: '2027-01-31', closed: true };
    const s = deriveStatus(daily9to18, null, null, at('2027-01-02T15:00:00Z'), [vacation]);
    expect(s.status).toBe('closed');
    expect(s.resumesAt).toBe('2027-02-01T12:00:00.000Z');
  });

  test('the storefront gets the single dates they cover, malformed rows skipped', () => {
    const now = at('2026-12-23T15:00:00Z');
    const anoNovo = { date: '2019-01-01', closed: true, yearly: true, label: 'Ano-Novo' };
    const bad = { date: '2026-12-28', until: 'sempre', closed: true };
    expect(upcomingSpecialDays([xmas, anoNovo, bad] as never, TZ, now)).toEqual([
      { date: '2026-12-24', closed: true, label: 'Natal' },
      { date: '2026-12-25', closed: true, label: 'Natal' },
      { date: '2026-12-26', closed: true, label: 'Natal' },
      // a bad `until` reads as that one day, never as "forever"
      { date: '2026-12-28', closed: true },
      // this year's turn of the yearly day
      { date: '2027-01-01', closed: true, label: 'Ano-Novo' },
    ]);
    expect(upcomingSpecialDays([xmas], TZ, now, 2)).toHaveLength(2);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('catalog quality of life (db)', () => {
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
  const slug = `qc-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `2193${String(Date.now()).slice(-7)}`;
  let tenantId = '';
  let catId = '';
  let cat2 = '';
  const ids: Record<string, string> = {};
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
    return { status: res.status, body: (await res.json()) as any };
  };
  let cookie = '';
  const owner = (method: string, path: string, body?: unknown) =>
    call(method, `/admin/v1${path}`, body, { cookie });
  const product = async (id: string) =>
    (
      await sql<
        {
          base_price_cents: number;
          compare_at_price_cents: number | null;
          promo_schedule: { priceCents: number } | null;
          status: string;
          sold_out_until: Date | null;
          category_id: string;
          deleted_at: Date | null;
        }[]
      >`select base_price_cents, compare_at_price_cents, promo_schedule, status, sold_out_until, category_id, deleted_at
        from products where id = ${id}`
    )[0]!;
  const publicCatalog = async () =>
    (await call('GET', '/storefront/v1/catalog', undefined, { host })).body.categories.flatMap(
      (c: { products: { id: string }[] }) => c.products.map((p) => p.id),
    );

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${tenantId}, ${sql.json({ timezone: TZ, windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})})
    `;
    [catId, cat2] = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name, sort)
        values (${tenantId}, 'doces', 'Doces', 0), (${tenantId}, 'bebidas', 'Bebidas', 1) returning id
      `
    ).map((r) => r.id) as [string, string];
    const mk = async (s: string, name: string, cents: number, extra: object = {}) => {
      const e = extra as { compare?: number; promo?: number };
      ids[s] = (
        await sql<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, base_price_cents, compare_at_price_cents, promo_schedule)
          values (${tenantId}, ${catId}, ${s}, ${name}, ${cents}, ${e.compare ?? null},
                  ${e.promo ? sql.json({ priceCents: e.promo, windows: [{ days: [1, 2, 3] }] }) : null})
          returning id
        `
      )[0]!.id;
    };
    await mk('pudim', 'Pudim de leite', 1250, { compare: 1500, promo: 1000 });
    await mk('brigadeiro', 'Brigadeiro', 400);
    await mk('bala', 'Bala de coco', 150);
    await mk('torta', 'Torta de limão', 3000);
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Ana Prado', ${ownerPhone}, 'owner')`;
    await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const r = await app.request('http://core.localhost/admin/v1/auth/otp/verify', {
      method: 'POST',
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-v`,
        'x-vendua-admin': '1',
      },
      body: JSON.stringify({ phone: ownerPhone, code: codes.get(ownerPhone) }),
    });
    cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')![1]!}`;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('bulk price by a fixed amount: exact cents, "de" and promo move, ≤ 0 refused, undo', async () => {
    const two = [ids.pudim!, ids.brigadeiro!];
    const up = await owner('POST', '/products/bulk', {
      ids: two,
      action: 'price_amount',
      amountCents: 250,
    });
    expect(up.status).toBe(200);
    expect(up.body.updated).toBe(2);
    const pudim = await product(ids.pudim!);
    expect(pudim.base_price_cents).toBe(1500);
    expect(pudim.compare_at_price_cents).toBe(1750);
    expect(pudim.promo_schedule!.priceCents).toBe(1250);
    expect((await product(ids.brigadeiro!)).base_price_cents).toBe(650);

    // a bala at 1,50 can't lose 2,00: nothing changes, and the answer names it
    const down = await owner('POST', '/products/bulk', {
      ids: [ids.bala!, ids.torta!],
      action: 'price_amount',
      amountCents: -200,
    });
    expect(down.status).toBe(422);
    expect(down.body.error.code).toBe('PRICE_NOT_POSITIVE');
    expect(down.body.error.details.products).toEqual([{ id: ids.bala, name: 'Bala de coco' }]);
    expect((await product(ids.torta!)).base_price_cents).toBe(3000);
    // landing exactly on zero is refused too; 0 and non-integers are bad requests
    const zero = await owner('POST', '/products/bulk', {
      ids: [ids.bala!],
      action: 'price_amount',
      amountCents: -150,
    });
    expect(zero.body.error.code).toBe('PRICE_NOT_POSITIVE');
    for (const amountCents of [0, 1.5, '200'])
      expect(
        (await owner('POST', '/products/bulk', { ids: two, action: 'price_amount', amountCents }))
          .status,
      ).toBe(422);

    // "desfazer": Core's own before, sent back
    const undo = await owner('POST', '/products/bulk', { action: 'revert', items: up.body.before });
    expect(undo.status).toBe(200);
    const back = await product(ids.pudim!);
    expect([
      back.base_price_cents,
      back.compare_at_price_cents,
      back.promo_schedule!.priceCents,
    ]).toEqual([1250, 1500, 1000]);
    expect((await product(ids.brigadeiro!)).base_price_cents).toBe(400);

    // a revert is checked like any write
    const forged = await owner('POST', '/products/bulk', {
      action: 'revert',
      items: [{ id: ids.pudim, priceCents: 900, compareAtPriceCents: 800 }],
    });
    expect(forged.status).toBe(422);
    expect((await product(ids.pudim!)).base_price_cents).toBe(1250);

    // a percentage rounds to 10 cents and comes back exactly
    const pct = await owner('POST', '/products/bulk', {
      ids: [ids.bala!],
      action: 'price_percent',
      percent: -90,
    });
    expect(pct.status).toBe(200);
    expect((await product(ids.bala!)).base_price_cents).toBe(20);
    await owner('POST', '/products/bulk', { action: 'revert', items: pct.body.before });
    expect((await product(ids.bala!)).base_price_cents).toBe(150);
  });

  test('bulk availability, category and schedule come back with revert', async () => {
    const moved = await owner('POST', '/products/bulk', {
      ids: [ids.brigadeiro!],
      action: 'category',
      categoryId: cat2,
    });
    expect((await product(ids.brigadeiro!)).category_id).toBe(cat2);
    await owner('POST', '/products/bulk', { action: 'revert', items: moved.body.before });
    expect((await product(ids.brigadeiro!)).category_id).toBe(catId);

    const today = await owner('POST', '/products/bulk', {
      ids: [ids.brigadeiro!],
      action: 'sold_out_today',
    });
    const out = await product(ids.brigadeiro!);
    expect(out.status).toBe('sold_out');
    expect(out.sold_out_until).not.toBeNull();
    const hide = await owner('POST', '/products/bulk', {
      ids: [ids.brigadeiro!, ids.torta!],
      action: 'hidden',
    });
    expect((await product(ids.torta!)).status).toBe('archived');
    // undoing the hide puts each back where it was: one esgotado hoje, one disponível
    await owner('POST', '/products/bulk', { action: 'revert', items: hide.body.before });
    const b = await product(ids.brigadeiro!);
    expect(b.status).toBe('sold_out');
    expect(b.sold_out_until?.getTime()).toBe(out.sold_out_until!.getTime());
    expect((await product(ids.torta!)).status).toBe('active');
    await owner('POST', '/products/bulk', { action: 'revert', items: today.body.before });
    expect((await product(ids.brigadeiro!)).status).toBe('active');

    const sched = await owner('POST', '/products/bulk', {
      ids: [ids.torta!],
      action: 'schedule',
      availabilitySchedule: { windows: [{ days: [6], from: '09:00', to: '13:00' }] },
    });
    expect(sched.status).toBe(200);
    const stock = await owner('POST', '/products/bulk', {
      ids: [ids.torta!],
      action: 'stock',
      stockQuantity: 12,
    });
    expect(stock.body.before).toEqual([{ id: ids.torta, stockQuantity: null }]);
    await owner('POST', '/products/bulk', { action: 'revert', items: sched.body.before });
    await owner('POST', '/products/bulk', { action: 'revert', items: stock.body.before });
    const t = (
      await sql`select availability_schedule, stock_quantity from products where id = ${ids.torta!}`
    )[0]!;
    expect(t.availability_schedule).toBeNull();
    expect(t.stock_quantity).toBeNull();
  });

  test('apagar a product: gone from every list, its orders intact, desfazer restores it', async () => {
    // an order with the pudim, placed before it goes
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    expect(
      (await call('POST', '/checkout/v1/cart/items', { productId: ids.pudim, qty: 2 }, auth))
        .status,
    ).toBe(200);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Rita Alves', phone: '(22) 97777-6666' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(placed.status).toBe(201);
    // and a cart still holding it
    const s2 = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth2 = { host, authorization: `Bearer ${s2.body.sessionToken}` };
    await call('POST', '/checkout/v1/cart/items', { productId: ids.pudim, qty: 1 }, auth2);

    expect(await publicCatalog()).toContain(ids.pudim);
    const del = await owner('DELETE', `/products/${ids.pudim}`);
    expect(del.status).toBe(200);
    expect((await owner('DELETE', `/products/${ids.pudim}`)).status).toBe(404);
    expect((await owner('DELETE', '/products/nao-e-id')).status).toBe(400);

    const gone = await product(ids.pudim!);
    expect(gone.status).toBe('archived');
    expect(gone.deleted_at).not.toBeNull();
    expect(await publicCatalog()).not.toContain(ids.pudim);
    expect((await call('GET', '/storefront/v1/products/pudim', undefined, { host })).status).toBe(
      404,
    );
    const hits = await withTenant(sql, tenantId, (tx) => searchCatalog(tx, tenantId, 'pudim'));
    expect(hits).toHaveLength(0);
    const admin = (await owner('GET', '/catalog')).body.categories.flatMap(
      (c: { products: { id: string }[] }) => c.products.map((p) => p.id),
    );
    expect(admin).not.toContain(ids.pudim);
    expect((await owner('GET', `/products/${ids.pudim}`)).status).toBe(404);
    expect((await owner('PATCH', `/products/${ids.pudim}`, { name: 'Outro' })).status).toBe(404);
    // the bulk bar skips it, and nothing makes it public again behind the admin's back
    expect(
      (await owner('POST', '/products/bulk', { ids: [ids.pudim!], action: 'available' })).body
        .updated,
    ).toBe(0);
    await sql`update products set status = 'active' where id = ${ids.pudim!}`;
    expect((await product(ids.pudim!)).status).toBe('archived');
    // the cart line can't be checked out
    const cart = await call('GET', '/checkout/v1/cart', undefined, auth2);
    expect(JSON.stringify(cart.body)).not.toContain('"status":"active"');

    // the order keeps its line, linked to the product
    const order = await owner('GET', `/orders/${placed.body.order.id}`);
    expect(order.status).toBe(200);
    expect(JSON.stringify(order.body.order)).toContain('Pudim de leite');
    const lines =
      await sql`select product_id, name, qty from order_items where order_id = ${placed.body.order.id}`;
    expect([...lines]).toEqual([{ product_id: ids.pudim, name: 'Pudim de leite', qty: 2 }]);

    const back = await owner('POST', `/products/${ids.pudim}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.product.status).toBe('active');
    expect(await publicCatalog()).toContain(ids.pudim);
    expect((await owner('POST', `/products/${crypto.randomUUID()}/restore`)).status).toBe(404);

    // in bulk too, and a hidden product comes back hidden
    await owner('PATCH', `/products/${ids.bala}`, { availability: 'hidden' });
    const bulkDel = await owner('POST', '/products/bulk', {
      ids: [ids.bala!, ids.brigadeiro!],
      action: 'delete',
    });
    expect(bulkDel.body.updated).toBe(2);
    expect(await publicCatalog()).not.toContain(ids.brigadeiro);
    await owner('POST', '/products/bulk', { ids: [ids.bala!, ids.brigadeiro!], action: 'restore' });
    expect((await product(ids.bala!)).status).toBe('archived');
    expect((await product(ids.brigadeiro!)).status).toBe('active');
  });

  test('a category with apagados in a cart deletes cleanly', async () => {
    const tmp = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'sazonais', 'Sazonais') returning id
      `
    )[0]!.id;
    const p = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${tmp}, 'panetone', 'Panetone', 4500) returning id
      `
    )[0]!.id;
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: p, qty: 1 },
      { host, authorization: `Bearer ${s.body.sessionToken}` },
    );
    expect((await owner('DELETE', `/categories/${tmp}`)).body.error.code).toBe(
      'CATEGORY_NOT_EMPTY',
    );
    await owner('DELETE', `/products/${p}`);
    expect((await owner('DELETE', `/categories/${tmp}`)).status).toBe(200);
  });

  test('copying option groups to another product makes independent copies', async () => {
    const groups = [
      {
        name: 'Calda',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { name: 'Caramelo', priceDeltaCents: 0, status: 'active' },
          { name: 'Chocolate', priceDeltaCents: 200, status: 'active', description: 'meio amargo' },
        ],
      },
      {
        name: 'Embalagem',
        minSelect: 0,
        maxSelect: 1,
        options: [{ name: 'Presente', priceDeltaCents: 300 }],
      },
    ];
    const src = await owner('PUT', `/products/${ids.torta}/options`, { groups });
    expect(src.status).toBe(200);
    const copied = src.body.product.groups;
    // the picker sends the source's groups as they are, ids and all, reordered
    const dst = await owner('PUT', `/products/${ids.brigadeiro}/options`, {
      groups: [copied[1], copied[0]],
    });
    expect(dst.status).toBe(200);
    const mine = dst.body.product.groups;
    expect(mine.map((g: { name: string }) => g.name)).toEqual(['Embalagem', 'Calda']);
    expect(mine[1].options[1]).toMatchObject({
      name: 'Chocolate',
      priceDeltaCents: 200,
      description: 'meio amargo',
    });
    const srcIds = new Set(
      copied.flatMap((g: { id: string; options: { id: string }[] }) => [
        g.id,
        ...g.options.map((o) => o.id),
      ]),
    );
    for (const g of mine) {
      expect(srcIds.has(g.id)).toBe(false);
      for (const o of g.options) expect(srcIds.has(o.id)).toBe(false);
    }
    // editing the copy leaves the source alone
    mine[1].options[0].name = 'Doce de leite';
    await owner('PUT', `/products/${ids.brigadeiro}/options`, { groups: mine });
    const again = (await owner('GET', `/products/${ids.torta}`)).body.product.groups;
    expect(again[0].options[0].name).toBe('Caramelo');
    expect(again.map((g: { id: string }) => g.id)).toEqual(copied.map((g: { id: string }) => g.id));
  });

  test('coupons: edit, clone, apagar with desfazer', async () => {
    const made = await owner('POST', '/coupons', {
      code: 'PUDIM10',
      kind: 'percent',
      value: 10,
      minSubtotalCents: 3000,
      perPhoneLimit: 1,
      firstOrderOnly: true,
    });
    expect(made.status).toBe(201);
    const id = made.body.coupons.find((c: { code: string }) => c.code === 'PUDIM10').id;

    const ends = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const edit = await owner('PATCH', `/coupons/${id}`, {
      label: '10% no pudim',
      endsAt: ends,
      maxRedemptions: 50,
    });
    expect(edit.status).toBe(200);
    const c = edit.body.coupons.find((x: { id: string }) => x.id === id);
    expect(c).toMatchObject({
      label: '10% no pudim',
      maxRedemptions: 50,
      displayLabel: '10% no pudim',
    });
    expect(new Date(c.endsAt).toISOString()).toBe(ends);
    expect((await owner('PATCH', `/coupons/${id}`, { maxRedemptions: 0 })).status).toBe(422);

    const clone = await owner('POST', `/coupons/${id}/clone`, { code: 'pudim 20' });
    expect(clone.status).toBe(201);
    expect(clone.body.coupon.code).toBe('PUDIM20');
    expect(clone.body.coupons.find((x: { code: string }) => x.code === 'PUDIM20')).toMatchObject({
      kind: 'percent',
      value: 10,
      label: '10% no pudim',
      minSubtotalCents: 3000,
      perPhoneLimit: 1,
      firstOrderOnly: true,
      maxRedemptions: 50,
      redemptions: 0,
    });
    expect((await owner('POST', `/coupons/${id}/clone`, { code: 'PUDIM20' })).body.error.code).toBe(
      'COUPON_EXISTS',
    );
    expect(
      (await owner('POST', `/coupons/${crypto.randomUUID()}/clone`, { code: 'X123' })).status,
    ).toBe(404);

    // apagar: off the list and off carts; the code stays taken; desfazer brings it back as it was
    await owner('PATCH', `/coupons/${id}`, { active: false });
    const del = await owner('DELETE', `/coupons/${id}`);
    expect(del.status).toBe(200);
    expect(del.body.coupons.some((x: { id: string }) => x.id === id)).toBe(false);
    expect((await owner('DELETE', `/coupons/${id}`)).status).toBe(404);
    expect((await owner('PATCH', `/coupons/${id}`, { active: true })).status).toBe(404);
    expect(
      (await owner('POST', '/coupons', { code: 'PUDIM10', kind: 'percent', value: 5 })).body.error
        .code,
    ).toBe('COUPON_ARCHIVED');
    const back = await owner('PATCH', `/coupons/${id}`, { archived: false, active: false });
    expect(back.status).toBe(200);
    expect(back.body.coupons.find((x: { id: string }) => x.id === id)).toMatchObject({
      code: 'PUDIM10',
      active: false,
      label: '10% no pudim',
    });
  });

  test('special days: a range and a yearly repeat close the store on the storefront', async () => {
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: TZ });
    const yearAgo = `${Number(day(0).slice(0, 4)) - 1}${day(0).slice(4)}`;
    const fix = /-02-29$/.test(day(0));
    const range = await owner('PATCH', '/store', {
      specialDays: [{ date: day(-1), until: day(2), closed: true, label: 'Férias' }],
    });
    expect(range.status).toBe(200);
    expect(range.body.specialDays[0]).toMatchObject({ until: day(2) });
    expect(range.body.specialDaysAhead.map((d: { date: string }) => d.date)).toEqual([
      day(0),
      day(1),
      day(2),
    ]);
    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.status).toBe('closed');
    expect(new Date(store.body.resumesAt).getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    expect(store.body.hours.specialDays[0]).toEqual({
      date: day(0),
      closed: true,
      label: 'Férias',
    });

    if (!fix) {
      const yearly = await owner('PATCH', '/store', {
        specialDays: [{ date: yearAgo, closed: true, yearly: true, label: 'Aniversário' }],
      });
      expect(yearly.status).toBe(200);
      expect((await call('GET', '/storefront/v1/store', undefined, { host })).body.status).toBe(
        'closed',
      );
    }

    for (const bad of [
      { date: day(0), until: day(-1), closed: true },
      { date: day(0), until: day(70), closed: true },
      { date: '2026-02-31', closed: true },
      { date: day(0), closed: true, yearly: 'sim' },
    ])
      expect((await owner('PATCH', '/store', { specialDays: [bad] })).status).toBe(422);
    // a one-off "hoje" may sit on a range's first day
    const both = await owner('PATCH', '/store', {
      specialDays: [
        { date: day(0), until: day(3), closed: true },
        { date: day(0), closed: false, open: '00:00', close: '23:59', label: 'Hoje' },
      ],
    });
    expect(both.status).toBe(200);
    await owner('PATCH', '/store', { specialDays: [] });
    expect((await call('GET', '/storefront/v1/store', undefined, { host })).body.status).toBe(
      'open',
    );
  });

  test('dietary tags that contradict each other are refused', async () => {
    const r = await owner('PATCH', `/products/${ids.torta}`, {
      dietary: ['sem_gluten', 'contem_gluten'],
    });
    expect(r.status).toBe(422);
    const ok = await owner('PATCH', `/products/${ids.torta}`, {
      dietary: ['vegetariano', 'sem_gluten'],
    });
    expect(ok.body.product.dietary).toEqual(['sem_gluten', 'vegetariano']);
  });
});
