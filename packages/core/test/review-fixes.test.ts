import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Hono } from 'hono';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { validateCombo, type ComboSlot } from '../src/modules/combos.ts';
import { controlIdemKey } from '../src/modules/control.ts';
import { couponUsage } from '../src/modules/coupons.ts';
import { migrate, type Sql } from '../src/platform/db.ts';
import { isCalendarDate } from '../src/platform/tz.ts';

// The October 2026 review: each test pins one fix (the rest sit with their feature's tests:
// referrals, pdv, shopper-plans).

describe('review fixes (units)', () => {
  test('a date that names no day is not a calendar date', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    for (const d of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-2-1', 20260201])
      expect(isCalendarDate(d)).toBe(false);
  });

  test('a kit pick the store took out names its slot', () => {
    const slot: ComboSlot = {
      id: 's1',
      name: 'Sabores',
      minSelect: 1,
      maxSelect: 2,
      qtyPerItem: 1,
      items: [],
    };
    const { error } = validateCombo([slot], [{ slotId: 's1', productId: 'gone', qty: 1 }]);
    expect(error?.code).toBe('INVALID_COMBO');
    expect(error?.message).toContain('Sabores');
    expect(error?.details).toMatchObject({ slotId: 's1', slotName: 'Sabores' });
  });

  test('a staff Idempotency-Key is bound to its route and target', async () => {
    const h = new Hono();
    h.all('*', (c) => c.text(controlIdemKey(c)));
    const key = async (path: string, method = 'POST') =>
      (await h.request(path, { method, headers: { 'idempotency-key': 'K1' } })).text();
    const a = await key('/control/v1/storefronts/a/reset');
    expect(a.endsWith(':K1')).toBe(true);
    expect(await key('/control/v1/storefronts/a/reset')).toBe(a);
    expect(await key('/control/v1/storefronts/b/reset')).not.toBe(a);
    expect(await key('/control/v1/storefronts/a/reset', 'PATCH')).not.toBe(a);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('review fixes (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `rf-${nonce}`;
  const host = `${slug}.localhost`;
  const shopper = `229${String(Date.now()).slice(-8)}`;
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
    return {
      status: res.status,
      body: (await res.json()) as any,
      replayed: res.headers.get('x-idempotent-replay') === 'true',
    };
  };
  const session = async () => {
    const s = await call('POST', '/checkout/v1/session');
    return { authorization: `Bearer ${s.body.sessionToken}` };
  };
  const bag = async () => {
    const auth = await session();
    const r = await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, auth);
    expect(r.status).toBe(200);
    return { auth, line: r.body.cart.items[0].id as string };
  };
  const place = (auth: Record<string, string>, extra: Record<string, unknown> = {}) =>
    call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Joana Lima', phone: shopper },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
        ...extra,
      },
      auth,
    );

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency,
                                  vocabulary, city, pix_key, pix_key_type, pix_beneficiary, pix_city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema', 'loja@exemplo.com', 'email', 'Loja',
              'Saquarema')`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${tenantId}, 'lanches', 'Lanches')
      returning id`;
    productId = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${cat!.id}, 'x-burger', 'X-Burger', 2500) returning id`
    )[0]!.id;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('a qty that is not a number is 422 and the line stays (null was a delete)', async () => {
    const { auth, line } = await bag();
    for (const qty of [null, '', true, [2]]) {
      const r = await call('PATCH', `/checkout/v1/cart/items/${line}`, { qty }, auth);
      expect([r.status, r.body.error.code]).toEqual([422, 'INVALID_QTY']);
    }
    const add = await call('POST', '/checkout/v1/cart/items', { productId, qty: '2' }, auth);
    expect(add.status).toBe(422);
    const cart = await call('GET', '/checkout/v1/cart', undefined, auth);
    expect(cart.body.cart.items.map((i: any) => i.qty)).toEqual([1]);
  });

  test('a date that does not exist is 422 at checkout, with a daily ceiling set too', async () => {
    await sql`
      update store_settings set encomenda_capacity = ${sql.json({ days: [5, 5, 5, 5, 5, 5, 5] })}
      where tenant_id = ${tenantId}`;
    try {
      const { auth } = await bag();
      const r = await place(auth, { scheduledFor: '2026-02-30' });
      expect([r.status, r.body.error.code]).toEqual([422, 'INVALID_SCHEDULE']);
    } finally {
      await sql`update store_settings set encomenda_capacity = null where tenant_id = ${tenantId}`;
    }
  });

  test('a single-use coupon on a refunded order is free again, as on a cancelled one', async () => {
    const [coupon] = await sql<{ id: string }[]>`
      insert into coupons (tenant_id, code, kind, value, max_redemptions)
      values (${tenantId}, 'UMAVEZ', 'fixed', 100, 1) returning id`;
    const { auth } = await bag();
    expect((await call('POST', '/checkout/v1/cart/coupon', { code: 'UMAVEZ' }, auth)).status).toBe(
      200,
    );
    const placed = await place(auth);
    expect(placed.status).toBe(201);
    const used = () =>
      sql.begin(async (tx) => {
        await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
        return (await couponUsage(tx as unknown as Sql, tenantId, coupon!.id, shopper)).total;
      });
    expect(await used()).toBe(1);
    await sql`update orders set state = 'refunded' where id = ${placed.body.order.id}`;
    expect(await used()).toBe(0);
  });

  test('a key resent with another body is refused; the same body replays', async () => {
    const auth = await session();
    const key = { ...auth, 'idempotency-key': `${nonce}-same` };
    const first = await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, key);
    expect(first.status).toBe(200);
    const again = await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, key);
    expect([again.status, again.replayed]).toEqual([200, true]);
    const other = await call('POST', '/checkout/v1/cart/items', { productId, qty: 3 }, key);
    expect([other.status, other.body.error.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
    // a client can't take an /events batch's key, which replays to anyone
    const squat = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId, qty: 1 },
      {
        ...auth,
        'idempotency-key': 'events:abcdefgh',
      },
    );
    expect(squat.status).toBe(400);
  });

  test("agent_events' partitions are closed to the app role", async () => {
    const parts = await sql<{ relname: string; rls: boolean; any: boolean }[]>`
      select c.relname, c.relrowsecurity as rls,
             has_table_privilege('vendua_app', c.oid, 'select, insert, update, delete') as any
      from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = 'agent_events'::regclass`;
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect([p.relname, p.rls, p.any]).toEqual([p.relname, true, false]);
  });

  test('a plan month ends on the day it was paid, in São Paulo', async () => {
    const [r] = await sql<Record<string, Date>[]>`
      select billing_month_after('2026-01-31 15:00-03', 31) as feb,
             billing_month_after('2026-02-28 15:00-03', 31) as mar,
             billing_month_after('2026-01-30 22:00-03', 30) as late,
             billing_month_after('2026-11-15 10:00-03', null, 2) as plain`;
    expect(r!.feb!.toISOString()).toBe('2026-02-28T18:00:00.000Z');
    expect(r!.mar!.toISOString()).toBe('2026-03-31T18:00:00.000Z');
    // 22h in São Paulo is the next day in UTC: still 28 February at 22h there
    expect(r!.late!.toISOString()).toBe('2026-03-01T01:00:00.000Z');
    expect(r!.plain!.toISOString()).toBe('2027-01-15T13:00:00.000Z');
  });
});
