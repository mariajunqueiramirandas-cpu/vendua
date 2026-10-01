import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

// ADR 0023 for orders and store payments: each staff event is written in the same transaction as
// the change (a checkout, a transition, a webhook, the MP connection), once per logical event.
// With TEST_APP_DATABASE_URL the API runs as vendua_app, so a wrong RLS context loses the row.
describe.skipIf(!process.env.TEST_DATABASE_URL)('staff events: commerce (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => void codes.set(phone, /(\d{6})/.exec(text)![1]!),
    paymentProvider: fake,
    notify: { whatsapp: async () => {}, email: async () => {} },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `se-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `228${String(Date.now()).slice(-8)}`;
  const STORE = 'Doces Eventos';
  let tenantId = '';
  let productId = '';
  let idem = 0;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const h = headers.host ?? 'core.localhost';
    const res = await app.request(`http://${h}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        host: h,
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined
        ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
        : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      headers: res.headers,
    };
  };
  let owner: (
    m: string,
    p: string,
    b?: unknown,
    h?: Record<string, string>,
  ) => ReturnType<typeof call>;

  const shopper = async () => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    expect(s.status).toBe(201);
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    expect(
      (await call('POST', '/checkout/v1/cart/items', { productId, qty: 2 }, auth)).status,
    ).toBe(200);
    return auth;
  };
  const checkoutBody = (method: string) => ({
    customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
    delivery: { mode: 'pickup' },
    payment: { method },
  });
  const place = async (method: string) => {
    const auth = await shopper();
    const r = await call('POST', '/checkout/v1/checkout', checkoutBody(method), auth);
    expect(r.status).toBe(201);
    return { ...r, auth };
  };
  const hook = (id: string) => {
    const w = fake.webhook('payment', id);
    return call(
      'POST',
      `/admin/v1/hooks/mercadopago?t=${tenantId}&data.id=${id}&type=payment`,
      w.body,
      { ...w.headers, 'x-vendua-admin': '' },
    );
  };
  const connect = async () => {
    const c = await owner('POST', '/payments/mercadopago/connect');
    expect(c.status).toBe(200);
    const u = new URL(c.body.url);
    const cb = await owner('GET', `${u.pathname.replace('/admin/v1', '')}${u.search}`);
    expect(cb.headers.get('location')).toBe('/admin/pagamentos?mp=connected');
  };
  /** an online Pix order, paid through the webhook */
  const paidOnline = async () => {
    const o = await place('pix');
    expect(o.body.order.payment.online).toBe(true);
    expect(
      (await call('POST', `/checkout/v1/orders/${o.body.order.id}/pay`, undefined, o.auth)).status,
    ).toBe(200);
    const row = (
      await sql<{ id: string; provider_payment_id: string }[]>`
        select id, provider_payment_id from payments where order_id = ${o.body.order.id}
        order by attempt desc limit 1
      `
    )[0]!;
    fake.settle(row.provider_payment_id, 'approved');
    expect((await hook(row.provider_payment_id)).status).toBe(200);
    return {
      id: o.body.order.id as string,
      number: o.body.order.number as number,
      totalCents: o.body.order.totalCents as number,
      providerId: row.provider_payment_id,
      paymentId: row.id,
    };
  };

  type Ev = {
    kind: string;
    tenant_id: string | null;
    severity: string;
    anchor: string | null;
    dedupe_key: string | null;
    data: any;
  };
  const events = (kind: string) => sql<Ev[]>`
    select kind, tenant_id, severity, anchor, dedupe_key, data from staff_events
    where tenant_id = ${tenantId} and kind = ${kind} order by id
  `;
  const ofOrder = (kind: string, orderId: string) => sql<Ev[]>`
    select kind, tenant_id, severity, anchor, dedupe_key, data from staff_events
    where tenant_id = ${tenantId} and kind = ${kind} and data ->> 'orderId' = ${orderId}
    order by id
  `;
  const steps = async (orderId: string) =>
    (await ofOrder('order.updated', orderId)).map((e) => `${e.data.to}:${e.data.actor}`);
  // other areas tick other steps (the owner's first login, …)
  const onboarding = async (step: string) =>
    (await events('store.onboarding')).filter((e) => e.data.step === step);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${STORE}) returning id
      `
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city,
                                  pix_key, pix_key_type, pix_beneficiary, pix_city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema', 'loja@exemplo.com', 'email', 'Doces Eventos', 'Saquarema')
    `;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id
      `
    )[0]!.id;
    productId = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${cat}, 'pudim', 'Pudim', 2295) returning id
      `
    )[0]!.id;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner')`;
    await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const v = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(v.headers.get('set-cookie') ?? '')![1]}`;
    owner = (m, p, b, h = {}) => call(m, `/admin/v1${p}`, b, { cookie, ...h });
  });

  afterAll(async () => {
    // staff_events cascade with the tenant
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('checkout: one order.placed per order (a replay adds none), the first order announced once', async () => {
    const auth = await shopper();
    const key = `${nonce}-checkout-once`;
    const first = await call('POST', '/checkout/v1/checkout', checkoutBody('cash'), {
      ...auth,
      'idempotency-key': key,
    });
    expect(first.status).toBe(201);
    const replay = await call('POST', '/checkout/v1/checkout', checkoutBody('cash'), {
      ...auth,
      'idempotency-key': key,
    });
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');
    const order = first.body.order;

    const placed = await events('order.placed');
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({
      tenant_id: tenantId,
      severity: 'info',
      anchor: `order:${order.id}`,
    });
    expect(placed[0]!.data).toEqual({
      orderId: order.id,
      number: 1,
      storeName: STORE,
      totalCents: order.totalCents,
      method: 'cash',
      fulfillment: 'pickup',
      items: 2,
      scheduledFor: null,
    });
    const firstOrder = await events('store.first_order');
    expect(firstOrder).toHaveLength(1);
    expect(firstOrder[0]).toMatchObject({
      tenant_id: tenantId,
      severity: 'success',
      dedupe_key: `first_order:${tenantId}`,
      data: {
        orderId: order.id,
        number: 1,
        storeName: STORE,
        totalCents: order.totalCents,
        method: 'cash',
      },
    });
    const step = await onboarding('first_order');
    expect(step).toHaveLength(1);
    expect(step[0]).toMatchObject({
      tenant_id: tenantId,
      anchor: `onboarding:${tenantId}`,
      dedupe_key: `onboarding:${tenantId}:first_order`,
    });

    // the next order gets its own card, and no second "first order"
    const second = await place('pix');
    expect(second.body.order.payment.online).toBe(false);
    const all = await events('order.placed');
    expect(all.map((e) => e.data.orderId)).toEqual([order.id, second.body.order.id]);
    expect(all[1]!.data).toMatchObject({ number: 2, method: 'pix', items: 2 });
    expect(await events('store.first_order')).toHaveLength(1);
    expect(await onboarding('first_order')).toHaveLength(1);

    // never the shopper
    const text = JSON.stringify(
      await sql`select data from staff_events where tenant_id = ${tenantId}`,
    );
    expect(text).not.toContain('Joana');
    expect(text).not.toContain('98888');
  });

  test('order.updated: delivered, cancelled and refunded with their actor — never the kitchen steps', async () => {
    const a = await place('cash');
    for (const to of ['confirmed', 'preparing', 'ready', 'delivered'])
      expect((await owner('POST', `/orders/${a.body.order.id}/transition`, { to })).status).toBe(
        200,
      );
    const refund = await owner('POST', `/orders/${a.body.order.id}/refund`, { reason: 'errado' });
    expect(refund.status).toBe(200);
    expect(refund.body.order.state).toBe('refunded');
    expect(await steps(a.body.order.id)).toEqual(['delivered:merchant', 'refunded:merchant']);

    const b = await place('cash');
    const c = await owner('POST', `/orders/${b.body.order.id}/transition`, {
      to: 'cancelled',
      reason: 'acabou o pudim',
    });
    expect(c.status).toBe(200);
    const cancelled = await ofOrder('order.updated', b.body.order.id);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      tenant_id: tenantId,
      severity: 'warning',
      anchor: `order:${b.body.order.id}`,
      dedupe_key: `order:${b.body.order.id}:cancelled`,
      data: {
        orderId: b.body.order.id,
        number: b.body.order.number,
        storeName: STORE,
        to: 'cancelled',
        actor: 'merchant',
      },
    });

    // the staff console: a control tx with the store's GUC
    const s = await place('cash');
    const staff = await call(
      'POST',
      `/control/v1/storefronts/${slug}/commerce/orders/${s.body.order.id}/transition`,
      { to: 'cancelled', note: 'pedido de teste' },
      { 'x-vendua-control': 'ctl' },
    );
    expect(staff.status).toBe(200);
    expect(await steps(s.body.order.id)).toEqual(['cancelled:staff']);
  });

  test('offline "mark paid": order.updated paid once, through unmark and mark again', async () => {
    const o = await place('cash');
    const id = o.body.order.id;
    for (const status of ['paid', 'pending', 'paid'])
      expect((await owner('POST', `/orders/${id}/payment`, { status })).status).toBe(200);
    const paid = await ofOrder('order.updated', id);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      severity: 'info',
      anchor: `order:${id}`,
      dedupe_key: `order:${id}:paid`,
      data: { number: o.body.order.number, storeName: STORE, to: 'paid', actor: 'merchant' },
    });
  });

  test('Mercado Pago connected: payments.connection + the onboarding step; an online Pix paid once', async () => {
    await connect();
    const conn = await events('payments.connection');
    expect(conn).toHaveLength(1);
    expect(conn[0]).toMatchObject({
      tenant_id: tenantId,
      severity: 'success',
      anchor: null,
      data: { storeName: STORE, connected: true, detail: 'modo de teste' },
    });
    const step = await onboarding('payments');
    expect(step).toHaveLength(1);
    expect(step[0]).toMatchObject({
      tenant_id: tenantId,
      anchor: `onboarding:${tenantId}`,
      dedupe_key: `onboarding:${tenantId}:payments`,
    });

    const o = await paidOnline();
    // MP retries its webhook: nothing new
    expect((await hook(o.providerId)).status).toBe(200);
    const paid = await ofOrder('order.updated', o.id);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({
      dedupe_key: `order:${o.id}:paid`,
      data: { orderId: o.id, number: o.number, storeName: STORE, to: 'paid', actor: 'fake' },
    });
    expect(await ofOrder('payment.problem', o.id)).toHaveLength(0);
  });

  test('payment.problem: mediation, chargeback and a refund made at the provider — not our refunds nor a declined card', async () => {
    const a = await paidOnline();
    fake.settle(a.providerId, 'in_mediation');
    await hook(a.providerId);
    fake.settle(a.providerId, 'charged_back');
    await hook(a.providerId);
    await hook(a.providerId);
    const pa = await ofOrder('payment.problem', a.id);
    expect(pa.map((e) => `${e.data.status}:${e.severity}`)).toEqual([
      'in_mediation:warning',
      'charged_back:critical',
    ]);
    expect(pa[1]).toMatchObject({
      tenant_id: tenantId,
      anchor: null,
      dedupe_key: `payment:${a.paymentId}:charged_back`,
      data: { orderId: a.id, number: a.number, storeName: STORE, amountCents: a.totalCents },
    });

    // the store refunded in Mercado Pago's own app
    const b = await paidOnline();
    const fp = fake.payments.get(b.providerId)!;
    fp.refundedCents = fp.amountCents;
    fake.settle(b.providerId, 'refunded');
    await hook(b.providerId);
    expect((await ofOrder('payment.problem', b.id)).map((e) => e.data.status)).toEqual([
      'refunded',
    ]);

    // refunds asked for through us: recorded at once, or confirmed later by the webhook
    const c = await paidOnline();
    const r = await owner('POST', `/orders/${c.id}/refund`, { reason: 'cliente desistiu' });
    expect(r.body.order.payment.status).toBe('refunded');
    await hook(c.providerId);
    expect(await ofOrder('payment.problem', c.id)).toHaveLength(0);
    const d = await paidOnline();
    await fake.refund(fake.payments.get(d.providerId)!.token, d.providerId, null, `${nonce}-late`);
    await sql`
      insert into payment_refunds (tenant_id, payment_id, amount_cents, status, request_key)
      values (${tenantId}, ${d.paymentId}, ${d.totalCents}, 'pending', ${`${nonce}-late`})
    `;
    await hook(d.providerId);
    const settled = (await sql`select status from payments where id = ${d.paymentId}`)[0]!;
    expect(settled.status).toBe('refunded');
    expect(await ofOrder('payment.problem', d.id)).toHaveLength(0);

    // a declined card is the shopper's to retry
    expect(
      (await owner('PATCH', '/payments', { methods: ['pix', 'card_online', 'cash'] })).status,
    ).toBe(200);
    const e = await place('card_online');
    const p = await call('POST', `/checkout/v1/orders/${e.body.order.id}/pay`, undefined, e.auth);
    const pref = new URL(p.body.next.url).searchParams.get('fake_checkout')!;
    await call('POST', `/admin/v1/dev/mp/checkouts/${pref}/complete`, { status: 'rejected' });
    const failed = await call('GET', `/checkout/v1/orders/${e.body.order.id}`, undefined, e.auth);
    expect(failed.body.order.payment.status).toBe('failed');
    expect(await ofOrder('payment.problem', e.body.order.id)).toHaveLength(0);
  });

  test('the owner disconnects: payments.connection off once (a replay adds none); reconnecting posts again, the onboarding step stays once', async () => {
    const key = `${nonce}-disconnect`;
    const off = await owner('POST', '/payments/mercadopago/disconnect', undefined, {
      'idempotency-key': key,
    });
    expect(off.status).toBe(200);
    const again = await owner('POST', '/payments/mercadopago/disconnect', undefined, {
      'idempotency-key': key,
    });
    expect(again.headers.get('x-idempotent-replay')).toBe('true');
    // already disconnected: a new request changes nothing
    expect((await owner('POST', '/payments/mercadopago/disconnect')).status).toBe(200);
    let conn = await events('payments.connection');
    expect(conn.map((e) => e.data.connected)).toEqual([true, false]);
    expect(conn[1]).toMatchObject({
      tenant_id: tenantId,
      severity: 'warning',
      data: { storeName: STORE, connected: false, detail: 'pelo lojista' },
    });

    await connect();
    conn = await events('payments.connection');
    expect(conn.map((e) => e.data.connected)).toEqual([true, false, true]);
    expect(await onboarding('payments')).toHaveLength(1);
  });
});
