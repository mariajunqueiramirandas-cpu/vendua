import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';

// The kitchen display (Cozinha): tickets with what the kitchen needs and nothing it doesn't,
// lines marked done (the first one starts the order), rush flags, stations by category.
describe.skipIf(!process.env.TEST_DATABASE_URL)('admin: kitchen display (db)', () => {
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
  const slug = `kd-${nonce}`;
  const stamp = String(Date.now()).slice(-7);
  const ownerPhone = `2195${stamp}`;
  const attendantPhone = `2196${stamp}`;
  const shopperPhone = `2297${stamp}`;
  // a store whose clock reads ~12:xx now: everything the stats test readies "a while ago" is today
  const offset = 12 - new Date().getUTCHours();
  const tz = offset === 0 ? 'Etc/GMT' : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
  const localHour = (d: Date) => new Date(d.getTime() + offset * 3_600_000).getUTCHours();
  const localDate = (d: Date) =>
    new Date(d.getTime() + offset * 3_600_000).toISOString().slice(0, 10);
  let tenantId = '';
  let otherTenant = '';
  let ownerId = '';
  let lanches = '';
  let bebidas = '';
  let burger = '';
  let coke = '';
  let otherCategory = '';
  let otherOrder = '';
  let otherLine = '';
  let idem = 0;
  let number = 0;

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
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
      replay: res.headers.get('x-idempotent-replay'),
    };
  };
  const signIn = async (phone: string) => {
    await call('POST', '/admin/v1/auth/otp/start', { phone });
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    return `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
  };
  let ownerCookie = '';
  let attendantCookie = '';
  const owner = (method: string, path: string, body?: unknown, headers = {}) =>
    call(method, `/admin/v1${path}`, body, { cookie: ownerCookie, ...headers });
  const attendant = (method: string, path: string, body?: unknown) =>
    call(method, `/admin/v1${path}`, body, { cookie: attendantCookie });

  const order = async (o: {
    state: string;
    name?: string;
    mode?: 'pickup' | 'delivery';
    notes?: string;
    scheduledFor?: string;
    paid?: boolean;
    tenant?: string;
  }) => {
    const tenant = o.tenant ?? tenantId;
    const cart = (
      await sql<{ id: string }[]>`
        insert into carts (tenant_id, session_hash) values (${tenant}, ${`kd-${nonce}-${++number}`})
        returning id
      `
    )[0]!.id;
    const row = (
      await sql<{ id: string; number: number }[]>`
        insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                            state, subtotal_cents, total_cents, notes, scheduled_for)
        values (${tenant}, ${cart}, ${number}, ${sql.json({ name: o.name ?? 'Bia Lima', phone: shopperPhone })},
                ${shopperPhone}, ${sql.json({ mode: o.mode ?? 'pickup' })},
                ${sql.json({ provider: 'sandbox', method: 'pix', status: o.paid ? 'paid' : 'pending' })},
                ${o.state}, 1000, 1000, ${o.notes ?? null}, ${o.scheduledFor ?? null})
        returning id, number
      `
    )[0]!;
    return row;
  };
  const line = async (
    orderId: string,
    o: {
      product?: string | null;
      name?: string;
      qty?: number;
      modifiers?: unknown[];
      combo?: unknown[];
      sort?: number;
      tenant?: string;
    } = {},
  ) =>
    (
      await sql<{ id: string }[]>`
        insert into order_items (tenant_id, order_id, product_id, slug, name, qty, unit_price_cents,
                                 modifiers, combo, line_total_cents, sort)
        values (${o.tenant ?? tenantId}, ${orderId}, ${o.product === undefined ? burger : o.product},
                'item', ${o.name ?? 'X-Burger'}, ${o.qty ?? 1}, 1000, ${sql.json((o.modifiers ?? []) as never)},
                ${sql.json((o.combo ?? []) as never)}, 1000, ${o.sort ?? 0})
        returning id
      `
    )[0]!.id;
  const event = (orderId: string, to: string, at: Date, meta: Record<string, unknown> = {}) =>
    sql`
      insert into order_events (tenant_id, order_id, to_state, actor, meta, at)
      values (${tenantId}, ${orderId}, ${to}, 'merchant', ${sql.json(meta as never)}, ${at})
    `;
  // one clock per test, so make times are exact
  let base = Date.now();
  const ago = (min: number) => new Date(base - min * 60_000);
  const audits = async (entityId: string, action: string) =>
    (
      await sql<{ summary: string }[]>`
        select summary from audit_log
        where tenant_id = ${tenantId} and entity_id = ${entityId} and action = ${action}
        order by id
      `
    ).map((r) => r.summary);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id
      `
    )[0]!.id;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
      values (${tenantId}, ${sql.json({ timezone: tz, windows: [] })}, 25, 0, 'BRL', ${sql.json({})})
    `;
    ownerId = (
      await sql<{ id: string }[]>`
        insert into merchant_users (tenant_id, name, phone, role)
        values (${tenantId}, 'Rita', ${ownerPhone}, 'owner') returning id
      `
    )[0]!.id;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Caio', ${attendantPhone}, 'attendant')`;
    const cat = async (tenant: string, name: string, sort: number) =>
      (
        await sql<{ id: string }[]>`
          insert into categories (tenant_id, slug, name, sort)
          values (${tenant}, ${name.toLowerCase()}, ${name}, ${sort}) returning id
        `
      )[0]!.id;
    const product = async (category: string, name: string) =>
      (
        await sql<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, base_price_cents)
          values (${tenantId}, ${category}, ${name.toLowerCase()}, ${name}, 1000) returning id
        `
      )[0]!.id;
    bebidas = await cat(tenantId, 'Bebidas', 2);
    lanches = await cat(tenantId, 'Lanches', 1);
    burger = await product(lanches, 'Burger');
    coke = await product(bebidas, 'Coca');

    otherTenant = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${`${slug}-b`}, 'Outra loja') returning id
      `
    )[0]!.id;
    otherCategory = await cat(otherTenant, 'Pizzas', 1);
    otherOrder = (await order({ state: 'confirmed', tenant: otherTenant })).id;
    otherLine = await line(otherOrder, { tenant: otherTenant, product: null });

    ownerCookie = await signIn(ownerPhone);
    attendantCookie = await signIn(attendantPhone);
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (otherTenant) await sql`delete from tenants where id = ${otherTenant}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  let ana = { id: '', number: 0 };
  let l1 = '';
  let l2 = '';
  let l3 = '';

  test('GET /kitchen: first name, prep from the accept, no prices; stats over today', async () => {
    base = Date.now();
    ana = await order({
      state: 'confirmed',
      name: '  Ana Maria Souza ',
      mode: 'delivery',
      notes: 'sem cebola',
      paid: true,
    });
    l1 = await line(ana.id, {
      product: burger,
      name: 'X-Burger',
      qty: 2,
      modifiers: [{ name: 'Bacon', priceDeltaCents: 300 }],
      sort: 0,
    });
    l2 = await line(ana.id, { product: coke, name: 'Coca', sort: 1 });
    l3 = await line(ana.id, {
      product: null,
      name: 'Combo antigo',
      combo: [{ slotName: 'Bebida', name: 'Suco', qty: 1, priceDeltaCents: 0 }],
      sort: 2,
    });
    const acceptedAt = ago(5);
    await event(ana.id, 'confirmed', acceptedAt, { by: 'Rita', prepMinutes: 40 });
    const fresh = await order({ state: 'placed', name: '' });
    const future = await order({ state: 'confirmed', scheduledFor: '2099-01-01' });
    const gone = await order({ state: 'delivered' });

    // on time (18 min against a 20-min promise), late (50 against the store's 25), an encomenda
    // (not timed), and yesterday's (not counted)
    const r1 = await order({ state: 'ready' });
    await event(r1.id, 'confirmed', ago(28), { prepMinutes: 20 });
    await event(r1.id, 'ready', ago(10));
    const r2 = await order({ state: 'ready' });
    await event(r2.id, 'confirmed', ago(70));
    await event(r2.id, 'ready', ago(20));
    const r3 = await order({ state: 'delivered', scheduledFor: localDate(new Date()) });
    await event(r3.id, 'confirmed', ago(26 * 60), { prepMinutes: 30 });
    await event(r3.id, 'ready', ago(90));
    const r4 = await order({ state: 'delivered' });
    await event(r4.id, 'confirmed', ago(27 * 60));
    await event(r4.id, 'ready', ago(26 * 60));

    const r = await attendant('GET', '/kitchen');
    expect(r.status).toBe(200);
    const ids = r.body.tickets.map((t: { id: string }) => t.id);
    expect(ids).toEqual(expect.arrayContaining([ana.id, fresh.id, r1.id, r2.id]));
    for (const hidden of [future.id, gone.id, r3.id, r4.id, otherOrder])
      expect(ids).not.toContain(hidden);

    const t = r.body.tickets.find((x: { id: string }) => x.id === ana.id);
    expect(t).toEqual({
      id: ana.id,
      number: ana.number,
      state: 'confirmed',
      mode: 'delivery',
      table: null,
      name: 'Ana',
      notes: 'sem cebola',
      scheduledFor: null,
      placedAt: expect.any(String),
      acceptedAt: acceptedAt.toISOString(),
      startedAt: null,
      readyAt: null,
      prepMinutes: 40,
      rush: false,
      paid: true,
      payMethod: 'pix',
      version: 1,
      items: [
        {
          id: l1,
          name: 'X-Burger',
          qty: 2,
          modifiers: [{ name: 'Bacon', qty: 1 }],
          combo: [],
          categoryId: lanches,
          stationId: null,
          doneAt: null,
        },
        {
          id: l2,
          name: 'Coca',
          qty: 1,
          modifiers: [],
          combo: [],
          categoryId: bebidas,
          stationId: null,
          doneAt: null,
        },
        {
          id: l3,
          name: 'Combo antigo',
          qty: 1,
          modifiers: [],
          combo: [{ slotName: 'Bebida', name: 'Suco', qty: 1 }],
          categoryId: null,
          stationId: null,
          doneAt: null,
        },
      ],
    });
    // the kitchen never sees money or the shopper's contact
    expect(JSON.stringify(r.body.tickets)).not.toMatch(/cents|price|phone|Souza/i);
    expect(r.body.tickets.find((x: { id: string }) => x.id === fresh.id)).toMatchObject({
      name: '',
      state: 'placed',
      acceptedAt: null,
      prepMinutes: 25,
      version: 0,
      items: [],
    });
    expect(r.body.tickets.find((x: { id: string }) => x.id === r1.id)).toMatchObject({
      prepMinutes: 20,
      readyAt: ago(10).toISOString(),
    });

    expect(r.body.stations).toEqual([]);
    expect(r.body.categories).toEqual([
      { id: lanches, name: 'Lanches' },
      { id: bebidas, name: 'Bebidas' },
    ]);
    expect(r.body.prepDefaultMinutes).toBe(25);
    expect(r.body.acceptTargetMinutes).toBe(5);
    expect(Number.isNaN(Date.parse(r.body.now))).toBe(false);

    const hourly = Array.from({ length: 24 }, () => 0);
    for (const at of [ago(10), ago(20), ago(90)]) hourly[localHour(at)]!++;
    expect(r.body.stats).toEqual({
      readyToday: 3,
      avgMakeSeconds: (18 * 60 + 50 * 60) / 2,
      onTimeRate: 0.5,
      readyLastHour: 2,
      hourly,
    });
  });

  test('marking lines: the first starts the order, a replay answers the same, unmark clears', async () => {
    const o = await order({ state: 'confirmed' });
    const a = await line(o.id, { sort: 0 });
    const b = await line(o.id, { product: coke, sort: 1 });
    const key = { 'idempotency-key': `${nonce}-mark` };
    const first = await owner(
      'POST',
      `/kitchen/orders/${o.id}/items`,
      { items: [a], done: true },
      key,
    );
    expect(first.status).toBe(200);
    const t = first.body.ticket;
    expect(t.state).toBe('preparing');
    expect(t.startedAt).not.toBeNull();
    expect(t.version).toBe(1);
    expect(t.items.map((i: { id: string; doneAt: string | null }) => [i.id, !!i.doneAt])).toEqual([
      [a, true],
      [b, false],
    ]);

    const again = await owner(
      'POST',
      `/kitchen/orders/${o.id}/items`,
      { items: [a], done: true },
      key,
    );
    expect(again.status).toBe(200);
    expect(again.replay).toBe('true');
    expect(again.body).toEqual(first.body);

    const events = await sql<{ to_state: string; actor: string; meta: any }[]>`
      select to_state, actor, meta from order_events where order_id = ${o.id}
    `;
    expect([...events]).toEqual([
      { to_state: 'preparing', actor: 'merchant', meta: { by: 'Rita', source: 'cozinha' } },
    ]);
    expect(await audits(o.id, 'order.preparing')).toEqual([
      `pedido #${o.number}: aceito → preparando`,
    ]);
    expect(await audits(o.id, 'kitchen.items')).toEqual([`pedido #${o.number}: 1 item feito`]);
    const marks = await sql<{ done_by: string }[]>`
      select done_by from kitchen_marks where order_item_id = ${a}
    `;
    expect(marks.map((r) => r.done_by)).toEqual([ownerId]);

    // attendants mark too; the order is already started, so no second step
    const second = await attendant('POST', `/kitchen/orders/${o.id}/items`, {
      items: [b],
      done: true,
    });
    expect(second.status).toBe(200);
    expect(second.body.ticket.state).toBe('preparing');
    expect(second.body.ticket.items.every((i: { doneAt: string | null }) => i.doneAt)).toBe(true);
    // nothing new: no audit row
    expect(
      (await owner('POST', `/kitchen/orders/${o.id}/items`, { items: [a, b], done: true })).status,
    ).toBe(200);
    expect(await audits(o.id, 'kitchen.items')).toHaveLength(2);
    expect(
      (await sql`select 1 from order_events where order_id = ${o.id} and to_state = 'preparing'`)
        .length,
    ).toBe(1);

    const undo = await owner('POST', `/kitchen/orders/${o.id}/items`, {
      items: [a, b.toUpperCase()],
      done: false,
    });
    expect(undo.status).toBe(200);
    expect(undo.body.ticket.state).toBe('preparing');
    expect(undo.body.ticket.items.map((i: { doneAt: string | null }) => i.doneAt)).toEqual([
      null,
      null,
    ]);
    expect((await audits(o.id, 'kitchen.items')).at(-1)).toBe(
      `pedido #${o.number}: 2 itens desmarcados`,
    );
  });

  test('closed orders, foreign ids and bad bodies are stable 4xx', async () => {
    for (const state of ['ready', 'placed', 'delivered']) {
      const o = await order({ state });
      const l = await line(o.id);
      const r = await owner('POST', `/kitchen/orders/${o.id}/items`, { items: [l], done: true });
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('KITCHEN_CLOSED');
      expect(r.body.error.details.state).toBe(state);
    }

    const o = await order({ state: 'confirmed' });
    const mine = await line(o.id);
    const neighbour = await order({ state: 'confirmed' });
    const theirs = await line(neighbour.id);
    for (const items of [[theirs], [mine, crypto.randomUUID()], [mine, otherLine]]) {
      const r = await owner('POST', `/kitchen/orders/${o.id}/items`, { items, done: true });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('ITEM_NOT_FOUND');
    }
    expect((await sql`select 1 from kitchen_marks where order_id = ${o.id}`).length).toBe(0);
    expect((await sql`select state from orders where id = ${o.id}`)[0]!.state).toBe('confirmed');

    // another store's order is not found, never touched
    for (const path of ['items', 'rush']) {
      const r = await owner('POST', `/kitchen/orders/${otherOrder}/${path}`, {
        items: [otherLine],
        done: true,
        rush: true,
      });
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('ORDER_NOT_FOUND');
    }
    expect((await sql`select 1 from kitchen_marks where order_id = ${otherOrder}`).length).toBe(0);
    expect((await sql`select 1 from kitchen_tickets where order_id = ${otherOrder}`).length).toBe(
      0,
    );
    const unknown = await owner('POST', `/kitchen/orders/${crypto.randomUUID()}/items`, {
      items: [mine],
      done: true,
    });
    expect(unknown.status).toBe(404);
    const nonsense = await owner('POST', '/kitchen/orders/nope/items', {
      items: [mine],
      done: true,
    });
    expect(nonsense.status).toBe(400);
    expect(nonsense.body.error.code).toBe('BAD_REQUEST');

    const tooMany = Array.from({ length: 101 }, () => crypto.randomUUID());
    for (const items of [[], 'x', ['nope'], [42], tooMany, undefined]) {
      const r = await owner('POST', `/kitchen/orders/${o.id}/items`, { items, done: true });
      expect(r.status).toBe(422);
      expect(r.body.error.details.field).toBe('items');
    }
    const noDone = await owner('POST', `/kitchen/orders/${o.id}/items`, { items: [mine] });
    expect(noDone.status).toBe(422);
    expect(noDone.body.error.details.field).toBe('done');
  });

  test('rush: any open ticket, audited once per change', async () => {
    const o = await order({ state: 'placed' });
    const on = await attendant('POST', `/kitchen/orders/${o.id}/rush`, { rush: true });
    expect(on.status).toBe(200);
    expect(on.body.ticket).toMatchObject({ id: o.id, state: 'placed', rush: true });
    const board = await owner('GET', '/kitchen');
    expect(board.body.tickets.find((x: { id: string }) => x.id === o.id).rush).toBe(true);
    expect((await owner('POST', `/kitchen/orders/${o.id}/rush`, { rush: true })).status).toBe(200);
    const off = await owner('POST', `/kitchen/orders/${o.id}/rush`, { rush: false });
    expect(off.body.ticket.rush).toBe(false);
    expect(await audits(o.id, 'kitchen.rush')).toEqual([
      `pedido #${o.number}: prioridade`,
      `pedido #${o.number}: sem prioridade`,
    ]);

    const ready = await order({ state: 'ready' });
    expect(
      (await owner('POST', `/kitchen/orders/${ready.id}/rush`, { rush: true })).body.ticket.rush,
    ).toBe(true);
    const done = await order({ state: 'delivered' });
    const closed = await owner('POST', `/kitchen/orders/${done.id}/rush`, { rush: true });
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('KITCHEN_CLOSED');
    const bad = await owner('POST', `/kitchen/orders/${o.id}/rush`, { rush: 'yes' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.field).toBe('rush');
  });

  test('stations: managers only, validated, and they route the lines', async () => {
    const put = (stations: unknown, as = owner) => as('PUT', '/kitchen/stations', { stations });
    const denied = await put([], attendant);
    expect(denied.status).toBe(403);

    const many = Array.from({ length: 13 }, (_, i) => ({ name: `E${i}`, categoryIds: [] }));
    const cases: [unknown, string][] = [
      [many, 'stations'],
      ['x', 'stations'],
      [
        [
          { name: 'Chapa', categoryIds: [lanches] },
          { name: 'Bar', categoryIds: [lanches] },
        ],
        'stations',
      ],
      [[{ name: 'Chapa', categoryIds: [otherCategory] }], 'categoryIds'],
      [[{ name: 'Chapa', categoryIds: [crypto.randomUUID()] }], 'categoryIds'],
      [[{ name: 'Chapa', categoryIds: ['nope'] }], 'categoryIds'],
      [
        [{ name: 'Chapa', categoryIds: Array.from({ length: 201 }, () => crypto.randomUUID()) }],
        'categoryIds',
      ],
      [[{ name: 'x'.repeat(41), categoryIds: [] }], 'name'],
      [[{ name: '   ', categoryIds: [] }], 'name'],
      [
        [
          { name: 'Chapa', categoryIds: [] },
          { name: 'CHAPA', categoryIds: [] },
        ],
        'name',
      ],
    ];
    for (const [stations, field] of cases) {
      const r = await put(stations);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('BAD_REQUEST');
      expect(r.body.error.details.field).toBe(field);
    }

    const doces = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name, sort) values (${tenantId}, 'doces', 'Doces', 3)
        returning id
      `
    )[0]!.id;
    const keep = crypto.randomUUID();
    const r = await put([
      { name: ' Chapa ', categoryIds: [lanches, lanches.toUpperCase()] },
      { id: 'nope', name: 'Bar', categoryIds: [bebidas] },
      { id: keep, name: 'Sobremesas', categoryIds: [doces] },
    ]);
    expect(r.status).toBe(200);
    const [chapa, bar, sweets] = r.body.stations;
    expect(r.body.stations).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Chapa', categoryIds: [lanches] },
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), name: 'Bar', categoryIds: [bebidas] },
      { id: keep, name: 'Sobremesas', categoryIds: [doces] },
    ]);
    const stored = (
      await sql<
        { kitchen: any }[]
      >`select kitchen from store_settings where tenant_id = ${tenantId}`
    )[0]!.kitchen;
    expect(stored).toEqual({ stations: r.body.stations });
    expect(
      (
        await sql`select 1 from audit_log where tenant_id = ${tenantId} and action = 'kitchen.stations'`
      ).length,
    ).toBe(1);

    const board = await attendant('GET', '/kitchen');
    expect(board.body.stations).toEqual(r.body.stations);
    const t = board.body.tickets.find((x: { id: string }) => x.id === ana.id);
    expect(
      t.items.map((i: { id: string; stationId: string | null }) => [i.id, i.stationId]),
    ).toEqual([
      [l1, chapa.id],
      [l2, bar.id],
      [l3, null],
    ]);

    // a category deleted later drops out of its station
    await sql`delete from categories where id = ${doces}`;
    const after = await owner('GET', '/kitchen');
    expect(after.body.stations[2]).toEqual({ ...sweets, categoryIds: [] });
    expect(after.body.categories.map((c: { id: string }) => c.id)).toEqual([lanches, bebidas]);

    const cleared = await put([]);
    expect(cleared.body.stations).toEqual([]);
    expect((await owner('GET', '/kitchen')).body.stations).toEqual([]);
  });
});
