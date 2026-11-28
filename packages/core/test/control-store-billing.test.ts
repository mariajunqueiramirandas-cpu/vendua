import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, membershipsFor } from '../src/admin/auth.ts';
import { aiAllowanceTx, claimAiConversationTx } from '../src/modules/billing/ai-allowance.ts';
import { runBillingTick } from '../src/modules/billing/jobs.ts';
import { handleBillingWebhook } from '../src/modules/billing/webhook.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

// The team's per-store plan actions in the CRM (control-store-billing.ts): plan change as a
// courtesy, a trial or unpaid plan opened for free, free months, Duá conversations, cancel/resume.

const DAY = 86_400_000;

describe.skipIf(!process.env.TEST_DATABASE_URL)('staff billing per store (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const notify = {
    whatsapp: async (phone: string, text: string) => void wa.push({ phone, text }),
    email: async () => {},
  };
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    paymentProvider: fake,
    notify,
  });
  const tick = (now = new Date()) =>
    runBillingTick(
      appSql,
      {
        provider: fake,
        notify,
        adminOrigin: 'https://painel.vendua.test',
        storeDomain: 'vendua.test',
      },
      now,
    );
  const nonce = crypto.randomUUID().slice(0, 6);
  const created: string[] = [];
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
    };
  };
  const control = (method: string, path: string, body?: unknown, key?: string) =>
    call(method, path, body, {
      'x-vendua-control': 'ctl',
      ...(key ? { 'idempotency-key': key } : {}),
    });
  const staff = (id: string, action: string, body: unknown = {}, key?: string) =>
    control('POST', `/control/v1/stores/${id}/billing/${action}`, body, key);

  /** a self-serve store (closed behind billing_hold until paid) with a signed-in owner */
  const store = async (name: string, plan: string) => {
    const slug = `sbill-${nonce}-${name}`;
    const phone = `218${String(Date.now() + created.length * 13).slice(-8)}`;
    const id = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, ${'Loja ' + name}, ${plan}, ${`${slug}.vendua.test`},
                               'Bia Dona', ${phone}, 'bia@example.com') as id
      `
    )[0]!.id;
    created.push(id);
    const m = (await membershipsFor(appSql, phone)).find((x) => x.tenant_id === id)!;
    const cookie = `vendua_admin=${await createSession(appSql, m, 'test')}`;
    const owner = (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie });
    return { id, slug, phone, owner };
  };
  const start = (s: Awaited<ReturnType<typeof store>>, plan: string, method: 'pix' | 'card') =>
    s.owner('POST', '/account/subscription', {
      planId: plan,
      method,
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
  const paidStore = async (name: string, plan: string) => {
    const s = await store(name, plan);
    const st = await start(s, plan, 'pix');
    expect(st.status).toBe(200);
    expect(
      (await call('POST', `/admin/v1/dev/billing/invoices/${st.body.invoices[0].id}/pay`, {}))
        .status,
    ).toBe(200);
    return s;
  };
  /** a store in its free trial, open, paying by Pix when it ends */
  const trialStore = async (name: string, plan: string, days = 14) => {
    const s = await store(name, plan);
    await sql`
      insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_email,
                                 payer_document, current_period_start, current_period_end,
                                 trial_ends_at)
      values (${s.id}, ${plan}, 'pix', 'trialing', 'fake', 'bia@example.com', '52998224725',
              now(), now() + make_interval(days => ${days}), now() + make_interval(days => ${days}))
    `;
    await sql`update tenants set plan = ${plan} where id = ${s.id}`;
    await sql`update store_settings set billing_hold = false, status_override = null, pause_message = null where tenant_id = ${s.id}`;
    return s;
  };

  const sub = async (id: string) =>
    (await sql`select * from subscriptions where tenant_id = ${id}`)[0]!;
  const invoices = (id: string) =>
    sql`select * from invoices where tenant_id = ${id} order by number`;
  const price = async (plan: string) =>
    (await sql<{ p: number }[]>`select price_cents as p from plans where id = ${plan}`)[0]!.p;
  const planName = async (plan: string) =>
    (await sql<{ n: string }[]>`select name as n from plans where id = ${plan}`)[0]!.n;
  const events = (id: string, kind: string) =>
    sql<{ data: any }[]>`
      select data from staff_events where tenant_id = ${id} and kind = ${kind} order by id`;
  const texts = (phone: string) => wa.filter((m) => m.phone === phone).map((m) => m.text);
  const billingRow = async (id: string) =>
    (await control('GET', `/control/v1/billing/stores?tenant=${id}`)).body.stores[0];

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });

  afterAll(async () => {
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('only staff reach it; bad ids and bodies are stable 4xx', async () => {
    const s = await paidStore('gate', 'mirim');
    const anon = await call('POST', `/control/v1/stores/${s.id}/billing/plan`, {
      planId: 'bandeira',
    });
    expect(anon.status).toBe(404);
    expect((await staff('not-a-uuid', 'plan', { planId: 'bandeira' })).status).toBe(400);
    expect((await staff(crypto.randomUUID(), 'plan', { planId: 'bandeira' })).status).toBe(404);
    expect((await staff(s.id, 'plan', { planId: 'BAD id' })).status).toBe(422);
    expect((await staff(s.id, 'plan', { planId: 'nope_plan' })).body.error.code).toBe(
      'UNKNOWN_PLAN',
    );
    expect((await staff(s.id, 'plan', { planId: 'mirim' })).body.error.code).toBe('SAME_PLAN');
    expect((await staff(s.id, 'free-months', { months: 0 })).status).toBe(422);
    expect((await staff(s.id, 'free-months', { months: 13 })).status).toBe(422);
    expect((await staff(s.id, 'activate', { months: 1.5 })).status).toBe(422);
    expect(
      (await staff(s.id, 'ai-credits', { conversations: 10, days: 30, note: 'x'.repeat(201) }))
        .status,
    ).toBe(422);
    // a paid plan is no trial to open
    expect((await staff(s.id, 'activate', { months: 1 })).body.error.code).toBe('NOT_UNPAID');
  });

  test('a plan change applies now, charges no difference, and the next Pix is at the new price', async () => {
    const s = await paidStore('up', 'mirim');
    // the renewal's Pix is already out at Mirim's price
    await sql`update subscriptions set current_period_end = now() + interval '3 days' where tenant_id = ${s.id}`;
    await tick();
    const renewal = (await invoices(s.id)).find((i) => i.status === 'open')!;
    expect(renewal.amount_cents).toBe(await price('mirim'));

    const key = `${nonce}-plan-up`;
    const r = await staff(s.id, 'plan', { planId: 'bandeira', note: 'parceria' }, key);
    expect(r.status).toBe(200);
    expect(await sub(s.id)).toMatchObject({
      plan_id: 'bandeira',
      upgrade_plan_id: null,
      pending_plan_id: null,
      status: 'active',
    });
    expect((await sql`select plan from tenants where id = ${s.id}`)[0]!.plan).toBe('bandeira');
    const invs = await invoices(s.id);
    expect(invs.filter((i) => i.kind === 'upgrade')).toHaveLength(0);
    expect(invs.find((i) => i.id === renewal.id)).toMatchObject({
      status: 'open',
      plan_id: 'bandeira',
      amount_cents: await price('bandeira'),
    });
    // a replay is the same answer, once
    expect((await staff(s.id, 'plan', { planId: 'bandeira' }, key)).status).toBe(200);
    const ev = await events(s.id, 'billing.staff');
    expect(ev).toHaveLength(1);
    expect(ev[0]!.data).toMatchObject({
      action: 'plan',
      detail: `${await planName('mirim')} → ${await planName('bandeira')}`,
      note: 'parceria',
    });
    const log = (
      await sql`select actor_label, action from audit_log where tenant_id = ${s.id} and action = 'subscription.change'`
    )[0]!;
    expect(log.actor_label).toBe('Equipe Venduá');
    await Bun.sleep(20);
    expect(texts(s.phone).some((t) => t.includes('mudou o plano da sua loja'))).toBe(true);
  });

  test("a card plan's assinatura follows a downgrade now; the owner's waiting upgrade gives way", async () => {
    const s = await store('card', 'bandeira');
    const st = await start(s, 'bandeira', 'card');
    expect(st.status).toBe(200);
    const pre = (await sub(s.id)).provider_subscription_id as string;
    await call('POST', `/admin/v1/dev/billing/subscriptions/${pre}/settle`, { status: 'approved' });
    expect((await sub(s.id)).status).toBe('active');
    // the owner asked for the top plan: a pro-rata invoice waits
    await sql`update plans set available = true where id = 'pangolim'`;
    const up = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    expect(up.status).toBe(200);
    const upInv = (await sub(s.id)).upgrade_invoice_id as string;
    expect(upInv).toBeTruthy();

    expect((await staff(s.id, 'plan', { planId: 'mirim' })).status).toBe(200);
    expect(await sub(s.id)).toMatchObject({
      plan_id: 'mirim',
      upgrade_plan_id: null,
      upgrade_invoice_id: null,
    });
    expect((await sql`select status from invoices where id = ${upInv}`)[0]!.status).toBe('void');
    expect(fake.subscriptions.get(pre)!.amountCents).toBe(await price('mirim'));
  });

  test('a trial becomes a paid plan with nothing charged: open now, first charge at the end', async () => {
    const s = await trialStore('comp', 'bandeira', 3);
    // the first month's Pix went out ahead of the trial's end
    await tick();
    const first = (await invoices(s.id)).find((i) => i.status === 'open')!;
    expect(first).toBeTruthy();

    const before = Date.now();
    const r = await staff(s.id, 'activate', { months: 2, note: 'loja piloto' });
    expect(r.status).toBe(200);
    const after = await sub(s.id);
    expect(after).toMatchObject({ status: 'active', method: 'pix', plan_id: 'bandeira' });
    const len = (after.current_period_end as Date).getTime() - before;
    expect(len).toBeGreaterThanOrEqual(58 * DAY);
    expect(len).toBeLessThanOrEqual(62 * DAY + 60_000);
    expect(new Date(r.body.until).getTime()).toBe((after.current_period_end as Date).getTime());
    expect((after.trial_ends_at as Date).getTime()).toBeLessThanOrEqual(Date.now());
    // its first invoice is void and its Pix withdrawn; nothing was paid
    const inv = (await invoices(s.id)).find((i) => i.id === first.id)!;
    expect(inv.status).toBe('void');
    await Bun.sleep(20);
    expect(fake.payments.get(first.provider_payment_id)?.status).toBe('cancelled');
    expect(
      await sql`select 1 from invoices where tenant_id = ${s.id} and status = 'paid'`,
    ).toHaveLength(0);
    expect(await events(s.id, 'billing.paid')).toHaveLength(0);
    expect((await events(s.id, 'billing.staff'))[0]!.data).toMatchObject({ action: 'activate' });
    // Duá now runs on the paid month's allowance
    const ai = await withTenant(appSql, s.id, (tx) => aiAllowanceTx(tx, s.id));
    expect(ai).toMatchObject({ included: true, period: 'month' });
    expect(texts(s.phone).some((t) => t.includes('por conta da Venduá'))).toBe(true);

    // nothing to charge until the period's end comes near; then the Pix at the plan's price
    await tick();
    expect((await invoices(s.id)).filter((i) => i.status === 'open')).toHaveLength(0);
    await sql`update subscriptions set current_period_end = now() + interval '3 days' where tenant_id = ${s.id}`;
    await tick();
    const next = (await invoices(s.id)).find((i) => i.status === 'open')!;
    expect(next).toMatchObject({ kind: 'period', amount_cents: await price('bandeira') });

    expect((await staff(s.id, 'activate', { months: 1 })).body.error.code).toBe('NOT_UNPAID');
  });

  test('a store waiting for its first payment opens; an assinatura not used stops', async () => {
    const s = await store('pend', 'mirim');
    expect((await start(s, 'mirim', 'card')).status).toBe(200);
    const pre = (await sub(s.id)).provider_subscription_id as string;
    expect((await sub(s.id)).status).toBe('pending');

    expect((await staff(s.id, 'activate', { months: 1 })).status).toBe(200);
    expect(await sub(s.id)).toMatchObject({
      status: 'active',
      method: 'pix',
      provider_subscription_id: null,
      checkout_url: null,
    });
    expect(fake.subscriptions.get(pre)!.status).toBe('cancelled');
    const st = (
      await sql`select billing_hold, status_override from store_settings where tenant_id = ${s.id}`
    )[0]!;
    expect(st).toMatchObject({ billing_hold: false, status_override: null });
  });

  test("free months move a Pix plan's next charge on, and the owner hears it from the team", async () => {
    const s = await paidStore('free', 'mirim');
    const before = (await sub(s.id)).current_period_end as Date;
    expect((await staff(s.id, 'free-months', { months: 2, note: 'indicou 3 amigos' })).status).toBe(
      200,
    );
    const rows =
      await sql`select reason, months, status, note from billing_credits where tenant_id = ${s.id}`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reason: 'staff',
      months: 1,
      status: 'pending',
      note: 'indicou 3 amigos',
    });
    expect((await billingRow(s.id)).freeMonthsPending).toBe(2);

    await tick();
    const moved = ((await sub(s.id)).current_period_end as Date).getTime() - before.getTime();
    expect(moved).toBeGreaterThanOrEqual(58 * DAY);
    expect(moved).toBeLessThanOrEqual(62 * DAY);
    expect((await billingRow(s.id)).freeMonthsPending).toBe(0);
    await Bun.sleep(20);
    const msg = texts(s.phone).find((t) => t.includes('meses grátis'))!;
    expect(msg).toContain('da equipe Venduá');
    expect(msg).not.toContain('indicou');
    // not a referral's: "Indique e ganhe" counts none of them
    const mine = await s.owner('GET', '/account/referrals');
    expect(mine.body).toMatchObject({ pendingMonths: 0, appliedMonths: 0 });
  });

  test("on a card plan each of the team's months gives one charge back", async () => {
    const s = await store('fcard', 'mirim');
    expect((await start(s, 'mirim', 'card')).status).toBe(200);
    const pre = (await sub(s.id)).provider_subscription_id as string;
    await call('POST', `/admin/v1/dev/billing/subscriptions/${pre}/settle`, { status: 'approved' });
    expect((await staff(s.id, 'free-months', { months: 2 })).status).toBe(200);
    for (let i = 0; i < 3; i++) {
      const charge = fake.settleSubscription(pre, 'approved');
      await handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
        kind: 'subscription_payment',
        resourceId: charge.id,
        providerUserId: null,
        action: null,
      });
    }
    const credits =
      await sql`select status, applied_how from billing_credits where tenant_id = ${s.id}`;
    expect(credits.every((c) => c.status === 'applied' && c.applied_how === 'refund')).toBe(true);
    const credited = (await invoices(s.id)).filter((i) => i.credited_cents > 0);
    expect(credited).toHaveLength(2);
  });

  test('Duá conversations from the team count on a paid month and in a trial', async () => {
    const trial = await trialStore('ai', 'bandeira');
    const limit = (await withTenant(appSql, trial.id, (tx) => aiAllowanceTx(tx, trial.id))).limit;
    const r = await staff(trial.id, 'ai-credits', { conversations: 2, days: 30, note: 'teste' });
    expect(r.status).toBe(200);
    const a = await withTenant(appSql, trial.id, (tx) => aiAllowanceTx(tx, trial.id));
    expect(a).toMatchObject({ period: 'trial', packRemaining: 2, remaining: limit + 2 });
    // the trial's own allowance spent, the team's conversations take over
    await sql`
      insert into ai_conversations (tenant_id, subject_key, source, started_at)
      select ${trial.id}, 'used-' || g, 'trial', now() from generate_series(1, ${limit}) g
    `;
    const c = await withTenant(appSql, trial.id, (tx) =>
      claimAiConversationTx(tx, trial.id, 'shopper-x'),
    );
    expect(c.ok).toBe(true);
    const row = (
      await sql`
        select a.source, c.source as credit_source from ai_conversations a
          join ai_credits c on c.id = a.credit_id
        where a.tenant_id = ${trial.id} and a.subject_key = 'shopper-x'`
    )[0]!;
    expect(row).toMatchObject({ source: 'pack', credit_source: 'staff' });
    // the CRM's list says the same as the allowance
    const detail = await control('GET', `/control/v1/customers/${trial.id}`);
    expect(detail.body.ai).toMatchObject({ remaining: 1 });
    const list = (await control('GET', '/control/v1/customers')).body.stores.find(
      (x: any) => x.id === trial.id,
    );
    expect(list.ai).toMatchObject({ remaining: 1 });
    await Bun.sleep(20);
    expect(texts(trial.phone).some((t) => t.includes('2 conversas do Duá'))).toBe(true);
    expect((await events(trial.id, 'billing.staff'))[0]!.data).toMatchObject({
      action: 'ai_credits',
      note: 'teste',
    });

    // a plan without the Vendedor could never spend them
    const mirim = await paidStore('ai-mirim', 'mirim');
    const no = await staff(mirim.id, 'ai-credits', { conversations: 10, days: 30 });
    expect(no.status).toBe(403);
    expect(no.body.error).toMatchObject({
      code: 'PLAN_REQUIRED',
      details: { feature: 'vendedor' },
    });
    expect((await staff(mirim.id, 'ai-credits', { conversations: 10, days: 366 })).status).toBe(
      422,
    );
  });

  test('cancel and resume from the CRM, in the team’s words', async () => {
    const s = await paidStore('cancel', 'mirim');
    expect((await staff(s.id, 'cancel')).status).toBe(200);
    expect((await sub(s.id)).cancel_at_period_end).toBe(true);
    expect((await billingRow(s.id)).subscription.cancelAtPeriodEnd).toBe(true);
    const problem = (await events(s.id, 'billing.problem')).at(-1)!;
    expect(problem.data).toMatchObject({ problem: 'cancelled' });
    expect(problem.data.detail).toContain('A equipe cancelou o plano');
    // nothing to give a plan that is ending
    expect((await staff(s.id, 'free-months', { months: 1 })).body.error.code).toBe('PLAN_ENDING');

    expect((await staff(s.id, 'resume')).status).toBe(200);
    expect((await sub(s.id)).cancel_at_period_end).toBe(false);
    expect((await events(s.id, 'billing.staff')).at(-1)!.data).toMatchObject({ action: 'resume' });
    expect((await staff(s.id, 'resume')).body.error.code).toBe('NOT_CANCELLING');
  });
});
