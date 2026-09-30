import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, membershipsFor } from '../src/admin/auth.ts';
import { normalizeHost, setDnsResolver } from '../src/modules/billing/domains.ts';
import { runBillingTick, runDomainChecks, syncPlanPrices } from '../src/modules/billing/jobs.ts';
import { billingStaff, CLOSED_MESSAGE } from '../src/modules/billing/subscriptions.ts';
import { handleBillingWebhook } from '../src/modules/billing/webhook.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

const DAY = 86_400_000;

describe('billing units', () => {
  test('custom domain hosts normalize and refuse store subdomains', () => {
    expect(normalizeHost(' https://WWW.Loja.com.br/produtos?x=1 ', 'vendua.com.br')).toBe(
      'www.loja.com.br',
    );
    expect(normalizeHost('loja.com.br.', 'vendua.com.br')).toBe('loja.com.br');
    for (const bad of ['doces.vendua.com.br', 'vendua.com.br', 'localhost', '1.2.3.4', 'x', 'a..b'])
      expect(() => normalizeHost(bad, 'vendua.com.br')).toThrow();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('plan billing (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  // provider ids are process-local counters; start past anything another run left behind
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const mails: { to: string; subject: string; idemKey: string }[] = [];
  const staff: { subject: string }[] = [];
  const notify = {
    whatsapp: async (phone: string, text: string) => void wa.push({ phone, text }),
    email: async (to: string, subject: string, _text: string, idemKey: string) =>
      void mails.push({ to, subject, idemKey }),
  };
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
  const jobOpts = {
    provider: fake,
    notify,
    adminOrigin: 'https://painel.vendua.test',
    storeDomain: 'vendua.test',
  };
  const tick = (now = new Date()) => runBillingTick(appSql, jobOpts, now);
  const nonce = crypto.randomUUID().slice(0, 6);
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
    };
  };
  const control = (method: string, path: string, body?: unknown) =>
    call(method, path, body, { 'x-vendua-control': 'ctl' });

  /** a self-serve store (provision_store, paused behind billing_hold) with a signed-in owner */
  const store = async (name: string, plan: 'basic' | 'pro_plus', email: string | null = null) => {
    const slug = `bill-${nonce}-${name}`;
    const phone = `219${String(Date.now() + created.length * 13).slice(-8)}`;
    const id = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, ${'Loja ' + name}, ${plan}, ${`${slug}.vendua.test`},
                               'Bia Dona', ${phone}, ${email}) as id
      `
    )[0]!.id;
    created.push(id);
    const m = (await membershipsFor(appSql, phone)).find((x) => x.tenant_id === id)!;
    const cookie = `vendua_admin=${await createSession(appSql, m, 'test')}`;
    const owner = (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie });
    return { id, slug, phone, owner };
  };

  const sub = async (tenant: string) =>
    (await sql`select * from subscriptions where tenant_id = ${tenant}`)[0]!;
  const invoices = async (tenant: string) =>
    sql`select * from invoices where tenant_id = ${tenant} order by number`;
  const settings = async (tenant: string) =>
    (
      await sql`select billing_hold, status_override, pause_message from store_settings where tenant_id = ${tenant}`
    )[0]!;
  const payInvoice = (id: string) => call('POST', `/admin/v1/dev/billing/invoices/${id}/pay`, {});
  /** a store whose plan is paid (pix, first invoice settled) */
  const paidStore = async (name: string, plan: 'basic' | 'pro_plus') => {
    const s = await store(name, plan, 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: plan,
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    expect(st.status).toBe(200);
    await payInvoice(st.body.invoices[0].id);
    return s;
  };
  const texts = (phone: string) => wa.filter((m) => m.phone === phone).map((m) => m.text);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    billingStaff.notify = async (_sql, n) => void staff.push({ subject: n.subject });
  });

  afterAll(async () => {
    billingStaff.notify = originalStaff;
    setDnsResolver(null);
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    await sql`delete from plans where id = ${`bill_${nonce}`}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('Basic: PLAN_REQUIRED for domain and site; pix start → pay → open', async () => {
    const s = await store('pix', 'basic', 'bia@example.com');
    const acct = await s.owner('GET', '/account');
    expect(acct.status).toBe(200);
    expect(acct.body.plan).toMatchObject({ id: 'basic', name: 'Venduá Basic', priceCents: 3990 });
    expect(acct.body.subscription).toBeNull();
    expect(acct.body.billing).toEqual({ available: true });
    expect(acct.body.domains).toEqual([
      { host: `${s.slug}.vendua.test`, kind: 'store', status: 'active', primary: true },
    ]);
    const dom = await s.owner('POST', '/account/domains', { host: 'loja.example.com' });
    expect(dom.status).toBe(403);
    expect(dom.body.error.code).toBe('PLAN_REQUIRED');
    const site = await s.owner('POST', '/account/site-request', { brief: 'Um site bonito' });
    expect(site.body.error.code).toBe('PLAN_REQUIRED');

    const bad = await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'boleto',
      payerEmail: 'bia@example.com',
    });
    expect(bad.status).toBe(422);
    const started = await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    expect(started.status).toBe(200);
    expect(started.body.subscription).toMatchObject({ status: 'pending', method: 'pix' });
    const inv = started.body.invoices[0];
    expect(inv).toMatchObject({ number: 1, amountCents: 3990, status: 'open', method: 'pix' });
    const again = await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    expect(again.body.error.code).toBe('SUBSCRIPTION_EXISTS');
    // the Pix request carried the webhook URL and the invoice as its reference
    const pid = (await invoices(s.id))[0]!.provider_payment_id;
    expect(fake.payments.get(pid)!.externalReference).toBe(inv.id);

    expect((await payInvoice(inv.id)).status).toBe(200);
    expect(await settings(s.id)).toEqual({
      billing_hold: false,
      status_override: null,
      pause_message: null,
    });
    expect((await sub(s.id)).status).toBe('active');
    const audit = await sql`select action from audit_log where tenant_id = ${s.id}`;
    expect(audit.map((a) => a.action)).toContain('subscription.start');
  });

  test('upgrade applies now, downgrade waits for the period end (pix)', async () => {
    const s = await store('updown', 'basic', 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    await payInvoice(st.body.invoices[0].id);

    const up = await s.owner('PATCH', '/account/subscription', { planId: 'pro_plus' });
    expect(up.status).toBe(200);
    expect(up.body.plan.id).toBe('pro_plus');
    expect(up.body.subscription).toMatchObject({ planId: 'pro_plus', pendingPlan: null });
    expect((await sql`select plan from tenants where id = ${s.id}`)[0]!.plan).toBe('pro_plus');
    // PRO+ comes with the site request
    expect(up.body.siteRequest.status).toBe('requested');
    expect(staff.some((n) => n.subject.includes('Site PRO+'))).toBe(true);

    // 4 days before the end: the renewal Pix goes out at the downgraded price
    const end = new Date(Date.now() + 4 * DAY);
    await sql`update subscriptions set current_period_end = ${end} where tenant_id = ${s.id}`;
    const down = await s.owner('PATCH', '/account/subscription', { planId: 'basic' });
    expect(down.body.plan.id).toBe('pro_plus');
    expect(down.body.subscription.pendingPlan).toEqual({ id: 'basic', name: 'Venduá Basic' });
    await tick();
    expect((await sub(s.id)).plan_id).toBe('pro_plus');
    await tick();
    await tick();
    const invs = await invoices(s.id);
    expect(invs).toHaveLength(2);
    expect(invs[1]).toMatchObject({
      number: 2,
      plan_id: 'basic',
      amount_cents: 3990,
      status: 'open',
    });
    expect(invs[1]!.pix_copy_paste).toContain('FAKEPIX');
    // paid early: the new period hasn't begun, PRO+ stays until it does
    await payInvoice(invs[1]!.id);
    let row = await sub(s.id);
    expect(row.current_period_start.getTime()).toBe(end.getTime());
    expect(row.pending_plan_id).toBe('basic');
    // the period turns over
    const past = new Date(Date.now() - 60_000);
    await sql`update invoices set period_start = ${past} where id = ${invs[1]!.id}`;
    await sql`
      update subscriptions set current_period_start = ${past}, pending_plan_at = ${past}
      where tenant_id = ${s.id}
    `;
    await tick();
    row = await sub(s.id);
    expect(row).toMatchObject({ plan_id: 'basic', pending_plan_id: null, status: 'active' });
    expect((await sql`select plan from tenants where id = ${s.id}`)[0]!.plan).toBe('basic');
  });

  test('card: start → authorized → active; upgrade reprices; cancel → hold at period end', async () => {
    const s = await store('card', 'basic', 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'card',
      payerEmail: 'bia@example.com',
    });
    expect(st.body.subscription.checkoutUrl).toContain('/admin/?assinatura=retorno');
    const pre = (await sub(s.id)).provider_subscription_id;
    const fs = fake.subscriptions.get(pre)!;
    expect(fs.req.notificationUrl).toMatch(/\/admin\/v1\/hooks\/mercadopago\?t=platform$/);
    await call('POST', `/admin/v1/dev/billing/subscriptions/${pre}/settle`, { status: 'approved' });
    let acct = await s.owner('GET', '/account');
    expect(acct.body.subscription).toMatchObject({ status: 'active', checkoutUrl: null });
    expect(acct.body.invoices[0]).toMatchObject({ method: 'card', status: 'paid' });
    expect((await settings(s.id)).billing_hold).toBe(false);

    // a replayed charge webhook is matched, not re-created
    const charge = [...fake.subscriptionPayments.values()].find((p) => p.subscriptionId === pre)!;
    await handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind: 'subscription_payment',
      resourceId: charge.id,
      providerUserId: null,
      action: null,
    });
    expect(await invoices(s.id)).toHaveLength(1);

    await s.owner('PATCH', '/account/subscription', { planId: 'pro_plus' });
    expect(fs.amountCents).toBe(9900);

    // a monthly charge renews the period
    const before = (await sub(s.id)).current_period_end as Date;
    fake.settleSubscription(pre, 'approved');
    const renewal = [...fake.subscriptionPayments.values()]
      .filter((p) => p.subscriptionId === pre)
      .at(-1)!;
    renewal.amountCents = 9900;
    await handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind: 'subscription_payment',
      resourceId: renewal.id,
      providerUserId: null,
      action: null,
    });
    const invs = await invoices(s.id);
    expect(invs).toHaveLength(2);
    expect(invs[1]).toMatchObject({ status: 'paid', amount_cents: 9900, plan_id: 'pro_plus' });
    expect(invs[1]!.period_start.getTime()).toBe(before.getTime());
    expect(((await sub(s.id)).current_period_end as Date).getTime()).toBe(
      invs[1]!.period_end.getTime(),
    );

    // a rejected monthly charge: the owner hears once, replays stay quiet
    fake.settleSubscription(pre, 'rejected');
    const rejected = [...fake.subscriptionPayments.values()]
      .filter((p) => p.subscriptionId === pre)
      .at(-1)!;
    for (let i = 0; i < 2; i++)
      await handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
        kind: 'subscription_payment',
        resourceId: rejected.id,
        providerUserId: null,
        action: null,
      });
    await Bun.sleep(20);
    expect(texts(s.phone).filter((t) => t.includes('não foi aprovada'))).toHaveLength(1);
    expect((await invoices(s.id)).at(-1)).toMatchObject({ status: 'failed' });

    const cancel = await s.owner('POST', '/account/subscription/cancel', {});
    expect(cancel.body.subscription.cancelAtPeriodEnd).toBe(true);
    await Bun.sleep(20);
    expect(texts(s.phone).filter((t) => t.includes('cancelamento do plano'))).toHaveLength(1);
    expect(fs.status).toBe('paused');
    const resume = await s.owner('POST', '/account/subscription/resume', {});
    expect(resume.body.subscription.cancelAtPeriodEnd).toBe(false);
    expect(fs.status).toBe('authorized');
    await s.owner('POST', '/account/subscription/cancel', {});

    await tick();
    expect((await sub(s.id)).status).toBe('active');
    await sql`update subscriptions set current_period_end = now() - interval '1 minute' where tenant_id = ${s.id}`;
    await tick();
    acct = await s.owner('GET', '/account');
    expect(acct.body.subscription).toMatchObject({ status: 'cancelled', cancelAtPeriodEnd: false });
    expect(await settings(s.id)).toEqual({
      billing_hold: true,
      status_override: 'paused',
      pause_message: CLOSED_MESSAGE,
    });
    expect(fs.status).toBe('cancelled');
    await tick();
    const ended = texts(s.phone).filter((t) => t.includes('foi encerrado e a loja está fechada'));
    expect(ended).toHaveLength(1);
  });

  test('concurrent starts create one assinatura', async () => {
    const s = await store('race', 'basic', 'bia@example.com');
    const before = fake.subscriptions.size;
    const res = await Promise.all(
      [1, 2, 3].map(() =>
        s.owner('POST', '/account/subscription', {
          planId: 'basic',
          method: 'card',
          payerEmail: 'bia@example.com',
        }),
      ),
    );
    expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(fake.subscriptions.size - before).toBe(1);
  });

  const hook = (id: string) =>
    handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind: 'payment',
      resourceId: id,
      providerUserId: null,
      action: null,
    });

  test('a reissued Pix cancels the old one at MP; a cancelled one never settles', async () => {
    const s = await store('drop', 'basic', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    const oldPix = (await invoices(s.id))[0]!.provider_payment_id;
    // upgrading before paying reprices the invoice and reissues its Pix
    await s.owner('PATCH', '/account/subscription', { planId: 'pro_plus' });
    await Bun.sleep(30);
    const inv = (await invoices(s.id))[0]!;
    expect(inv).toMatchObject({ amount_cents: 9900, pix_superseded: [oldPix] });
    expect(inv.provider_payment_id).not.toBe(oldPix);
    expect(fake.payments.get(oldPix)!.status).toBe('cancelled');
    await hook(oldPix);
    expect((await invoices(s.id))[0]!.status).toBe('open');
    await payInvoice(inv.id);
    expect((await invoices(s.id))[0]).toMatchObject({ status: 'paid', amount_cents: 9900 });
  });

  test('an old Pix paid before its cancel still settles; odd amounts and double pays reach the team', async () => {
    const s = await store('super', 'basic', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    const oldPix = (await invoices(s.id))[0]!.provider_payment_id;
    // the owner scanned the old QR; MP's webhook hasn't arrived when the price changes
    fake.settle(oldPix, 'approved');
    await s.owner('PATCH', '/account/subscription', { planId: 'pro_plus' });
    await Bun.sleep(30);
    expect(fake.payments.get(oldPix)!.status).toBe('approved');
    const staffBefore = staff.length;
    await hook(oldPix);
    await Bun.sleep(30);
    const inv = (await invoices(s.id))[0]!;
    expect(inv).toMatchObject({ status: 'paid', amount_cents: 3990, provider_payment_id: oldPix });
    expect((await sub(s.id)).status).toBe('active');
    expect((await settings(s.id)).billing_hold).toBe(false);
    // the unused new attempt was cancelled; if MP had charged it anyway, the team hears
    const newPix = inv.pix_superseded.at(-1)!;
    expect(fake.payments.get(newPix)!.status).toBe('cancelled');
    fake.settle(newPix, 'approved');
    await hook(newPix);
    await Bun.sleep(30);
    const flagged = staff.slice(staffBefore).map((n) => n.subject);
    expect(flagged.some((x) => x.startsWith('Pix com valor diferente'))).toBe(true);
    expect(flagged.some((x) => x.startsWith('Fatura paga duas vezes'))).toBe(true);
  });

  test('pix → card mid-period: the assinatura starts when the paid period ends', async () => {
    const s = await paidStore('switch', 'basic');
    const end = (await sub(s.id)).current_period_end as Date;
    const r = await s.owner('PATCH', '/account/subscription', { method: 'card' });
    expect(r.body.subscription).toMatchObject({ method: 'card', status: 'active' });
    const pre = (await sub(s.id)).provider_subscription_id;
    expect(fake.subscriptions.get(pre)!.req.startDate?.getTime()).toBe(end.getTime());
  });

  test('features need a paid plan: a pending PRO+ store gets PLAN_REQUIRED', async () => {
    const s = await store('unpaid', 'pro_plus', 'bia@example.com');
    const noSub = await s.owner('POST', '/account/domains', {
      host: `unpaid-${nonce}.example.com`,
    });
    expect(noSub.body.error).toMatchObject({
      code: 'PLAN_REQUIRED',
      details: { reason: 'unpaid' },
    });
    await s.owner('POST', '/account/subscription', {
      planId: 'pro_plus',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    const site = await s.owner('POST', '/account/site-request', { brief: 'Um site bonito' });
    expect(site.body.error).toMatchObject({ code: 'PLAN_REQUIRED', details: { reason: 'unpaid' } });
  });

  test('pix renewal: reminders once each, past_due, paid again → active', async () => {
    const s = await store('late', 'basic', 'bia@example.com');
    await sql`update merchant_users set prefs = '{"emailInvoices": false}' where tenant_id = ${s.id}`;
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    await payInvoice(st.body.invoices[0].id);
    const mine = () => wa.filter((m) => m.phone === s.phone && m.text.startsWith('Venduá: '));

    const end = new Date(Date.now() + 2 * DAY);
    await sql`update subscriptions set current_period_end = ${end} where tenant_id = ${s.id}`;
    await tick();
    await tick();
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.text).toContain('vence em');
    expect(mine()[0]!.text).toContain('R$ 39,90');
    expect(mine()[0]!.text).toContain('https://painel.vendua.test/admin/conta');

    const inv2 = (await invoices(s.id))[1]!;
    const ended = new Date(Date.now() - 3_600_000);
    await sql`update subscriptions set current_period_end = ${ended} where tenant_id = ${s.id}`;
    await sql`update invoices set period_start = ${ended}, due_at = ${ended} where id = ${inv2.id}`;
    await tick();
    await tick();
    expect((await sub(s.id)).status).toBe('past_due');
    expect(mine()).toHaveLength(3);
    expect(mine().filter((m) => m.text.includes('vence hoje'))).toHaveLength(1);
    expect(mine().filter((m) => m.text.includes('ainda não foi confirmado'))).toHaveLength(1);
    // the store stays open while late
    expect((await settings(s.id)).billing_hold).toBe(false);

    await sql`update invoices set due_at = now() - interval '4 days' where id = ${inv2.id}`;
    await tick();
    await tick();
    expect(mine()).toHaveLength(4);
    expect(mine()[3]!.text).toContain('em aberto');
    expect(mails.filter((m) => m.to === 'bia@example.com' && m.idemKey.includes(inv2.id))).toEqual(
      [],
    );
    expect((await invoices(s.id))[1]!.reminded.sort()).toEqual(['due', 'due_soon', 'overdue']);

    // the Pix expired meanwhile: the owner asks for a new one
    await sql`update invoices set pix_expires_at = now() - interval '1 minute' where id = ${inv2.id}`;
    const before = (await invoices(s.id))[1]!.provider_payment_id;
    const re = await s.owner('POST', `/account/invoices/${inv2.id}/pix`, {});
    expect(re.status).toBe(200);
    const after = (await invoices(s.id))[1]!;
    expect(after.provider_payment_id).not.toBe(before);
    expect(after.pix_attempt).toBe(2);
    expect((await s.owner('POST', '/account/invoices/not-a-uuid/pix', {})).status).toBe(400);

    await payInvoice(inv2.id);
    const row = await sub(s.id);
    expect(row.status).toBe('active');
    expect((row.current_period_end as Date).getTime()).toBe(after.period_end.getTime());
  });

  test('PRO+ domain: add → DNS check → dns_ok (team told once) → CRM activates', async () => {
    const s = await paidStore('dom', 'pro_plus');
    const other = await paidStore('dom2', 'pro_plus');
    const host = `loja-${nonce}.example.com`;
    const bad = await s.owner('POST', '/account/domains', { host: `x.vendua.test` });
    expect(bad.body.error.code).toBe('INVALID_DOMAIN');
    const add = await s.owner('POST', '/account/domains', {
      host: `https://${host.toUpperCase()}/`,
    });
    expect(add.status).toBe(201);
    const cd = add.body.customDomain;
    expect(cd).toMatchObject({
      host,
      status: 'pending_dns',
      cnameTarget: `${s.slug}.vendua.test`,
      txtName: `_vendua.${host}`,
    });
    expect(cd.txtValue).toMatch(/^vendua-verify=[0-9a-f]{32}$/);
    expect(add.body.domains).toContainEqual({
      host,
      kind: 'custom',
      status: 'pending_dns',
      primary: false,
    });
    // a waiting claim doesn't hold the host: another store may claim it too
    const rival = await other.owner('POST', '/account/domains', { host });
    expect(rival.status).toBe(201);

    const dns: Record<string, { cname?: string[]; a?: string[]; txt?: string[][] }> = {};
    const miss = () => Promise.reject(new Error('ENOTFOUND'));
    setDnsResolver({
      resolveCname: async (h) => dns[h]?.cname ?? miss(),
      resolve4: async (h) => dns[h]?.a ?? miss(),
      resolveTxt: async (h) => dns[h]?.txt ?? miss(),
    });
    let chk = await s.owner('POST', `/account/domains/${cd.id}/check`, {});
    expect(chk.body.customDomain.status).toBe('pending_dns');
    expect(chk.body.customDomain.lastError).toContain(`${s.slug}.vendua.test`);

    // A records that match the store host's count as pointed; the TXT proves ownership
    dns[host] = { a: ['203.0.113.7'] };
    dns[`${s.slug}.vendua.test`] = { a: ['203.0.113.7'] };
    dns[`_vendua.${host}`] = {
      txt: [['vendua-verify=', cd.txtValue.slice('vendua-verify='.length)]],
    };
    const staffBefore = staff.length;
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 20 * 60_000));
    chk = await s.owner('GET', '/account');
    expect(chk.body.customDomain.status).toBe('dns_ok');
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 60 * 60_000));
    await s.owner('POST', `/account/domains/${cd.id}/check`, {});
    expect(staff.slice(staffBefore).filter((n) => n.subject.includes(host))).toHaveLength(1);
    // the store whose TXT verified wins; the rival claim is lost, and the host is now taken
    const lost = await other.owner('GET', '/account');
    expect(lost.body.customDomain).toMatchObject({ host, status: 'failed' });
    expect(lost.body.customDomain.lastError).toContain('Outra loja');
    const third = await (
      await paidStore('dom3', 'pro_plus')
    ).owner('POST', '/account/domains', {
      host,
    });
    expect(third.body.error.code).toBe('DOMAIN_TAKEN');

    expect((await call('POST', `/control/v1/custom-domains/${cd.id}/activate`)).status).toBe(404);
    const act = await control('POST', `/control/v1/custom-domains/${cd.id}/activate`);
    expect(act.status).toBe(200);
    expect(act.body).toEqual({ ok: true });
    const acct = await s.owner('GET', '/account');
    expect(acct.body.customDomain.status).toBe('active');
    expect(acct.body.address).toBe(`https://${host}`);
    expect(acct.body.domains).toContainEqual({
      host,
      kind: 'custom',
      status: 'active',
      primary: true,
    });
    const del = await s.owner('DELETE', `/account/domains/${cd.id}`);
    expect(del.body.error.code).toBe('DOMAIN_ACTIVE');

    // a domain that never resolves gives up after 7 days
    const add2 = await other.owner('POST', '/account/domains', {
      host: `never-${nonce}.example.com`,
    });
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 8 * DAY));
    const gone = await other.owner('GET', '/account');
    expect(gone.body.customDomain).toMatchObject({
      id: add2.body.customDomain.id,
      status: 'failed',
    });
    // …and a week later the failed claim is cleaned up
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 16 * DAY));
    expect((await other.owner('GET', '/account')).body.customDomain).toBeNull();

    // the CRM won't activate a host another store already serves
    const x = await paidStore('dom4', 'pro_plus');
    const xh = `clash-${nonce}.example.com`;
    const xa = await x.owner('POST', '/account/domains', { host: xh });
    await sql`update custom_domains set status = 'dns_ok' where id = ${xa.body.customDomain.id}`;
    await sql`insert into domains (host, tenant_id) values (${xh}, ${other.id})`;
    const clash = await control(
      'POST',
      `/control/v1/custom-domains/${xa.body.customDomain.id}/activate`,
    );
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('DOMAIN_TAKEN');
  });

  test('site request (PRO+) and the CRM', async () => {
    const s = await paidStore('site', 'pro_plus');
    const r = await s.owner('POST', '/account/site-request', {
      brief: 'Loja de doces, tons pastel',
    });
    // paying PRO+ already opened the request; the brief fills it in
    expect(r.status).toBe(200);
    expect(r.body.siteRequest).toMatchObject({
      status: 'requested',
      brief: 'Loja de doces, tons pastel',
    });
    const p = await s.owner('PATCH', '/account/site-request', {
      brief: 'Tons pastel e fotos grandes',
    });
    expect(p.body.siteRequest.brief).toBe('Tons pastel e fotos grandes');

    expect((await call('GET', '/control/v1/billing/stores')).status).toBe(404);
    const stores = await control('GET', '/control/v1/billing/stores');
    expect(stores.status).toBe(200);
    const row = stores.body.stores.find((x: any) => x.tenantId === s.id);
    expect(row).toMatchObject({
      slug: s.slug,
      url: `https://${s.slug}.vendua.test`,
      plan: { id: 'pro_plus', name: 'Venduá PRO+' },
      subscription: { status: 'active', method: 'pix' },
      siteRequest: { status: 'requested', brief: 'Tons pastel e fotos grandes', staffNote: null },
    });
    const patch = await control('PATCH', `/control/v1/site-requests/${row.siteRequest.id}`, {
      status: 'in_progress',
      staffNote: 'Começamos',
    });
    expect(patch.body).toEqual({ ok: true });
    expect((await s.owner('GET', '/account')).body.siteRequest.status).toBe('in_progress');
    expect(
      (await control('PATCH', `/control/v1/site-requests/${row.siteRequest.id}`, { status: 'x' }))
        .status,
    ).toBe(422);

    expect((await call('GET', '/control/v1/plans')).status).toBe(404);
    const plans = await control('GET', '/control/v1/plans');
    expect(plans.body.plans.find((x: any) => x.id === 'basic')).toMatchObject({
      priceCents: 3990,
      public: true,
    });
    const same = await control('PATCH', '/control/v1/plans/basic', { public: true });
    expect(same.body.plan).toMatchObject({ id: 'basic', public: true, priceCents: 3990 });
    expect((await control('PATCH', '/control/v1/plans/nope_plan', { public: true })).status).toBe(
      404,
    );
    expect((await control('PATCH', '/control/v1/plans/basic', { priceCents: 1.5 })).status).toBe(
      422,
    );
  });

  test('a CRM price change reaches the assinatura and unpaid invoices', async () => {
    const planId = `bill_${nonce}`;
    await sql`
      insert into plans (id, name, price_cents, features, public, sort)
      values (${planId}, 'Plano teste', 5000, '{}', false, 99)
    `;
    const a = await store('price-card', 'basic', 'bia@example.com');
    const ps = await fake.createSubscription({
      reason: 'x',
      amountCents: 5000,
      payerEmail: 'bia@example.com',
      externalReference: a.id,
      backUrl: 'https://painel.vendua.test/admin/',
      notificationUrl: null,
      idempotencyKey: `price-${nonce}`,
    });
    await sql`
      insert into subscriptions (tenant_id, plan_id, method, status, provider, provider_subscription_id,
                                 charge_cents, current_period_start, current_period_end)
      values (${a.id}, ${planId}, 'card', 'active', 'fake', ${ps.id}, 5000, now(), now() + interval '10 days')
    `;
    const b = await store('price-pix', 'basic', 'bia@example.com');
    await sql`insert into subscriptions (tenant_id, plan_id, method, status, provider) values (${b.id}, ${planId}, 'pix', 'pending', 'fake')`;
    await sql`
      insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end, method, provider, due_at)
      values (${b.id}, 1, ${planId}, 5000, now(), now() + interval '1 month', 'pix', 'fake', now())
    `;
    const patch = await control('PATCH', `/control/v1/plans/${planId}`, { priceCents: 6000 });
    expect(patch.body.plan.priceCents).toBe(6000);
    await syncPlanPrices(appSql, { sql: appSql, provider: fake, notify, origin: null }, new Date());
    expect(fake.subscriptions.get(ps.id)!.amountCents).toBe(6000);
    expect((await sub(a.id)).charge_cents).toBe(6000);
    expect((await invoices(b.id))[0]!.amount_cents).toBe(6000);
  });

  test('webhooks: unknown references and other stores’ ids are ignored', async () => {
    const d = { sql: appSql, provider: fake, notify } as never;
    const stray = await fake.platformPix({
      amountCents: 3990,
      description: 'x',
      payerEmail: 'x@example.com',
      externalReference: crypto.randomUUID(),
      idempotencyKey: `stray-${nonce}`,
      notificationUrl: null,
      applicationFeeCents: 0,
      expiresAt: new Date(Date.now() + DAY),
    });
    fake.settle(stray.id, 'approved');
    await handleBillingWebhook(d, {
      kind: 'payment',
      resourceId: stray.id,
      providerUserId: null,
      action: null,
    });
    const s = await store('hook', 'basic', 'bia@example.com');
    const ps = await fake.createSubscription({
      reason: 'x',
      amountCents: 3990,
      payerEmail: 'x@example.com',
      externalReference: s.id,
      backUrl: 'https://painel.vendua.test/admin/',
      notificationUrl: null,
      idempotencyKey: 'x',
    });
    // the store never started this preapproval: nothing happens
    fake.settleSubscription(ps.id, 'approved');
    await handleBillingWebhook(d, {
      kind: 'subscription',
      resourceId: ps.id,
      providerUserId: null,
      action: null,
    });
    expect(await sql`select 1 from subscriptions where tenant_id = ${s.id}`).toHaveLength(0);
    expect(await settings(s.id)).toMatchObject({ billing_hold: true });
    fake.platformConfigured = false;
    try {
      const off = await s.owner('POST', '/account/subscription', {
        planId: 'basic',
        method: 'pix',
        payerEmail: 'bia@example.com',
      });
      expect(off.body.error.code).toBe('BILLING_UNAVAILABLE');
    } finally {
      fake.platformConfigured = true;
    }
  });
});
