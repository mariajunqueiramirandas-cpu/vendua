import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import {
  notifyConnectionChanges,
  reconcilePayments,
  refreshConnections,
} from '../src/modules/payments/jobs.ts';
import { upsertConnection } from '../src/modules/payments/connections.ts';
import { ProviderError } from '../src/modules/payments/provider.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

// Shopper → merchant online payments end to end (13-payments.md) against a real Postgres, with
// the fake Mercado Pago: connect, Pix, card, webhooks, refunds, degradation, jobs.
describe.skipIf(!process.env.TEST_DATABASE_URL)('store payments (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  const codes = new Map<string, string>();
  const whatsapps: { phone: string; text: string }[] = [];
  const notify = {
    whatsapp: async (phone: string, text: string) => void whatsapps.push({ phone, text }),
    email: async () => {},
  };
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => void codes.set(phone, /(\d{6})/.exec(text)![1]!),
    paymentProvider: fake,
    notify,
  });
  // jobs see every store's connection; ours only — another store's tokens don't open with 's'
  const jobDeps = {
    provider: fake,
    sessionSecret: 's',
    notify,
    adminOrigin: 'https://painel.test',
    only: [] as string[],
  };
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `pay-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `229${String(Date.now()).slice(-8)}`;
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
  const place = async (method: string) => {
    const auth = await shopper();
    const r = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
        delivery: { mode: 'pickup' },
        payment: { method },
      },
      auth,
    );
    return { ...r, auth };
  };
  const pay = (id: string, auth: Record<string, string>, key?: string) =>
    call('POST', `/checkout/v1/orders/${id}/pay`, undefined, {
      ...auth,
      ...(key ? { 'idempotency-key': key } : {}),
    });
  const getOrder = async (id: string, auth: Record<string, string>) =>
    (await call('GET', `/checkout/v1/orders/${id}`, undefined, auth)).body.order;
  const attempts = (orderId: string) =>
    sql<
      {
        provider_payment_id: string | null;
        provider_checkout_id: string | null;
        attempt: number;
        status: string;
      }[]
    >`
      select provider_payment_id, provider_checkout_id, attempt, status from payments
      where order_id = ${orderId} order by attempt
    `;
  // MP and our row agree on the expiry; move both into the past
  const expire = async (orderId: string) => {
    const rows = await sql<{ provider_payment_id: string }[]>`
      update payments set pix_expires_at = now() - interval '1 minute'
      where order_id = ${orderId} and status = 'pending' returning provider_payment_id
    `;
    for (const r of rows)
      fake.payments.get(r.provider_payment_id)!.pix!.expiresAt = new Date(
        Date.now() - 60_000,
      ).toISOString();
  };
  const hook = (id: string, t = tenantId) => {
    const w = fake.webhook('payment', id);
    return call('POST', `/admin/v1/hooks/mercadopago?t=${t}&data.id=${id}&type=payment`, w.body, {
      ...w.headers,
      'x-vendua-admin': '',
    });
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, 'Doces Pay') returning id
      `
    )[0]!.id;
    jobDeps.only.push(tenantId);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city,
                                  pix_key, pix_key_type, pix_beneficiary, pix_city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema', 'loja@exemplo.com', 'email', 'Doces Pay', 'Saquarema')
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
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('not connected: card_online refused, storefront offers offline only', async () => {
    const view = await owner('GET', '/payments');
    expect(view.status).toBe(200);
    expect(view.body.mercadoPago).toMatchObject({ available: true, status: 'not_connected' });
    const card = await owner('PATCH', '/payments', { methods: ['pix', 'card_online'] });
    expect(card.status).toBe(422);
    expect(card.body.error.code).toBe('MP_NOT_CONNECTED');
    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.onlinePayments).toEqual({ pix: false, card: false });
    const o = await place('pix');
    expect(o.status).toBe(201);
    expect(o.body.order.payment).toMatchObject({ provider: 'offline', online: false });
    expect(o.body.order.payment.pix.copyPaste).toContain('br.gov.bcb.pix');
    expect((await pay(o.body.order.id, o.auth)).body.error.code).toBe('PAYMENT_NOT_REQUIRED');
  });

  test('OAuth: a forged state is refused; the fake consent connects the store', async () => {
    const bad = await owner('GET', '/payments/mercadopago/callback?code=fake-code-x&state=nope');
    expect(bad.status).toBe(302);
    expect(bad.headers.get('location')).toBe('/admin/pagamentos?mp=error&reason=invalid_state');
    const denied = await owner('GET', '/payments/mercadopago/callback?error=access_denied');
    expect(denied.headers.get('location')).toBe('/admin/pagamentos?mp=error&reason=access_denied');

    const c = await owner('POST', '/payments/mercadopago/connect');
    expect(c.status).toBe(200);
    const u = new URL(c.body.url);
    expect(u.pathname).toBe('/admin/v1/payments/mercadopago/callback');
    // the state belongs to this store+person only: tampering breaks it
    const st = u.searchParams.get('state')!;
    const tampered = await owner(
      'GET',
      `/payments/mercadopago/callback?code=fake-code-x&state=${st.slice(0, -2)}xx`,
    );
    expect(tampered.headers.get('location')).toContain('reason=invalid_state');
    const cb = await owner('GET', `${u.pathname.replace('/admin/v1', '')}${u.search}`);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/admin/pagamentos?mp=connected');

    const view = await owner('GET', '/payments');
    expect(view.body.mercadoPago).toMatchObject({
      available: true,
      status: 'connected',
      accountId: '424242',
      liveMode: false,
    });
    const row = (
      await sql<
        { access_token: any }[]
      >`select access_token from payment_connections where tenant_id = ${tenantId}`
    )[0]!;
    expect(JSON.stringify(row.access_token)).not.toContain('fake-access');
    const audit =
      await sql`select 1 from audit_log where tenant_id = ${tenantId} and action = 'payments.mercadopago.connect'`;
    expect(audit.length).toBe(1);

    const on = await owner('PATCH', '/payments', { methods: ['pix', 'card_online', 'cash'] });
    expect(on.status).toBe(200);
    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.onlinePayments).toEqual({ pix: true, card: true });
    expect(store.body.paymentMethods).toContain('card_online');
  });

  let paidPix = { id: '', auth: {} as Record<string, string>, providerId: '' };

  test('Pix: checkout → pay → QR → webhook approves → paid, version bumps; replay is a no-op', async () => {
    const o = await place('pix');
    expect(o.status).toBe(201);
    const order = o.body.order;
    expect(order.payment).toMatchObject({
      provider: 'fake',
      method: 'pix',
      status: 'pending',
      online: true,
      pix: null,
    });
    expect(order.version).toBe(1);

    const key = `${nonce}-pay-once`;
    const p1 = await pay(order.id, o.auth, key);
    expect(p1.status).toBe(200);
    expect(p1.body.next.kind).toBe('pix');
    expect(p1.body.next.copyPaste).toContain('FAKEPIX');
    expect(Date.parse(p1.body.next.expiresAt)).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(p1.body.order.payment.pix.copyPaste).toBe(p1.body.next.copyPaste);
    expect(p1.body.order.version).toBe(2);
    // same key → the stored answer; new key → the same live attempt, no new charge
    const replay = await pay(order.id, o.auth, key);
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');
    const again = await pay(order.id, o.auth);
    expect(again.body.next.copyPaste).toBe(p1.body.next.copyPaste);
    expect(again.body.order.version).toBe(2);
    const rows = await attempts(order.id);
    expect(rows).toHaveLength(1);
    const providerId = rows[0]!.provider_payment_id!;
    expect(fake.payments.get(providerId)!.amountCents).toBe(order.totalCents);

    // someone else's session can't touch it
    const other = await shopper();
    expect((await pay(order.id, other)).status).toBe(404);

    expect((await call('POST', `/admin/v1/hooks/mercadopago?t=${tenantId}`, '{}')).status).toBe(
      401,
    );
    const forged = fake.webhook('payment', providerId);
    const badSig = await call(
      'POST',
      `/admin/v1/hooks/mercadopago?t=${tenantId}&data.id=${providerId}&type=payment`,
      forged.body,
      {
        'x-signature': forged.headers['x-signature'].replace(
          /v1=[0-9a-f]+/,
          `v1=${'0'.repeat(64)}`,
        ),
        'x-request-id': forged.headers['x-request-id'],
      },
    );
    expect(badSig.status).toBe(401);

    fake.settle(providerId, 'approved');
    const h = await hook(providerId);
    expect(h.status).toBe(200);
    const paid = await getOrder(order.id, o.auth);
    expect(paid.payment.status).toBe('paid');
    expect(paid.payment.paidAt).toBeTruthy();
    expect(paid.version).toBe(3);
    expect((await hook(providerId)).status).toBe(200);
    expect((await getOrder(order.id, o.auth)).version).toBe(3);
    const row = (
      await sql<{ status: string; provider_fee_cents: number; net_cents: number }[]>`
        select status, provider_fee_cents, net_cents from payments where provider_payment_id = ${providerId}
      `
    )[0]!;
    expect(row.status).toBe('approved');
    expect(row.net_cents).toBe(order.totalCents - row.provider_fee_cents);

    expect((await pay(order.id, o.auth)).body.error.code).toBe('PAYMENT_NOT_REQUIRED');
    const manual = await owner('POST', `/orders/${order.id}/payment`, { status: 'paid' });
    expect(manual.status).toBe(409);
    expect(manual.body.error.code).toBe('PAYMENT_ONLINE');
    const awaiting = (await owner('GET', '/payments')).body.awaitingPix.map((a: any) => a.id);
    expect(awaiting).not.toContain(order.id);
    paidPix = { id: order.id, auth: o.auth, providerId };
  });

  test('a payment into another account is ignored', async () => {
    const o = await place('pix');
    const p = await pay(o.body.order.id, o.auth);
    const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
    fake.payments.get(id)!.collectorId = '999999';
    fake.settle(id, 'approved');
    expect((await hook(id)).status).toBe(200);
    const after = await getOrder(o.body.order.id, o.auth);
    expect(after.payment.status).toBe('pending');
    expect(after.version).toBe(p.body.order.version);
    // a webhook naming another store's tenant does nothing either
    expect((await hook(id, crypto.randomUUID())).status).toBe(200);
  });

  test('card: redirect → complete (dev route) → paid; the return syncs before the webhook', async () => {
    const o = await place('card_online');
    expect(o.status).toBe(201);
    expect(o.body.order.payment).toMatchObject({
      method: 'card_online',
      online: true,
      status: 'pending',
    });
    const p = await pay(o.body.order.id, o.auth);
    expect(p.body.next.kind).toBe('redirect');
    const url = new URL(p.body.next.url);
    // storeOrigin's fallback host (no public domains row): <slug>.<store domain>
    expect(url.host.startsWith(`${slug}.vendua.`)).toBe(true);
    expect(url.protocol).toBe('https:');
    expect(url.pathname).toBe(`/pedido/${o.body.order.id}`);
    expect(url.searchParams.get('pagamento')).toBe('retorno');
    expect(p.body.order.payment.redirectUrl).toBe(p.body.next.url);
    const pref = url.searchParams.get('fake_checkout')!;
    const done = await call('POST', `/admin/v1/dev/mp/checkouts/${pref}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body.result.applied).toBe(true);
    const paid = await getOrder(o.body.order.id, o.auth);
    expect(paid.payment.status).toBe('paid');
    expect(paid.payment.redirectUrl).toBeNull();

    // the return lands first: /pay finds the payment by reference
    const o2 = await place('card_online');
    const p2 = await pay(o2.body.order.id, o2.auth);
    const pref2 = new URL(p2.body.next.url).searchParams.get('fake_checkout')!;
    fake.completeCheckout(pref2, 'approved');
    const back = await pay(o2.body.order.id, o2.auth);
    expect(back.status).toBe(200);
    expect(back.body.next.kind).toBe('none');
    expect(back.body.order.payment.status).toBe('paid');

    // a declined card opens a fresh checkout on the next try
    const o3 = await place('card_online');
    const p3 = await pay(o3.body.order.id, o3.auth);
    const pref3 = new URL(p3.body.next.url).searchParams.get('fake_checkout')!;
    await call('POST', `/admin/v1/dev/mp/checkouts/${pref3}/complete`, { status: 'rejected' });
    expect((await getOrder(o3.body.order.id, o3.auth)).payment.status).toBe('failed');
    const retry = await pay(o3.body.order.id, o3.auth);
    expect(retry.body.next.kind).toBe('redirect');
    expect(new URL(retry.body.next.url).searchParams.get('fake_checkout')).not.toBe(pref3);
    expect((await attempts(o3.body.order.id)).map((a) => a.attempt)).toEqual([1, 2]);

    // refunds: partial, too large, full, nothing left
    const id = o.body.order.id;
    const detail = await owner('GET', `/orders/${id}`);
    expect(detail.body.payments).toHaveLength(1);
    expect(detail.body.payments[0].refundableCents).toBe(o.body.order.totalCents);
    const part = await owner('POST', `/orders/${id}/refund`, {
      amountCents: 500,
      reason: 'faltou um',
    });
    expect(part.status).toBe(200);
    expect(part.body.order.payment.status).toBe('partially_refunded');
    expect(part.body.order.payment.refundedCents).toBe(500);
    expect(part.body.payments[0].refundableCents).toBe(o.body.order.totalCents - 500);
    expect(part.body.payments[0].refunds[0]).toMatchObject({
      amountCents: 500,
      status: 'approved',
      reason: 'faltou um',
    });
    const big = await owner('POST', `/orders/${id}/refund`, {
      amountCents: o.body.order.totalCents,
    });
    expect(big.status).toBe(422);
    expect(big.body.error.code).toBe('REFUND_TOO_LARGE');
    const full = await owner('POST', `/orders/${id}/refund`, {});
    expect(full.body.order.payment.status).toBe('refunded');
    expect(full.body.order.payment.refundedCents).toBe(o.body.order.totalCents);
    expect(full.body.order.state).toBe('placed');
    expect((await owner('POST', `/orders/${id}/refund`, {})).body.error.code).toBe(
      'NOTHING_TO_REFUND',
    );
    expect(fake.refunds.filter((r) => r.paymentId === done.body.paymentId)).toHaveLength(2);
    const audits =
      await sql`select 1 from audit_log where tenant_id = ${tenantId} and action = 'order.payment.refund' and entity_id = ${id}`;
    expect(audits.length).toBe(2);
  });

  test('full refund of a delivered online order → refunded; cancelling a paid order refunds it', async () => {
    for (const to of ['confirmed', 'preparing', 'ready', 'delivered'])
      expect((await owner('POST', `/orders/${paidPix.id}/transition`, { to })).status).toBe(200);
    const r = await owner('POST', `/orders/${paidPix.id}/refund`, { reason: 'cliente desistiu' });
    expect(r.status).toBe(200);
    expect(r.body.order.state).toBe('refunded');
    expect(r.body.order.payment.status).toBe('refunded');

    const o = await place('pix');
    await pay(o.body.order.id, o.auth);
    const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
    fake.settle(id, 'approved');
    await hook(id);
    const c = await owner('POST', `/orders/${o.body.order.id}/transition`, {
      to: 'cancelled',
      reason: 'acabou o pudim',
    });
    expect(c.status).toBe(200);
    expect(c.body.order.state).toBe('cancelled');
    expect(c.body.order.payment.status).toBe('refunded');
    expect(fake.refunds.some((f) => f.paymentId === id)).toBe(true);
    // the webhook MP sends for the refund changes nothing further
    const v = (await getOrder(o.body.order.id, o.auth)).version;
    await hook(id);
    expect((await getOrder(o.body.order.id, o.auth)).version).toBe(v);

    // MP refusing fails the cancel loudly and leaves the order as it was
    const o2 = await place('pix');
    await pay(o2.body.order.id, o2.auth);
    const id2 = (await attempts(o2.body.order.id))[0]!.provider_payment_id!;
    fake.settle(id2, 'approved');
    await hook(id2);
    const tokenOf = fake.payments.get(id2)!.token;
    fake.restricted.add(tokenOf);
    const cancelKey = `${nonce}-cancel-refused`;
    const refused = await owner(
      'POST',
      `/orders/${o2.body.order.id}/transition`,
      { to: 'cancelled', reason: 'x' },
      { 'idempotency-key': cancelKey },
    );
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('REFUND_FAILED');
    expect((await getOrder(o2.body.order.id, o2.auth)).state).toBe('placed');
    fake.restricted.delete(tokenOf);
    // the same request again (MP would take it now): it fails the same way, never cancels with
    // the money kept
    const again = await owner(
      'POST',
      `/orders/${o2.body.order.id}/transition`,
      { to: 'cancelled', reason: 'x' },
      { 'idempotency-key': cancelKey },
    );
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REFUND_FAILED');
    const kept = await getOrder(o2.body.order.id, o2.auth);
    expect(kept.state).toBe('placed');
    expect(kept.payment.status).toBe('paid');
    // a new request goes through
    const ok = await owner('POST', `/orders/${o2.body.order.id}/transition`, {
      to: 'cancelled',
      reason: 'x',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.order.payment.status).toBe('refunded');
    await new Promise((r) => setTimeout(r, 50));
    await sql`update payment_connections set status = 'connected', last_error = null where tenant_id = ${tenantId}`;
  });

  test('statement: money that landed this month', async () => {
    const view = await owner('GET', '/payments');
    expect(view.body.month.count).toBeGreaterThanOrEqual(4);
    expect(view.body.month.grossCents).toBeGreaterThan(0);
    const st = await owner('GET', `/payments/statement?month=${view.body.month.month}`);
    expect(st.status).toBe(200);
    expect(st.body.totals).toEqual({
      grossCents: view.body.month.grossCents,
      providerFeeCents: view.body.month.providerFeeCents,
      applicationFeeCents: 0,
      netCents: view.body.month.netCents,
      refundedCents: view.body.month.refundedCents,
      count: view.body.month.count,
    });
    expect(st.body.payments[0]).toHaveProperty('orderNumber');
    expect((await owner('GET', '/payments/statement?month=2026-13')).status).toBe(400);
  });

  test('expired Pix → a new attempt with a new QR; the job expires what nobody paid', async () => {
    const o = await place('pix');
    const first = await pay(o.body.order.id, o.auth);
    await expire(o.body.order.id);
    const second = await pay(o.body.order.id, o.auth);
    expect(second.body.next.kind).toBe('pix');
    expect(second.body.next.copyPaste).not.toBe(first.body.next.copyPaste);
    expect((await attempts(o.body.order.id)).map((a) => [a.attempt, a.status])).toEqual([
      [1, 'expired'],
      [2, 'pending'],
    ]);

    // reconciliation: an approval whose webhook never came, and a QR that ran out
    const lost = await place('pix');
    await pay(lost.body.order.id, lost.auth);
    fake.settle((await attempts(lost.body.order.id))[0]!.provider_payment_id!, 'approved');
    await expire(o.body.order.id);
    await reconcilePayments(appSql, jobDeps);
    expect((await getOrder(lost.body.order.id, lost.auth)).payment.status).toBe('paid');
    expect((await getOrder(o.body.order.id, o.auth)).payment.status).toBe('expired');
    const third = await pay(o.body.order.id, o.auth);
    expect(third.body.next.kind).toBe('pix');
    expect((await attempts(o.body.order.id)).length).toBe(3);
  });

  // a paid online Pix order, straight through the webhook
  const paidOrder = async () => {
    const o = await place('pix');
    await pay(o.body.order.id, o.auth);
    const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
    fake.settle(id, 'approved');
    await hook(id);
    return { ...o, id: o.body.order.id as string, providerId: id };
  };
  const reconnect = async () => {
    const c = await owner('POST', '/payments/mercadopago/connect');
    const u = new URL(c.body.url);
    const cb = await owner('GET', `${u.pathname.replace('/admin/v1', '')}${u.search}`);
    expect(cb.headers.get('location')).toBe('/admin/pagamentos?mp=connected');
  };

  test('an amount that does not match the order never pays it, and never pins /pay', async () => {
    const o = await place('pix');
    const p1 = await pay(o.body.order.id, o.auth);
    const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
    fake.payments.get(id)!.amountCents = o.body.order.totalCents + 100;
    fake.settle(id, 'approved');
    expect((await hook(id)).status).toBe(200);
    expect((await getOrder(o.body.order.id, o.auth)).payment.status).toBe('pending');
    const again = await pay(o.body.order.id, o.auth);
    expect(again.body.next.kind).toBe('pix');
    expect(again.body.next.copyPaste).not.toBe(p1.body.next.copyPaste);
    const view = await owner('GET', '/payments');
    expect(view.body.review.map((r: any) => [r.orderId, r.reason])).toContainEqual([
      o.body.order.id,
      'amount_mismatch',
    ]);
  });

  test('a signed webhook naming another store (?t=) never applies there or here', async () => {
    const other = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${`pay2-${nonce}`}, 'Outra Loja') returning id
      `
    )[0]!.id;
    try {
      // same MP account on both stores: the collector matches, the order doesn't
      await withTenant(sql, other, (tx) =>
        upsertConnection(tx, other, 'fake', fake.tokens('424242'), 's', null),
      );
      const o = await place('pix');
      await pay(o.body.order.id, o.auth);
      const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
      fake.settle(id, 'approved');
      expect((await hook(id, other)).status).toBe(200);
      expect((await getOrder(o.body.order.id, o.auth)).payment.status).toBe('pending');
      expect((await sql`select 1 from payments where tenant_id = ${other}`).length).toBe(0);
      // and a different account there: the collector check stops it first
      await withTenant(sql, other, (tx) =>
        upsertConnection(tx, other, 'fake', fake.tokens('777777'), 's', null),
      );
      expect((await hook(id, other)).status).toBe(200);
      expect((await sql`select 1 from payments where tenant_id = ${other}`).length).toBe(0);
      // the right store still gets it
      await hook(id);
      expect((await getOrder(o.body.order.id, o.auth)).payment.status).toBe('paid');
    } finally {
      await sql`delete from tenants where id = ${other}`;
    }
  });

  test('a provider id already bound to another store is a conflict (503), never a 500', async () => {
    const other = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${`pay3-${nonce}`}, 'Terceira') returning id
      `
    )[0]!.id;
    try {
      // the id the fake will hand out next is already someone else's (a replayed/reused id)
      const f = fake as unknown as { boot: string; seq: number };
      const nextId = `P${f.boot}${1000 + f.seq + 1}`;
      const cart = (
        await sql<{ id: string }[]>`
          insert into carts (tenant_id, session_hash) values (${other}, ${'pay3-' + nonce}) returning id
        `
      )[0]!.id;
      const ord = (
        await sql<{ id: string }[]>`
          insert into orders (tenant_id, cart_id, number, customer, delivery, payment, subtotal_cents, total_cents)
          values (${other}, ${cart}, 1, ${sql.json({ name: 'x', phone: 'x' })}, ${sql.json({ mode: 'pickup' })},
                  ${sql.json({ provider: 'fake', method: 'pix', status: 'pending', online: true })}, 100, 100)
          returning id
        `
      )[0]!.id;
      await sql`
        insert into payments (tenant_id, order_id, provider, provider_payment_id, kind, status, amount_cents)
        values (${other}, ${ord}, 'fake', ${nextId}, 'pix', 'pending', 100)
      `;
      const o = await place('pix');
      const p = await pay(o.body.order.id, o.auth);
      expect(p.status).toBe(503);
      expect(p.body.error).toMatchObject({
        code: 'PAYMENT_UNAVAILABLE',
        details: { reason: 'conflict' },
      });
      const again = await pay(o.body.order.id, o.auth);
      expect(again.status).toBe(200);
      expect(again.body.next.kind).toBe('pix');
      expect((await attempts(o.body.order.id)).map((a) => [a.attempt, a.status])).toEqual([
        [1, 'cancelled'],
        [2, 'pending'],
      ]);
      // a webhook for that id here is ignored, not a 500
      fake.settle(nextId, 'approved');
      expect((await hook(nextId)).status).toBe(200);
    } finally {
      await sql`delete from tenants where id = ${other}`;
    }
  });

  test('refund retried after MP answered but we did not record it: refunded once', async () => {
    const o = await paidOrder();
    const orig = fake.refund.bind(fake);
    fake.refund = async (...a: Parameters<typeof orig>) => {
      await orig(...a);
      fake.refund = orig;
      throw new ProviderError('unavailable', 'timed out after MP refunded');
    };
    const key = `${nonce}-refund-retry`;
    const first = await owner(
      'POST',
      `/orders/${o.id}/refund`,
      { amountCents: 300 },
      { 'idempotency-key': key },
    );
    expect(first.status).toBe(503);
    expect(first.body.error.code).toBe('PAYMENT_UNAVAILABLE');
    const retry = await owner(
      'POST',
      `/orders/${o.id}/refund`,
      { amountCents: 300 },
      { 'idempotency-key': key },
    );
    expect(retry.status).toBe(200);
    expect(retry.body.order.payment.refundedCents).toBe(300);
    expect(retry.body.payments[0].refundedCents).toBe(300);
    expect(retry.body.payments[0].refunds).toHaveLength(1);
    expect(fake.refunds.filter((r) => r.paymentId === o.providerId)).toHaveLength(1);
    expect(fake.payments.get(o.providerId)!.refundedCents).toBe(300);
    // a replay of the finished request is the stored answer, still one refund
    const replay = await owner(
      'POST',
      `/orders/${o.id}/refund`,
      { amountCents: 300 },
      { 'idempotency-key': key },
    );
    expect(replay.headers.get('x-idempotent-replay')).toBe('true');
    expect(fake.refunds.filter((r) => r.paymentId === o.providerId)).toHaveLength(1);
  });

  test('cancelling stops the unpaid Pix; money that lands anyway goes straight back', async () => {
    const cancelled: string[] = [];
    const orig = fake.cancelPayment.bind(fake);
    fake.cancelPayment = async (t: string, id: string) => {
      cancelled.push(id);
      return orig(t, id);
    };
    try {
      const o = await place('pix');
      await pay(o.body.order.id, o.auth);
      const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
      const c = await owner('POST', `/orders/${o.body.order.id}/transition`, {
        to: 'cancelled',
        reason: 'fechamos mais cedo',
      });
      expect(c.status).toBe(200);
      expect(cancelled).toEqual([id]);
      expect((await attempts(o.body.order.id))[0]!.status).toBe('cancelled');
      expect(fake.payments.get(id)!.status).toBe('cancelled');
      // the shopper paid the QR a second before MP cancelled it
      fake.settle(id, 'approved');
      expect((await hook(id)).status).toBe(200);
      const after = await getOrder(o.body.order.id, o.auth);
      expect(after.state).toBe('cancelled');
      expect(after.payment.status).toBe('refunded');
      expect(fake.payments.get(id)!.refundedCents).toBe(o.body.order.totalCents);
      // the webhook again: nothing more goes back
      await hook(id);
      expect(fake.refunds.filter((r) => r.paymentId === id)).toHaveLength(1);
    } finally {
      fake.cancelPayment = orig;
    }
  });

  test('a disconnected store still applies what was in flight; without a token, it is flagged', async () => {
    // disconnected by health (token still opens): the approval is fetched and applied
    const o = await place('pix');
    await pay(o.body.order.id, o.auth);
    const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
    await sql`update payment_connections set status = 'disconnected' where tenant_id = ${tenantId}`;
    fake.settle(id, 'approved');
    expect((await hook(id)).status).toBe(200);
    expect((await getOrder(o.body.order.id, o.auth)).payment.status).toBe('paid');

    // the owner disconnects (tokens wiped): the event can't be verified — flagged, not dropped
    await reconnect();
    const o2 = await place('pix');
    await pay(o2.body.order.id, o2.auth);
    const id2 = (await attempts(o2.body.order.id))[0]!.provider_payment_id!;
    // and a Pix closed here (order cancelled) that MP still takes
    const o3 = await place('pix');
    await pay(o3.body.order.id, o3.auth);
    const id3 = (await attempts(o3.body.order.id))[0]!.provider_payment_id!;
    await owner('POST', `/orders/${o3.body.order.id}/transition`, { to: 'cancelled', reason: 'x' });
    expect((await attempts(o3.body.order.id))[0]!.status).toBe('cancelled');
    expect((await owner('POST', '/payments/mercadopago/disconnect')).status).toBe(200);
    fake.settle(id3, 'approved');
    expect((await hook(id3)).status).toBe(200);
    expect(
      (await owner('GET', '/payments')).body.review.map((r: any) => [r.orderId, r.reason]),
    ).toContainEqual([o3.body.order.id, 'unverified']);
    const row = (
      await sql<{ status: string; access_token: unknown; provider_user_id: string }[]>`
        select status, access_token, provider_user_id from payment_connections where tenant_id = ${tenantId}
      `
    )[0]!;
    expect(row).toMatchObject({ status: 'disconnected', provider_user_id: '424242' });
    expect(row.access_token).toEqual({});
    fake.settle(id2, 'approved');
    expect((await hook(id2)).status).toBe(200);
    expect((await attempts(o2.body.order.id))[0]!.status).toBe('pending');
    const view = await owner('GET', '/payments');
    expect(view.body.mercadoPago.status).toBe('not_connected');
    expect(view.body.review.map((r: any) => [r.orderId, r.reason])).toContainEqual([
      o2.body.order.id,
      'unverified',
    ]);
    // reconnecting settles it: the job re-reads it with the new token
    await reconnect();
    await reconcilePayments(appSql, jobDeps);
    expect((await getOrder(o2.body.order.id, o2.auth)).payment.status).toBe('paid');
    expect((await owner('GET', '/payments')).body.review.map((r: any) => r.orderId)).not.toContain(
      o2.body.order.id,
    );
  });

  test('a flagged payment is still refundable; a refund MP made but we never recorded is found', async () => {
    const o = await paidOrder();
    await sql`update payments set review = 'refund_failed' where provider_payment_id = ${o.providerId}`;
    const r = await owner('POST', `/orders/${o.id}/refund`, { amountCents: 200 });
    expect(r.status).toBe(200);
    expect(r.body.order.payment.refundedCents).toBe(200);
    expect(r.body.payments[0].refundableCents).toBe(o.body.order.totalCents - 200);

    // crash between MP refunding and us recording: the reservation is there, unsent
    const row = (
      await sql<
        { id: string }[]
      >`select id from payments where provider_payment_id = ${o.providerId}`
    )[0]!;
    await fake.refund(fake.payments.get(o.providerId)!.token, o.providerId, 300, 'crashed-one');
    await sql`
      insert into payment_refunds (tenant_id, payment_id, amount_cents, status, request_key, created_at)
      values (${tenantId}, ${row.id}, 300, 'pending', ${`${nonce}-crashed`}, now() - interval '10 minutes')
    `;
    await reconcilePayments(appSql, jobDeps);
    const after = await getOrder(o.id, o.auth);
    expect(after.payment.refundedCents).toBe(500);
    const refunds = await sql<{ status: string }[]>`
      select status from payment_refunds where payment_id = ${row.id} order by created_at
    `;
    expect(refunds.map((x) => x.status)).toEqual(['approved', 'approved']);
  });

  test('money approved while the cancel is in flight is sent back after it commits', async () => {
    const o = await place('pix');
    await pay(o.body.order.id, o.auth);
    const id = (await attempts(o.body.order.id))[0]!.provider_payment_id!;
    const orig = fake.cancelPayment.bind(fake);
    // the shopper pays while we're asking MP to cancel: MP refuses, the webhook lands first
    fake.cancelPayment = async () => {
      fake.settle(id, 'approved');
      await hook(id);
      throw new ProviderError('invalid', 'already approved', 400);
    };
    try {
      const c = await owner('POST', `/orders/${o.body.order.id}/transition`, {
        to: 'cancelled',
        reason: 'fechou',
      });
      expect(c.status).toBe(200);
    } finally {
      fake.cancelPayment = orig;
    }
    const after = await getOrder(o.body.order.id, o.auth);
    expect(after.state).toBe('cancelled');
    expect(after.payment.status).toBe('refunded');
    expect(fake.payments.get(id)!.refundedCents).toBe(o.body.order.totalCents);
  });

  test('token refresh job: revoked → disconnected, owners told once', async () => {
    // another replica holds the lease: this one leaves the row alone
    await sql`update payment_connections set expires_at = now() + interval '3 days', refreshing_until = now() + interval '1 minute' where tenant_id = ${tenantId}`;
    await refreshConnections(appSql, jobDeps);
    const leased = (
      await sql<
        { expires_at: Date }[]
      >`select expires_at from payment_connections where tenant_id = ${tenantId}`
    )[0]!;
    expect(new Date(leased.expires_at).getTime()).toBeLessThan(Date.now() + 4 * 86_400_000);
    await sql`update payment_connections set refreshing_until = null where tenant_id = ${tenantId}`;
    await refreshConnections(appSql, jobDeps);
    expect(
      (
        await sql<
          { r: Date | null }[]
        >`select refreshing_until as r from payment_connections where tenant_id = ${tenantId}`
      )[0]!.r,
    ).toBeNull();
    let conn = (
      await sql<
        { status: string; expires_at: Date }[]
      >`select status, expires_at from payment_connections where tenant_id = ${tenantId}`
    )[0]!;
    expect(conn.status).toBe('connected');
    expect(new Date(conn.expires_at).getTime()).toBeGreaterThan(Date.now() + 100 * 86_400_000);

    await sql`update payment_connections set expires_at = now() + interval '3 days' where tenant_id = ${tenantId}`;
    const { unseal } = await import('../src/platform/secrets.ts');
    const rt = (
      await sql<
        { refresh_token: unknown }[]
      >`select refresh_token from payment_connections where tenant_id = ${tenantId}`
    )[0]!.refresh_token;
    fake.revoked.add(unseal(rt, 's')!);
    await refreshConnections(appSql, jobDeps);
    conn = (
      await sql<any[]>`select status from payment_connections where tenant_id = ${tenantId}`
    )[0]!;
    expect(conn.status).toBe('disconnected');
    await notifyConnectionChanges(appSql, jobDeps);
    await notifyConnectionChanges(appSql, jobDeps);
    const told = whatsapps.filter((w) => w.phone === ownerPhone);
    expect(told).toHaveLength(1);
    expect(told[0]!.text).toContain('desconectada do Mercado Pago');
    expect(told[0]!.text).toContain('https://painel.test/admin/pagamentos');
    expect((await owner('GET', '/payments')).body.mercadoPago.status).toBe('disconnected');
  });

  test('disconnected: static Pix, card hidden, a pending online Pix falls back', async () => {
    // reconnect, open an online Pix, then disconnect by hand
    const c = await owner('POST', '/payments/mercadopago/connect');
    const u = new URL(c.body.url);
    await owner('GET', `${u.pathname.replace('/admin/v1', '')}${u.search}`);
    const pending = await place('pix');
    expect(pending.body.order.payment.online).toBe(true);
    const d = await owner('POST', '/payments/mercadopago/disconnect');
    expect(d.status).toBe(200);
    expect(d.body.mercadoPago.status).toBe('not_connected');

    const store = await call('GET', '/storefront/v1/store', undefined, { host });
    expect(store.body.onlinePayments).toEqual({ pix: false, card: false });
    expect(store.body.paymentMethods).not.toContain('card_online');
    const card = await place('card_online');
    expect(card.status).toBe(422);
    expect(card.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    const o = await place('pix');
    expect(o.body.order.payment).toMatchObject({ provider: 'offline', online: false });
    expect(o.body.order.payment.pix.copyPaste).toContain('br.gov.bcb.pix');

    const fell = await pay(pending.body.order.id, pending.auth);
    expect(fell.status).toBe(200);
    expect(fell.body.next.kind).toBe('pix');
    expect(fell.body.next.copyPaste).toContain('br.gov.bcb.pix');
    expect(fell.body.order.payment).toMatchObject({ provider: 'offline', online: false });
    // and the store confirms it by hand again
    const m = await owner('POST', `/orders/${pending.body.order.id}/payment`, { status: 'paid' });
    expect(m.status).toBe(200);
    // an offline refund is record-only and needs a delivered order
    expect((await owner('POST', `/orders/${o.body.order.id}/refund`, {})).body.error.code).toBe(
      'INVALID_ORDER_TRANSITION',
    );
  });
});
