import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { orderTrackToken } from '../src/modules/orders.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { depositCents, newSinal, sinalApplies } from '../src/modules/sinal.ts';
import { migrate } from '../src/platform/db.ts';

// Festa calculada F2 (0128): a party (and an encomenda from the store's amount) locks its date
// with a sinal by Pix; the rest is paid by Pix before the date or at the caixa. One order, two
// charges that always add up to its total.

describe('sinal: the split', () => {
  test('half a cent up, both parts at least a cent, always the total', () => {
    expect(depositCents(10_001, 5000)).toBe(5001);
    expect(depositCents(54_000, 4000)).toBe(21_600);
    expect(depositCents(3, 9000)).toBe(2);
    expect(depositCents(2, 500)).toBe(1);
    for (const total of [2, 99, 1_000, 54_321, 99_999_999])
      for (const bps of [500, 3300, 5000, 9000]) {
        const s = newSinal(total, { bps, minCents: null, policy: null });
        expect(s.depositCents + s.balanceCents).toBe(total);
        expect(s.depositCents).toBeGreaterThan(0);
        expect(s.balanceCents).toBeGreaterThan(0);
      }
  });

  test('a party always; another encomenda only from the store’s amount', () => {
    const rule = { bps: 3000, minCents: 40_000, policy: null };
    expect(sinalApplies(rule, { party: true, totalCents: 1_000 })).toBe(true);
    expect(sinalApplies(rule, { party: false, totalCents: 39_999 })).toBe(false);
    expect(sinalApplies(rule, { party: false, totalCents: 40_000 })).toBe(true);
    expect(sinalApplies({ ...rule, minCents: null }, { party: false, totalCents: 90_000 })).toBe(
      false,
    );
    expect(sinalApplies(null, { party: true, totalCents: 90_000 })).toBe(false);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('sinal (db)', () => {
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
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => void codes.set(phone, /(\d{6})/.exec(text)![1]!),
    paymentProvider: fake,
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const ids: string[] = [];
  let idem = 0;
  let n = 0;

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
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      headers: res.headers,
    };
  };

  const login = async (tenantId: string, role: string) => {
    const phone = `2${String(Date.now() + ++n).slice(-10)}`;
    await sql`insert into merchant_users (tenant_id, name, phone, role)
              values (${tenantId}, ${'Pessoa ' + role}, ${phone}, ${role})`;
    await call('POST', '/admin/v1/auth/otp/start', { phone });
    const v = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(v.headers.get('set-cookie') ?? '')![1]}`;
    return (m: string, p: string, b?: unknown) => call(m, `/admin/v1${p}`, b, { cookie });
  };

  /** pix: false = a store with no Pix key */
  const store = async (o: { pix?: boolean } = {}) => {
    const slug = `si-${nonce}-${++n}`;
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name) values (${slug}, ${'Doceria ' + n}) returning id`;
    ids.push(t!.id);
    const host = `${slug}.localhost`;
    await sql`insert into domains (host, tenant_id) values (${host}, ${t!.id})`;
    const pix = o.pix !== false;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency,
                                  vocabulary, city, preorder_payment_methods,
                                  pix_key, pix_key_type, pix_beneficiary, pix_city)
      values (${t!.id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Niterói', ${sql.json(['pix', 'cash'])},
              ${pix ? 'doceria@exemplo.com' : null}, ${pix ? 'email' : null},
              ${pix ? 'Doceria' : null}, ${pix ? 'Niteroi' : null})`;
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${t!.id}, true, 'open')`;
    const [cat] = await sql<{ id: string }[]>`
      insert into categories (tenant_id, slug, name) values (${t!.id}, 'festa', 'Festa') returning id`;
    const product = async (slug: string, price: number, preorder = false) =>
      (
        await sql<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, base_price_cents,
                                requires_preorder, preorder_lead_days)
          values (${t!.id}, ${cat!.id}, ${slug}, ${slug}, ${price}, ${preorder}, ${preorder ? 2 : 0})
          returning id`
      )[0]!.id;
    const coxinha = await product('coxinha-cento', 9_000);
    const bolo = await product('bolo-casamento', 50_000, true);
    const torta = await product('torta', 3_000, true);
    const [prof] = await sql<{ id: string }[]>`
      insert into party_profiles (tenant_id, name, child_factor_bps, min_guests, max_guests)
      values (${t!.id}, 'Aniversário', 5000, 10, 300) returning id`;
    const [g] = await sql<{ id: string }[]>`
      insert into party_groups (tenant_id, profile_id, name, per_guest_milli, max_choices, sort)
      values (${t!.id}, ${prof!.id}, 'Salgados', 15000, 3, 0) returning id`;
    await sql`
      insert into party_group_products (tenant_id, profile_id, group_id, product_id, units_per_sale)
      values (${t!.id}, ${prof!.id}, ${g!.id}, ${coxinha}, 100)`;
    const owner = await login(t!.id, 'owner');
    return { id: t!.id, host, owner, profileId: prof!.id, group: g!.id, coxinha, bolo, torta };
  };
  type Store = Awaited<ReturnType<typeof store>>;

  const session = async (s: Store) => {
    const r = await call('POST', '/checkout/v1/session', undefined, { host: s.host });
    return { host: s.host, authorization: `Bearer ${r.body.sessionToken}` };
  };

  /** 40 guests → 6 centos of coxinha: R$ 540,00 */
  const partyCart = async (s: Store) => {
    const auth = await session(s);
    const b = await call(
      'POST',
      '/checkout/v1/cart/party',
      { profileId: s.profileId, adults: 40, choices: { [s.group]: [s.coxinha] } },
      auth,
    );
    expect(b.status).toBe(200);
    return { auth, cart: b.body.cart };
  };

  const checkout = (
    auth: Record<string, string>,
    cart: any,
    method = 'pix',
    mode: 'pickup' | 'delivery' = 'pickup',
  ) =>
    call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Bia Souza', phone: '21988887777' },
        delivery: { mode },
        payment: { method },
        scheduledFor: cart.schedule.dates[3],
      },
      auth,
    );

  // the currency's space is a no-break one
  const messages = async (orderId: string) =>
    (
      await sql<{ event: string; body: string }[]>`
        select event, body from store_wa_messages where order_id = ${orderId}
        order by created_at, id`
    ).map((m) => ({ ...m, body: m.body.replace(/\u00a0/g, ' ') }));

  /** the EMV amount field (tag 54) a copia e cola carries */
  const amountTag = (cents: number) => {
    const v = (cents / 100).toFixed(2);
    return `54${String(v.length).padStart(2, '0')}${v}`;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (ids.length) await sql`delete from tenants where id = any(${ids}::uuid[])`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('the owner sets the sinal; it needs a Pix; bad values are 4xx', async () => {
    const s = await store();
    const set = await s.owner('PATCH', '/store', {
      sinal: { bps: 4000, minCents: 40_000, policy: 'Sinal devolvido até 7 dias antes.' },
    });
    expect(set.status).toBe(200);
    const view = await s.owner('GET', '/store');
    expect(view.body.sinal).toEqual({
      bps: 4000,
      minCents: 40_000,
      policy: 'Sinal devolvido até 7 dias antes.',
    });
    for (const bps of [-1, 300, 4050, 9500, 'x'])
      expect((await s.owner('PATCH', '/store', { sinal: { bps } })).status).toBe(422);
    expect((await s.owner('PATCH', '/store', { sinal: { policy: 'x'.repeat(601) } })).status).toBe(
      422,
    );
    const manager = await login(s.id, 'manager');
    const no = await manager('PATCH', '/store', { sinal: { bps: 5000 } });
    expect(no.status).toBe(403);
    // a store without a Pix key (nor Mercado Pago) can't ask for one
    const bare = await store({ pix: false });
    const refused = await bare.owner('PATCH', '/store', { sinal: { bps: 3000 } });
    expect(refused.body.error.code).toBe('PIX_REQUIRED');
    expect((await bare.owner('PATCH', '/store', { sinal: { bps: 0 } })).status).toBe(200);
  });

  test('a party: the cart shows Core’s sinal; checkout takes only Pix; the code is the sinal’s', async () => {
    const s = await store();
    await s.owner('PATCH', '/store', { sinal: { bps: 4000, policy: 'Política da loja.' } });
    const { auth, cart } = await partyCart(s);
    expect(cart.totals.totalCents).toBe(54_000);
    expect(cart.totals.depositCents).toBe(21_600);
    expect(cart.totals.balanceCents).toBe(32_400);
    expect(cart.sinal).toEqual({ percent: 40, policy: 'Política da loja.' });
    expect(cart.schedule.paymentMethods).toEqual(['pix']);

    const cash = await checkout(auth, cart, 'cash');
    expect(cash.status).toBe(422);
    expect(cash.body.error.code).toBe('PAYMENT_NOT_ALLOWED');

    const ok = await checkout(auth, cart);
    expect(ok.status).toBe(201);
    const o = ok.body.order;
    expect(o.totalCents).toBe(54_000);
    expect(o.payment).toMatchObject({
      method: 'pix',
      status: 'pending',
      online: false,
      sinal: {
        depositCents: 21_600,
        balanceCents: 32_400,
        depositPaidAt: null,
        balancePaidAt: null,
        policy: 'Política da loja.',
      },
    });
    expect(o.payment.pix.copyPaste).toContain(amountTag(21_600));
    expect(o.payment.instructions).toContain('sinal de R$');
    const [row] = await sql<{ deposit_cents: number; total_cents: number }[]>`
      select deposit_cents, total_cents from orders where id = ${o.id}`;
    expect(row).toEqual({ deposit_cents: 21_600, total_cents: 54_000 });

    // the store's WhatsApp: the order, then the sinal, then its code alone
    const sent = await messages(o.id);
    expect(sent.map((m) => m.event)).toEqual(['placed', 'sinal_due', 'sinal_pix']);
    expect(sent[1]!.body).toContain('o sinal da encomenda');
    expect(sent[1]!.body).toContain('R$ 216,00');
    expect(sent[1]!.body).toContain('R$ 324,00');
    expect(sent[2]!.body).toBe(o.payment.pix.copyPaste);
  });

  test('a big encomenda pays a sinal from the store’s amount; a small one or a store without it doesn’t', async () => {
    const s = await store();
    await s.owner('PATCH', '/store', { sinal: { bps: 3000, minCents: 40_000 } });
    const big = await session(s);
    const add = await call('POST', '/checkout/v1/cart/items', { productId: s.bolo, qty: 1 }, big);
    expect(add.body.cart.totals.depositCents).toBe(15_000);
    const placed = await checkout(big, add.body.cart);
    expect(placed.status).toBe(201);
    expect(placed.body.order.payment.sinal.depositCents).toBe(15_000);

    const small = await session(s);
    const add2 = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: s.torta, qty: 2 },
      small,
    );
    expect(add2.body.cart.totals.depositCents).toBeUndefined();
    expect(add2.body.cart.sinal).toBeNull();
    const placed2 = await checkout(small, add2.body.cart, 'cash');
    expect(placed2.status).toBe(201);
    expect(placed2.body.order.payment.sinal).toBeUndefined();

    // the sinal off: a party is paid in one go, as before
    await s.owner('PATCH', '/store', { sinal: { bps: 0 } });
    const { auth, cart } = await partyCart(s);
    expect(cart.totals.depositCents).toBeUndefined();
    const whole = await checkout(auth, cart);
    expect(whole.body.order.payment.sinal).toBeUndefined();
    expect(whole.body.order.payment.pix.copyPaste).toContain(amountTag(54_000));
  });

  test('own Pix: the store marks the sinal, then the rest; the code and messages follow; undo steps back', async () => {
    const s = await store();
    await s.owner('PATCH', '/store', { sinal: { bps: 4000 } });
    const { auth, cart } = await partyCart(s);
    const o = (await checkout(auth, cart)).body.order;

    const dep = await s.owner('POST', `/orders/${o.id}/payment`, {
      status: 'paid',
      charge: 'deposit',
    });
    expect(dep.status).toBe(200);
    const p1 = dep.body.order.payment;
    expect(p1.status).toBe('pending');
    expect(p1.paidAt).toBeNull();
    expect(p1.sinal.depositPaidAt).toBeTruthy();
    expect(p1.sinal.depositVia).toBe('manual');
    expect(p1.sinal.balancePaidAt).toBeNull();
    expect(p1.pix.copyPaste).toContain(amountTag(32_400));
    // marking it again changes nothing
    const again = await s.owner('POST', `/orders/${o.id}/payment`, {
      status: 'paid',
      charge: 'deposit',
    });
    expect(again.body.order.payment.sinal.depositPaidAt).toBe(p1.sinal.depositPaidAt);

    let sent = await messages(o.id);
    expect(sent.map((m) => m.event)).toEqual([
      'placed',
      'sinal_due',
      'sinal_pix',
      'sinal_paid',
      'balance_pix',
    ]);
    expect(sent[3]!.body).toContain('Sinal de R$ 216,00 recebido');
    expect(sent[3]!.body).toContain('Falta R$ 324,00');
    expect(sent[4]!.body).toBe(p1.pix.copyPaste);

    // the WhatsApp link sees what's due now
    const track = orderTrackToken('s', s.id, o.id, o.placedAt);
    const seen = await call('GET', `/checkout/v1/orders/${o.id}`, undefined, {
      host: s.host,
      authorization: `Bearer ${track}`,
    });
    expect(seen.body.order.statusOnly).toBe(true);
    expect(seen.body.order.payment).toEqual({
      status: 'pending',
      online: false,
      dueCents: 32_400,
      pix: { copyPaste: p1.pix.copyPaste, expiresAt: null },
      sinal: { depositCents: 21_600, balanceCents: 32_400, depositPaid: true, balancePaid: false },
    });
    expect(seen.body.order.customer).toBeUndefined();

    const all = await s.owner('POST', `/orders/${o.id}/payment`, { status: 'paid', charge: 'all' });
    const p2 = all.body.order.payment;
    expect(p2.status).toBe('paid');
    expect(p2.paidAt).toBeTruthy();
    expect(p2.pix).toBeNull();
    sent = await messages(o.id);
    expect(sent.at(-1)!.event).toBe('paid');

    // undo: the rest goes back to open, the sinal stays
    const undo = await s.owner('POST', `/orders/${o.id}/payment`, { status: 'pending' });
    expect(undo.body.order.payment).toMatchObject({ status: 'pending', paidAt: null });
    expect(undo.body.order.payment.sinal.depositPaidAt).toBeTruthy();
    expect(undo.body.order.payment.sinal.balancePaidAt).toBeNull();
    expect(undo.body.order.payment.pix.copyPaste).toContain(amountTag(32_400));
  });

  test('the caixa takes the rest after the sinal, or the whole before it', async () => {
    const s = await store();
    await s.owner('PATCH', '/store', { sinal: { bps: 4000 } });
    await s.owner('POST', '/pdv/caixa/open', { openingCents: 0 });
    const a = await partyCart(s);
    const o = (await checkout(a.auth, a.cart)).body.order;
    await s.owner('POST', `/orders/${o.id}/payment`, { status: 'paid', charge: 'deposit' });
    const whole = await s.owner('POST', `/pdv/orders/${o.id}/payments`, {
      payments: [{ method: 'cash', amountCents: 54_000 }],
    });
    expect(whole.status).toBe(422);
    expect(whole.body.error.details.totalCents).toBe(32_400);
    const rest = await s.owner('POST', `/pdv/orders/${o.id}/payments`, {
      payments: [{ method: 'credit', amountCents: 32_400 }],
    });
    expect(rest.status).toBe(200);
    expect(rest.body.order.payment).toMatchObject({ status: 'paid', provider: 'pdv' });
    expect(rest.body.order.payment.sinal).toMatchObject({
      depositVia: 'manual',
      balanceVia: 'pdv',
    });

    const b = await partyCart(s);
    const o2 = (await checkout(b.auth, b.cart)).body.order;
    const all = await s.owner('POST', `/pdv/orders/${o2.id}/payments`, {
      payments: [{ method: 'pix', amountCents: 54_000 }],
    });
    expect(all.status).toBe(200);
    expect(all.body.order.payment.sinal).toMatchObject({ depositVia: 'pdv', balanceVia: 'pdv' });
  });

  test('Mercado Pago: each part is its own Pix; the sinal alone is not paid; a cancel keeps it', async () => {
    const s = await store();
    const c = await s.owner('POST', '/payments/mercadopago/connect');
    const u = new URL(c.body.url);
    await s.owner('GET', `${u.pathname.replace('/admin/v1', '')}${u.search}`);
    await s.owner('PATCH', '/payments', { methods: ['pix', 'cash'] });
    await s.owner('PATCH', '/store', { sinal: { bps: 4000 } });
    const hook = (id: string) => {
      const w = fake.webhook('payment', id);
      return call(
        'POST',
        `/admin/v1/hooks/mercadopago?t=${s.id}&data.id=${id}&type=payment`,
        w.body,
        {
          ...w.headers,
          'x-vendua-admin': '',
        },
      );
    };
    const rows = (orderId: string) =>
      sql<{ provider_payment_id: string; amount_cents: number; charge: string; status: string }[]>`
        select provider_payment_id, amount_cents, charge, status from payments
        where order_id = ${orderId} order by attempt`;

    const { auth, cart } = await partyCart(s);
    const o = (await checkout(auth, cart)).body.order;
    expect(o.payment).toMatchObject({ online: true, status: 'pending', pix: null });
    expect(o.payment.sinal.depositCents).toBe(21_600);

    // the WhatsApp link can ask for the Pix too, and reads only the status view back
    const track = {
      host: s.host,
      authorization: `Bearer ${orderTrackToken('s', s.id, o.id, o.placedAt)}`,
    };
    const p1 = await call('POST', `/checkout/v1/orders/${o.id}/pay`, undefined, track);
    expect(p1.status).toBe(200);
    expect(p1.body.next.kind).toBe('pix');
    expect(p1.body.order.statusOnly).toBe(true);
    expect(p1.body.order.payment).toMatchObject({ dueCents: 21_600, online: true });
    let r = await rows(o.id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ amount_cents: 21_600, charge: 'deposit' });
    expect(fake.payments.get(r[0]!.provider_payment_id)!.amountCents).toBe(21_600);

    fake.settle(r[0]!.provider_payment_id, 'approved');
    expect((await hook(r[0]!.provider_payment_id)).status).toBe(200);
    const mid = (await call('GET', `/checkout/v1/orders/${o.id}`, undefined, auth)).body.order;
    expect(mid.payment.status).toBe('pending');
    expect(mid.payment.paidAt).toBeNull();
    expect(mid.payment.sinal).toMatchObject({ depositVia: 'online', balancePaidAt: null });
    expect((await messages(o.id)).map((m) => m.event)).toContain('sinal_paid');

    // the rest: a second Pix for its own amount, not flagged as paid twice
    const p2 = await call('POST', `/checkout/v1/orders/${o.id}/pay`, undefined, auth);
    expect(p2.body.next.kind).toBe('pix');
    r = await rows(o.id);
    expect(r[1]).toMatchObject({ amount_cents: 32_400, charge: 'balance' });
    fake.settle(r[1]!.provider_payment_id, 'approved');
    await hook(r[1]!.provider_payment_id);
    const done = (await call('GET', `/checkout/v1/orders/${o.id}`, undefined, auth)).body.order;
    expect(done.payment.status).toBe('paid');
    expect(done.payment.paidAt).toBeTruthy();
    expect(done.payment.sinal).toMatchObject({ depositVia: 'online', balanceVia: 'online' });
    const [flag] = await sql<{ n: number }[]>`
      select count(*)::int as n from payments where order_id = ${o.id} and review is not null`;
    expect(flag!.n).toBe(0);
    expect((await messages(o.id)).at(-1)!.event).toBe('paid');

    // cancelling after the sinal: a manager's call, and the sinal stays with the store
    const b = await partyCart(s);
    const o2 = (await checkout(b.auth, b.cart)).body.order;
    await call('POST', `/checkout/v1/orders/${o2.id}/pay`, undefined, b.auth);
    const dep = (await rows(o2.id))[0]!;
    fake.settle(dep.provider_payment_id, 'approved');
    await hook(dep.provider_payment_id);
    const attendant = await login(s.id, 'attendant');
    const no = await attendant('POST', `/orders/${o2.id}/transition`, {
      to: 'cancelled',
      reason: 'cliente desistiu',
    });
    expect(no.status).toBe(403);
    const refundsBefore = fake.refunds.length;
    const cancel = await s.owner('POST', `/orders/${o2.id}/transition`, {
      to: 'cancelled',
      reason: 'cliente desistiu',
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.order.state).toBe('cancelled');
    expect(fake.refunds.length).toBe(refundsBefore);
    // Mercado Pago sending the sinal's webhook again doesn't give it back either
    expect((await hook(dep.provider_payment_id)).status).toBe(200);
    expect(fake.refunds.length).toBe(refundsBefore);
    // the manager gives it back when the policy says so: Estornar
    const back = await s.owner('POST', `/orders/${o2.id}/refund`, { reason: 'política da loja' });
    expect(back.status).toBe(200);
    expect(fake.refunds.length).toBe(refundsBefore + 1);
    expect(back.body.payments[0].charge).toBe('deposit');

    // the rest taken at the caixa, then its open Pix paid too: flagged, never silent
    await s.owner('POST', '/pdv/caixa/open', { openingCents: 0 });
    const c3 = await partyCart(s);
    const o3 = (await checkout(c3.auth, c3.cart)).body.order;
    await call('POST', `/checkout/v1/orders/${o3.id}/pay`, undefined, c3.auth);
    const d3 = (await rows(o3.id))[0]!;
    fake.settle(d3.provider_payment_id, 'approved');
    await hook(d3.provider_payment_id);
    await call('POST', `/checkout/v1/orders/${o3.id}/pay`, undefined, c3.auth);
    const b3 = (await rows(o3.id))[1]!;
    expect(b3.charge).toBe('balance');
    const counter = await s.owner('POST', `/pdv/orders/${o3.id}/payments`, {
      payments: [{ method: 'cash', amountCents: 32_400 }],
    });
    expect(counter.status).toBe(200);
    expect(counter.body.order.payment).toMatchObject({ status: 'paid', online: true });
    fake.settle(b3.provider_payment_id, 'approved');
    await hook(b3.provider_payment_id);
    const [twice] = await sql<{ review: string | null }[]>`
      select review from payments where provider_payment_id = ${b3.provider_payment_id}`;
    expect(twice!.review).toBe('paid_twice');
  });
});
