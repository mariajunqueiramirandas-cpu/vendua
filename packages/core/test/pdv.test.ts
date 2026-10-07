import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { discountCents, serviceCents, splitShares } from '../src/modules/pdv/pricing.ts';
import { claimDueJobsTx } from '../src/modules/printing/jobs.ts';
import { migrate } from '../src/platform/db.ts';

describe('pdv money helpers', () => {
  test('discounts never exceed what they discount; percent rounds', () => {
    expect(discountCents({ kind: 'fixed', value: 5000, reason: 'x' }, 3000)).toBe(3000);
    expect(discountCents({ kind: 'percent', value: 1000, reason: 'x' }, 3605)).toBe(361);
    expect(discountCents(null, 3000)).toBe(0);
    expect(serviceCents(1000, 2005)).toBe(201);
    expect(serviceCents(0, 2000)).toBe(0);
  });
  test('shares add up to the whole, leftovers on the first', () => {
    expect(splitShares(2200, 3)).toEqual([734, 733, 733]);
    expect(splitShares(0, 2)).toEqual([0, 0]);
    expect(splitShares(10, 4).reduce((a, b) => a + b, 0)).toBe(10);
  });
});

// The PDV (ADR 0035): the caixa, counter sales, comandas on tables, payments into the caixa.
describe.skipIf(!process.env.TEST_DATABASE_URL)('admin: pdv (db)', () => {
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
  const slug = `pdv-${nonce}`;
  const host = `${slug}.localhost`;
  const stamp = String(Date.now()).slice(-7);
  const ownerPhone = `2185${stamp}`;
  const attendantPhone = `2186${stamp}`;
  const mirimPhone = `2187${stamp}`;
  let tenantId = '';
  let mirimTenant = '';
  let burger = '';
  let coke = '';
  let bacon = '';
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
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
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
  let mirimCookie = '';
  const owner = (method: string, path: string, body?: unknown) =>
    call(method, `/admin/v1${path}`, body, { cookie: ownerCookie });
  const attendant = (method: string, path: string, body?: unknown) =>
    call(method, `/admin/v1${path}`, body, { cookie: attendantCookie });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const store = async (s: string, plan: string | null) => {
      const id = (
        await sql<{ id: string }[]>`
          insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id
        `
      )[0]!.id;
      if (plan) await sql`update tenants set plan = ${plan} where id = ${id}`;
      await sql`
        insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary,
                                    pix_key, pix_key_type, pix_beneficiary, pix_city)
        values (${id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [] })}, 20, 0, 'BRL', ${sql.json({})},
                'loja@example.com', 'email', 'Loja Teste', 'Niteroi')
      `;
      return id;
    };
    tenantId = await store(slug, null);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      update store_settings set hours = ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })}
      where tenant_id = ${tenantId}`;
    mirimTenant = await store(`${slug}-m`, 'mirim');
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Rita', ${ownerPhone}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Caio', ${attendantPhone}, 'attendant')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${mirimTenant}, 'Lia', ${mirimPhone}, 'owner')`;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name, sort) values (${tenantId}, 'lanches', 'Lanches', 1)
        returning id
      `
    )[0]!.id;
    const product = async (name: string, price: number, stock: number | null = null) =>
      (
        await sql<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, base_price_cents, stock_quantity)
          values (${tenantId}, ${cat}, ${name.toLowerCase()}, ${name}, ${price}, ${stock}) returning id
        `
      )[0]!.id;
    burger = await product('Burger', 1000);
    coke = await product('Coca', 600, 5);
    const group = (
      await sql<{ id: string }[]>`
        insert into modifier_groups (tenant_id, product_id, name, min_select, max_select)
        values (${tenantId}, ${burger}, 'Extras', 0, 2) returning id
      `
    )[0]!.id;
    bacon = (
      await sql<{ id: string }[]>`
        insert into modifiers (tenant_id, group_id, name, price_delta_cents)
        values (${tenantId}, ${group}, 'Bacon', 300) returning id
      `
    )[0]!.id;
    ownerCookie = await signIn(ownerPhone);
    attendantCookie = await signIn(attendantPhone);
    mirimCookie = await signIn(mirimPhone);
  });

  afterAll(async () => {
    for (const id of [tenantId, mirimTenant])
      if (id) await sql`delete from tenants where id = ${id}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  const sale = (o: { quoted: number; payments: unknown[]; serveNow?: boolean; phone?: string }) =>
    attendant('POST', '/pdv/sales', {
      lines: [
        { productId: burger, qty: 2, modifiers: [{ id: bacon }], note: 'sem cebola' },
        { productId: coke, qty: 1 },
      ],
      mode: 'takeaway',
      quotedTotalCents: o.quoted,
      payments: o.payments,
      ...(o.serveNow ? { serveNow: true } : {}),
      ...(o.phone ? { customer: { name: 'Bia', phone: o.phone } } : {}),
    });

  test('the plan gate: Mirim has no PDV', async () => {
    const r = await call('GET', '/admin/v1/pdv/state', undefined, { cookie: mirimCookie });
    expect(r.status).toBe(403);
    expect(r.body.error.code ?? r.body.code).toBe('PLAN_REQUIRED');
  });

  test('quote: Core prices options; a discount needs a manager', async () => {
    const lines = [
      { productId: burger, qty: 2, modifiers: [{ id: bacon }] },
      { productId: coke, qty: 1 },
    ];
    const q = await attendant('POST', '/pdv/quote', { lines });
    expect(q.status).toBe(200);
    expect(q.body.quote).toMatchObject({ subtotalCents: 3200, discountCents: 0, totalCents: 3200 });
    expect(q.body.quote.lines[0]).toMatchObject({ unitPriceCents: 1300, lineTotalCents: 2600 });
    const discount = { kind: 'percent', value: 1000, reason: 'cliente da casa' };
    expect((await attendant('POST', '/pdv/quote', { lines, discount })).status).toBe(403);
    const d = await owner('POST', '/pdv/quote', { lines, discount });
    expect(d.body.quote).toMatchObject({ discountCents: 320, totalCents: 2880 });
    const bad = await attendant('POST', '/pdv/quote', {
      lines: [{ productId: crypto.randomUUID(), qty: 1 }],
    });
    expect(bad.status).toBe(404);
    expect(bad.body.error?.details?.line ?? bad.body.details?.line).toBe(0);
    expect((await attendant('POST', '/pdv/quote', { lines: [] })).status).toBe(422);
  });

  test('no sale without an open caixa; one caixa at a time', async () => {
    const r = await sale({ quoted: 3200, payments: [{ method: 'pix', amountCents: 3200 }] });
    expect(r.status).toBe(409);
    const open = await attendant('POST', '/pdv/caixa/open', { openingCents: 10_000 });
    expect(open.status).toBe(201);
    expect(open.body.caixa).toMatchObject({
      openingCents: 10_000,
      openedBy: 'Caio',
      expected: null,
    });
    expect((await owner('POST', '/pdv/caixa/open', { openingCents: 0 })).status).toBe(409);
  });

  let saleOrder = '';
  test('a counter sale: re-priced, paid in full, an accepted order with no cart', async () => {
    const moved = await sale({ quoted: 3000, payments: [{ method: 'pix', amountCents: 3000 }] });
    expect(moved.status).toBe(409);
    const short = await sale({ quoted: 3200, payments: [{ method: 'pix', amountCents: 3000 }] });
    expect(short.status).toBe(422);
    const tender = await sale({
      quoted: 3200,
      payments: [{ method: 'pix', amountCents: 1000, tenderedCents: 2000 }],
    });
    expect(tender.status).toBe(422);
    const r = await sale({
      quoted: 3200,
      payments: [
        { method: 'cash', amountCents: 2000, tenderedCents: 5000 },
        { method: 'pix', amountCents: 1200 },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.sale).toMatchObject({ totalCents: 3200, changeCents: 3000 });
    expect(r.body.order).toMatchObject({
      state: 'confirmed',
      totalCents: 3200,
      delivery: { mode: 'pickup' },
      payment: { provider: 'pdv', method: 'mixed', status: 'paid' },
    });
    expect(r.body.order.items[0]).toMatchObject({
      qty: 2,
      unitPriceCents: 1300,
      note: 'sem cebola',
    });
    saleOrder = r.body.order.id;
    const [row] = await sql<{ cart_id: string | null; source: string }[]>`
      select cart_id, source from orders where id = ${saleOrder}`;
    expect(row).toEqual({ cart_id: null, source: 'pdv' });
    const [stock] = await sql<
      { n: number }[]
    >`select stock_quantity as n from products where id = ${coke}`;
    expect(stock!.n).toBe(4);
  });

  test('"entregar agora" walks the sale to delivered and stamps loyalty by phone', async () => {
    const r = await attendant('POST', '/pdv/sales', {
      lines: [{ productId: coke, qty: 1 }],
      mode: 'here',
      quotedTotalCents: 600,
      payments: [{ method: 'debit', amountCents: 600 }],
      serveNow: true,
      customer: { phone: '(21) 99888-7766' },
    });
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({
      state: 'delivered',
      delivery: { mode: 'dine_in', table: null },
      payment: { method: 'debit' },
    });
    const bad = await attendant('POST', '/pdv/sales', {
      lines: [{ productId: coke, qty: 1 }],
      mode: 'here',
      quotedTotalCents: 600,
      payments: [{ method: 'debit', amountCents: 600 }],
      customer: { phone: '123' },
    });
    expect(bad.status).toBe(422);
  });

  let mesa1 = '';
  let mesa2 = '';
  let tab = '';
  test('tables are a manager thing; one open comanda per table', async () => {
    expect((await attendant('POST', '/pdv/tables', { labels: ['Mesa 1'] })).status).toBe(403);
    const t = await owner('POST', '/pdv/tables', { labels: ['Mesa 1', 'Mesa 2', 'mesa 1'] });
    expect(t.status).toBe(201);
    expect(t.body.tables.map((x: any) => x.label)).toEqual(['Mesa 1', 'Mesa 2']);
    [mesa1, mesa2] = t.body.tables.map((x: any) => x.id);
    expect((await owner('PATCH', '/pdv/settings', { serviceBps: 1000 })).status).toBe(200);
    expect((await owner('PATCH', '/pdv/settings', { serviceBps: 5000 })).status).toBe(422);
    const open = await attendant('POST', '/pdv/tabs', { tableId: mesa1 });
    expect(open.status).toBe(201);
    expect(open.body.tab).toMatchObject({ label: 'Mesa 1', serviceBps: 1000, serviceFee: true });
    tab = open.body.tab.id;
    const again = await attendant('POST', '/pdv/tabs', { tableId: mesa1 });
    expect(again.status).toBe(409);
    expect((await owner('DELETE', `/pdv/tables/${mesa1}`)).status).toBe(409);
    expect((await attendant('POST', '/pdv/tabs', {})).status).toBe(422);
  });

  test('a round goes to the kitchen with its table; the bill has the service', async () => {
    const r = await attendant('POST', `/pdv/tabs/${tab}/rounds`, {
      lines: [{ productId: burger, qty: 2 }],
    });
    expect(r.status).toBe(201);
    expect(r.body.tab).toMatchObject({
      rounds: 1,
      subtotalCents: 2000,
      serviceCents: 200,
      totalCents: 2200,
      remainingCents: 2200,
    });
    const order = await owner('GET', `/orders/${r.body.orderId}`);
    expect(order.body.order ?? order.body).toMatchObject({
      state: 'confirmed',
      delivery: { mode: 'dine_in', table: 'Mesa 1' },
      payment: { method: 'tab', status: 'pending' },
    });
    const kitchen = await owner('GET', '/kitchen');
    const ticket = kitchen.body.tickets.find((t: any) => t.id === r.body.orderId);
    expect(ticket).toMatchObject({ mode: 'dine_in', table: 'Mesa 1' });
    // a dine-in order is never out for delivery
    const out = await owner('POST', `/orders/${r.body.orderId}/transition`, {
      to: 'out_for_delivery',
    });
    expect(out.status).toBeGreaterThanOrEqual(400);
    const split = await attendant('GET', `/pdv/tabs/${tab}?ways=3`);
    expect(split.body.tab.split).toEqual({ ways: 3, sharesCents: [734, 733, 733] });
    expect((await attendant('GET', `/pdv/tabs/${tab}?ways=50`)).status).toBe(422);
  });

  test('partial payments, a voided one, then the last one closes the comanda', async () => {
    const p1 = await attendant('POST', `/pdv/tabs/${tab}/payments`, {
      method: 'cash',
      amountCents: 1000,
    });
    expect(p1.status).toBe(200);
    expect(p1.body.tab.remainingCents).toBe(1200);
    const over = await attendant('POST', `/pdv/tabs/${tab}/payments`, {
      method: 'credit',
      amountCents: 1300,
    });
    expect(over.status).toBe(422);
    expect(
      (await attendant('POST', `/pdv/payments/${p1.body.payment.id}/void`, { reason: 'errou' }))
        .status,
    ).toBe(403);
    const v = await owner('POST', `/pdv/payments/${p1.body.payment.id}/void`, { reason: 'errou' });
    expect(v.status).toBe(200);
    expect(v.body.tab.remainingCents).toBe(2200);
    const off = await attendant('PATCH', `/pdv/tabs/${tab}`, { serviceFee: false });
    expect(off.body.tab.totalCents).toBe(2000);
    await attendant('PATCH', `/pdv/tabs/${tab}`, { serviceFee: true });
    const last = await attendant('POST', `/pdv/tabs/${tab}/payments`, {
      method: 'credit',
      amountCents: 2200,
    });
    expect(last.status).toBe(200);
    expect(last.body.tab).toMatchObject({ status: 'closed', remainingCents: 0, serviceCents: 200 });
    const round = last.body.tab.roundsList[0];
    expect(round.state).toBe('delivered');
    const [o] = await sql<{ status: string }[]>`
      select payment ->> 'status' as status from orders where id = ${round.orderId}`;
    expect(o!.status).toBe('paid');
    const closed = await attendant('POST', `/pdv/tabs/${tab}/payments`, {
      method: 'cash',
      amountCents: 100,
    });
    expect(closed.status).toBe(409);
    // the table is free again
    const next = await attendant('POST', '/pdv/tabs', { tableId: mesa1, customerName: 'Joana' });
    expect(next.status).toBe(201);
    const moved = await attendant('PATCH', `/pdv/tabs/${next.body.tab.id}`, { tableId: mesa2 });
    expect(moved.body.tab).toMatchObject({ tableId: mesa2, label: 'Mesa 2' });
    const state = await attendant('GET', '/pdv/state');
    expect(state.body.tabs.map((t: any) => t.label)).toEqual(['Mesa 2']);
    expect(
      (await attendant('POST', `/pdv/tabs/${next.body.tab.id}/cancel`, { reason: 'x' })).status,
    ).toBe(403);
    const cancel = await owner('POST', `/pdv/tabs/${next.body.tab.id}/cancel`, {
      reason: 'desistiu',
    });
    expect(cancel.body.tab.status).toBe('cancelled');
  });

  test('an order from the storefront is received at the counter', async () => {
    const cart = (
      await sql<{ id: string }[]>`
        insert into carts (tenant_id, session_hash) values (${tenantId}, ${`pdv-${nonce}`}) returning id`
    )[0]!.id;
    const id = (
      await sql<{ id: string }[]>`
      insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                          state, subtotal_cents, total_cents)
      values (${tenantId}, ${cart}, 9000, ${sql.json({ name: 'Bia', phone: '' })}, null,
              ${sql.json({ mode: 'pickup' })}, ${sql.json({ provider: 'sandbox', method: 'cash', status: 'pending', online: false })},
              'ready', 1500, 1500)
      returning id`
    )[0]!.id;
    const short = await attendant('POST', `/pdv/orders/${id}/payments`, {
      payments: [{ method: 'cash', amountCents: 1000 }],
    });
    expect(short.status).toBe(422);
    const r = await attendant('POST', `/pdv/orders/${id}/payments`, {
      payments: [{ method: 'cash', amountCents: 1500, tenderedCents: 2000 }],
    });
    expect(r.status).toBe(200);
    expect(r.body.changeCents).toBe(500);
    expect(r.body.order.payment).toMatchObject({ provider: 'pdv', method: 'cash', status: 'paid' });
    const again = await attendant('POST', `/pdv/orders/${id}/payments`, {
      payments: [{ method: 'cash', amountCents: 1500 }],
    });
    expect(again.status).toBe(409);
  });

  let comanda7 = '';
  test('a phone order for delivery: priced by the zone, paid at the door, received later', async () => {
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 500, 30, 50)
    `;
    const lines = [{ productId: coke, qty: 1 }];
    const address = {
      street: 'Rua das Flores',
      number: '120',
      neighborhood: 'centro',
      reference: 'portão azul',
    };
    const q = await attendant('POST', '/pdv/quote', { lines, delivery: address });
    expect(q.status).toBe(200);
    expect(q.body.quote).toMatchObject({
      subtotalCents: 600,
      deliveryFeeCents: 500,
      totalCents: 1100,
      delivery: { zoneName: 'Centro', etaMin: 30, etaMax: 50 },
    });
    const far = await attendant('POST', '/pdv/quote', {
      lines,
      delivery: { ...address, neighborhood: 'Longe' },
    });
    expect(far.status).toBe(422);
    expect(far.body.error.code).toBe('OUT_OF_ZONE');
    const typed = { ...address, neighborhood: 'Longe', feeCents: 800 };
    expect((await attendant('POST', '/pdv/quote', { lines, delivery: typed })).status).toBe(403);
    const byHand = await owner('POST', '/pdv/quote', { lines, delivery: typed });
    expect(byHand.body.quote).toMatchObject({ deliveryFeeCents: 800, totalCents: 1400 });
    const noPhone = await attendant('POST', '/pdv/sales', {
      lines,
      mode: 'delivery',
      delivery: address,
      customer: { name: 'Marta' },
      quotedTotalCents: 1100,
      payments: [],
      payLater: { method: 'cash' },
    });
    expect(noPhone.status).toBe(422);
    expect(noPhone.body.error.code).toBe('CUSTOMER_REQUIRED');
    const partly = await attendant('POST', '/pdv/sales', {
      lines,
      mode: 'delivery',
      delivery: address,
      customer: { name: 'Marta Lima', phone: '21988776655' },
      quotedTotalCents: 1100,
      payments: [{ method: 'pix', amountCents: 500 }],
      payLater: { method: 'cash' },
    });
    expect(partly.status).toBe(422);
    expect(partly.body.error.code).toBe('INVALID_PAYMENT');
    const r = await attendant('POST', '/pdv/sales', {
      lines,
      mode: 'delivery',
      delivery: address,
      customer: { name: 'Marta Lima', phone: '(21) 98877-6655' },
      quotedTotalCents: 1100,
      payments: [],
      payLater: { method: 'cash', changeForCents: 5000 },
    });
    expect(r.status).toBe(201);
    expect(r.body.order).toMatchObject({
      state: 'confirmed',
      totalCents: 1100,
      deliveryFeeCents: 500,
      delivery: {
        mode: 'delivery',
        zoneName: 'Centro',
        address: 'Rua das Flores, 120',
        feeCents: 500,
      },
      payment: { provider: 'pdv', method: 'cash', status: 'pending', changeForCents: 5000 },
    });
    expect(r.body.sale.payments).toEqual([]);
    // it can go out for delivery, and is received when the courier is back
    const id = r.body.order.id;
    for (const to of ['preparing', 'ready', 'out_for_delivery'])
      expect((await owner('POST', `/orders/${id}/transition`, { to })).status).toBe(200);
    const got = await attendant('POST', `/pdv/orders/${id}/payments`, {
      payments: [{ method: 'pix', amountCents: 1100 }],
    });
    expect(got.status).toBe(200);
    expect(got.body.order.payment).toMatchObject({ status: 'paid', method: 'pix' });
    // next time the phone brings the name and the address
    const back = await attendant('GET', '/pdv/customer?phone=21988776655');
    expect(back.body.customer).toMatchObject({
      name: 'Marta Lima',
      lastDelivery: {
        street: 'Rua das Flores',
        number: '120',
        neighborhood: 'centro',
        reference: 'portão azul',
      },
    });
    expect((await attendant('GET', '/pdv/customer?phone=21900000000')).body.customer).toBeNull();
    expect((await attendant('GET', '/pdv/customer?phone=12')).status).toBe(422);
  });

  test('no 500 on bad options, no second charge, no overpaid comanda', async () => {
    const bad = await attendant('POST', '/pdv/quote', {
      lines: [{ productId: burger, qty: 1, modifiers: [null] }],
    });
    expect(bad.status).toBe(422);
    // the caixa holds a PDV payment: Pedidos can't unmark it for a second charge
    const unmark = await owner('POST', `/orders/${saleOrder}/payment`, { status: 'pending' });
    expect(unmark.status).toBe(409);
    const open = await attendant('POST', '/pdv/tabs', { label: 'Comanda 7' });
    const id = open.body.tab.id;
    comanda7 = id;
    const r1 = await attendant('POST', `/pdv/tabs/${id}/rounds`, {
      lines: [{ productId: burger, qty: 1 }],
    });
    await attendant('POST', `/pdv/tabs/${id}/rounds`, { lines: [{ productId: burger, qty: 1 }] });
    const paid = await attendant('POST', `/pdv/tabs/${id}/payments`, {
      method: 'pix',
      amountCents: 1500,
    });
    expect(paid.body.tab.remainingCents).toBe(700);
    const discount = { kind: 'fixed', value: 1000, reason: 'cortesia' };
    expect((await owner('PATCH', `/pdv/tabs/${id}`, { discount })).status).toBe(422);
    await owner('POST', `/orders/${r1.body.orderId}/transition`, {
      to: 'cancelled',
      reason: 'lançou errado',
    });
    const close = await attendant('POST', `/pdv/tabs/${id}/close`);
    expect(close.status).toBe(409);
    expect(close.body.error.code).toBe('TAB_OVERPAID');
    // the difference goes back: void, then take what it owes (1000 + 10%)
    await owner('POST', `/pdv/payments/${paid.body.payment.id}/void`, { reason: 'devolveu' });
    const last = await attendant('POST', `/pdv/tabs/${id}/payments`, {
      method: 'cash',
      amountCents: 1100,
    });
    expect(last.body.tab).toMatchObject({ status: 'closed', serviceCents: 100 });
  });

  test('a cancelled counter sale takes its money out of the open caixa', async () => {
    // the drawer's expected count drops with it: a manager's call, like a refund
    expect(
      (
        await attendant('POST', `/orders/${saleOrder}/transition`, {
          to: 'cancelled',
          reason: 'cliente desistiu',
        })
      ).status,
    ).toBe(403);
    const r = await owner('POST', `/orders/${saleOrder}/transition`, {
      to: 'cancelled',
      reason: 'cliente desistiu',
    });
    expect(r.status).toBe(200);
    const [n] = await sql<{ n: number }[]>`
      select count(*)::int as n from pdv_payments where order_id = ${saleOrder} and voided_at is not null`;
    expect(n!.n).toBe(2);
  });

  test('the bill and the caixa print on the store printer; archived tables come back', async () => {
    expect((await attendant('POST', `/pdv/tabs/${comanda7}/print`, {})).status).toBe(409);
    const [device] = await sql<{ id: string }[]>`
      insert into print_devices (tenant_id, name, platform) values (${tenantId}, 'Balcão', 'windows')
      returning id`;
    const printer = async (key: string, name: string) =>
      (
        await sql<{ id: string }[]>`
          insert into printers (tenant_id, device_id, key, kind, name, address)
          values (${tenantId}, ${device!.id}, ${key}, 'spooler', ${name}, ${key}) returning id`
      )[0]!.id;
    const caixaPrinter = await printer('p1', 'Caixa');
    await printer('p2', 'Cozinha');
    const ask = await attendant('POST', `/pdv/tabs/${comanda7}/print`, { ways: 2 });
    expect(ask.status).toBe(422);
    expect(ask.body.error.code).toBe('PRINTER_REQUIRED');
    expect(ask.body.error.details.printers).toHaveLength(2);
    const bill = await attendant('POST', `/pdv/tabs/${comanda7}/print`, {
      printerId: caixaPrinter,
      ways: 2,
    });
    expect(bill.status).toBe(202);
    const state = await attendant('GET', '/pdv/state');
    expect(
      (
        await attendant('POST', `/pdv/caixa/${state.body.caixa.id}/print`, {
          printerId: caixaPrinter,
        })
      ).status,
    ).toBe(403);
    expect(
      (await owner('POST', `/pdv/caixa/${state.body.caixa.id}/print`, { printerId: caixaPrinter }))
        .status,
    ).toBe(202);
    const jobs = await claimDueJobsTx(sql as never, tenantId, device!.id);
    const text = jobs.map((j) => Buffer.from(j.data, 'base64').toString('latin1')).join('\n');
    expect(text).toContain('COMANDA 7');
    expect(text).toContain('Pessoa 2');
    expect(text).toContain('CAIXA PARCIAL');
    expect(text).toContain('documento fiscal');
    await sql`delete from print_devices where id = ${device!.id}`;

    // a table removed by mistake comes back; one whose name was taken since is refused
    const removed = await owner('DELETE', `/pdv/tables/${mesa2}`);
    expect(removed.body.archived.map((t: any) => t.id)).toContain(mesa2);
    const again = await owner('POST', '/pdv/tables', { labels: ['Mesa 2'] });
    const twin = again.body.tables.find((t: any) => t.label === 'Mesa 2').id;
    const taken = await owner('POST', `/pdv/tables/${mesa2}/restore`);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('TABLE_LABEL_TAKEN');
    expect((await attendant('POST', `/pdv/tables/${mesa2}/restore`)).status).toBe(403);
    await owner('DELETE', `/pdv/tables/${twin}`);
    const back = await owner('POST', `/pdv/tables/${mesa2}/restore`);
    expect(back.status).toBe(200);
    expect(back.body.tables.map((t: any) => t.id)).toContain(mesa2);
    expect(back.body.archived.map((t: any) => t.id)).not.toContain(mesa2);
  });

  test('ordering from the table QR: a placed order on the comanda, accepted by the staff', async () => {
    const shop = (method: string, path: string, body?: unknown, auth?: string) =>
      call(method, path, body, { host, ...(auth ? { authorization: `Bearer ${auth}` } : {}) });
    const tbls = await attendant('GET', '/pdv/tables');
    const qrUrl: string = tbls.body.tables.find((t: any) => t.id === mesa1).qrUrl;
    expect(qrUrl).toMatch(/\?mesa=vqr\./);
    const token = decodeURIComponent(qrUrl.split('?mesa=')[1]!);
    expect((await shop('GET', '/storefront/v1/table?t=vqr.nope')).status).toBe(404);
    const seen = await shop('GET', `/storefront/v1/table?t=${encodeURIComponent(token)}`);
    expect(seen.body.table).toEqual({ label: 'Mesa 1', ordering: true, reason: null });
    expect((await shop('GET', '/storefront/v1/store')).body.dineIn).toEqual({ enabled: true });

    const cart = async () => {
      const s = (await shop('POST', '/checkout/v1/session')).body.sessionToken as string;
      expect(
        (await shop('POST', '/checkout/v1/cart/items', { productId: burger, qty: 1 }, s)).status,
      ).toBe(200);
      return s;
    };
    const order = (s: string, extra: Record<string, unknown> = {}, t = token) =>
      shop(
        'POST',
        '/checkout/v1/checkout',
        {
          customer: { name: 'Lia' },
          delivery: { mode: 'dine_in', table: t },
          payment: { method: 'tab' },
          ...extra,
        },
        s,
      );
    const s1 = await cart();
    const view = await shop('POST', '/checkout/v1/cart/delivery', { mode: 'dine_in' }, s1);
    expect(view.body.cart?.totals ?? view.body.totals).toMatchObject({ deliveryFeeCents: 0 });
    // the cart preview with "pagar na mesa" chosen
    expect((await shop('GET', '/checkout/v1/cart?paymentMethod=tab', undefined, s1)).status).toBe(
      200,
    );
    expect((await order(s1, { payment: { method: 'pix' } })).status).toBe(422);
    const badPhone = await order(s1, { customer: { name: 'Lia', phone: '1' } });
    expect(badPhone.status).toBe(422);
    expect(badPhone.body.error.code).toBe('INVALID_CUSTOMER');
    const placed = await order(s1);
    expect(placed.status).toBe(201);
    expect(placed.body.customerToken).toBeNull();
    expect(placed.body.order).toMatchObject({
      state: 'placed',
      delivery: { mode: 'dine_in', table: 'Mesa 1' },
      payment: { provider: 'pdv', method: 'tab', status: 'pending' },
    });
    // a redemption is keyed by phone: a table order without one is told so, not a 500
    await sql`insert into coupons (tenant_id, code, kind, value) values (${tenantId}, 'MESA10', 'fixed', 100)`;
    const sc = await cart();
    expect((await shop('POST', '/checkout/v1/cart/coupon', { code: 'mesa10' }, sc)).status).toBe(
      200,
    );
    const noPhone = await order(sc);
    expect(noPhone.status).toBe(422);
    expect(noPhone.body.error).toMatchObject({
      code: 'INVALID_CUSTOMER',
      details: { field: 'customer.phone' },
    });
    const id = placed.body.order.id;
    const track = await shop('GET', `/checkout/v1/orders/${id}`, undefined, s1);
    expect(track.status).toBe(200);
    const [row] = await sql<{ source: string; tab_id: string }[]>`
      select source, tab_id from orders where id = ${id}`;
    expect(row!.source).toBe('table_qr');
    // the first QR order opened the table's comanda; it isn't owed until the staff accept it
    let tab = (await attendant('GET', `/pdv/tabs/${row!.tab_id}`)).body.tab;
    expect(tab).toMatchObject({ label: 'Mesa 1', tableId: mesa1, subtotalCents: 0 });
    expect(tab.roundsList[0]).toMatchObject({
      source: 'table_qr',
      paidOnline: false,
      state: 'placed',
    });
    expect((await attendant('POST', `/pdv/tabs/${tab.id}/close`)).body.error.code).toBe(
      'TAB_HAS_PENDING',
    );
    expect((await owner('POST', `/orders/${id}/transition`, { to: 'confirmed' })).status).toBe(200);
    tab = (await attendant('GET', `/pdv/tabs/${tab.id}`)).body.tab;
    expect(tab).toMatchObject({ subtotalCents: 1000, serviceCents: 100, totalCents: 1100 });

    // five waiting orders at once is the most a table gets
    const waiting: string[] = [];
    for (let i = 0; i < 5; i++) waiting.push((await order(await cart())).body.order.id);
    const sixth = await order(await cart());
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('TABLE_ORDERS_PENDING');
    for (const w of waiting)
      await owner('POST', `/orders/${w}/transition`, { to: 'cancelled', reason: 'trote' });

    // the store can switch it off, and a closed store takes no table orders
    await owner('PATCH', '/pdv/settings', { qrOrders: false });
    expect(
      (await shop('GET', `/storefront/v1/table?t=${encodeURIComponent(token)}`)).body.table,
    ).toMatchObject({
      ordering: false,
      reason: 'off',
    });
    expect((await order(await cart())).body.error.code).toBe('TABLE_ORDERS_OFF');
    expect((await owner('PATCH', '/pdv/settings', { qrOrders: true })).body).toEqual({
      serviceBps: 1000,
      qrOrders: true,
    });
    await sql`update store_settings set status_override = 'closed' where tenant_id = ${tenantId}`;
    expect((await order(await cart())).body.error.code).toBe('STORE_CLOSED');
    await sql`update store_settings set status_override = null where tenant_id = ${tenantId}`;

    // a new QR retires the printed one
    expect((await attendant('POST', `/pdv/tables/${mesa1}/qr`)).status).toBe(403);
    const fresh = await owner('POST', `/pdv/tables/${mesa1}/qr`);
    expect(fresh.body.table.qrUrl).not.toBe(qrUrl);
    expect((await shop('GET', `/storefront/v1/table?t=${encodeURIComponent(token)}`)).status).toBe(
      404,
    );
    expect((await order(await cart())).status).toBe(404);

    const paid = await attendant('POST', `/pdv/tabs/${tab.id}/payments`, {
      method: 'cash',
      amountCents: 1100,
    });
    expect(paid.body.tab.status).toBe('closed');
  });

  test('sangria and suprimento; attendants close blind; the report keeps the difference', async () => {
    // only who sees the expected count is refused: a 422 would let an attendant probe it
    expect(
      (
        await owner('POST', '/pdv/caixa/movements', {
          kind: 'sangria',
          amountCents: 1_000_000,
          reason: 'banco',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await attendant('POST', '/pdv/caixa/movements', {
          kind: 'sangria',
          amountCents: 500,
          reason: 'troco do motoboy',
        })
      ).status,
    ).toBe(200);
    await attendant('POST', '/pdv/caixa/movements', {
      kind: 'suprimento',
      amountCents: 200,
      reason: 'moedas',
    });
    const blind = await attendant('GET', '/pdv/caixa');
    expect(blind.body.caixa.expected).toBeNull();
    expect(blind.body.caixa.byMethod.cash).toEqual({ count: expect.any(Number), cents: null });
    const seen = await owner('GET', '/pdv/caixa');
    // float 100,00 + the storefront order's 15,00 + Comanda 7's 11,00 + Mesa 1's QR 11,00
    // − 5,00 + 2,00; the
    // cancelled sale's left
    expect(seen.body.caixa.expected).toEqual({
      cash: 13_400,
      pix: 1100,
      credit: 2200,
      debit: 600,
      voucher: 0,
    });
    expect(seen.body.caixa.serviceCents).toBe(400);
    const close = await attendant('POST', '/pdv/caixa/close', {
      counted: { cash: 13_200, pix: 1100, credit: 2200, debit: 600 },
      notes: 'faltou troco',
    });
    expect(close.status).toBe(200);
    expect(close.body.report.differences).toEqual({
      cash: -200,
      pix: 0,
      credit: 0,
      debit: 0,
      voucher: 0,
    });
    const hist = await owner('GET', '/pdv/caixa/history');
    expect(hist.body.sessions[0]).toMatchObject({ differenceCents: -200, closedBy: 'Caio' });
    const one = await owner('GET', `/pdv/caixa/${close.body.report.id}`);
    expect(one.body.report.counted.cash).toBe(13_200);
    expect((await attendant('GET', '/pdv/caixa')).body.caixa).toBeNull();
  });

  test('a refunded counter sale leaves the drawer, even when its caixa was already counted', async () => {
    expect((await owner('POST', '/pdv/caixa/open', { openingCents: 5000 })).status).toBe(201);
    const cashSale = async () => {
      const r = await attendant('POST', '/pdv/sales', {
        lines: [{ productId: coke, qty: 1 }],
        mode: 'here',
        quotedTotalCents: 600,
        payments: [{ method: 'cash', amountCents: 600 }],
        serveNow: true,
      });
      expect(r.body.order.state).toBe('delivered');
      return r.body.order.id as string;
    };
    const same = await cashSale();
    expect((await owner('POST', `/orders/${same}/refund`, { reason: 'devolveu' })).status).toBe(
      200,
    );
    const [v] = await sql<{ n: number }[]>`
      select count(*)::int as n from pdv_payments where order_id = ${same} and voided_at is not null`;
    expect(v!.n).toBe(1);

    const earlier = await cashSale();
    expect(
      (
        await owner('POST', '/pdv/caixa/close', {
          counted: { cash: 5600, pix: 0, credit: 0, debit: 0 },
        })
      ).status,
    ).toBe(200);
    const next = await owner('POST', '/pdv/caixa/open', { openingCents: 1000 });
    expect((await owner('POST', `/orders/${earlier}/refund`, { reason: 'devolveu' })).status).toBe(
      200,
    );
    const moves = await sql<{ kind: string; amount_cents: number; session_id: string }[]>`
      select kind, amount_cents, session_id from cash_movements where tenant_id = ${tenantId}
        and reason like '%' || ${'pedido'} || '%' order by at desc limit 1`;
    expect(moves[0]).toMatchObject({
      kind: 'sangria',
      amount_cents: 600,
      session_id: next.body.caixa.id,
    });
  });

  test('bad and foreign ids answer 4xx', async () => {
    expect((await attendant('GET', `/pdv/tabs/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await attendant('GET', '/pdv/tabs/nope')).status).toBeLessThan(500);
    expect((await attendant('GET', `/pdv/caixa/${crypto.randomUUID()}`)).status).toBe(404);
    const pix = await attendant('POST', '/pdv/pix', { amountCents: 1234 });
    expect(pix.body.copyPaste).toContain('br.gov.bcb.pix');
  });
});
