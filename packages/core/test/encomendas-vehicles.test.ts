import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { HttpError } from '../src/platform/http.ts';
import { migrate } from '../src/platform/db.ts';
import { bookableDates, parseBlockedDates, scheduleView } from '../src/modules/preorder.ts';
import { parseVehicleFees, vehicleFeeCents, vehicleFor } from '../src/modules/vehicles.ts';

const HOURS = {
  timezone: 'America/Sao_Paulo',
  windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }],
};

describe('0158 units', () => {
  test('blocked dates leave the calendar; the admin list drops days gone by', () => {
    const now = new Date('2026-11-28T15:00:00Z');
    const all = bookableDates(HOURS, 1, 5, now);
    expect(all[0]).toBe('2026-11-29');
    const less = bookableDates(HOURS, 1, 5, now, [], ['2026-11-30', '2026-12-02']);
    expect(less).toEqual(all.filter((d) => d !== '2026-11-30' && d !== '2026-12-02'));
    expect(
      parseBlockedDates(['2026-12-02', '2026-11-27', '2026-12-02', '2026-11-30'], '2026-11-28'),
    ).toEqual(['2026-11-30', '2026-12-02']);
    expect(() => parseBlockedDates(['2026-02-30'], '2026-01-01')).toThrow(HttpError);
    expect(() => parseBlockedDates('2026-12-01', '2026-01-01')).toThrow(HttpError);
  });

  test("a line sold past its stock doesn't force a date, but bounds the dates by its lead", () => {
    const now = new Date('2026-11-28T15:00:00Z');
    const v = scheduleView(
      [{ requiresPreorder: false, preorderLeadDays: 2, preorderWhenSoldOut: true }],
      { hours: HOURS },
      now,
    );
    expect(v.required).toBe(false);
    expect(v.leadDays).toBe(2);
    expect(v.dates[0]).toBe('2026-11-30');
  });

  test('the cart takes the biggest vehicle; only set extras count', () => {
    expect(vehicleFor([null, 'moto', undefined])).toBe('moto');
    expect(vehicleFor(['moto', 'car', null])).toBe('car');
    expect(vehicleFor([null])).toBeNull();
    expect(vehicleFeeCents({ car: 1500 }, 'moto')).toBe(0);
    expect(vehicleFeeCents({ car: 1500 }, 'car')).toBe(1500);
    expect(parseVehicleFees({ moto: 300, car: null })).toEqual({ moto: 300 });
    expect(() => parseVehicleFees({ bike: 100 })).toThrow(HttpError);
    expect(() => parseVehicleFees({ car: -1 })).toThrow(HttpError);
    expect(() => parseVehicleFees({ car: 1.5 })).toThrow(HttpError);
  });
});

