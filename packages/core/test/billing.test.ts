import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, membershipsFor } from '../src/admin/auth.ts';
import { normalizeHost, setDnsResolver } from '../src/modules/billing/domains.ts';
import { runBillingTick, runDomainChecks, syncPlanPrices } from '../src/modules/billing/jobs.ts';
import { CLOSED_MESSAGE, proratedCents } from '../src/modules/billing/subscriptions.ts';
import { handleBillingWebhook } from '../src/modules/billing/webhook.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { ProviderError, type PixRequest } from '../src/modules/payments/provider.ts';
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

test('proratedCents: the difference × time left / period, half-up, integer', () => {
  const start = new Date('2026-09-01T00:00:00Z');
  const end = new Date('2026-10-01T00:00:00Z');
  const mid = new Date('2026-09-16T00:00:00Z');
  expect(proratedCents(5910, start, end, mid)).toBe(2955);
  expect(proratedCents(5911, start, end, mid)).toBe(2956); // 2955.5 rounds up
  expect(proratedCents(5910, start, end, start)).toBe(5910);
  expect(proratedCents(5910, start, end, end)).toBe(0);
  expect(proratedCents(5910, start, end, new Date('2026-12-01T00:00:00Z'))).toBe(0);
  expect(proratedCents(-100, start, end, mid)).toBe(0);
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
  // what the team hears about a store: its staff events' titles (ADR 0023)
  const flagged = async (tenantId: string) =>
    (
      await sql<{ title: string }[]>`
        select data->>'title' as title from staff_events
        where tenant_id = ${tenantId} and kind in ('billing.problem', 'store.request')
        order by id
      `
    ).map((e) => e.title);

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
  const store = async (name: string, plan: 'mirim' | 'pangolim', email: string | null = null) => {
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
    return { id, slug, phone, owner, cookie };
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
  const paidStore = async (name: string, plan: 'mirim' | 'pangolim') => {
    const s = await store(name, plan, 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: plan,
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    expect(st.status).toBe(200);
    await payInvoice(st.body.invoices[0].id);
    return s;
  };
  const texts = (phone: string) => wa.filter((m) => m.phone === phone).map((m) => m.text);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    // these run billing on the top plan, which launches closed to new stores (ADR 0032)
    await sql`update plans set available = true where id = 'pangolim'`;
  });

  afterAll(async () => {
    setDnsResolver(null);
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    await sql`delete from plans where id like ${`bill_${nonce}%`}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('Mirim: PLAN_REQUIRED for domain and site; pix start → pay → open', async () => {
    const s = await store('pix', 'mirim', 'bia@example.com');
    const acct = await s.owner('GET', '/account');
    expect(acct.status).toBe(200);
    expect(acct.body.plan).toMatchObject({ id: 'mirim', name: 'Venduá Mirim', priceCents: 6990 });
    expect(acct.body.subscription).toBeNull();
    expect(acct.body.billing).toEqual({ available: true, publicKey: null });
    expect(acct.body.domains).toEqual([
      { host: `${s.slug}.vendua.test`, kind: 'store', status: 'active', primary: true },
    ]);
    const dom = await s.owner('POST', '/account/domains', { host: 'loja.example.com' });
    expect(dom.status).toBe(403);
    expect(dom.body.error.code).toBe('PLAN_REQUIRED');
    const site = await s.owner('POST', '/account/site-request', { brief: 'Um site bonito' });
    expect(site.body.error.code).toBe('PLAN_REQUIRED');

    const bad = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'boleto',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    expect(bad.status).toBe(422);
    const started = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    expect(started.status).toBe(200);
    expect(started.body.subscription).toMatchObject({ status: 'pending', method: 'pix' });
    const inv = started.body.invoices[0];
    expect(inv).toMatchObject({ number: 1, amountCents: 6990, status: 'open', method: 'pix' });
    const again = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
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

  test('a plan Pix carries the owner as its payer and the plan as its item', async () => {
    const s = await store('payer', 'mirim', 'bia@example.com');
    const seen: PixRequest[] = [];
    const realPix = fake.platformPix.bind(fake);
    fake.platformPix = async (req) => {
      seen.push(req);
      return realPix(req);
    };
    try {
      const started = await s.owner('POST', '/account/subscription', {
        planId: 'mirim',
        method: 'pix',
        payerEmail: 'bia@example.com',
        payerDocument: '529.982.247-25',
      });
      expect(started.status).toBe(200);
    } finally {
      fake.platformPix = realPix;
    }
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      payerEmail: 'bia@example.com',
      payerName: 'Bia Dona',
      payerPhone: s.phone,
      items: [
        {
          id: 'mirim',
          title: 'Venduá Mirim',
          description: expect.stringMatching(/^Venduá Mirim — fatura \d+$/),
          categoryId: 'services',
          quantity: 1,
          unitPriceCents: 6990,
        },
      ],
      statementDescriptor: 'Venduá',
    });
  });

  const planOf = async (tenant: string) =>
    (await sql`select plan from tenants where id = ${tenant}`)[0]!.plan;
  const siteRequests = async (tenant: string) =>
    sql`select status from site_requests where tenant_id = ${tenant}`;

  test('upgrade mid-period: a pro-rata invoice first, the plan when it is paid; downgrade waits', async () => {
    const s = await store('updown', 'mirim', 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    await payInvoice(st.body.invoices[0].id);

    const up = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    expect(up.status).toBe(200);
    // nothing changes until the difference is paid
    expect(up.body.plan.id).toBe('mirim');
    expect(up.body.subscription).toMatchObject({ planId: 'mirim', pendingPlan: null });
    expect(await planOf(s.id)).toBe('mirim');
    expect(up.body.siteRequest).toBeNull();
    const pu = up.body.subscription.pendingUpgrade;
    // (44900 − 6990) × almost the whole month
    expect(pu).toMatchObject({ planId: 'pangolim', planName: 'Venduá Pangolim' });
    expect(pu.amountCents).toBeGreaterThan(37810);
    expect(pu.amountCents).toBeLessThanOrEqual(37910);
    expect(pu.invoice).toMatchObject({ kind: 'upgrade', status: 'open', method: 'pix' });
    expect(pu.invoice.amountCents).toBe(pu.amountCents);
    expect(pu.invoice.pix.copyPaste).toContain('FAKEPIX');
    // asking again returns the same invoice
    const again = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    expect(again.body.subscription.pendingUpgrade.invoice.id).toBe(pu.invoice.id);
    expect(await invoices(s.id)).toHaveLength(2);

    await payInvoice(pu.invoice.id);
    const paid = await s.owner('GET', '/account');
    expect(paid.body.plan.id).toBe('pangolim');
    expect(paid.body.subscription).toMatchObject({ planId: 'pangolim', pendingUpgrade: null });
    expect(await planOf(s.id)).toBe('pangolim');
    // Pangolim comes with the site request, once paid
    expect(paid.body.siteRequest.status).toBe('requested');
    expect(await flagged(s.id)).toContain('site sob medida');
    // the paid period itself is unchanged
    expect((await sub(s.id)).current_period_end.getTime()).toBe(
      (await invoices(s.id))[0]!.period_end.getTime(),
    );

    // 4 days before the end: the renewal Pix goes out at the downgraded price
    const end = new Date(Date.now() + 4 * DAY);
    await sql`update subscriptions set current_period_end = ${end} where tenant_id = ${s.id}`;
    const down = await s.owner('PATCH', '/account/subscription', { planId: 'mirim' });
    expect(down.body.plan.id).toBe('pangolim');
    expect(down.body.subscription.pendingPlan).toEqual({ id: 'mirim', name: 'Venduá Mirim' });
    await tick();
    expect((await sub(s.id)).plan_id).toBe('pangolim');
    await tick();
    await tick();
    const invs = (await invoices(s.id)).filter((i) => i.kind === 'period');
    expect(invs).toHaveLength(2);
    expect(invs[1]).toMatchObject({
      number: 3,
      plan_id: 'mirim',
      amount_cents: 6990,
      status: 'open',
    });
    expect(invs[1]!.pix_copy_paste).toContain('FAKEPIX');
    // paid early: the new period hasn't begun, Pangolim stays until it does
    await payInvoice(invs[1]!.id);
    let row = await sub(s.id);
    expect(row.current_period_start.getTime()).toBe(end.getTime());
    expect(row.pending_plan_id).toBe('mirim');
    // the period turns over
    const past = new Date(Date.now() - 60_000);
    await sql`update invoices set period_start = ${past} where id = ${invs[1]!.id}`;
    await sql`
      update subscriptions set current_period_start = ${past}, pending_plan_at = ${past}
      where tenant_id = ${s.id}
    `;
    await tick();
    row = await sub(s.id);
    expect(row).toMatchObject({ plan_id: 'mirim', pending_plan_id: null, status: 'active' });
    expect((await sql`select plan from tenants where id = ${s.id}`)[0]!.plan).toBe('mirim');
  });

  test('card: start → authorized → active; upgrade reprices; cancel → hold at period end', async () => {
    const s = await store('card', 'mirim', 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'card',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
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

    // a card store pays the difference by Pix too; the assinatura moves once it's paid
    const up = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    expect(fs.amountCents).toBe(6990);
    expect(up.body.subscription.pendingUpgrade.invoice).toMatchObject({ method: 'pix' });
    await payInvoice(up.body.subscription.pendingUpgrade.invoice.id);
    expect(fs.amountCents).toBe(44900);
    expect((await sub(s.id)).plan_id).toBe('pangolim');

    // a monthly charge renews the period
    const before = (await sub(s.id)).current_period_end as Date;
    fake.settleSubscription(pre, 'approved');
    const renewal = [...fake.subscriptionPayments.values()]
      .filter((p) => p.subscriptionId === pre)
      .at(-1)!;
    renewal.amountCents = 44900;
    await handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind: 'subscription_payment',
      resourceId: renewal.id,
      providerUserId: null,
      action: null,
    });
    const invs = (await invoices(s.id)).filter((i) => i.kind === 'period');
    expect(invs).toHaveLength(2);
    expect(invs[1]).toMatchObject({ status: 'paid', amount_cents: 44900, plan_id: 'pangolim' });
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
    const s = await store('race', 'mirim', 'bia@example.com');
    const before = fake.subscriptions.size;
    const res = await Promise.all(
      [1, 2, 3].map(() =>
        s.owner('POST', '/account/subscription', {
          planId: 'mirim',
          method: 'card',
          payerEmail: 'bia@example.com',
          payerDocument: '529.982.247-25',
        }),
      ),
    );
    expect(res.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(fake.subscriptions.size - before).toBe(1);
  });

  test('a pending card plan with no CPF/CNPJ is refused Pix before MP drops the card', async () => {
    const s = await store('troca', 'mirim', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'card',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    const pre = (await sub(s.id)).provider_subscription_id;
    await sql`update subscriptions set payer_document = null where tenant_id = ${s.id}`;
    const r = await s.owner('PATCH', '/account/subscription', { method: 'pix' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('PAYER_DOCUMENT_REQUIRED');
    expect(fake.subscriptions.get(pre)!.status).not.toBe('cancelled');
    expect(await sub(s.id)).toMatchObject({ method: 'card', provider_subscription_id: pre });

    // the document in the same request lets the switch through
    const ok = await s.owner('PATCH', '/account/subscription', {
      method: 'pix',
      payerDocument: '390.533.447-05',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.subscription).toMatchObject({ method: 'pix', status: 'pending' });
    expect(fake.subscriptions.get(pre)!.status).toBe('cancelled');
  });

  /** platformPix answers `unavailable` while `work` runs */
  const pixDown = async <T>(work: () => Promise<T>): Promise<T> => {
    const realPix = fake.platformPix.bind(fake);
    fake.platformPix = async () => {
      throw new ProviderError('unavailable', 'MP fora do ar');
    };
    try {
      return await work();
    } finally {
      fake.platformPix = realPix;
    }
  };

  test('card → Pix with MP down: the card is never dropped by a switch that rolled back', async () => {
    const s = await store('troca-down', 'mirim', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'card',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    const pre = (await sub(s.id)).provider_subscription_id;
    const r = await pixDown(() => s.owner('PATCH', '/account/subscription', { method: 'pix' }));
    expect(r.status).toBe(503);
    expect(fake.subscriptions.get(pre)!.status).not.toBe('cancelled');
    expect(await sub(s.id)).toMatchObject({ method: 'card', provider_subscription_id: pre });

    // an active card store whose renewal is due: same, the renewal Pix goes out first
    await sql`
      update subscriptions set status = 'active', current_period_start = now() - interval '28 days',
        current_period_end = now() + interval '2 days'
      where tenant_id = ${s.id}
    `;
    const r2 = await pixDown(() => s.owner('PATCH', '/account/subscription', { method: 'pix' }));
    expect(r2.status).toBe(503);
    expect(fake.subscriptions.get(pre)!.status).not.toBe('cancelled');

    // a plan change in the same request doesn't re-price the card it drops (a pending store's
    // plan applies at once, and its first Pix fails)
    const amount = fake.subscriptions.get(pre)!.amountCents;
    await sql`update subscriptions set status = 'pending' where tenant_id = ${s.id}`;
    const r3 = await pixDown(() =>
      s.owner('PATCH', '/account/subscription', { method: 'pix', planId: 'bandeira' }),
    );
    expect(r3.status).toBe(503);
    expect(fake.subscriptions.get(pre)!.amountCents).toBe(amount);
    await sql`update subscriptions set status = 'active' where tenant_id = ${s.id}`;

    const ok = await s.owner('PATCH', '/account/subscription', { method: 'pix' });
    expect(ok.status).toBe(200);
    expect(fake.subscriptions.get(pre)!.status).toBe('cancelled');
    expect((await invoices(s.id)).at(-1)).toMatchObject({ method: 'pix', status: 'open' });
  });

  test('an upgrade whose Pix fails leaves the waiting downgrade’s price on the assinatura', async () => {
    const s = await store('up-down', 'mirim', 'bia@example.com');
    const ps = await fake.createSubscription({
      reason: 'x',
      amountCents: 16900,
      payerEmail: 'bia@example.com',
      externalReference: s.id,
      backUrl: 'https://painel.vendua.test/admin/',
      notificationUrl: null,
      idempotencyKey: `up-down-${nonce}`,
    });
    await sql`
      insert into subscriptions (tenant_id, plan_id, method, status, provider, provider_subscription_id,
                                 charge_cents, payer_email, payer_document, current_period_start,
                                 current_period_end)
      values (${s.id}, 'bandeira', 'card', 'active', 'fake', ${ps.id}, 16900, 'bia@example.com',
              '52998224725', now() - interval '10 days', now() + interval '20 days')
    `;
    const down = await s.owner('PATCH', '/account/subscription', { planId: 'mirim' });
    expect(down.status).toBe(200);
    expect(fake.subscriptions.get(ps.id)!.amountCents).toBe(6990);

    const up = await pixDown(() =>
      s.owner('PATCH', '/account/subscription', { planId: 'pangolim' }),
    );
    expect(up.status).toBe(503);
    expect(fake.subscriptions.get(ps.id)!.amountCents).toBe(6990);
    expect(await sub(s.id)).toMatchObject({
      plan_id: 'bandeira',
      pending_plan_id: 'mirim',
      charge_cents: 6990,
      upgrade_plan_id: null,
    });

    const ok = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    expect(ok.status).toBe(200);
    expect(fake.subscriptions.get(ps.id)!.amountCents).toBe(16900);
    expect(await sub(s.id)).toMatchObject({
      pending_plan_id: null,
      upgrade_plan_id: 'pangolim',
      charge_cents: 16900,
    });
  });

  test('a request that rolls back cancels no Pix at MP', async () => {
    const s = await store('rollback', 'mirim', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    const oldPix = (await invoices(s.id))[0]!.provider_payment_id;
    // the reprice queues the old Pix's cancel, then the new Pix fails: 503, nothing written
    const r = await pixDown(() =>
      s.owner('PATCH', '/account/subscription', { planId: 'pangolim' }),
    );
    expect(r.status).toBe(503);
    await Bun.sleep(30);
    expect(fake.payments.get(oldPix)!.status).toBe('pending');
    expect((await invoices(s.id))[0]).toMatchObject({
      provider_payment_id: oldPix,
      amount_cents: 6990,
    });
  });

  test('platform webhooks naming nothing MP will hand over are ignored; MP down still retries', async () => {
    const d = { sql: appSql, provider: fake, notify } as never;
    for (const kind of ['subscription', 'subscription_payment', 'payment'] as const)
      for (const resourceId of ['', `nope-${nonce}`])
        await handleBillingWebhook(d, { kind, resourceId, providerUserId: null, action: null });
    const realGet = fake.getSubscription.bind(fake);
    fake.getSubscription = async () => {
      throw new ProviderError('unavailable', 'MP fora do ar');
    };
    try {
      await expect(
        handleBillingWebhook(d, {
          kind: 'subscription',
          resourceId: 'x',
          providerUserId: null,
          action: null,
        }),
      ).rejects.toMatchObject({ code: 'unavailable' });
    } finally {
      fake.getSubscription = realGet;
    }
  });

  const hook = (id: string) =>
    handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind: 'payment',
      resourceId: id,
      providerUserId: null,
      action: null,
    });

  test('a reissued Pix cancels the old one at MP; a cancelled one never settles', async () => {
    const s = await store('drop', 'mirim', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    const oldPix = (await invoices(s.id))[0]!.provider_payment_id;
    // upgrading before paying reprices the invoice and reissues its Pix
    await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    await Bun.sleep(30);
    const inv = (await invoices(s.id))[0]!;
    expect(inv).toMatchObject({ amount_cents: 44900, pix_superseded: [oldPix] });
    expect(inv.provider_payment_id).not.toBe(oldPix);
    expect(fake.payments.get(oldPix)!.status).toBe('cancelled');
    await hook(oldPix);
    expect((await invoices(s.id))[0]!.status).toBe('open');
    await payInvoice(inv.id);
    expect((await invoices(s.id))[0]).toMatchObject({ status: 'paid', amount_cents: 44900 });
  });

  test('starting a plan needs the CPF/CNPJ; changing it replaces the live Pix with one that carries it', async () => {
    const s = await store('doc', 'mirim', 'bia@example.com');
    const none = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    expect(none.status).toBe(422);
    expect(none.body.error.details).toEqual({ field: 'payerDocument' });
    expect(await sql`select 1 from subscriptions where tenant_id = ${s.id}`).toHaveLength(0);

    const started: PixRequest[] = [];
    const realStart = fake.platformPix.bind(fake);
    fake.platformPix = async (req) => {
      started.push(req);
      return realStart(req);
    };
    try {
      // the admin's MercadoPago.js device id rides on the request that issues the Pix
      await call(
        'POST',
        '/admin/v1/account/subscription',
        {
          planId: 'mirim',
          method: 'pix',
          payerEmail: 'bia@example.com',
          payerDocument: '529.982.247-25',
        },
        { cookie: s.cookie, 'x-vendua-device': 'armor.0wn3r' },
      );
    } finally {
      fake.platformPix = realStart;
    }
    expect(started.map((r) => r.deviceId)).toEqual(['armor.0wn3r']);
    expect((await s.owner('GET', '/account')).body.billing).toEqual({
      available: true,
      publicKey: null,
    });
    const oldPix = (await invoices(s.id))[0]!.provider_payment_id;
    const seen: PixRequest[] = [];
    const realPix = fake.platformPix.bind(fake);
    fake.platformPix = async (req) => {
      seen.push(req);
      return realPix(req);
    };
    try {
      // the same document again changes nothing; a new one reissues the live Pix
      await s.owner('PATCH', '/account/subscription', { payerDocument: '52998224725' });
      expect(seen).toHaveLength(0);
      const changed = await s.owner('PATCH', '/account/subscription', {
        payerDocument: '11.222.333/0001-81',
      });
      expect(changed.status).toBe(200);
    } finally {
      fake.platformPix = realPix;
    }
    expect(seen.map((r) => r.payerDocument)).toEqual(['11222333000181']);
    await Bun.sleep(30);
    const inv = (await invoices(s.id))[0]!;
    expect(inv.provider_payment_id).not.toBe(oldPix);
    expect(inv.pix_superseded).toEqual([oldPix]);
    expect(fake.payments.get(oldPix)!.status).toBe('cancelled');
  });

  test('an old Pix for a lower price leaves the invoice open; odd amounts and double pays reach the team', async () => {
    const s = await store('super', 'mirim', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    const oldPix = (await invoices(s.id))[0]!.provider_payment_id;
    // the owner scanned the old QR; MP's webhook hasn't arrived when the price changes
    fake.settle(oldPix, 'approved');
    await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    await Bun.sleep(30);
    expect(fake.payments.get(oldPix)!.status).toBe('approved');
    await hook(oldPix);
    await Bun.sleep(30);
    // R$ 69,90 never pays a R$ 449,00 invoice: it stays open, the payment is kept for the team
    let inv = (await invoices(s.id))[0]!;
    expect(inv).toMatchObject({ status: 'open', amount_cents: 44900, short_payments: [oldPix] });
    expect(inv.provider_payment_id).not.toBe(oldPix);
    expect((await sub(s.id)).status).toBe('pending');
    expect((await settings(s.id)).billing_hold).toBe(true);
    await hook(oldPix);
    expect((await invoices(s.id))[0]!.short_payments).toEqual([oldPix]);
    // the current Pix pays it; the old one landing again is a double payment
    await payInvoice(inv.id);
    inv = (await invoices(s.id))[0]!;
    expect(inv).toMatchObject({ status: 'paid', amount_cents: 44900 });
    expect((await sub(s.id)).status).toBe('active');
    await hook(oldPix);
    await Bun.sleep(30);
    const titles = await flagged(s.id);
    expect(titles).toContain('Pix com valor menor');
    expect(titles).toContain('Fatura paga duas vezes');
  });

  test('a cancelled plan’s Pix paid late activates nothing, whatever plan came after', async () => {
    const s = await store('voidpix', 'mirim', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    const old = (await invoices(s.id))[0]!;
    // scanned before the cancel; MP's webhook lands after a pricier plan was started
    fake.settle(old.provider_payment_id, 'approved');
    expect((await s.owner('POST', '/account/subscription/cancel', {})).status).toBe(200);
    expect((await invoices(s.id))[0]!.status).toBe('void');
    await s.owner('POST', '/account/subscription', {
      planId: 'pangolim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    await hook(old.provider_payment_id);
    await Bun.sleep(30);
    expect((await invoices(s.id))[0]!.status).toBe('void');
    expect((await sub(s.id)).status).toBe('pending');
    expect((await settings(s.id)).billing_hold).toBe(true);
    expect(await flagged(s.id)).toContain('Pix numa fatura cancelada');
  });

  test('upgrade then downgrade before paying: Mirim, the invoice void, no site request', async () => {
    const s = await paidStore('updown2', 'mirim');
    const up = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    const inv = up.body.subscription.pendingUpgrade.invoice;
    const pix = (await sql`select provider_payment_id from invoices where id = ${inv.id}`)[0]!
      .provider_payment_id;
    const down = await s.owner('PATCH', '/account/subscription', { planId: 'mirim' });
    expect(down.status).toBe(200);
    expect(down.body.subscription).toMatchObject({
      planId: 'mirim',
      pendingPlan: null,
      pendingUpgrade: null,
    });
    expect((await sql`select status from invoices where id = ${inv.id}`)[0]!.status).toBe('void');
    await Bun.sleep(20);
    expect(fake.payments.get(pix)!.status).toBe('cancelled');
    // MP charged the QR anyway: the money is flagged, the plan doesn't move
    fake.settle(pix, 'approved');
    await hook(pix);
    await Bun.sleep(30);
    expect(await planOf(s.id)).toBe('mirim');
    expect((await sub(s.id)).plan_id).toBe('mirim');
    expect(await siteRequests(s.id)).toHaveLength(0);
    expect(await flagged(s.id)).toContain('Upgrade pago fora do prazo');
  });

  test('an upgrade paid after the renewal was paid first does not apply', async () => {
    const s = await paidStore('late-up', 'mirim');
    const soon = new Date(Date.now() + 4 * DAY);
    await sql`update subscriptions set current_period_end = ${soon} where tenant_id = ${s.id}`;
    const up = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    const inv = up.body.subscription.pendingUpgrade.invoice;
    const pix = (await sql`select provider_payment_id from invoices where id = ${inv.id}`)[0]!
      .provider_payment_id;
    await tick();
    const renewal = (await invoices(s.id)).filter((r) => r.kind === 'period').at(-1)!;
    expect(renewal).toMatchObject({ plan_id: 'mirim', amount_cents: 6990 });
    await payInvoice(renewal.id);
    // the difference was priced for the old period: paying it now must not buy the new one
    fake.settle(pix, 'approved');
    await hook(pix);
    await Bun.sleep(30);
    expect(await planOf(s.id)).toBe('mirim');
    expect(await siteRequests(s.id)).toHaveLength(0);
    expect(await flagged(s.id)).toContain('Upgrade pago fora do prazo');
  });

  test('the old exploit (Mirim → Pangolim → Mirim, repeated) never yields Pangolim', async () => {
    const s = await paidStore('exploit', 'mirim');
    for (let i = 0; i < 3; i++) {
      await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
      expect(await planOf(s.id)).toBe('mirim');
      const site = await s.owner('POST', '/account/site-request', { brief: 'Um site bonito' });
      expect(site.body.error.code).toBe('PLAN_REQUIRED');
      const dom = await s.owner('POST', '/account/domains', { host: `x-${nonce}.example.com` });
      expect(dom.body.error.code).toBe('PLAN_REQUIRED');
      await s.owner('PATCH', '/account/subscription', { planId: 'mirim' });
    }
    expect(await siteRequests(s.id)).toHaveLength(0);
    const upgrades =
      await sql`select status from invoices where tenant_id = ${s.id} and kind = 'upgrade'`;
    expect(upgrades.map((r) => r.status)).toEqual(['void', 'void', 'void']);
    // the renewal is still Mirim
    await sql`update subscriptions set current_period_end = now() + interval '4 days' where tenant_id = ${s.id}`;
    await tick();
    const renewal = (await invoices(s.id)).filter((r) => r.kind === 'period').at(-1)!;
    expect(renewal).toMatchObject({ plan_id: 'mirim', amount_cents: 6990 });
  });

  test('an unpaid upgrade expires with the period; a tiny one waits for the renewal', async () => {
    const s = await paidStore('expire', 'mirim');
    const up = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    const inv = up.body.subscription.pendingUpgrade.invoice;
    // the period ends unpaid (the store renews): the upgrade never applies
    const past = new Date(Date.now() - 60_000);
    await sql`update invoices set period_end = ${past} where id = ${inv.id}`;
    await tick();
    expect((await sql`select status from invoices where id = ${inv.id}`)[0]!.status).toBe('void');
    expect(await sub(s.id)).toMatchObject({
      plan_id: 'mirim',
      upgrade_plan_id: null,
      upgrade_invoice_id: null,
    });
    expect((await s.owner('POST', `/account/invoices/${inv.id}/pix`, {})).body.error.code).toBe(
      'INVOICE_NOT_OPEN',
    );

    // under R$ 1 left to charge: no invoice, Pangolim from the next (Pangolim-priced) period
    const end = new Date(Date.now() + 60 * 60_000);
    await sql`
      update subscriptions set current_period_start = ${new Date(end.getTime() - 30 * DAY)},
        current_period_end = ${end}
      where tenant_id = ${s.id}
    `;
    const tiny = await s.owner('PATCH', '/account/subscription', { planId: 'pangolim' });
    expect(tiny.body.plan.id).toBe('mirim');
    expect(tiny.body.subscription).toMatchObject({
      pendingUpgrade: null,
      pendingPlan: { id: 'pangolim', name: 'Venduá Pangolim' },
    });
    expect(
      (
        await sql`select 1 from invoices where tenant_id = ${s.id} and kind = 'upgrade' and status = 'open'`
      ).length,
    ).toBe(0);
    await tick();
    const renewal = (await invoices(s.id)).filter((r) => r.kind === 'period').at(-1)!;
    expect(renewal).toMatchObject({ plan_id: 'pangolim', amount_cents: 44900 });
    await payInvoice(renewal.id);
    await sql`update invoices set period_start = ${past} where id = ${renewal.id}`;
    await sql`
      update subscriptions set current_period_start = ${past}, pending_plan_at = ${past}
      where tenant_id = ${s.id}
    `;
    await tick();
    expect(await planOf(s.id)).toBe('pangolim');
    expect((await siteRequests(s.id)).map((r) => r.status)).toEqual(['requested']);
  });

  test('pix → card mid-period: the assinatura starts when the paid period ends', async () => {
    const s = await paidStore('switch', 'mirim');
    const end = (await sub(s.id)).current_period_end as Date;
    const r = await s.owner('PATCH', '/account/subscription', { method: 'card' });
    expect(r.body.subscription).toMatchObject({ method: 'card', status: 'active' });
    const pre = (await sub(s.id)).provider_subscription_id;
    expect(fake.subscriptions.get(pre)!.req.startDate?.getTime()).toBe(end.getTime());
  });

  test('features need a paid plan: a pending Pangolim store gets PLAN_REQUIRED', async () => {
    const s = await store('unpaid', 'pangolim', 'bia@example.com');
    const noSub = await s.owner('POST', '/account/domains', {
      host: `unpaid-${nonce}.example.com`,
    });
    expect(noSub.body.error).toMatchObject({
      code: 'PLAN_REQUIRED',
      details: { reason: 'unpaid' },
    });
    await s.owner('POST', '/account/subscription', {
      planId: 'pangolim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    const site = await s.owner('POST', '/account/site-request', { brief: 'Um site bonito' });
    expect(site.body.error).toMatchObject({ code: 'PLAN_REQUIRED', details: { reason: 'unpaid' } });
  });

  test('no CPF/CNPJ on file: the renewal waits without its Pix, says why, and saving it issues the Pix', async () => {
    const s = await store('held', 'mirim', 'bia@example.com');
    await sql`update merchant_users set prefs = '{"emailInvoices": false}' where tenant_id = ${s.id}`;
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    await payInvoice(st.body.invoices[0].id);
    // a store from before signup asked for one
    await sql`update subscriptions set payer_document = null where tenant_id = ${s.id}`;
    const mine = () => wa.filter((m) => m.phone === s.phone && m.text.startsWith('Venduá: '));

    await sql`update subscriptions set current_period_end = ${new Date(Date.now() + 2 * DAY)} where tenant_id = ${s.id}`;
    await tick();
    await tick();
    const held = (await invoices(s.id))[1]!;
    expect(held).toMatchObject({ status: 'open', pix_copy_paste: null, provider_payment_id: null });
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.text).toContain('Para gerar o Pix, informe o CPF ou o CNPJ da cobrança');

    // the owner asks for the Pix: told what is missing, nothing goes to MP
    const asked = await s.owner('POST', `/account/invoices/${held.id}/pix`, {});
    expect(asked.status).toBe(422);
    expect(asked.body.error).toMatchObject({
      code: 'PAYER_DOCUMENT_REQUIRED',
      details: { field: 'payerDocument' },
    });

    const seen: PixRequest[] = [];
    const realPix = fake.platformPix.bind(fake);
    fake.platformPix = async (req) => {
      seen.push(req);
      return realPix(req);
    };
    try {
      const saved = await s.owner('PATCH', '/account/subscription', {
        payerDocument: '390.533.447-05',
      });
      expect(saved.status).toBe(200);
    } finally {
      fake.platformPix = realPix;
    }
    // the held invoice gets its Pix, carrying the document — in its key too, so a retry after a
    // rollback that changed the document can't get the old Pix back
    expect(seen.map((r) => r.payerDocument)).toEqual(['39053344705']);
    const digest = createHash('sha256').update('39053344705').digest('hex').slice(0, 12);
    expect(seen[0]!.idempotencyKey).toBe(`invoice:${held.id}:1:${digest}`);
    expect((await invoices(s.id))[1]!.pix_copy_paste).toEqual(expect.any(String));
  });

  test('saving the CPF/CNPJ never fails on a held renewal that has no email to bill', async () => {
    const s = await store('mudo', 'mirim', 'mudo@example.com');
    await sql`update merchant_users set prefs = '{"emailInvoices": false}' where tenant_id = ${s.id}`;
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'mudo@example.com',
      payerDocument: '529.982.247-25',
    });
    await payInvoice(st.body.invoices[0].id);
    await sql`update subscriptions set payer_document = null where tenant_id = ${s.id}`;
    await sql`update subscriptions set current_period_end = ${new Date(Date.now() + 2 * DAY)} where tenant_id = ${s.id}`;
    await tick();
    expect((await invoices(s.id))[1]).toMatchObject({ status: 'open', pix_copy_paste: null });
    await sql`update subscriptions set payer_email = null where tenant_id = ${s.id}`;
    await sql`update merchant_users set email = null where tenant_id = ${s.id}`;
    await sql`update store_settings set email = null where tenant_id = ${s.id}`;

    const saved = await s.owner('PATCH', '/account/subscription', {
      payerDocument: '390.533.447-05',
    });
    expect(saved.status).toBe(200);
    expect(
      (await sql`select payer_document from subscriptions where tenant_id = ${s.id}`)[0]!
        .payer_document,
    ).toBe('39053344705');
    expect((await invoices(s.id))[1]!.pix_copy_paste).toBeNull();
  });

  test('pix renewal: reminders once each, past_due, paid again → active', async () => {
    const s = await store('late', 'mirim', 'bia@example.com');
    await sql`update merchant_users set prefs = '{"emailInvoices": false}' where tenant_id = ${s.id}`;
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'mirim',
      method: 'pix',
      payerEmail: 'bia@example.com',
      payerDocument: '529.982.247-25',
    });
    await payInvoice(st.body.invoices[0].id);
    const mine = () => wa.filter((m) => m.phone === s.phone && m.text.startsWith('Venduá: '));

    const end = new Date(Date.now() + 2 * DAY);
    await sql`update subscriptions set current_period_end = ${end} where tenant_id = ${s.id}`;
    await tick();
    await tick();
    expect(mine()).toHaveLength(1);
    expect(mine()[0]!.text).toContain('vence em');
    expect(mine()[0]!.text).toContain('R$ 69,90');
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

  test('the renewal asks MP with no billing lock held; a reprice meanwhile drops that Pix', async () => {
    const s = await paidStore('lockfree', 'mirim');
    const realPix = fake.platformPix.bind(fake);
    const asked: { free: boolean; id: string; amountCents: number }[] = [];
    let repriceOnce = true;
    fake.platformPix = async (req) => {
      const mine = await sql`
        select 1 from invoices where id = ${req.externalReference} and tenant_id = ${s.id}
      `;
      if (!mine.length) return realPix(req);
      // a merchant request needs this lock: it must be free while MP answers
      const free = await sql.begin(
        async (tx) =>
          (
            await tx<{ ok: boolean }[]>`
              select pg_try_advisory_xact_lock(hashtextextended(${`billing:${s.id}`}, 0)) as ok
            `
          )[0]!.ok,
      );
      if (repriceOnce) {
        repriceOnce = false;
        await sql`update invoices set amount_cents = amount_cents + 100 where id = ${req.externalReference}`;
      }
      const p = await realPix(req);
      asked.push({ free, id: p.id, amountCents: req.amountCents });
      return p;
    };
    try {
      const end = new Date(Date.now() + 2 * DAY);
      await sql`update subscriptions set current_period_end = ${end} where tenant_id = ${s.id}`;
      await tick();
      expect(asked).toHaveLength(1);
      expect(asked[0]!.free).toBe(true);
      // asked for the old amount: never stored, cancelled at MP
      let inv = (await invoices(s.id))[1]!;
      expect(inv.provider_payment_id).toBeNull();
      expect(fake.payments.get(asked[0]!.id)!.status).toBe('cancelled');

      // the next tick retries the invoice that has no Pix, at the plan's price, with a new key
      await tick();
      expect(asked).toHaveLength(2);
      expect(asked[1]!.free).toBe(true);
      inv = (await invoices(s.id))[1]!;
      expect(inv.amount_cents).toBe(6990);
      expect(inv.provider_payment_id).toBe(asked[1]!.id);
      expect(asked[1]!.amountCents).toBe(6990);
      expect(inv.pix_attempt).toBe(2);

      await tick();
      expect(asked).toHaveLength(2);
    } finally {
      fake.platformPix = realPix;
    }
  });

  test('two replicas remind at once: one message, and it points at a Pix that is stored', async () => {
    const s = await paidStore('replicas', 'mirim');
    await sql`update merchant_users set prefs = '{"emailInvoices": false}' where tenant_id = ${s.id}`;
    const due = () =>
      wa.filter((m) => m.phone === s.phone && m.text.includes('vence hoje')).map((m) => m.text);
    await sql`update subscriptions set current_period_end = ${new Date(Date.now() + 2 * DAY)} where tenant_id = ${s.id}`;
    await tick();
    const inv = (await invoices(s.id))[1]!;
    // due today, its Pix expired: the reminder needs a fresh one
    await sql`update invoices set due_at = now() - interval '1 hour', pix_expires_at = now() - interval '1 minute' where id = ${inv.id}`;

    // replica 1 asks MP; replica 2 reserves and asks too; replica 1 claims while replica 2's
    // answer is still on its way — the order in which both used to drop each other's Pix
    const realPix = fake.platformPix.bind(fake);
    let r2AtMp!: () => void;
    const atMp = new Promise<void>((r) => (r2AtMp = r));
    let releaseR2!: () => void;
    const r1Done = new Promise<void>((r) => (releaseR2 = r));
    let calls = 0;
    let r2: Promise<void> | null = null;
    fake.platformPix = async (req) => {
      if (req.externalReference !== inv.id) return realPix(req);
      calls++;
      if (calls === 1) {
        r2 = tick();
        await atMp;
      } else if (calls === 2) {
        r2AtMp();
        await r1Done;
      }
      return realPix(req);
    };
    try {
      await tick();
      releaseR2();
      await r2;
    } finally {
      fake.platformPix = realPix;
    }
    expect(calls).toBe(2);
    expect(due()).toHaveLength(1);
    const row = (await invoices(s.id))[1]!;
    expect(row.reminded).toContain('due');
    expect(row.pix_expires_at.getTime()).toBeGreaterThan(Date.now());
    expect(fake.payments.get(row.provider_payment_id)!.status).toBe('pending');
  });

  test('Pangolim domain: add → DNS check → dns_ok (team told once) → CRM activates → removed', async () => {
    const s = await paidStore('dom', 'pangolim');
    const other = await paidStore('dom2', 'pangolim');
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
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 20 * 60_000));
    chk = await s.owner('GET', '/account');
    expect(chk.body.customDomain.status).toBe('dns_ok');
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 60 * 60_000));
    await s.owner('POST', `/account/domains/${cd.id}/check`, {});
    // the team hears it once, on Discord; nobody has to switch anything on by hand any more
    const ready = await sql`
      select 1 from staff_events where kind = 'domain.ready' and tenant_id = ${s.id}
    `;
    expect(ready).toHaveLength(1);
    // the store whose TXT verified wins; the rival claim is lost, and the host is now taken
    const lost = await other.owner('GET', '/account');
    expect(lost.body.customDomain).toMatchObject({ host, status: 'failed' });
    expect(lost.body.customDomain.lastError).toContain('Outra loja');
    const third = await (
      await paidStore('dom3', 'pangolim')
    ).owner('POST', '/account/domains', {
      host,
    });
    expect(third.body.error.code).toBe('DOMAIN_TAKEN');

    expect((await call('POST', `/control/v1/custom-domains/${cd.id}/activate`)).status).toBe(404);
    // a store whose plan lost the domain doesn't get it switched on
    await sql`update tenants set plan = 'mirim' where id = ${s.id}`;
    const refused = await control('POST', `/control/v1/custom-domains/${cd.id}/activate`);
    expect(refused.body.error).toMatchObject({
      code: 'PLAN_REQUIRED',
      details: { feature: 'customDomain' },
    });
    await sql`update tenants set plan = 'pangolim' where id = ${s.id}`;
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
    // a live domain can be removed by its owner: it leaves through the domain jobs
    const del = await s.owner('DELETE', `/account/domains/${cd.id}`);
    expect(del.status).toBe(200);
    expect(del.body.customDomain).toBeNull();

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
    const x = await paidStore('dom4', 'pangolim');
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

  test('site request (Pangolim) and the CRM', async () => {
    const s = await paidStore('site', 'pangolim');
    const r = await s.owner('POST', '/account/site-request', {
      brief: 'Loja de doces, tons pastel',
    });
    // paying Pangolim already opened the request; the brief fills it in
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
      plan: { id: 'pangolim', name: 'Venduá Pangolim' },
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
    expect(plans.body.plans.find((x: any) => x.id === 'mirim')).toMatchObject({
      priceCents: 6990,
      public: true,
    });
    const same = await control('PATCH', '/control/v1/plans/mirim', { public: true });
    expect(same.body.plan).toMatchObject({ id: 'mirim', public: true, priceCents: 6990 });
    expect((await control('PATCH', '/control/v1/plans/nope_plan', { public: true })).status).toBe(
      404,
    );
    expect((await control('PATCH', '/control/v1/plans/mirim', { priceCents: 1.5 })).status).toBe(
      422,
    );
  });

  test('a CRM price change reaches the assinatura and unpaid invoices', async () => {
    const planId = `bill_${nonce}`;
    await sql`
      insert into plans (id, name, price_cents, features, public, sort)
      values (${planId}, 'Plano teste', 5000, '{}', false, 99)
    `;
    const a = await store('price-card', 'mirim', 'bia@example.com');
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
    const b = await store('price-pix', 'mirim', 'bia@example.com');
    await sql`insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_document) values (${b.id}, ${planId}, 'pix', 'pending', 'fake', '52998224725')`;
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

  test('a reprice keeps the live Pix until MP hands over the new one', async () => {
    const planId = `bill_${nonce}_live`;
    await sql`
      insert into plans (id, name, price_cents, features, public, sort)
      values (${planId}, 'Plano vivo', 5000, '{}', false, 99)
    `;
    const s = await store('price-live', 'mirim', 'bia@example.com');
    await sql`insert into subscriptions (tenant_id, plan_id, method, status, provider, payer_document) values (${s.id}, ${planId}, 'pix', 'pending', 'fake', '52998224725')`;
    const inv = (
      await sql`
        insert into invoices (tenant_id, number, plan_id, amount_cents, period_start, period_end, method, provider, due_at)
        values (${s.id}, 1, ${planId}, 5000, now(), now() + interval '1 month', 'pix', 'fake', now())
        returning id
      `
    )[0]!;
    const old = await fake.platformPix({
      amountCents: 5000,
      description: 'x',
      payerEmail: 'bia@example.com',
      externalReference: inv.id,
      idempotencyKey: `live-${nonce}`,
      notificationUrl: null,
      applicationFeeCents: 0,
      expiresAt: new Date(Date.now() + DAY),
    });
    await sql`
      update invoices set provider_payment_id = ${old.id}, pix_copy_paste = ${old.pix!.copyPaste},
        pix_expires_at = now() + interval '1 day'
      where id = ${inv.id}
    `;
    await sql`update plans set price_cents = 6000 where id = ${planId}`;
    const ctx = { sql: appSql, provider: fake, notify, origin: null };

    const realPix = fake.platformPix.bind(fake);
    fake.platformPix = async () => {
      throw new ProviderError('unavailable', 'MP fora do ar');
    };
    try {
      await syncPlanPrices(appSql, ctx, new Date());
    } finally {
      fake.platformPix = realPix;
    }
    let row = (await invoices(s.id))[0]!;
    expect(row.amount_cents).toBe(5000);
    expect(row.provider_payment_id).toBe(old.id);
    expect(fake.payments.get(old.id)!.status).not.toBe('cancelled');

    await syncPlanPrices(appSql, ctx, new Date());
    row = (await invoices(s.id))[0]!;
    expect(row.amount_cents).toBe(6000);
    expect(row.provider_payment_id).not.toBe(old.id);
    expect(fake.payments.get(row.provider_payment_id)!.amountCents).toBe(6000);
    expect(row.pix_superseded).toContain(old.id);
    expect(fake.payments.get(old.id)!.status).toBe('cancelled');
  });

  test('webhooks: unknown references and other stores’ ids are ignored', async () => {
    const d = { sql: appSql, provider: fake, notify } as never;
    const stray = await fake.platformPix({
      amountCents: 6990,
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
    const s = await store('hook', 'mirim', 'bia@example.com');
    const ps = await fake.createSubscription({
      reason: 'x',
      amountCents: 6990,
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
        planId: 'mirim',
        method: 'pix',
        payerEmail: 'bia@example.com',
        payerDocument: '529.982.247-25',
      });
      expect(off.body.error.code).toBe('BILLING_UNAVAILABLE');
    } finally {
      fake.platformConfigured = true;
    }
  });
});
