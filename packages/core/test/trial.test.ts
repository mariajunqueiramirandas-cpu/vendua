import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { runBillingTick } from '../src/modules/billing/jobs.ts';
import { billingStaff } from '../src/modules/billing/subscriptions.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

// ADR 0025: Venduá Bandeira starts with a free trial (no card); one per owner phone; an unpaid end
// pauses the store until the first payment.

const DAY = 86_400_000;

describe.skipIf(!process.env.TEST_DATABASE_URL)('free trial (db)', () => {
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
  const deps = {
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    paymentProvider: fake,
    // signup's gate (the CRM switch, WhatsApp, email, billing) is open here; signup.test checks it
    signupReady: async () => ({ on: true, whatsapp: true, email: true, billing: true, open: true }),
    notify,
  };
  // signup's per-IP limits live in each app: every test gets its own budget
  let app = createApp(deps);
  const jobOpts = {
    provider: fake,
    notify,
    adminOrigin: 'https://painel.vendua.test',
    storeDomain: 'vendua.test',
  };
  const tick = (now = new Date()) => runBillingTick(appSql, jobOpts, now);
  const nonce = crypto.randomUUID().slice(0, 6);
  let seq = 0;
  const mkPhone = () => `218${String(Date.now() + ++seq * 37).slice(-8)}`;
  const created: string[] = [];
  let idem = 0;
  const originalStaff = billingStaff.notify;

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
  const control = (method: string, path: string, body?: unknown) =>
    call(method, path, body, { 'x-vendua-control': 'ctl', 'idempotency-key': crypto.randomUUID() });

  const verified = async (phone: string) => {
    expect((await call('POST', '/admin/v1/signup/otp/start', { phone })).status).toBe(200);
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const v = await call('POST', '/admin/v1/signup/otp/verify', { phone, code });
    expect(v.status).toBe(200);
    return v.body as { signupToken: string; trialEligible: boolean };
  };

  const signup = async (token: string, slug: string, extra: Record<string, unknown> = {}) => {
    const r = await call('POST', '/admin/v1/signup', {
      signupToken: token,
      planId: 'bandeira',
      trial: true,
      storeName: 'Doces da Lia',
      slug,
      ownerName: 'Lia Souza',
      email: 'lia@example.com',
      document: '529.982.247-25',
      ...extra,
    });
    if (r.body?.store?.id && !created.includes(r.body.store.id)) created.push(r.body.store.id);
    return r;
  };

  const session = (cookie: string | null) => {
    const value = /vendua_admin=([^;]+)/.exec(cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}` });
  };

  /** a fresh trial store, signed in as its owner */
  const trialStore = async (tag: string) => {
    const phone = mkPhone();
    const { signupToken } = await verified(phone);
    const r = await signup(signupToken, `trial-${nonce}-${tag}`);
    expect(r.status).toBe(201);
    return { id: r.body.store.id as string, phone, owner: session(r.cookie), next: r.body.next };
  };
  const sub = async (id: string) =>
    (await sql`select * from subscriptions where tenant_id = ${id}`)[0]!;
  const settings = async (id: string) =>
    (
      await sql`select billing_hold, status_override, pause_message from store_settings where tenant_id = ${id}`
    )[0]!;
  /** move the trial's end (and the period it is) to `at` */
  const endAt = (id: string, at: Date) =>
    sql`update subscriptions set trial_ends_at = ${at}, current_period_end = ${at} where tenant_id = ${id}`;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    // these run billing on the top plan, which launches closed to new stores (ADR 0032)
    await sql`update plans set available = true where id = 'pangolim'`;
    billingStaff.notify = async () => {};
  });

  beforeEach(() => {
    app = createApp(deps);
  });

  afterAll(async () => {
    billingStaff.notify = originalStaff;
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('the catalog: Bandeira trials 14 days, Mirim and Pangolim none; a new phone is eligible', async () => {
    const plans = await call('GET', '/admin/v1/signup/plans');
    const by = Object.fromEntries(plans.body.plans.map((p: any) => [p.id, p]));
    expect(by.bandeira.trialDays).toBe(14);
    expect(by.pangolim.trialDays).toBe(0);
    expect(by.mirim.trialDays).toBe(0);
    expect((await verified(mkPhone())).trialEligible).toBe(true);
  });

  test('a trial signup: open store, no charge, no card; a replay returns the same trial', async () => {
    const phone = mkPhone();
    const { signupToken } = await verified(phone);
    const slug = `trial-${nonce}-open`;
    const before = Date.now();
    const r = await signup(signupToken, slug);
    expect(r.status).toBe(201);
    expect(r.body.next.kind).toBe('trial');
    const endsAt = new Date(r.body.next.endsAt).getTime();
    expect(Math.abs(endsAt - (before + 14 * DAY))).toBeLessThan(60_000);
    const id = r.body.store.id;

    const s = await sub(id);
    expect(s.status).toBe('trialing');
    expect(s.method).toBe('pix');
    expect(s.trial_ends_at.getTime()).toBe(endsAt);
    expect(s.current_period_end.getTime()).toBe(endsAt);
    expect(await settings(id)).toMatchObject({ billing_hold: false, status_override: null });
    expect((await sql`select 1 from invoices where tenant_id = ${id}`).length).toBe(0);
    expect(
      fake.subscriptions.size === 0 ||
        ![...fake.subscriptions.values()].some((x) => x.req.externalReference === id),
    ).toBe(true);

    const ev =
      await sql`select data from staff_events where tenant_id = ${id} and kind = 'store.created'`;
    expect(new Date(ev[0]!.data.trialEndsAt).getTime()).toBe(endsAt);
    const audit =
      await sql`select summary from audit_log where tenant_id = ${id} and action = 'store.signup'`;
    expect(audit[0]!.summary).toContain('14 dias de teste grátis');

    const acct = await session(r.cookie)('GET', '/account');
    expect(acct.body.subscription).toMatchObject({ status: 'trialing', method: 'pix' });
    expect(new Date(acct.body.subscription.trialEndsAt).getTime()).toBe(endsAt);

    const again = await signup(signupToken, slug);
    expect(again.status).toBe(201);
    expect(again.body.store.id).toBe(id);
    expect(again.body.next).toEqual(r.body.next);
  });

  test('one trial per owner phone: a second store asks for the payment', async () => {
    const t = await trialStore('once');
    const v = await verified(t.phone);
    expect(v.trialEligible).toBe(false);
    const r = await signup(v.signupToken, `trial-${nonce}-twice`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatchObject({ code: 'TRIAL_USED', details: { field: 'trial' } });
    expect((await sql`select 1 from tenants where slug = ${`trial-${nonce}-twice`}`).length).toBe(
      0,
    );
    // paying is still open to them
    const paid = await signup(v.signupToken, `trial-${nonce}-twice`, {
      trial: false,
      method: 'pix',
    });
    expect(paid.status).toBe(201);
    expect(paid.body.next.kind).toBe('pix');
  });

  test('the phone that took the trial keeps it taken, whatever its role becomes', async () => {
    const t = await trialStore('role');
    await sql`update merchant_users set role = 'manager' where tenant_id = ${t.id} and phone = ${t.phone}`;
    expect((await verified(t.phone)).trialEligible).toBe(false);
  });

  test('a plan without a trial refuses one; a bad flag is a 422', async () => {
    const { signupToken } = await verified(mkPhone());
    const pro = await signup(signupToken, `trial-${nonce}-pro`, { planId: 'pangolim' });
    expect(pro.status).toBe(422);
    expect(pro.body.error.code).toBe('TRIAL_UNAVAILABLE');
    const bad = await signup(signupToken, `trial-${nonce}-bad`, { trial: 'yes' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.field).toBe('trial');
  });

  test('the last days: the first Pix goes out ahead, reminders once each, Início says so', async () => {
    const t = await trialStore('remind');
    await endAt(t.id, new Date(Date.now() + 2.5 * DAY));
    const sent = () => wa.filter((m) => m.phone === t.phone && m.text.includes('teste grátis'));
    await tick();
    await tick();
    const inv = (await sql`select * from invoices where tenant_id = ${t.id}`)[0]!;
    expect(inv.status).toBe('open');
    expect(inv.period_start.getTime()).toBe((await sub(t.id)).trial_ends_at.getTime());
    expect(inv.pix_copy_paste).toBeTruthy();
    expect(sent().length).toBe(1);
    expect(sent()[0]!.text).toContain('pague a primeira mensalidade do Venduá Bandeira');
    // no generic "fatura vence" on top of it
    expect(wa.filter((m) => m.phone === t.phone && m.text.includes('fatura')).length).toBe(0);

    const home = await t.owner('GET', '/home');
    expect(home.body.attention.some((a: any) => a.kind === 'trial_ending')).toBe(true);
    expect(home.body.attention.some((a: any) => a.kind === 'invoice_open')).toBe(false);

    await endAt(t.id, new Date(Date.now() + 0.5 * DAY));
    await tick();
    await tick();
    expect(sent().length).toBe(2);
    expect(sent()[1]!.text).toContain('último aviso');
  });

  test('paid during the trial: active from the trial end, the store never closes', async () => {
    const t = await trialStore('paid');
    const end = new Date(Date.now() + 3 * DAY);
    await endAt(t.id, end);
    await tick();
    const inv = (await sql`select id from invoices where tenant_id = ${t.id}`)[0]!;
    expect((await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {})).status).toBe(
      200,
    );
    const s = await sub(t.id);
    expect(s.status).toBe('active');
    expect(s.current_period_start.getTime()).toBe(end.getTime());
    expect(s.trial_ends_at.getTime()).toBe(end.getTime());
    expect((await settings(t.id)).billing_hold).toBe(false);
    await tick(new Date(end.getTime() + DAY));
    expect((await sub(t.id)).status).toBe('active');
  });

  test('ended unpaid: the store pauses, the owner and the team hear once, paying reopens it', async () => {
    const t = await trialStore('ended');
    await endAt(t.id, new Date(Date.now() + 2 * DAY));
    await tick(); // the first Pix goes out
    await endAt(t.id, new Date(Date.now() - 60_000));
    await tick();
    await tick();
    const s = await sub(t.id);
    expect(s.status).toBe('pending');
    expect(s.current_period_end).toBeNull();
    expect(await settings(t.id)).toMatchObject({ billing_hold: true, status_override: 'paused' });
    const told = wa.filter((m) => m.phone === t.phone && m.text.includes('o teste grátis acabou'));
    expect(told.length).toBe(1);
    const problems =
      await sql`select data from staff_events where tenant_id = ${t.id} and kind = 'billing.problem'`;
    expect(problems.map((p) => p.data.problem)).toEqual(['trial_ended']);
    const home = await t.owner('GET', '/home');
    const hold = home.body.attention.find((a: any) => a.kind === 'billing_pending');
    expect(hold.title).toContain('teste grátis acabou');

    const inv = (
      await sql`select id from invoices where tenant_id = ${t.id} and status = 'open'`
    )[0]!;
    await t.owner('POST', `/account/invoices/${inv.id}/pix`);
    expect((await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {})).status).toBe(
      200,
    );
    expect((await sub(t.id)).status).toBe('active');
    expect(await settings(t.id)).toMatchObject({ billing_hold: false, status_override: null });
  });

  test('card during the trial: the first charge waits for its end; an authorized card gets a grace day', async () => {
    const t = await trialStore('card');
    const end = new Date(Date.now() + 5 * DAY);
    await endAt(t.id, end);
    const r = await t.owner('PATCH', '/account/subscription', { method: 'card' });
    expect(r.status).toBe(200);
    const s = await sub(t.id);
    expect(s.status).toBe('trialing');
    expect(s.method).toBe('card');
    const pre = fake.subscriptions.get(s.provider_subscription_id)!;
    expect(new Date(pre.req.startDate!).getTime()).toBe(end.getTime());
    // the owner authorized it on Mercado Pago
    await sql`update subscriptions set checkout_url = null where tenant_id = ${t.id}`;
    await endAt(t.id, new Date(Date.now() - 60_000));
    await tick();
    expect((await sub(t.id)).status).toBe('trialing');
    await tick(new Date(Date.now() + 1.1 * DAY));
    expect((await sub(t.id)).status).toBe('pending');
    expect((await settings(t.id)).billing_hold).toBe(true);
  });

  test('a card never authorized gives way to the Pix at the end, its assinatura stopped', async () => {
    const t = await trialStore('noauth');
    await endAt(t.id, new Date(Date.now() + 5 * DAY));
    expect((await t.owner('PATCH', '/account/subscription', { method: 'card' })).status).toBe(200);
    const pre = (await sub(t.id)).provider_subscription_id;
    await endAt(t.id, new Date(Date.now() - 60_000));
    await tick();
    const s = await sub(t.id);
    expect(s).toMatchObject({ status: 'pending', method: 'pix', provider_subscription_id: null });
    expect(s.checkout_url).toBeNull();
    expect(fake.subscriptions.get(pre)!.status).toBe('cancelled');
    const open = await sql`select 1 from invoices where tenant_id = ${t.id} and status = 'open'`;
    expect(open.length).toBe(1);
  });

  test('Pangolim chosen and paid during the trial: its site request opens with the first payment', async () => {
    const t = await trialStore('prosite');
    expect((await t.owner('PATCH', '/account/subscription', { planId: 'pangolim' })).status).toBe(
      200,
    );
    await endAt(t.id, new Date(Date.now() + 3 * DAY));
    await tick();
    const inv = (await sql`select id, amount_cents from invoices where tenant_id = ${t.id}`)[0]!;
    expect(inv.amount_cents).toBe(44900);
    await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {});
    expect((await sub(t.id)).status).toBe('active');
    expect((await sql`select 1 from site_requests where tenant_id = ${t.id}`).length).toBe(1);
  });

  test('cancelled during the trial: it runs to its end, then the store closes', async () => {
    const t = await trialStore('cancel');
    expect((await t.owner('POST', '/account/subscription/cancel', {})).status).toBe(200);
    expect(await sub(t.id)).toMatchObject({ status: 'trialing', cancel_at_period_end: true });
    await endAt(t.id, new Date(Date.now() - 60_000));
    await tick();
    expect((await sub(t.id)).status).toBe('cancelled');
    expect((await settings(t.id)).billing_hold).toBe(true);
  });

  test('another plan during the trial: it swaps, the trial goes on, no prorated invoice', async () => {
    const t = await trialStore('swap');
    const r = await t.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    expect(r.status).toBe(200);
    expect(await sub(t.id)).toMatchObject({ status: 'trialing', plan_id: 'pangolim' });
    expect((await sql`select 1 from invoices where tenant_id = ${t.id}`).length).toBe(0);
  });

  test('staff: the trial length is plan data; stores show their trial', async () => {
    const plans = await control('GET', '/control/v1/plans');
    expect(plans.body.plans.find((p: any) => p.id === 'bandeira').trialDays).toBe(14);
    const bad = await control('PATCH', '/control/v1/plans/bandeira', { trialDays: 61 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.field).toBe('trialDays');
    const ok = await control('PATCH', '/control/v1/plans/bandeira', { trialDays: 14 });
    expect(ok.body.plan.trialDays).toBe(14);
    const t = await trialStore('staff');
    const stores = await control('GET', '/control/v1/billing/stores');
    const row = stores.body.stores.find((x: any) => x.tenantId === t.id);
    expect(row.subscription.status).toBe('trialing');
    expect(row.subscription.trialEndsAt).toBeTruthy();
  });
});
