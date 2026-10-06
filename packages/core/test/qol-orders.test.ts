import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { sweepAdmin } from '../src/admin/workers.ts';
import { createApp } from '../src/app.ts';
import { migrate, withTenant } from '../src/platform/db.ts';
import { syncOrderPayment } from '../src/modules/payments/store-payments.ts';
import { renderOrderMessage, type OrderFacts } from '../src/store-whatsapp/messages.ts';

// Handling orders day to day: "atrasou", the refund message, Histórico's filters, the order's
// tickets and "muitos pedidos agora" that ends by itself.

const facts: OrderFacts = {
  storeName: 'Doce Lar',
  firstName: 'Ana',
  number: 42,
  mode: 'delivery',
  totalCents: 5890,
  promisedFrom: '2026-10-02T22:40:00.000Z',
  promisedTo: '2026-10-02T22:55:00.000Z',
  scheduledFor: null,
  timezone: 'America/Sao_Paulo',
};

describe('order messages: atrasou and estorno', () => {
  test('a delay names the new time, the way the acceptance did', () => {
    expect(renderOrderMessage('delayed', facts)).toBe(
      'Seu pedido #42 vai atrasar um pouquinho, desculpe 🙏 Agora chega entre 19:40 e 19:55.',
    );
    expect(renderOrderMessage('delayed', { ...facts, mode: 'pickup' })).toContain(
      'Agora fica pronto por volta das 19:55.',
    );
    expect(renderOrderMessage('delayed', { ...facts, promisedFrom: facts.promisedTo })).toContain(
      'chega por volta das 19:55',
    );
    // an encomenda has a day, not a time: nothing to say
    expect(renderOrderMessage('delayed', { ...facts, scheduledFor: '2026-10-12' })).toBeNull();
    // the acceptance reads as before
    expect(renderOrderMessage('confirmed', facts)).toBe(
      'Seu pedido #42 foi aceito pela Doce Lar ✓ Chega entre 19:40 e 19:55.',
    );
  });

  test('a refund says how much, in reais, and how it comes back', () => {
    const full = renderOrderMessage('refunded', {
      ...facts,
      refund: { cents: 5890, full: true, online: true },
    })!;
    expect(full).toContain('o valor do seu pedido #42 (R$');
    expect(full).toContain('58,90');
    expect(full).toContain('mesma forma de pagamento');
    const part = renderOrderMessage('refunded', {
      ...facts,
      refund: { cents: 1250, full: false, online: true },
    })!;
    expect(part).toMatch(/^Devolvemos R\$\s12,50 do seu pedido #42 ✓/);
    const byStore = renderOrderMessage('refunded', {
      ...facts,
      refund: { cents: 5890, full: true, online: false },
    })!;
    expect(byStore).toContain('A Doce Lar devolveu o valor do seu pedido #42');
    expect(byStore).not.toContain('forma de pagamento');
    expect(renderOrderMessage('refunded', facts)).toBeNull();
    expect(
      renderOrderMessage('refunded', { ...facts, refund: { cents: 0, full: true, online: true } }),
    ).toBeNull();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('orders qol (db)', () => {
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
  const slug = `qo-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `219${String(Date.now()).slice(-8)}`;
  const otherPhone = `219${String(Date.now() + 7).slice(-8)}`;
  let tenantId = '';
  let tenant2 = '';
  let productId = '';
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
    expect((await call('POST', '/admin/v1/auth/otp/start', { phone })).status).toBe(200);
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    const value = /vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}`, ...h });
  };

  const placeOrder = async (payment = 'pix') => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    expect(
      (await call('POST', '/checkout/v1/cart/items', { productId, qty: 2 }, auth)).status,
    ).toBe(200);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
        delivery: { mode: 'pickup' },
        payment: { method: payment },
      },
      auth,
    );
    expect(placed.status).toBe(201);
    return placed.body.order as { id: string; number: number; totalCents: number };
  };

  const messages = (orderId: string) =>
    sql<{ event: string; body: string }[]>`
      select event, body from store_wa_messages where order_id = ${orderId} order by created_at, event`;

  let owner: Awaited<ReturnType<typeof signIn>>;
  let other: Awaited<ReturnType<typeof signIn>>;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const mk = async (s: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id`
      )[0]!.id;
    tenantId = await mk(slug);
    tenant2 = await mk(`${slug}-b`);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenant2}, 'Outra Dona', ${otherPhone}, 'owner')`;
    // the store's own WhatsApp is linked: order messages queue (the gateway isn't running here)
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${tenantId}, true, 'open')`;
    owner = await signIn(ownerPhone);
    other = await signIn(otherPhone);
    const catId = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    const p = await owner('POST', '/products', {
      name: 'Pudim de Leite',
      categoryId: catId,
      priceCents: 1250,
    });
    expect(p.status).toBe(201);
    productId = p.body.product.id;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id in (${tenantId}, ${tenant2})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('a new store sends both new messages; old stores got them turned on', async () => {
    const wa = await owner('GET', '/whatsapp');
    expect(wa.body.events.delayed).toBe(true);
    expect(wa.body.events.refunded).toBe(true);
    expect(wa.body.previews.delayed).toContain('vai atrasar');
    expect(wa.body.previews.refunded).toContain('Devolvemos');
  });

  test('atrasou: the promise moves, the shopper is told once per delay, inputs are bounded', async () => {
    const o = await placeOrder();
    // not accepted yet: nothing was promised by the store
    const early = await owner('POST', `/orders/${o.id}/delay`, { minutes: 10 });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ORDER_NOT_DELAYABLE');
    const acc = await owner('POST', `/orders/${o.id}/transition`, {
      to: 'confirmed',
      prepMinutes: 20,
    });
    expect(acc.status).toBe(200);
    const promised = Date.parse(acc.body.order.delivery.promisedTo);
    const version = acc.body.order.version;

    for (const minutes of [0, 4, 121, 'dez', null])
      expect((await owner('POST', `/orders/${o.id}/delay`, { minutes })).status).toBe(422);
    expect((await owner('POST', '/orders/nope/delay', { minutes: 10 })).status).toBe(400);
    expect(
      (await owner('POST', `/orders/${crypto.randomUUID()}/delay`, { minutes: 10 })).status,
    ).toBe(404);
    // another store's order is not there
    expect((await other('POST', `/orders/${o.id}/delay`, { minutes: 10 })).status).toBe(404);

    const key = { 'idempotency-key': `${nonce}-delay-1` };
    const d1 = await owner('POST', `/orders/${o.id}/delay`, { minutes: 10 }, key);
    expect(d1.status).toBe(200);
    const to1 = Date.parse(d1.body.order.delivery.promisedTo);
    expect(to1 - promised).toBe(10 * 60_000);
    expect(d1.body.order.delivery.promisedFrom).toBe(d1.body.order.delivery.promisedTo);
    expect(d1.body.order.delivery.delayMinutes).toBe(10);
    expect(d1.body.notified).toBe(true);
    // the live cursor moved: the shopper's order page re-reads
    expect(d1.body.order.version).toBeGreaterThan(version);
    // a replay is the same answer, not a second delay
    const again = await owner('POST', `/orders/${o.id}/delay`, { minutes: 10 }, key);
    expect(again.body.order.delivery.promisedTo).toBe(d1.body.order.delivery.promisedTo);

    const d2 = await owner('POST', `/orders/${o.id}/delay`, { minutes: 20 });
    expect(Date.parse(d2.body.order.delivery.promisedTo) - to1).toBe(20 * 60_000);
    expect(d2.body.order.delivery.delayMinutes).toBe(30);

    const sent = (await messages(o.id)).filter((m) => m.event.startsWith('delayed'));
    expect(sent.map((m) => m.event)).toEqual([`delayed:${to1}`, `delayed:${to1 + 20 * 60_000}`]);
    expect(sent[0]!.body).toContain(`Seu pedido #${o.number} vai atrasar`);
    expect(sent[0]!.body).toContain('fica pronto por volta das');

    // the store turned this message off: the promise still moves, nobody is texted
    expect(
      (await owner('PATCH', '/whatsapp/settings', { events: { delayed: false } })).status,
    ).toBe(200);
    const d3 = await owner('POST', `/orders/${o.id}/delay`, { minutes: 5 });
    expect(d3.status).toBe(200);
    expect(d3.body.notified).toBe(false);
    expect((await messages(o.id)).filter((m) => m.event.startsWith('delayed')).length).toBe(2);
    await owner('PATCH', '/whatsapp/settings', { events: { delayed: true } });

    // the admin's recent list names the step, not its occurrence
    const recent = (await owner('GET', '/whatsapp')).body.recent as { event: string }[];
    expect(recent.some((r) => r.event === 'delayed')).toBe(true);
    expect(recent.every((r) => !String(r.event).includes(':'))).toBe(true);

    // finished: no promise left to move
    for (const to of ['preparing', 'ready', 'delivered'])
      expect((await owner('POST', `/orders/${o.id}/transition`, { to })).status).toBe(200);
    expect((await owner('POST', `/orders/${o.id}/delay`, { minutes: 10 })).status).toBe(409);
  });

  test('atrasou: an encomenda has no time to move', async () => {
    const o = await placeOrder();
    await owner('POST', `/orders/${o.id}/transition`, { to: 'confirmed', prepMinutes: 20 });
    await sql`update orders set scheduled_for = current_date + 3 where id = ${o.id}`;
    const r = await owner('POST', `/orders/${o.id}/delay`, { minutes: 10 });
    expect(r.status).toBe(409);
  });

  test('estorno the store made itself: the shopper hears the whole amount', async () => {
    const o = await placeOrder();
    for (const to of ['confirmed', 'preparing', 'ready', 'delivered'])
      expect((await owner('POST', `/orders/${o.id}/transition`, { to })).status).toBe(200);
    const r = await owner('POST', `/orders/${o.id}/refund`, { reason: 'Produto com problema' });
    expect(r.status).toBe(200);
    expect(r.body.order.state).toBe('refunded');
    const m = (await messages(o.id)).filter((x) => x.event.startsWith('refunded'));
    expect(m.map((x) => x.event)).toEqual([`refunded:${o.totalCents}`]);
    expect(m[0]!.body).toContain(`devolveu o valor do seu pedido #${o.number}`);
    expect(m[0]!.body).toContain('25,00');
  });

  test('estorno online: each approved refund is told once, partial ones by their amount', async () => {
    const o = await placeOrder();
    await sql`update orders set payment = payment || ${sql.json({ online: true, provider: 'fake' })} where id = ${o.id}`;
    const [pay] = await sql<{ id: string }[]>`
      insert into payments (tenant_id, order_id, provider, provider_payment_id, kind, status, amount_cents, approved_at)
      values (${tenantId}, ${o.id}, 'fake', ${`qo-${nonce}-1`}, 'pix', 'approved', ${o.totalCents}, now())
      returning id`;
    const sync = () => withTenant(appSql, tenantId, (tx) => syncOrderPayment(tx, tenantId, o.id));
    await sync();
    expect((await messages(o.id)).map((x) => x.event)).toContain('paid');

    await sql`update payments set refunded_cents = 1000, status = 'partially_refunded' where id = ${pay!.id}`;
    await sync();
    await sync();
    await sql`update payments set refunded_cents = ${o.totalCents}, status = 'refunded' where id = ${pay!.id}`;
    await sync();
    const refunds = (await messages(o.id)).filter((x) => x.event.startsWith('refunded'));
    expect(refunds.map((x) => x.event)).toEqual(['refunded:1000', `refunded:${o.totalCents}`]);
    expect(refunds[0]!.body).toMatch(/^Devolvemos R\$\s10,00 do seu pedido/);
    // the rest, not "the order's value": part of it went back already
    expect(refunds[1]!.body).toMatch(/^Devolvemos R\$\s15,00 do seu pedido/);
    expect(refunds[1]!.body).toContain('mesma forma de pagamento');
  });

  test('Histórico filters by payment method, delivery mode and unpaid; bad values are a 400', async () => {
    const cash = await placeOrder();
    const card = await placeOrder();
    await sql`update orders set payment = payment || ${sql.json({ method: 'cash', status: 'pending' })} where id = ${cash.id}`;
    await sql`update orders set payment = payment || ${sql.json({ method: 'card_on_delivery', status: 'paid' })},
                                delivery = delivery || ${sql.json({ mode: 'delivery' })} where id = ${card.id}`;
    const ids = async (q: string) =>
      ((await owner('GET', `/orders?limit=100&${q}`)).body.orders as { id: string }[]).map(
        (x) => x.id,
      );
    const byCash = await ids('method=cash');
    expect(byCash).toContain(cash.id);
    expect(byCash).not.toContain(card.id);
    const delivery = await ids('mode=delivery');
    expect(delivery).toEqual([card.id]);
    const pickup = await ids('mode=pickup');
    expect(pickup).toContain(cash.id);
    expect(pickup).not.toContain(card.id);
    const unpaid = await ids('unpaid=1');
    expect(unpaid).toContain(cash.id);
    expect(unpaid).not.toContain(card.id);
    expect(await ids('unpaid=1&method=card_on_delivery')).toEqual([]);
    expect(await ids('unpaid=0&mode=delivery')).toEqual([card.id]);
    await sql`update orders set scheduled_for = current_date + 2 where id = ${cash.id}`;
    const scheduled = await ids('mode=scheduled');
    expect(scheduled).toContain(cash.id);
    expect(scheduled).not.toContain(card.id);
    for (const q of ['method=bitcoin', 'mode=drone', 'unpaid=talvez'])
      expect((await owner('GET', `/orders?${q}`)).status).toBe(400);
  });

  test('an order’s tickets: printed where and when, or why not — and Início hears of a failure', async () => {
    const o = await placeOrder();
    await owner('POST', `/orders/${o.id}/transition`, { to: 'confirmed', prepMinutes: 20 });
    const [dev] = await sql<{ id: string }[]>`
      insert into print_devices (tenant_id, name, platform) values (${tenantId}, 'Caixa', 'windows')
      returning id`;
    const [cozinha] = await sql<{ id: string }[]>`
      insert into printers (tenant_id, device_id, key, kind, name, address, source, label)
      values (${tenantId}, ${dev!.id}, 'spooler:K', 'spooler', 'EPSON', 'EPSON', 'agent', 'Cozinha')
      returning id`;
    await sql`
      insert into print_jobs (tenant_id, printer_id, device_id, order_id, kind, trigger, status, error, finished_at, created_at)
      values (${tenantId}, ${cozinha!.id}, ${dev!.id}, ${o.id}, 'order', 'confirmed', 'failed',
              'Sem papel', now() - interval '1 minute', now() - interval '2 minutes')`;
    const r = await owner('GET', `/orders/${o.id}/prints`);
    expect(r.status).toBe(200);
    expect(r.body.jobs).toHaveLength(1);
    expect(r.body.jobs[0]).toMatchObject({
      status: 'failed',
      printer: 'Cozinha',
      device: 'Caixa',
      deviceOnline: false,
      error: 'Sem papel',
      printerId: cozinha!.id,
    });
    expect((await owner('GET', '/orders/nope/prints')).status).toBe(400);
    expect((await owner('GET', `/orders/${crypto.randomUUID()}/prints`)).status).toBe(404);
    expect((await other('GET', `/orders/${o.id}/prints`)).status).toBe(404);

    const failing = (await owner('GET', '/home')).body.attention.find(
      (a: { kind: string }) => a.kind === 'print_failed',
    );
    expect(failing).toMatchObject({
      title: `A comanda do pedido #${o.number} não imprimiu`,
      detail: 'Cozinha: Sem papel',
      href: `/pedidos/${o.id}`,
    });

    // printed again, anywhere: Início lets it go
    await sql`
      insert into print_jobs (tenant_id, printer_id, device_id, order_id, kind, trigger, status, finished_at)
      values (${tenantId}, ${cozinha!.id}, ${dev!.id}, ${o.id}, 'order', 'manual', 'done', now())`;
    const after = (await owner('GET', '/home')).body.attention as { kind: string }[];
    expect(after.some((a) => a.kind === 'print_failed')).toBe(false);
    const jobs = (await owner('GET', `/orders/${o.id}/prints`)).body.jobs;
    expect(jobs.map((j: { status: string }) => j.status)).toEqual(['done', 'failed']);
  });

  test('muitos pedidos agora: chosen length, a default when none, and it always ends', async () => {
    expect((await owner('POST', '/store/demand', { for: 'sempre' })).status).toBe(422);
    const on = await owner('POST', '/store/demand', { for: '1h' });
    expect(on.status).toBe(200);
    expect(on.body.operations.demand).toBe('high');
    const until = Date.parse(on.body.operations.demandUntil);
    expect(Math.abs(until - Date.now() - 60 * 60_000)).toBeLessThan(60_000);
    expect((await owner('GET', '/home')).body.demand).toEqual({
      level: 'high',
      until: on.body.operations.demandUntil,
    });

    // the time is up: it reads as over at once, and the sweep puts the store back to normal
    await sql`update store_settings set demand_until = now() - interval '1 second' where tenant_id = ${tenantId}`;
    expect((await owner('GET', '/store')).body.operations.demand).toBe('normal');
    await sweepAdmin(appSql);
    const [row] = await sql<{ demand_level: string; demand_until: Date | null }[]>`
      select demand_level, demand_until from store_settings where tenant_id = ${tenantId}`;
    expect(row).toEqual({ demand_level: 'normal', demand_until: null });

    // Loja's switch has no length: Core gives it two hours, and a running one keeps its end
    const sw = await owner('PATCH', '/store', { operations: { demand: 'high' } });
    expect(sw.status).toBe(200);
    const swUntil = Date.parse(sw.body.operations.demandUntil);
    expect(Math.abs(swUntil - Date.now() - 120 * 60_000)).toBeLessThan(60_000);
    const again = await owner('PATCH', '/store', { operations: { demand: 'high' } });
    expect(again.body.operations.demandUntil).toBe(sw.body.operations.demandUntil);
    const off = await owner('POST', '/store/demand', { for: 'off' });
    expect(off.body.operations).toMatchObject({ demand: 'normal', demandUntil: null });

    // turned on elsewhere with no end (the CRM's ops): the sweep starts the default clock
    await sql`update store_settings set demand_level = 'high', demand_until = null where tenant_id = ${tenantId}`;
    await sweepAdmin(appSql);
    const [later] = await sql<{ demand_level: string; demand_until: Date | null }[]>`
      select demand_level, demand_until from store_settings where tenant_id = ${tenantId}`;
    expect(later!.demand_level).toBe('high');
    expect(Math.abs(later!.demand_until!.getTime() - Date.now() - 120 * 60_000)).toBeLessThan(
      60_000,
    );
  });
});
