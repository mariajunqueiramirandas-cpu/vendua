import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { latePassTx } from '../src/admin/late-orders.ts';
import {
  deliveryWindow,
  freioPassTx,
  nextLevel,
  readyInMinutes,
  waitMinutes,
  type Ticket,
} from '../src/modules/freio.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

// Freio automático (0125, docs/features/freio-automatico.md): promises from the kitchen's queue,
// a brake that pauses delivery in steps and never closes, late orders told before they ask.

const NOW = new Date('2026-10-13T20:00:00-03:00');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const t = (id: string, placedMinAgo: number, prep: number, startedMinAgo?: number): Ticket => ({
  id,
  placedAt: ago(placedMinAgo),
  prep,
  startedAt: startedMinAgo === undefined ? null : ago(startedMinAgo),
});
const cfg = { prep: 30, capacity: 3, buffer: 5, maxPromise: 90 };

describe('freio: the lane model', () => {
  test('lanes, not an average: one ticket on three lanes waits nothing; four wait for the first', () => {
    expect(waitMinutes([t('a', 5, 30)], 3, NOW)).toBe(0);
    const four = [t('a', 4, 30), t('b', 3, 30), t('c', 2, 30), t('d', 1, 30)];
    // three lanes busy for 30, the fourth ticket takes the first that frees: a new order waits 30
    expect(waitMinutes(four, 3, NOW)).toBe(30);
    // a started ticket holds its lane only for what's left
    expect(waitMinutes([t('a', 20, 30, 20)], 1, NOW)).toBe(10);
  });

  test('an order in the queue counts only the tickets before it, never itself', () => {
    const q = [t('a', 10, 30), t('b', 5, 20)];
    expect(readyInMinutes(q[1]!, q, 1, NOW)).toBe(50);
    expect(readyInMinutes(q[0]!, q, 1, NOW)).toBe(30);
    expect(readyInMinutes(t('s', 30, 40, 25), q, 1, NOW)).toBe(15);
  });

  test('the delivery window: distance adds drive and buffer; a zone keeps its ETA unless later', () => {
    expect(deliveryWindow({ kind: 'distance', driveMinutes: 12 }, 30, 5)).toEqual({
      from: 47,
      to: 57,
    });
    expect(deliveryWindow({ kind: 'zone', etaMin: 40, etaMax: 60 }, 30, 5)).toEqual({
      from: 40,
      to: 60,
    });
    expect(deliveryWindow({ kind: 'zone', etaMin: 40, etaMax: 60 }, 60, 5)).toEqual({
      from: 65,
      to: 85,
    });
    expect(deliveryWindow(null, 30, 5)).toEqual({ from: 30, to: 30 });
  });

  test('levels: up after the hold, down only below the margin, Cheio that lasts → Só retirada', () => {
    const k = (extra: number) => ({
      queue: 5,
      backlogMinutes: extra,
      pickupMinutes: 30 + extra,
      extraMinutes: extra,
    });
    expect(nextLevel('normal', null, k(12), cfg, NOW)).toBe('busy');
    expect(nextLevel('normal', ago(5), k(40), cfg, NOW)).toBe('normal');
    expect(nextLevel('busy', ago(11), k(40), cfg, NOW)).toBe('full');
    // 7 is under Movimentado's 10, but not 5 under it: holds
    expect(nextLevel('busy', ago(30), k(7), cfg, NOW)).toBe('busy');
    expect(nextLevel('busy', ago(30), k(4), cfg, NOW)).toBe('normal');
    expect(nextLevel('full', ago(25), k(35), cfg, NOW)).toBe('pickup_only');
    expect(nextLevel('pickup_only', ago(25), k(20), cfg, NOW)).toBe('pickup_only');
    expect(nextLevel('pickup_only', ago(25), k(3), cfg, NOW)).toBe('normal');
    // a promise past the store's ceiling is Cheio whatever the extra
    expect(nextLevel('normal', null, { ...k(0), pickupMinutes: 95 }, cfg, NOW)).toBe('full');
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('freio (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    otpSender: async () => {},
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let idem = 0;
  let n = 0;
  let num = 0;

  const call = async (host: string, method: string, path: string, body?: unknown, h = {}) => {
    const res = await app.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        ...(method === 'GET' ? {} : { 'idempotency-key': `${nonce}-${++idem}` }),
        ...h,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };

  const store = async (o: { mode?: string; capacity?: number } = {}) => {
    const slug = `fr-${nonce}-${++n}`;
    const [tn] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Cozinha ' + n}) returning id`;
    ids.push(tn!.id);
    const host = `${slug}.localhost`;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tn!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary,
                                  freio_mode, kitchen_capacity)
      values (${tn!.id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              30, 0, 'BRL', ${sql.json({})}, ${o.mode ?? 'suggest'}, ${o.capacity ?? 1})`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${tn!.id}, 'pratos', 'Pratos') returning id`;
    const [p] = await sql<{ id: string }[]>`
      insert into products (tenant_id, category_id, slug, name, base_price_cents)
      values (${tn!.id}, ${cat!.id}, 'marmita', 'Marmita', 2000) returning id`;
    return { id: tn!.id, host, product: p!.id };
  };

  /** an order already in the kitchen, placed `min` minutes ago */
  const ticket = async (
    s: { id: string },
    min: number,
    o: { state?: string; promisedIn?: number; phone?: string; fee?: number; mode?: string } = {},
  ) => {
    const placed = new Date(Date.now() - min * 60_000);
    const promised = new Date(Date.now() + (o.promisedIn ?? 30) * 60_000).toISOString();
    const [row] = await sql<{ id: string }[]>`
      insert into orders (tenant_id, number, source, state, customer, customer_phone, delivery, payment,
                          subtotal_cents, delivery_fee_cents, total_cents, placed_at)
      values (${s.id}, ${++num}, 'pdv', ${o.state ?? 'confirmed'}, ${sql.json({ name: 'Ana' })},
              ${o.phone ?? null},
              ${sql.json({ mode: o.mode ?? 'pickup', promisedFrom: promised, promisedTo: promised })},
              ${sql.json({ method: 'cash' })}, 2000, ${o.fee ?? 0}, ${2000 + (o.fee ?? 0)}, ${placed})
      returning id`;
    await sql`insert into order_events (order_id, tenant_id, at, from_state, to_state, actor, meta)
              values (${row!.id}, ${s.id}, ${placed}, 'placed', 'confirmed', 'merchant', '{}')`;
    return row!.id;
  };

  const pass = (s: { id: string }, now = new Date()) =>
    withTenant(sql, s.id, (tx) =>
      freioPassTx(tx, s.id, now, { audit: async () => {}, emitStore: async () => {} }),
    );
  const settings = async (s: { id: string }) =>
    (await sql<Record<string, any>[]>`select * from store_settings where tenant_id = ${s.id}`)[0]!;

  const place = async (s: { host: string; product: string }, mode: 'pickup' | 'delivery') => {
    const session = await call(s.host, 'POST', '/checkout/v1/session');
    const auth = { authorization: `Bearer ${session.body.sessionToken}` };
    await call(s.host, 'POST', '/checkout/v1/cart/items', { productId: s.product, qty: 1 }, auth);
    return call(
      s.host,
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Bia', phone: '21988887777' },
        delivery:
          mode === 'delivery'
            ? { mode, street: 'Rua A', number: '10', neighborhood: 'Centro' }
            : { mode },
        payment: { method: 'cash' },
      },
      auth,
    );
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('a new pickup is promised after the queue ahead of it', async () => {
    const s = await store({ capacity: 1 });
    const quiet = await place(s, 'pickup');
    expect(quiet.status).toBe(201);
    const q = quiet.body.order.delivery;
    const quietMin = (Date.parse(q.promisedTo) - Date.now()) / 60_000;
    // the order just placed is now ahead of the next one, on the only lane
    const busy = await place(s, 'pickup');
    const b = busy.body.order.delivery;
    const busyMin = (Date.parse(b.promisedTo) - Date.now()) / 60_000;
    expect(Math.round(quietMin)).toBe(30);
    expect(Math.round(busyMin)).toBe(60);
  });

  test('Automático pauses delivery at Cheio, checkout refuses delivery, pickup goes on', async () => {
    const s = await store({ mode: 'auto', capacity: 1 });
    await ticket(s, 1);
    await ticket(s, 1);
    // two 30-min tickets on one lane: a new order waits 60 → Cheio
    expect((await pass(s))?.title).toMatch(/^Freio: só retirada até/);
    const st = await settings(s);
    expect(st.freio_level).toBe('full');
    expect(st.delivery_paused_until).not.toBeNull();
    expect(st.freio_backlog_minutes).toBe(60);
    const refused = await place(s, 'delivery');
    expect([refused.status, refused.body.error.code]).toEqual([409, 'DELIVERY_PAUSED']);
    expect((await place(s, 'pickup')).status).toBe(201);
    const profile = await call(s.host, 'GET', '/storefront/v1/store');
    expect(profile.body.fulfillment.deliveryPausedUntil).not.toBeNull();
    expect(profile.body.fulfillment.level).toBe('full');
    // the kitchen catches up: past the hold, the pause lifts by itself
    await sql`update orders set state = 'delivered' where tenant_id = ${s.id}`;
    const later = new Date(Date.now() + 11 * 60_000);
    expect((await pass(s, later))?.title).toBe('Entregas de volta');
    expect((await settings(s)).delivery_paused_until).toBeNull();
  });

  test('Sugerir only suggests; applying it pauses, undoing it holds the brake off', async () => {
    const s = await store({ mode: 'suggest', capacity: 1 });
    await ticket(s, 1);
    await ticket(s, 1);
    expect((await pass(s))?.title).toBe('Cozinha cheia: pausar as entregas?');
    const st = await settings(s);
    expect(st.delivery_paused_until).toBeNull();
    expect(st.freio_suggestion.level).toBe('full');
    expect((await place(s, 'delivery')).body.error?.code).not.toBe('DELIVERY_PAUSED');
  });

  test('Automático stays locked until the board is used', async () => {
    const s = await store();
    await sql`insert into merchant_users (tenant_id, name, phone, role)
              values (${s.id}, 'Dona', ${'2199' + String(Date.now()).slice(-7)}, 'owner')`;
    // checked through the module the route uses: no orders marked ready yet
    const { freioViewTx } = await import('../src/admin/routes-freio.ts');
    const v = await withTenant(sql, s.id, (tx) => freioViewTx(tx, s.id));
    expect(v.auto.unlocked).toBe(false);
  });

  test('a late order is told once, with an apology only while the budget lasts', async () => {
    const s = await store({ capacity: 1 });
    await sql`update store_settings set late_mode = 'auto', apology_kind = 'fixed',
                apology_value_cents = 500, apology_budget_cents = 500 where tenant_id = ${s.id}`;
    // a 30-min ticket ahead, then two promised in 2 minutes: both will be late by ~58
    await ticket(s, 3, { promisedIn: 40 });
    const a = await ticket(s, 2, { promisedIn: 2, phone: '21977776666' });
    const b = await ticket(s, 1, { promisedIn: 2, phone: '21955554444' });
    const pushes = await withTenant(sql, s.id, (tx) => latePassTx(tx, s.id, new Date()));
    expect(pushes.map((p) => p.key).sort()).toEqual([`late:${a}`, `late:${b}`].sort());
    const notes = await sql<{ order_id: string; state: string; coupon_cents: number }[]>`
      select order_id, state, coupon_cents from order_late_notices where tenant_id = ${s.id}
      order by created_at`;
    expect(notes.every((x) => x.state === 'sent')).toBe(true);
    // R$ 5 of budget: one apology, the other told without one
    expect(notes.map((x) => x.coupon_cents).sort()).toEqual([0, 500]);
    const [moved] = await sql<{ delay: number }[]>`
      select (delivery ->> 'delayMinutes')::int as delay from orders where id = ${a}`;
    expect(moved!.delay).toBeGreaterThanOrEqual(5);
    // never twice
    expect(await withTenant(sql, s.id, (tx) => latePassTx(tx, s.id, new Date()))).toEqual([]);
    const coupons =
      await sql`select code from coupons where tenant_id = ${s.id} and source = 'apology'`;
    expect(coupons).toHaveLength(1);
  });
});
