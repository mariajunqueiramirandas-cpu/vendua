import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, membershipsFor } from '../src/admin/auth.ts';
import { aiAllowanceTx, claimAiConversationTx } from '../src/modules/billing/ai-allowance.ts';
import { planHas, requireFeature } from '../src/modules/billing/plans.ts';
import { billingStaff } from '../src/modules/billing/subscriptions.ts';
import { handleBillingWebhook } from '../src/modules/billing/webhook.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { enqueueOrderPrintTx } from '../src/modules/printing/jobs.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

// ADR 0032: what each plan includes (KDS, printing, loyalty, the Vendedor, domain and site), the
// Vendedor's conversation allowance and the packs that add to it.

const DAY = 86_400_000;
const NONE = {
  customDomain: false,
  customSite: false,
  kds: false,
  printing: false,
  loyalty: false,
  vendedor: false,
};

describe.skipIf(!process.env.TEST_DATABASE_URL)('plan tiers (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  // provider ids are process-local counters; start past anything another run left behind
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const notify = { whatsapp: async () => {}, email: async () => {} };
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    paymentProvider: fake,
    notify,
  });
  const nonce = crypto.randomUUID().slice(0, 6);
  const created: string[] = [];
  const tempPlan = `pt_${nonce}`;
  const aiPlan = `pt_${nonce}_ai`;
  const tempPack = `pt_${nonce}_pack`;
  let idem = 0;
  const originalStaff = billingStaff.notify;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const host = headers.host ?? 'core.localhost';
    const res = await app.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
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
    };
  };
  const control = (method: string, path: string, body?: unknown) =>
    call(method, path, body, { 'x-vendua-control': 'ctl' });

  /** a store on `plan` with a signed-in owner; `sub` writes its subscription row directly */
  const store = async (
    name: string,
    plan: string,
    sub: 'active' | 'trialing' | 'pending' | null = null,
  ) => {
    const slug = `tier-${nonce}-${name}`;
    const legacy = plan === 'spike';
    const phone = `217${String(Date.now() + created.length * 17).slice(-8)}`;
    const id = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, ${'Loja ' + name}, ${legacy ? 'mirim' : plan},
                               ${`${slug}.vendua.test`},
                               'Bia Dona', ${phone}, 'bia@example.com') as id
      `
    )[0]!.id;
    created.push(id);
    // provisioning takes catalog plans only; a pilot store is one the team moved by hand
    if (legacy) await sql`update tenants set plan = ${plan} where id = ${id}`;
    if (sub === 'trialing')
      await sql`
        insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_email,
                                   current_period_start, current_period_end, trial_ends_at)
        values (${id}, ${plan}, 'pix', 'trialing', 'fake', 'bia@example.com',
                now(), now() + interval '14 days', now() + interval '14 days')
      `;
    else if (sub)
      await sql`
        insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_email,
                                   current_period_start, current_period_end)
        values (${id}, ${plan}, 'pix', ${sub}, 'fake', 'bia@example.com',
                now(), now() + interval '30 days')
      `;
    if (sub === 'active' || sub === 'trialing')
      await sql`update store_settings set billing_hold = false, status_override = null, pause_message = null where tenant_id = ${id}`;
    const m = (await membershipsFor(appSql, phone)).find((x) => x.tenant_id === id)!;
    const cookie = `vendua_admin=${await createSession(appSql, m, 'test')}`;
    const owner = (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie });
    return { id, slug, phone, host: `${slug}.vendua.test`, owner };
  };

  const has = (tenantId: string, f: Parameters<typeof planHas>[2]) =>
    withTenant(appSql, tenantId, (tx) => planHas(tx, tenantId, f));
  const gate = async (tenantId: string, f: Parameters<typeof requireFeature>[2]) => {
    try {
      await withTenant(appSql, tenantId, (tx) => requireFeature(tx, tenantId, f));
      return null;
    } catch (e) {
      return e as { status: number; code: string; details: Record<string, unknown> };
    }
  };

  const loyaltyProgram = {
    stampsRequired: 2,
    minOrderCents: 0,
    reward: { kind: 'fixed', value: 500, label: 'R$ 5' },
    rewardValidDays: 60,
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    billingStaff.notify = async () => {};
    await sql`
      insert into plans (id, name, price_cents, features, public, sort, ai_conversations,
                         ai_trial_conversations)
      values (${tempPlan}, 'Plano teste', 5000, ${sql.json({ loyalty: true, vendedor: true })},
              false, 99, 0, 0),
             (${aiPlan}, 'Plano conversas', 5000, ${sql.json({ vendedor: true })},
              false, 99, 2, 1)
    `;
    await sql`
      insert into ai_packs (id, name, price_cents, conversations, public, sort)
      values (${tempPack}, 'Pacote teste', 1990, 10, false, 99)
    `;
  });

  afterAll(async () => {
    billingStaff.notify = originalStaff;
    // the catalog is shared with every other test: the launch plan leads again
    await sql`update plans set recommended = false where recommended and id <> 'bandeira'`;
    await sql`update plans set recommended = true where id = 'bandeira'`;
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    await sql`delete from plans where id in (${tempPlan}, ${aiPlan})`;
    await sql`delete from ai_packs where id = ${tempPack}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('the catalog: three public plans in order, Bandeira recommended, packs listed', async () => {
    const r = await call('GET', '/admin/v1/signup/plans');
    expect(r.status).toBe(200);
    const plans = r.body.plans as any[];
    expect(plans.map((p) => p.id)).toEqual(['mirim', 'bandeira', 'pangolin']);
    expect(plans.filter((p) => p.recommended).map((p) => p.id)).toEqual(['bandeira']);
    expect(plans.map((p) => [p.priceCents, p.trialDays, p.feeBps])).toEqual([
      [6990, 0, 0],
      [16900, 14, 0],
      [44900, 0, 0],
    ]);
    expect(plans[0].features).toEqual(NONE);
    expect(plans[1].features).toEqual({
      ...NONE,
      kds: true,
      printing: true,
      loyalty: true,
      vendedor: true,
    });
    expect(Object.values(plans[2].features).every((v) => v === true)).toBe(true);
    expect(plans.map((p) => [p.aiConversations, p.aiTrialConversations])).toEqual([
      [0, 0],
      [250, 50],
      [1000, 50],
    ]);
  });

  test('Mirim: KDS, printing and turning loyalty on answer 403 PLAN_REQUIRED', async () => {
    const s = await store('mirim', 'mirim', 'active');
    const kds = await s.owner('GET', '/kitchen');
    expect(kds.status).toBe(403);
    expect(kds.body.error).toMatchObject({ code: 'PLAN_REQUIRED', details: { feature: 'kds' } });
    expect(kds.body.error.details.reason).toBeUndefined();
    const stations = await s.owner('PUT', '/kitchen/stations', { stations: [] });
    expect(stations.body.error.code).toBe('PLAN_REQUIRED');

    const pairing = await s.owner('POST', '/printers/pairing', { code: 'ABCD-EFGH' });
    expect(pairing.status).toBe(403);
    expect(pairing.body.error).toMatchObject({
      code: 'PLAN_REQUIRED',
      details: { feature: 'printing' },
    });
    expect((await s.owner('GET', '/printers/pairing/ABCDEFGH')).status).toBe(403);
    expect((await s.owner('PATCH', '/printers/settings', { printOn: 'placed' })).status).toBe(403);

    // a device paired before: the list answers, but shows nothing to print to
    await sql`insert into print_devices (tenant_id, name, platform) values (${s.id}, 'CAIXA', 'windows')`;
    const printers = await s.owner('GET', '/printers');
    expect(printers.status).toBe(200);
    expect(printers.body).toMatchObject({ included: false, devices: [] });

    const on = await s.owner('PUT', '/loyalty', { program: loyaltyProgram });
    expect(on.status).toBe(403);
    expect(on.body.error).toMatchObject({ code: 'PLAN_REQUIRED', details: { feature: 'loyalty' } });
    expect(
      (await sql`select loyalty from store_settings where tenant_id = ${s.id}`)[0]!.loyalty,
    ).toBeNull();
    const off = await s.owner('PUT', '/loyalty', { program: null });
    expect(off.status).toBe(200);
    expect(off.body.program).toBeNull();

    expect(await gate(s.id, 'vendedor')).toMatchObject({ status: 403, code: 'PLAN_REQUIRED' });
    expect(await has(s.id, 'kds')).toBe(false);
  });

  test('Bandeira paid opens its features; in the trial too, but the domain waits for payment', async () => {
    const paid = await store('band', 'bandeira', 'active');
    expect((await paid.owner('GET', '/kitchen')).status).toBe(200);
    const printers = await paid.owner('GET', '/printers');
    expect(printers.body).toMatchObject({ included: true, devices: [] });
    const loy = await paid.owner('PUT', '/loyalty', { program: loyaltyProgram });
    expect(loy.status).toBe(200);
    expect(loy.body.program.stampsRequired).toBe(2);
    // Bandeira has no own domain at all: that is the plan, not the payment
    const dom = await paid.owner('POST', '/account/domains', { host: `b-${nonce}.example.com` });
    expect(dom.status).toBe(403);
    expect(dom.body.error.details).toEqual({ feature: 'customDomain' });

    const trial = await store('trial', 'bandeira', 'trialing');
    expect((await trial.owner('GET', '/kitchen')).status).toBe(200);
    for (const f of ['kds', 'printing', 'loyalty', 'vendedor'] as const)
      expect(await has(trial.id, f)).toBe(true);

    // ADR 0025: during a trial, only the domain and the site stay locked until the first payment
    const pang = await store('pangtrial', 'pangolin', 'trialing');
    expect((await pang.owner('GET', '/kitchen')).status).toBe(200);
    expect(await gate(pang.id, 'customDomain')).toMatchObject({
      status: 403,
      code: 'PLAN_REQUIRED',
      details: { feature: 'customDomain', reason: 'unpaid' },
    });
    const site = await pang.owner('POST', '/account/site-request', { brief: 'Um site bonito' });
    expect(site.body.error).toMatchObject({
      code: 'PLAN_REQUIRED',
      details: { feature: 'customSite', reason: 'unpaid' },
    });

    // a pending (never paid) Bandeira store gets nothing yet
    const pending = await store('pend', 'bandeira', 'pending');
    const k = await pending.owner('GET', '/kitchen');
    expect(k.status).toBe(403);
    expect(k.body.error.details).toEqual({ feature: 'kds', reason: 'unpaid' });
  });

  test('legacy pilot stores keep KDS, printing and loyalty, not the domain', async () => {
    const s = await store('spike', 'spike');
    // the team set it up by hand: no subscription and not held for payment
    await sql`update store_settings set billing_hold = false where tenant_id = ${s.id}`;
    expect((await s.owner('GET', '/kitchen')).status).toBe(200);
    expect((await s.owner('GET', '/printers')).body.included).toBe(true);
    expect((await s.owner('PUT', '/loyalty', { program: loyaltyProgram })).status).toBe(200);
    expect(await has(s.id, 'vendedor')).toBe(true);
    expect(await gate(s.id, 'customDomain')).toMatchObject({ code: 'PLAN_REQUIRED' });
  });

  test('GET /session: plan.features is what is open right now', async () => {
    const mirim = await store('sess-m', 'mirim', 'active');
    const r = await mirim.owner('GET', '/session');
    expect(r.status).toBe(200);
    expect(r.body.plan).toEqual({ id: 'mirim', name: 'Venduá Mirim', features: NONE });

    const trial = await store('sess-t', 'pangolin', 'trialing');
    expect((await trial.owner('GET', '/session')).body.plan).toEqual({
      id: 'pangolin',
      name: 'Venduá Pangolin',
      features: { ...NONE, kds: true, printing: true, loyalty: true, vendedor: true },
    });
    const paid = await store('sess-p', 'pangolin', 'active');
    expect((await paid.owner('GET', '/session')).body.plan.features).toEqual({
      customDomain: true,
      customSite: true,
      kds: true,
      printing: true,
      loyalty: true,
      vendedor: true,
    });
    // any role gets it
    const attendant = `217${String(Date.now() + 999).slice(-8)}`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${paid.id}, 'Caio', ${attendant}, 'attendant')`;
    const m = (await membershipsFor(appSql, attendant)).find((x) => x.tenant_id === paid.id)!;
    const cookie = `vendua_admin=${await createSession(appSql, m, 'test')}`;
    const as = await call('GET', '/admin/v1/session', undefined, { cookie });
    expect(as.status).toBe(200);
    expect(as.body.plan.features.kds).toBe(true);
  });

  describe('a plan without loyalty or printing never breaks an order', () => {
    /** an open store ready to sell, with a stored loyalty card and an automatic printer */
    const shop = async (name: string, plan: string) => {
      const s = await store(name, plan);
      await sql`
        update store_settings set billing_hold = false, status_override = null,
          pause_message = null, pickup_enabled = true, min_order_cents = 0,
          hours = ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
          loyalty = ${sql.json(loyaltyProgram)}
        where tenant_id = ${s.id}
      `;
      const cat = (
        await sql<{ id: string }[]>`
          insert into categories (tenant_id, slug, name) values (${s.id}, 'doces', 'Doces') returning id
        `
      )[0]!.id;
      const productId = (
        await sql<{ id: string }[]>`
          insert into products (tenant_id, category_id, slug, name, base_price_cents)
          values (${s.id}, ${cat}, 'pudim', 'Pudim', 2000) returning id
        `
      )[0]!.id;
      const device = (
        await sql<{ id: string }[]>`
          insert into print_devices (tenant_id, name, platform) values (${s.id}, 'CAIXA', 'windows')
          returning id
        `
      )[0]!.id;
      await sql`
        insert into printers (tenant_id, device_id, key, kind, name, address, auto)
        values (${s.id}, ${device}, 'spooler:EPSON', 'spooler', 'EPSON', 'EPSON', true)
      `;
      const shopper = { host: s.host };
      const order = async (phone: string) => {
        const sess = await call('POST', '/checkout/v1/session', undefined, shopper);
        expect(sess.status).toBe(201);
        const auth = { ...shopper, authorization: `Bearer ${sess.body.sessionToken}` };
        expect(
          (await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, auth)).status,
        ).toBe(200);
        const r = await call(
          'POST',
          '/checkout/v1/checkout',
          {
            customer: { name: 'Xana', phone },
            delivery: { mode: 'pickup' },
            payment: { method: 'cash' },
          },
          auth,
        );
        expect(r.body.error ?? null).toBeNull();
        expect(r.status).toBe(201);
        return r.body as { order: { id: string }; customerToken: string };
      };
      const deliver = async (orderId: string) => {
        for (const to of ['confirmed', 'preparing', 'ready', 'delivered'])
          expect(
            (
              await control(
                'POST',
                `/control/v1/storefronts/${s.slug}/commerce/orders/${orderId}/transition`,
                {
                  to,
                },
              )
            ).status,
          ).toBe(200);
      };
      const fiel = async () =>
        (await sql`select code from coupons where tenant_id = ${s.id} and code like 'FIEL-%'`).map(
          (r) => r.code as string,
        );
      const jobs = async () =>
        (
          await sql<
            { n: number }[]
          >`select count(*)::int as n from print_jobs where tenant_id = ${s.id}`
        )[0]!.n;
      return { ...s, order, deliver, fiel, jobs };
    };

    test('Mirim: no card on the storefront, no reward minted, no ticket queued', async () => {
      const s = await shop('quiet', 'mirim');
      const st = await call('GET', '/storefront/v1/store', undefined, { host: s.host });
      expect(st.status).toBe(200);
      expect(st.body.loyalty).toBeNull();

      const phone = '22911112222';
      const a = await s.order(phone);
      const b = await s.order(phone);
      await s.deliver(a.order.id);
      await s.deliver(b.order.id);
      expect(await s.fiel()).toEqual([]);
      expect(await s.jobs()).toBe(0);
      expect(
        await withTenant(appSql, s.id, (tx) =>
          enqueueOrderPrintTx(tx, s.id, a.order.id, 'confirmed'),
        ),
      ).toBe(0);
      const card = await call('GET', '/checkout/v1/customer/loyalty', undefined, {
        host: s.host,
        'x-vendua-customer': a.customerToken,
      });
      expect(card.status).toBe(200);
      expect(card.body.loyalty.enabled).toBe(false);
      // the program is kept for when the plan has it again
      expect(
        (await sql`select loyalty from store_settings where tenant_id = ${s.id}`)[0]!.loyalty,
      ).toMatchObject({ stampsRequired: 2 });
    });

    test('the same store on a plan with them: card shown, reward minted, tickets queued', async () => {
      const s = await shop('loud', 'spike');
      const st = await call('GET', '/storefront/v1/store', undefined, { host: s.host });
      expect(st.body.loyalty).toMatchObject({ stampsRequired: 2 });
      const phone = '22911113333';
      const a = await s.order(phone);
      const b = await s.order(phone);
      await s.deliver(a.order.id);
      await s.deliver(b.order.id);
      expect(await s.fiel()).toHaveLength(1);
      expect(await s.jobs()).toBe(2);
    });
  });

  describe('the Vendedor conversations', () => {
    const claim = (tenantId: string, subject: string, now = new Date()) =>
      withTenant(appSql, tenantId, (tx) => claimAiConversationTx(tx, tenantId, subject, now));
    const allowance = (tenantId: string) =>
      withTenant(appSql, tenantId, (tx) => aiAllowanceTx(tx, tenantId));
    /** a paid pack's conversations, as the settled invoice would add them */
    const credit = async (tenantId: string, conversations: number) => {
      const inv = (
        await sql<{ id: string }[]>`
          insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                                method, status, provider, due_at, kind, ai_pack_id,
                                ai_conversations)
          values (${tenantId},
                  (select coalesce(max(number), 0) + 1 from invoices where tenant_id = ${tenantId}),
                  ${aiPlan}, 3990, now(), now(), 'pix', 'paid', 'fake', now(), 'ai_pack', 'ai_100',
                  ${conversations})
          returning id
        `
      )[0]!.id;
      await sql`insert into ai_credits (tenant_id, invoice_id, conversations) values (${tenantId}, ${inv}, ${conversations})`;
    };
    const sources = async (tenantId: string) =>
      (
        await sql`select source from ai_conversations where tenant_id = ${tenantId} order by started_at, source`
      ).map((r) => r.source as string);

    test('counted once per subject a day; the month first, then packs; then exhausted', async () => {
      const s = await store('ai-month', aiPlan, 'active');
      await credit(s.id, 1);
      expect(await allowance(s.id)).toMatchObject({
        included: true,
        period: 'month',
        limit: 2,
        used: 0,
        packRemaining: 1,
        remaining: 3,
      });
      const t0 = new Date();
      const a = await claim(s.id, 'thread-a', t0);
      expect(a).toMatchObject({ ok: true, counted: true });
      const again = await claim(s.id, 'thread-a', new Date(t0.getTime() + 60_000));
      expect(again).toEqual({
        ok: true,
        counted: false,
        conversationId: (a as { conversationId: string }).conversationId,
      });
      expect((await claim(s.id, 'thread-b', new Date(t0.getTime() + 1000))).ok).toBe(true);
      expect(await sources(s.id)).toEqual(['plan', 'plan']);
      // the month's two are spent: the pack pays for the third
      expect(await claim(s.id, 'thread-c', new Date(t0.getTime() + 2000))).toMatchObject({
        ok: true,
        counted: true,
      });
      expect(await sources(s.id)).toEqual(['plan', 'plan', 'pack']);
      const out = await claim(s.id, 'thread-d', new Date(t0.getTime() + 3000));
      expect(out).toMatchObject({ ok: false, reason: 'exhausted' });
      expect((out as { allowance: { remaining: number } }).allowance.remaining).toBe(0);
      // a conversation already open keeps going after the allowance ran out
      expect(await claim(s.id, 'thread-b', new Date(t0.getTime() + 4000))).toMatchObject({
        ok: true,
        counted: false,
      });
      const acct = await s.owner('GET', '/account');
      expect(acct.body.ai).toMatchObject({
        included: true,
        period: 'month',
        limit: 2,
        used: 2,
        packRemaining: 0,
        remaining: 0,
      });
      expect(new Date(acct.body.ai.resetsAt).getTime()).toBeGreaterThan(Date.now());
      await expect(claim(s.id, '')).rejects.toThrow(RangeError);
      await expect(claim(s.id, 'x'.repeat(201))).rejects.toThrow(RangeError);
    });

    test('a subject counts again once its day is over', async () => {
      const s = await store('ai-day', 'bandeira', 'active');
      const t0 = new Date();
      expect((await claim(s.id, 'thread', t0)).ok).toBe(true);
      const later = await claim(s.id, 'thread', new Date(t0.getTime() + DAY + 60_000));
      expect(later).toMatchObject({ ok: true, counted: true });
      expect(await sources(s.id)).toHaveLength(2);
    });

    test('an open conversation stops when the plan loses the Vendedor', async () => {
      const s = await store('ai-lost', 'bandeira', 'active');
      const t0 = new Date();
      expect(await claim(s.id, 'thread', t0)).toMatchObject({ ok: true, counted: true });
      // a downgrade to Mirim lands mid-conversation
      await sql`update tenants set plan = 'mirim' where id = ${s.id}`;
      await sql`update subscriptions set plan_id = 'mirim' where tenant_id = ${s.id}`;
      expect(await claim(s.id, 'thread', new Date(t0.getTime() + 60_000))).toMatchObject({
        ok: false,
        reason: 'plan',
      });
      expect(await sources(s.id)).toEqual(['plan']);
    });

    test('Mirim has no Vendedor: reason plan, nothing recorded', async () => {
      const s = await store('ai-mirim', 'mirim', 'active');
      const r = await claim(s.id, 'thread');
      expect(r).toMatchObject({ ok: false, reason: 'plan', allowance: { included: false } });
      expect(await sources(s.id)).toEqual([]);
      expect((await s.owner('GET', '/account')).body.ai).toMatchObject({
        included: false,
        period: null,
        remaining: 0,
      });
    });

    test('a trial runs on its own allowance and ignores packs', async () => {
      const s = await store('ai-trial', aiPlan, 'trialing');
      await credit(s.id, 5);
      expect(await allowance(s.id)).toMatchObject({
        period: 'trial',
        limit: 1,
        used: 0,
        packRemaining: 5,
        remaining: 1,
        resetsAt: null,
      });
      expect((await claim(s.id, 'thread-a')).ok).toBe(true);
      expect(await claim(s.id, 'thread-b')).toMatchObject({ ok: false, reason: 'exhausted' });
      expect(await sources(s.id)).toEqual(['trial']);

      // Bandeira's own trial allowance is its 50
      const band = await store('ai-btrial', 'bandeira', 'trialing');
      expect(await allowance(band.id)).toMatchObject({ period: 'trial', limit: 50, remaining: 50 });
    });

    test('two shoppers at once for the last conversation: exactly one gets it', async () => {
      const s = await store('ai-race', aiPlan, 'active');
      expect((await claim(s.id, 'first')).ok).toBe(true);
      const res = await Promise.all([claim(s.id, 'race-a'), claim(s.id, 'race-b')]);
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      expect(res.filter((r) => !r.ok)).toMatchObject([{ reason: 'exhausted' }]);
      expect(await sources(s.id)).toEqual(['plan', 'plan']);
    });
  });

  describe('AI packs', () => {
    const payInvoice = (id: string) => call('POST', `/admin/v1/dev/billing/invoices/${id}/pay`, {});
    const hook = (id: string) =>
      handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
        kind: 'payment',
        resourceId: id,
        providerUserId: null,
        action: null,
      });

    test('bought on a paid Bandeira: one Pix invoice, credited once when paid', async () => {
      const s = await store('pack', 'bandeira');
      const st = await s.owner('POST', '/account/subscription', {
        planId: 'bandeira',
        method: 'pix',
        payerEmail: 'bia@example.com',
      });
      expect(st.status).toBe(200);
      expect((await payInvoice(st.body.invoices[0].id)).status).toBe(200);
      const period = (
        await sql`select status, current_period_end from subscriptions where tenant_id = ${s.id}`
      )[0]!;
      expect(period.status).toBe('active');

      const acct0 = await s.owner('GET', '/account');
      expect(acct0.body.aiPacks).toEqual([
        { id: 'ai_100', name: '+100 conversas', priceCents: 3990, conversations: 100 },
      ]);
      expect(acct0.body.ai).toMatchObject({ included: true, limit: 250, packRemaining: 0 });

      expect((await s.owner('POST', '/account/ai-packs', { packId: 'nope' })).body.error.code).toBe(
        'UNKNOWN_AI_PACK',
      );
      // a pack the team keeps off the catalog can't be bought either
      expect(
        (await s.owner('POST', '/account/ai-packs', { packId: tempPack })).body.error.code,
      ).toBe('UNKNOWN_AI_PACK');

      const buy = await s.owner('POST', '/account/ai-packs', { packId: 'ai_100' });
      expect(buy.status).toBe(200);
      const inv = buy.body.invoices.find((i: any) => i.id === buy.body.invoiceId);
      expect(inv).toMatchObject({
        kind: 'ai_pack',
        aiPackName: '+100 conversas',
        amountCents: 3990,
        status: 'open',
        method: 'pix',
      });
      expect(inv.pix.copyPaste).toContain('FAKEPIX');
      const again = await s.owner('POST', '/account/ai-packs', { packId: 'ai_100' });
      expect(again.body.invoiceId).toBe(buy.body.invoiceId);
      const open =
        await sql`select id, provider_payment_id from invoices where tenant_id = ${s.id} and kind = 'ai_pack'`;
      expect(open).toHaveLength(1);

      expect((await payInvoice(buy.body.invoiceId)).status).toBe(200);
      const credits = await sql`select conversations from ai_credits where tenant_id = ${s.id}`;
      expect(credits.map((c) => c.conversations)).toEqual([100]);
      const acct = await s.owner('GET', '/account');
      expect(acct.body.ai).toMatchObject({ packRemaining: 100, remaining: 350 });
      expect(acct.body.invoices.find((i: any) => i.id === buy.body.invoiceId).status).toBe('paid');
      // a pack is not a month: the paid period stays where it was
      const after = (
        await sql`select status, current_period_end from subscriptions where tenant_id = ${s.id}`
      )[0]!;
      expect(after.status).toBe('active');
      expect(after.current_period_end.getTime()).toBe(period.current_period_end.getTime());

      // Mercado Pago replays the payment: no second credit
      await hook(open[0]!.provider_payment_id);
      await hook(open[0]!.provider_payment_id);
      expect(
        (await sql`select count(*)::int as n from ai_credits where tenant_id = ${s.id}`)[0]!.n,
      ).toBe(1);
      expect((await s.owner('GET', '/account')).body.ai.packRemaining).toBe(100);

      // the next pack is a new invoice
      const next = await s.owner('POST', '/account/ai-packs', { packId: 'ai_100' });
      expect(next.status).toBe(200);
      expect(next.body.invoiceId).not.toBe(buy.body.invoiceId);
    });

    test('packs never crowd an unpaid plan invoice out of Conta', async () => {
      const s = await store('packcap', 'bandeira');
      const st = await s.owner('POST', '/account/subscription', {
        planId: 'bandeira',
        method: 'pix',
        payerEmail: 'bia@example.com',
      });
      expect((await payInvoice(st.body.invoices[0].id)).status).toBe(200);
      const t0 = Date.now() - 40 * DAY;
      await sql`
        insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                              method, status, provider, due_at, kind)
        values (${s.id}, 100, 'bandeira', 16900, ${new Date(t0)}, ${new Date(t0 + 30 * DAY)},
                'pix', 'open', 'fake', ${new Date(t0)}, 'period')`;
      for (let n = 0; n < 13; n++)
        await sql`
          insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end,
                                method, status, provider, due_at, paid_at, kind, ai_pack_id,
                                ai_conversations)
          values (${s.id}, ${101 + n}, 'bandeira', 3990, ${new Date(t0 + (n + 1) * 1000)},
                  ${new Date(t0 + (n + 1) * 1000)}, 'pix', 'paid', 'fake', ${new Date(t0)}, now(),
                  'ai_pack', 'ai_100', 100)`;
      const acct = await s.owner('GET', '/account');
      const numbers = acct.body.invoices.map((i: any) => i.number);
      expect(numbers).toContain(100);
      expect(acct.body.invoices.find((i: any) => i.number === 100)).toMatchObject({
        kind: 'period',
        status: 'open',
      });
      expect(numbers.filter((n: number) => n > 100)).toHaveLength(12);
    });

    test('the pack is frozen at purchase: a catalog change before paying credits what was bought', async () => {
      const s = await store('pack-frozen', 'bandeira');
      const st = await s.owner('POST', '/account/subscription', {
        planId: 'bandeira',
        method: 'pix',
        payerEmail: 'bia@example.com',
      });
      await payInvoice(st.body.invoices[0].id);
      await sql`update ai_packs set public = true where id = ${tempPack}`;
      try {
        const buy = await s.owner('POST', '/account/ai-packs', { packId: tempPack });
        expect(buy.status).toBe(200);
        const first = buy.body.invoiceId as string;
        // the team changes the pack while the Pix is open
        const p = await control('PATCH', `/control/v1/ai-packs/${tempPack}`, { conversations: 20 });
        expect(p.body.pack.conversations).toBe(20);
        expect((await payInvoice(first)).status).toBe(200);
        expect(
          (await sql`select conversations from ai_credits where invoice_id = ${first}`).map(
            (r) => r.conversations,
          ),
        ).toEqual([10]);
        expect((await s.owner('GET', '/account')).body.ai.packRemaining).toBe(10);

        // an open pack invoice is reused only while it still matches the pack
        const b2 = await s.owner('POST', '/account/ai-packs', { packId: tempPack });
        await control('PATCH', `/control/v1/ai-packs/${tempPack}`, { conversations: 30 });
        const b3 = await s.owner('POST', '/account/ai-packs', { packId: tempPack });
        expect(b3.body.invoiceId).not.toBe(b2.body.invoiceId);
        const rows = await sql`
          select id, status, ai_conversations from invoices
          where tenant_id = ${s.id} and kind = 'ai_pack' order by number
        `;
        expect(rows.map((r) => [r.status, r.ai_conversations])).toEqual([
          ['paid', 10],
          ['void', 20],
          ['open', 30],
        ]);
        await payInvoice(b3.body.invoiceId);
        expect((await s.owner('GET', '/account')).body.ai.packRemaining).toBe(40);
      } finally {
        await sql`update ai_packs set public = false, conversations = 10 where id = ${tempPack}`;
      }
    });

    test('a trial or a plan without the Vendedor can not buy one', async () => {
      const trial = await store('pack-trial', 'bandeira', 'trialing');
      const t = await trial.owner('POST', '/account/ai-packs', { packId: 'ai_100' });
      expect(t.status).toBe(409);
      expect(t.body.error.code).toBe('AI_PACK_NEEDS_PAID_PLAN');

      const mirim = await store('pack-mirim', 'mirim', 'active');
      const m = await mirim.owner('POST', '/account/ai-packs', { packId: 'ai_100' });
      expect(m.status).toBe(403);
      expect(m.body.error).toMatchObject({
        code: 'PLAN_REQUIRED',
        details: { feature: 'vendedor' },
      });
      // a pilot store has the Vendedor but no paid plan to add a pack to
      const pilot = await store('pack-spike', 'spike');
      await sql`update store_settings set billing_hold = false where tenant_id = ${pilot.id}`;
      const sp = await pilot.owner('POST', '/account/ai-packs', { packId: 'ai_100' });
      expect(sp.status).toBe(409);
      expect(sp.body.error.code).toBe('AI_PACK_NEEDS_PAID_PLAN');
      expect(
        (
          await sql`select 1 from invoices where tenant_id in (${trial.id}, ${mirim.id}, ${pilot.id})`
        ).length,
      ).toBe(0);
    });
  });

  describe('the CRM edits the catalog', () => {
    const recommended = async () =>
      (await sql`select id from plans where recommended order by id`).map((r) => r.id as string);

    test('recommended moves: only one plan leads', async () => {
      expect(await recommended()).toEqual(['bandeira']);
      expect(
        (await call('PATCH', `/control/v1/plans/${tempPlan}`, { recommended: true })).status,
      ).toBe(404);
      const r = await control('PATCH', `/control/v1/plans/${tempPlan}`, { recommended: true });
      expect(r.status).toBe(200);
      expect(r.body.plan).toMatchObject({ id: tempPlan, recommended: true });
      expect(await recommended()).toEqual([tempPlan]);
      const list = await control('GET', '/control/v1/plans');
      expect(list.body.plans.filter((p: any) => p.recommended).map((p: any) => p.id)).toEqual([
        tempPlan,
      ]);
      // a 404 changes nothing
      expect(
        (await control('PATCH', '/control/v1/plans/nope_plan', { recommended: true })).status,
      ).toBe(404);
      expect(await recommended()).toEqual([tempPlan]);
      expect(
        (await control('PATCH', `/control/v1/plans/${tempPlan}`, { recommended: 'yes' })).status,
      ).toBe(422);
      const back = await control('PATCH', '/control/v1/plans/bandeira', { recommended: true });
      expect(back.body.plan.recommended).toBe(true);
      expect(await recommended()).toEqual(['bandeira']);
    });

    test('conversation counts are bounded; features merge and refuse unknown keys', async () => {
      for (const bad of [-1, 100_001, 1.5, '10'])
        expect(
          (await control('PATCH', `/control/v1/plans/${tempPlan}`, { aiConversations: bad }))
            .status,
        ).toBe(422);
      const bt = await control('PATCH', `/control/v1/plans/${tempPlan}`, {
        aiTrialConversations: -1,
      });
      expect(bt.status).toBe(422);
      expect(bt.body.error.details.field).toBe('aiTrialConversations');
      const ok = await control('PATCH', `/control/v1/plans/${tempPlan}`, {
        aiConversations: 100_000,
        aiTrialConversations: 0,
      });
      expect(ok.body.plan).toMatchObject({ aiConversations: 100_000, aiTrialConversations: 0 });

      const merged = await control('PATCH', `/control/v1/plans/${tempPlan}`, {
        features: { kds: true, vendedor: false },
      });
      expect(merged.status).toBe(200);
      expect(merged.body.plan.features).toEqual({
        ...NONE,
        kds: true,
        loyalty: true,
        vendedor: false,
      });
      for (const bad of [{ foo: true }, { kds: 'yes' }, [], null, 'kds'])
        expect(
          (await control('PATCH', `/control/v1/plans/${tempPlan}`, { features: bad })).status,
        ).toBe(422);
      const row = (await sql`select features from plans where id = ${tempPlan}`)[0]!;
      expect(row.features).toEqual({ loyalty: true, vendedor: false, kds: true });
    });

    test('packs: listed, repriced, bounded; a bad id is a 404', async () => {
      expect((await call('GET', '/control/v1/ai-packs')).status).toBe(404);
      const list = await control('GET', '/control/v1/ai-packs');
      expect(list.status).toBe(200);
      expect(list.body.packs.find((p: any) => p.id === 'ai_100')).toMatchObject({
        name: '+100 conversas',
        priceCents: 3990,
        conversations: 100,
        public: true,
      });
      expect(list.body.packs.find((p: any) => p.id === tempPack)).toMatchObject({ public: false });

      const p = await control('PATCH', `/control/v1/ai-packs/${tempPack}`, { priceCents: 2490 });
      expect(p.status).toBe(200);
      expect(p.body.pack).toMatchObject({ id: tempPack, priceCents: 2490, conversations: 10 });
      for (const body of [
        { priceCents: 99 },
        { priceCents: 10_000_001 },
        { priceCents: 24.9 },
        { conversations: 0 },
        { name: 'x' },
        { public: 'no' },
      ])
        expect((await control('PATCH', `/control/v1/ai-packs/${tempPack}`, body)).status).toBe(422);
      expect(
        (await control('PATCH', '/control/v1/ai-packs/NOPE!', { priceCents: 2490 })).status,
      ).toBe(404);
      expect(
        (await control('PATCH', '/control/v1/ai-packs/nope_pack', { priceCents: 2490 })).status,
      ).toBe(404);
      expect(
        (await sql`select price_cents from ai_packs where id = 'ai_100'`)[0]!.price_cents,
      ).toBe(3990);
    });
  });
});