// End to end over HTTP against a real Postgres: encomenda past stock, blocked dates, vehicles.
describe.skipIf(!process.env.TEST_DATABASE_URL)('encomendas and vehicles (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl' });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `ev-${nonce}`;
  const host = `${slug}.localhost`;
  let tenantId = '';
  const ids: Record<string, string> = {};
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
  const session = async () => {
    const r = await call('POST', '/checkout/v1/session');
    expect(r.status).toBe(201);
    return { authorization: `Bearer ${r.body.sessionToken}` };
  };
  const stock = async (id: string) =>
    (
      await sql<{ n: number | null }[]>`select stock_quantity as n from products where id = ${id}`
    )[0]!.n;
  const customer = { name: 'Ana', phone: '(22) 99999-0001' };
  const pickup = { mode: 'pickup' };
  const delivery = { mode: 'delivery', neighborhood: 'Centro', address: 'Rua A, 10' };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary,
                                  preorder_payment_methods, vehicle_fees)
      values (${tenantId}, ${sql.json(HOURS)}, 25, 0, 'BRL', ${sql.json({})},
              ${sql.json(['pix', 'cash'])}, ${sql.json({ moto: 300, car: 1500 })})
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes,
                                  eta_max_minutes, free_delivery_over_cents)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 500, 0, 30, 50, 20000)
    `;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    const prod = async (s: string, price: number, extra: Record<string, unknown> = {}) =>
      (ids[s] = (
        await sql<{ id: string }[]>`
          insert into products ${sql({ tenant_id: tenantId, category_id: cat, slug: s, name: s, base_price_cents: price, ...extra } as never)}
          returning id`
      )[0]!.id);
    await prod('pote', 1000, {
      stock_quantity: 2,
      preorder_when_sold_out: true,
      preorder_lead_days: 1,
    });
    await prod('torta', 3000, { delivery_vehicle: 'moto' });
    await prod('andares', 25000, { delivery_vehicle: 'car' });
    await prod('cafe', 500);
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('an item sold past its stock: from stock without a date, an encomenda past it', async () => {
    const shown = (await call('GET', '/storefront/v1/products/pote')).body.product;
    // the stock is no cap for the shopper: past it, the line turns into an encomenda
    expect(shown).toMatchObject({
      status: 'active',
      stockQuantity: null,
      lowStock: false,
      requiresPreorder: false,
      preorderWhenSoldOut: true,
    });

    const auth = await session();
    const add = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: ids.pote, qty: 2 },
      auth,
    );
    expect(add.status).toBe(200);
    const fits = (await call('GET', '/checkout/v1/cart', undefined, auth)).body.cart;
    expect(fits.items[0]).toMatchObject({ requiresPreorder: false, stockQuantity: null });
    expect(fits.schedule).toMatchObject({ required: false, leadDays: 1 });

    // one more than the stock: allowed, and now it needs a date
    const line = fits.items[0].id;
    const more = await call('PATCH', `/checkout/v1/cart/items/${line}`, { qty: 3 }, auth);
    expect(more.status).toBe(200);
    expect(more.body.cart.items[0].requiresPreorder).toBe(true);
    expect(more.body.cart.schedule.required).toBe(true);
    const input = { customer, delivery: pickup, payment: { method: 'pix' } };
    const noDate = await call('POST', '/checkout/v1/checkout', input, auth);
    expect(noDate.body.error.code).toBe('SCHEDULE_REQUIRED');
    const date = more.body.cart.schedule.dates[0];
    const dated = await call(
      'POST',
      '/checkout/v1/checkout',
      { ...input, scheduledFor: date },
      auth,
    );
    expect(dated.status).toBe(201);
    // made for the date: the 2 ready ones stay for whoever orders now
    expect(await stock(ids.pote)).toBe(2);

    // without a date and within the stock: pronta entrega, drawn
    const now = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.pote, qty: 2 }, now);
    const ready = await call('POST', '/checkout/v1/checkout', input, now);
    expect(ready.status).toBe(201);
    expect(ready.body.order.scheduledFor).toBeNull();
    expect(await stock(ids.pote)).toBe(0);

    // out of stock it reads as an encomenda, never sold out
    const out = (await call('GET', '/storefront/v1/products/pote')).body.product;
    expect(out).toMatchObject({ status: 'active', requiresPreorder: true });
    expect(out.preorderEarliestDate).toBe(date);
    const later = await session();
    expect(
      (await call('POST', '/checkout/v1/cart/items', { productId: ids.pote, qty: 1 }, later))
        .status,
    ).toBe(200);
    const c = (await call('GET', '/checkout/v1/cart', undefined, later)).body.cart;
    expect(c.items[0].requiresPreorder).toBe(true);
  });

  test('closed, the store takes an item sold past its stock as an encomenda', async () => {
    await sql`update products set stock_quantity = 5 where id = ${ids.pote}`;
    await sql`update store_settings set status_override = 'closed', preorders_while_closed = true
              where tenant_id = ${tenantId}`;
    try {
      const auth = await session();
      await call('POST', '/checkout/v1/cart/items', { productId: ids.pote, qty: 1 }, auth);
      const cart = (await call('GET', '/checkout/v1/cart', undefined, auth)).body.cart;
      expect(cart.items[0].requiresPreorder).toBe(true);
      const placed = await call(
        'POST',
        '/checkout/v1/checkout',
        {
          customer,
          delivery: pickup,
          payment: { method: 'pix' },
          scheduledFor: cart.schedule.dates[0],
        },
        auth,
      );
      expect(placed.status).toBe(201);
      expect(await stock(ids.pote)).toBe(5);

      // a plain item can't ride along: the store is closed for it
      const mixed = await session();
      await call('POST', '/checkout/v1/cart/items', { productId: ids.pote, qty: 1 }, mixed);
      await call('POST', '/checkout/v1/cart/items', { productId: ids.cafe, qty: 1 }, mixed);
      const m = (await call('GET', '/checkout/v1/cart', undefined, mixed)).body.cart;
      const refused = await call(
        'POST',
        '/checkout/v1/checkout',
        {
          customer,
          delivery: pickup,
          payment: { method: 'pix' },
          scheduledFor: m.schedule.dates[0],
        },
        mixed,
      );
      expect(refused.body.error.code).toBe('STORE_CLOSED');
    } finally {
      await sql`update store_settings set status_override = null where tenant_id = ${tenantId}`;
    }
  });

  test('a blocked date leaves the calendar and checkout refuses it', async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.cafe, qty: 1 }, auth);
    const before = (await call('GET', '/checkout/v1/cart', undefined, auth)).body.cart.schedule
      .dates;
    const blocked = before[1];
    await sql`update store_settings set blocked_dates = ${sql.json([blocked])} where tenant_id = ${tenantId}`;
    const after = (await call('GET', '/checkout/v1/cart', undefined, auth)).body.cart.schedule
      .dates;
    expect(after).toEqual(before.filter((d: string) => d !== blocked));
    const r = await call(
      'POST',
      '/checkout/v1/checkout',
      { customer, delivery: pickup, payment: { method: 'pix' }, scheduledFor: blocked },
      auth,
    );
    expect(r.body.error.code).toBe('INVALID_SCHEDULE');
    await sql`update store_settings set blocked_dates = '[]' where tenant_id = ${tenantId}`;
  });

  test("a delivery takes the items' vehicle and its extra, past free delivery", async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.torta, qty: 1 }, auth);
    const moto = await call('POST', '/checkout/v1/cart/delivery', delivery, auth);
    expect(moto.body.cart.vehicle).toBe('moto');
    expect(moto.body.cart.totals).toMatchObject({ deliveryFeeCents: 800, vehicleFeeCents: 300 });

    // a car carries what a moto does; past the zone's free delivery only the extra is paid
    await call('POST', '/checkout/v1/cart/items', { productId: ids.andares, qty: 1 }, auth);
    const car = (await call('GET', '/checkout/v1/cart', undefined, auth)).body.cart;
    expect(car.vehicle).toBe('car');
    expect(car.totals).toMatchObject({
      subtotalCents: 28000,
      deliveryFeeCents: 1500,
      vehicleFeeCents: 1500,
      freeDeliveryThresholdCents: null,
      totalCents: 29500,
    });
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      { customer, delivery, payment: { method: 'pix' }, expectedTotalCents: 29500 },
      auth,
    );
    expect(placed.status).toBe(201);
    expect(placed.body.order).toMatchObject({ deliveryVehicle: 'car', deliveryFeeCents: 1500 });

    // pickup: no trip, no vehicle
    const pick = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.andares, qty: 1 }, pick);
    const r = await call(
      'POST',
      '/checkout/v1/checkout',
      { customer, delivery: pickup, payment: { method: 'pix' } },
      pick,
    );
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({ deliveryVehicle: null, deliveryFeeCents: 0 });
  });

  test('a free-delivery coupon waives the trip, not the vehicle', async () => {
    await sql`
      insert into coupons (tenant_id, code, kind, value)
      values (${tenantId}, 'FRETE', 'free_delivery', 0)`;
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.torta, qty: 1 }, auth);
    await call('POST', '/checkout/v1/cart/delivery', delivery, auth);
    const c = await call('POST', '/checkout/v1/cart/coupon', { code: 'FRETE' }, auth);
    expect(c.body.cart.totals).toMatchObject({
      deliveryFeeCents: 800,
      discountCents: 500,
      totalCents: 3300,
    });
  });
});
