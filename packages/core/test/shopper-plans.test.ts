import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { parsePlan } from '../src/admin/routes-plans.ts';
import { createApp } from '../src/app.ts';
import { planCyclePass } from '../src/modules/shopper-plan-cycles.ts';
import { addDays, dayOfWeek } from '../src/modules/shopper-plan-base.ts';
import { migrate } from '../src/platform/db.ts';
import { handleInbound } from '../src/store-whatsapp/state.ts';
import { optKeyword } from '../src/store-whatsapp/text.ts';

// Plano semanal (0127): a plan's cart, the shopper's yes at checkout, ASSINAR, the week's order
// placed by Core once, PULAR, a week that fails, and CANCELAR PLANO.

describe('plano semanal: rules', () => {
  test('the words', () => {
    expect(optKeyword('ASSINAR')).toBe('plan_yes');
    expect(optKeyword('Pular')).toBe('plan_skip');
    expect(optKeyword('cancelar plano')).toBe('plan_stop');
    expect(optKeyword('quero cancelar o plano da semana que vem')).toBeNull();
    // the old words keep their meaning
    expect(optKeyword('SAIR')).toBe('out');
  });

  test('dates', () => {
    expect(dayOfWeek('2026-10-16')).toBe(5);
    expect(addDays('2026-10-30', 7)).toBe('2026-11-06');
  });

  test('a plan is bounded and names the field', () => {
    const id = crypto.randomUUID();
    expect(() => parsePlan({ name: '', items: [{ productId: id, qty: 1 }] })).toThrow();
    expect(() => parsePlan({ name: 'Cesta', items: [] })).toThrow();
    expect(() => parsePlan({ name: 'Cesta', items: [{ productId: id, qty: 100 }] })).toThrow();
    expect(() =>
      parsePlan({
        name: 'Cesta',
        items: [
          { productId: id, qty: 1 },
          { productId: id, qty: 2 },
        ],
      }),
    ).toThrow();
    expect(() =>
      parsePlan({ name: 'Cesta', weekday: 7, items: [{ productId: id, qty: 1 }] }),
    ).toThrow();
    expect(parsePlan({ name: ' Cesta ', items: [{ productId: id, qty: 2 }] })).toEqual({
      name: 'Cesta',
      description: null,
      weekday: null,
      leadDays: 2,
      items: [{ productId: id, qty: 2 }],
      active: true,
    });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('plano semanal (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    otpSender: async () => {},
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let idem = 0;
  let n = 0;
  const PHONE = '21988887777';

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

  const store = async (opts: { whatsapp?: boolean; weekday?: number | null } = {}) => {
    const slug = `pl-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Hortifruti ' + n}) returning id`;
    ids.push(t!.id);
    const host = `${slug}.localhost`;
    await sql`insert into domains (host, tenant_id) values (${host}, ${t!.id})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency,
                                  vocabulary, preorder_payment_methods)
      values (${t!.id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, ${sql.json(['cash', 'pix'])})`;
    if (opts.whatsapp !== false)
      await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${t!.id}, true, 'open')`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${t!.id}, 'cestas', 'Cestas') returning id`;
    const p: Record<string, string> = {};
    for (const [key, name, price] of [
      ['alface', 'Alface', 450],
      ['tomate', 'Tomate (kg)', 890],
    ] as const) {
      const [row] = await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${t!.id}, ${cat!.id}, ${key}, ${name}, ${price}) returning id`;
      p[key] = row!.id;
    }
    const [plan] = await sql<{ id: string }[]>`
      insert into shopper_plans (tenant_id, name, weekday, lead_days, items)
      values (${t!.id}, 'Cesta da semana', ${opts.weekday ?? null}, 2,
              ${sql.json([
                { productId: p.alface!, qty: 2 },
                { productId: p.tomate!, qty: 1 },
              ])})
      returning id`;
    return { id: t!.id, host, p, planId: plan!.id };
  };

  const session = async (host: string) => {
    const s = await call(host, 'POST', '/checkout/v1/session');
    return { authorization: `Bearer ${s.body.sessionToken}` };
  };

  /** the plan's cart checked out with the shopper's yes; returns the first order and its date */
  const subscribe = async (s: Awaited<ReturnType<typeof store>>) => {
    const auth = await session(s.host);
    const b = await call(s.host, 'POST', '/checkout/v1/cart/plan', { planId: s.planId }, auth);
    expect(b.status).toBe(200);
    const day = b.body.cart.schedule.dates[1] as string;
    const ok = await call(
      s.host,
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Bia Souza', phone: PHONE },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
        scheduledFor: day,
        subscribe: true,
      },
      auth,
    );
    expect(ok.status).toBe(201);
    return { orderId: ok.body.order.id as string, day };
  };

  const say = (tenantId: string, text: string) =>
    handleInbound(sql, tenantId, { phone: PHONE, text, id: `in-${++idem}` });

  /** noon in São Paulo, `days` after a date */
  const noon = (date: string, days = 0) => new Date(`${addDays(date, days)}T15:00:00Z`);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('plans are offered only by a store that can text; Core sums the basket', async () => {
    const off = await store({ whatsapp: false });
    expect((await call(off.host, 'GET', '/storefront/v1/plans')).body.plans).toEqual([]);
    const auth = await session(off.host);
    const b = await call(off.host, 'POST', '/checkout/v1/cart/plan', { planId: off.planId }, auth);
    expect([b.status, b.body.error.code]).toEqual([404, 'PLAN_NOT_FOUND']);

    const s = await store();
    const list = await call(s.host, 'GET', '/storefront/v1/plans');
    expect(list.body.plans).toHaveLength(1);
    expect(list.body.plans[0].subtotalCents).toBe(2 * 450 + 890);
    expect(list.body.plans[0].lines.map((l: any) => [l.name, l.qty])).toEqual([
      ['Alface', 2],
      ['Tomate (kg)', 1],
    ]);
    const bad = await call(
      s.host,
      'POST',
      '/checkout/v1/cart/plan',
      { planId: 'x' },
      await session(s.host),
    );
    expect([bad.status, bad.body.error.details.field]).toEqual([422, 'planId']);
  });

  test('a plan’s cart is an encomenda on the plan’s day', async () => {
    const s = await store({ weekday: 5 });
    const auth = await session(s.host);
    const b = await call(s.host, 'POST', '/checkout/v1/cart/plan', { planId: s.planId }, auth);
    expect(b.body.cart.plan).toEqual({ id: s.planId, name: 'Cesta da semana', weekday: 5 });
    expect(b.body.cart.items).toHaveLength(2);
    expect(b.body.cart.schedule.required).toBe(true);
    expect(b.body.cart.schedule.dates.length).toBeGreaterThan(0);
    for (const d of b.body.cart.schedule.dates) expect(dayOfWeek(d)).toBe(5);
  });

  test('checkout’s yes starts a pending plan; ASSINAR confirms it; one plan per number', async () => {
    const s = await store();
    const { orderId, day } = await subscribe(s);
    const [sub] = await sql<{ state: string; next_on: string; weekday: number }[]>`
      select state, next_on::text as next_on, weekday from plan_subscriptions where tenant_id = ${s.id}`;
    expect(sub).toEqual({ state: 'pending', next_on: addDays(day, 7), weekday: dayOfWeek(day) });
    const [m] = await sql<{ body: string }[]>`
      select body from store_wa_messages where order_id = ${orderId} and event = 'plan_confirm'`;
    expect(m!.body).toContain('responda ASSINAR');
    // the same number again: still one plan
    await subscribe(s);
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from plan_subscriptions where tenant_id = ${s.id}`;
    expect(count).toBe(1);

    await say(s.id, 'Assinar');
    const [after] = await sql<{ state: string }[]>`
      select state from plan_subscriptions where tenant_id = ${s.id}`;
    expect(after!.state).toBe('active');
    const [ack] = await sql<{ body: string }[]>`
      select body from store_wa_messages where tenant_id = ${s.id} and kind = 'opt_in' and event = 'plan'`;
    expect(ack!.body).toContain('confirmado');
  });

  test('without the yes, the order is just an order', async () => {
    const s = await store();
    const auth = await session(s.host);
    const b = await call(s.host, 'POST', '/checkout/v1/cart/plan', { planId: s.planId }, auth);
    const ok = await call(
      s.host,
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Bia Souza', phone: PHONE },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
        scheduledFor: b.body.cart.schedule.dates[0],
      },
      auth,
    );
    expect(ok.status).toBe(201);
    const subs = await sql`select 1 from plan_subscriptions where tenant_id = ${s.id}`;
    expect(subs).toHaveLength(0);
  });

  test('each week is placed once, lead days ahead; PULAR cancels it while the store hasn’t taken it', async () => {
    const s = await store();
    const { day } = await subscribe(s);
    await say(s.id, 'ASSINAR');
    const next = addDays(day, 7);
    // three days before: not yet (lead 2)
    expect(await planCyclePass(sql, s.id, undefined, noon(next, -3))).toBe(0);
    expect(await planCyclePass(sql, s.id, undefined, noon(next, -2))).toBe(1);
    expect(await planCyclePass(sql, s.id, undefined, noon(next, -2))).toBe(0);
    const [o] = await sql<{ id: string; source: string; day: string; total: number }[]>`
      select id, source, scheduled_for::text as day, total_cents as total from orders
      where tenant_id = ${s.id} and source = 'plan'`;
    expect(o).toMatchObject({ source: 'plan', day: next, total: 2 * 450 + 890 });
    const msgs = await sql<{ event: string; body: string }[]>`
      select event, body from store_wa_messages where order_id = ${o!.id}`;
    // the plan's own message, not the 'placed' one
    expect(msgs.map((x) => x.event)).toEqual(['plan_cycle']);
    expect(msgs[0]!.body).toContain('responda PULAR');
    const [sub] = await sql<{ next_on: string }[]>`
      select next_on::text as next_on from plan_subscriptions where tenant_id = ${s.id}`;
    expect(sub!.next_on).toBe(addDays(next, 7));

    await say(s.id, 'pular');
    const [gone] = await sql<{ state: string }[]>`select state from orders where id = ${o!.id}`;
    expect(gone!.state).toBe('cancelled');
    const [cycle] = await sql<{ state: string }[]>`
      select state from plan_cycles where order_id = ${o!.id}`;
    expect(cycle!.state).toBe('skipped');
  });

  test('PULAR before the week is placed skips its date', async () => {
    const s = await store();
    const { day } = await subscribe(s);
    await say(s.id, 'ASSINAR');
    await say(s.id, 'PULAR');
    const next = addDays(day, 7);
    const [sub] = await sql<{ next_on: string }[]>`
      select next_on::text as next_on from plan_subscriptions where tenant_id = ${s.id}`;
    expect(sub!.next_on).toBe(addDays(next, 7));
    expect(await planCyclePass(sql, s.id, undefined, noon(next, -2))).toBe(0);
  });

  test('a week that can’t be placed fails alone, the shopper hears why, the next goes on', async () => {
    const s = await store();
    const { day } = await subscribe(s);
    await say(s.id, 'ASSINAR');
    await sql`update products set status = 'archived' where tenant_id = ${s.id}`;
    const next = addDays(day, 7);
    expect(await planCyclePass(sql, s.id, undefined, noon(next, -2))).toBe(0);
    const [c] = await sql<{ state: string; reason: string }[]>`
      select state, reason from plan_cycles where tenant_id = ${s.id}`;
    expect(c!.state).toBe('failed');
    const [sub] = await sql<{ next_on: string; last_error: string }[]>`
      select next_on::text as next_on, last_error from plan_subscriptions where tenant_id = ${s.id}`;
    expect(sub!.next_on).toBe(addDays(next, 7));
    const notes = await sql<{ body: string }[]>`
      select body from store_wa_messages where tenant_id = ${s.id} and kind = 'opt_in'
        and body like '%Esta semana não deu%'`;
    expect(notes).toHaveLength(1);
    const placed = await sql`select 1 from orders where tenant_id = ${s.id} and source = 'plan'`;
    expect(placed).toHaveLength(0);
  });

  test('a closed store waits; a pending number is let go after a week', async () => {
    const s = await store();
    const { day } = await subscribe(s);
    await sql`update store_settings set status_override = 'closed' where tenant_id = ${s.id}`;
    await sql`update plan_subscriptions set state = 'active' where tenant_id = ${s.id}`;
    const next = addDays(day, 7);
    expect(await planCyclePass(sql, s.id, undefined, noon(next, -2))).toBe(0);
    const none = await sql`select 1 from plan_cycles where tenant_id = ${s.id}`;
    expect(none).toHaveLength(0);

    const t = await store();
    await subscribe(t);
    await sql`update plan_subscriptions set created_at = now() - interval '8 days'
              where tenant_id = ${t.id}`;
    await planCyclePass(sql, t.id, undefined);
    const [sub] = await sql<{ state: string; cancelled_by: string }[]>`
      select state, cancelled_by from plan_subscriptions where tenant_id = ${t.id}`;
    expect(sub).toEqual({ state: 'cancelled', cancelled_by: 'not_confirmed' });
  });

  test('CANCELAR PLANO ends it; a number with no plan gets no answer', async () => {
    const s = await store();
    await subscribe(s);
    await say(s.id, 'ASSINAR');
    await say(s.id, 'cancelar plano');
    const [sub] = await sql<{ state: string; cancelled_by: string; next_on: string | null }[]>`
      select state, cancelled_by, next_on from plan_subscriptions where tenant_id = ${s.id}`;
    expect(sub).toEqual({ state: 'cancelled', cancelled_by: 'shopper', next_on: null });
    const before =
      await sql`select 1 from store_wa_messages where tenant_id = ${s.id} and kind = 'opt_in'`;
    await say(s.id, 'PULAR');
    const after =
      await sql`select 1 from store_wa_messages where tenant_id = ${s.id} and kind = 'opt_in'`;
    expect(after.length).toBe(before.length);
  });
});
