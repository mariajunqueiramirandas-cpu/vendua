import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession, membershipsFor } from '../src/admin/auth.ts';
import { setDnsResolver } from '../src/modules/billing/domains.ts';
import { runBillingTick, runDomainChecks } from '../src/modules/billing/jobs.ts';
import { billingStaff } from '../src/modules/billing/subscriptions.ts';
import { handleBillingWebhook } from '../src/modules/billing/webhook.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

// ADR 0023 in plan billing, signup and the merchant admin: every event is written in the
// transaction of its change, carries its store, and a replay or a re-run sweep adds nothing.

interface EventRow {
  kind: string;
  tenant_id: string | null;
  anchor: string | null;
  dedupe_key: string | null;
  severity: string;
  data: Record<string, any>;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('staff events: billing and signup (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  // provider ids are process-local counters; start past anything another run left behind
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const staff: string[] = [];
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
    notify,
  };
  const app = createApp(deps);
  const jobOpts = {
    provider: fake,
    notify,
    adminOrigin: 'https://painel.vendua.test',
    storeDomain: 'vendua.test',
  };
  const tick = () => runBillingTick(appSql, jobOpts, new Date());
  const nonce = crypto.randomUUID().slice(0, 6);
  const created: string[] = [];
  let idem = 0;
  let phones = 0;
  const mkPhone = () => `219${String(Date.now() + ++phones * 17).slice(-8)}`;
  const originalStaff = billingStaff.notify;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    via = app,
  ) => {
    const res = await via.request(`http://core.localhost${path}`, {
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
  const control = (method: string, path: string, body?: unknown, key = crypto.randomUUID()) =>
    call(method, path, body, { 'x-vendua-control': 'ctl', 'idempotency-key': key });

  const events = (tenantId: string, kind?: string) =>
    sql<EventRow[]>`
      select kind, tenant_id, anchor, dedupe_key, severity, data from staff_events
      where tenant_id = ${tenantId} ${kind ? sql`and kind = ${kind}` : sql``}
      order by id
    `;
  const problems = async (tenantId: string, problem: string) =>
    (await events(tenantId, 'billing.problem')).filter((e) => e.data.problem === problem);

  /** a store from provision_store with its owner signed in (the store's first sign-in) */
  const store = async (name: string, plan: 'basic' | 'pro_plus', email: string | null = null) => {
    const slug = `sev-${nonce}-${name}`;
    const phone = mkPhone();
    const id = (
      await sql<{ id: string }[]>`
        select provision_store(${slug}, ${'Loja ' + name}, ${plan}, ${`${slug}.vendua.test`},
                               'Bia Dona', ${phone}, ${email}) as id
      `
    )[0]!.id;
    created.push(id);
    const m = (await membershipsFor(appSql, phone)).find((x) => x.tenant_id === id)!;
    const cookie = `vendua_admin=${await createSession(appSql, m, 'test')}`;
    const owner = (method: string, path: string, body?: unknown, key?: string) =>
      call(method, `/admin/v1${path}`, body, {
        cookie,
        ...(key ? { 'idempotency-key': key } : {}),
      });
    return { id, slug, phone, owner };
  };
  const payInvoice = (id: string) => call('POST', `/admin/v1/dev/billing/invoices/${id}/pay`, {});
  const paidStore = async (name: string, plan: 'basic' | 'pro_plus') => {
    const s = await store(name, plan, 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: plan,
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    expect(st.status).toBe(200);
    expect((await payInvoice(st.body.invoices[0].id)).status).toBe(200);
    return s;
  };
  const hook = (kind: 'payment' | 'subscription' | 'subscription_payment', id: string) =>
    handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind,
      resourceId: id,
      providerUserId: null,
      action: null,
    });
  const preapproval = async (tenantId: string) =>
    (
      await sql`select provider_subscription_id from subscriptions where tenant_id = ${tenantId}`
    )[0]!.provider_subscription_id as string;

  const verified = async (phone: string, via = app) => {
    expect((await call('POST', '/admin/v1/signup/otp/start', { phone }, {}, via)).status).toBe(200);
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const v = await call('POST', '/admin/v1/signup/otp/verify', { phone, code }, {}, via);
    expect(v.status).toBe(200);
    return v.body.signupToken as string;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    billingStaff.notify = async (_sql, n) => void staff.push(n.subject);
  });

  afterAll(async () => {
    billingStaff.notify = originalStaff;
    setDnsResolver(null);
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('signup: store.created opens the onboarding card; first sign-in and first payment follow', async () => {
    const via = createApp(deps);
    const slug = `sev-${nonce}-signup`;
    const body = {
      signupToken: await verified(mkPhone(), via),
      planId: 'basic',
      method: 'pix',
      storeName: 'Doces da Praia',
      slug,
      ownerName: 'Ana Lima',
      email: 'ana@example.com',
    };
    const r = await call('POST', '/admin/v1/signup', body, {}, via);
    expect(r.status).toBe(201);
    const id = r.body.store.id as string;
    created.push(id);
    let rows = await events(id);
    expect(rows.map((e) => e.kind)).toEqual(['store.created', 'store.onboarding']);
    expect(rows[0]).toMatchObject({
      tenant_id: id,
      anchor: `onboarding:${id}`,
      dedupe_key: `store.created:${id}`,
      severity: 'success',
      data: {
        storeName: 'Doces da Praia',
        slug,
        source: 'signup',
        owner: 'Ana Lima',
        leadId: null,
        plan: 'Venduá Basic',
      },
    });
    expect(rows[1]).toMatchObject({
      tenant_id: id,
      anchor: `onboarding:${id}`,
      dedupe_key: `onboarding:${id}:first_login`,
      data: { step: 'first_login' },
    });

    // the same token+slug again is the same store (and an owner already seen): nothing new
    expect((await call('POST', '/admin/v1/signup', body, {}, via)).status).toBe(201);
    expect(await events(id)).toHaveLength(2);

    // the first payment, then MP's webhook again
    const inv = r.body.next.invoiceId as string;
    expect((await payInvoice(inv)).status).toBe(200);
    const pid = (await sql`select provider_payment_id from invoices where id = ${inv}`)[0]!
      .provider_payment_id as string;
    await hook('payment', pid);
    rows = await events(id);
    expect(rows.map((e) => e.kind)).toEqual([
      'store.created',
      'store.onboarding',
      'billing.paid',
      'store.onboarding',
    ]);
    expect(rows[2]).toMatchObject({
      tenant_id: id,
      anchor: null,
      dedupe_key: `billing.paid:${inv}`,
      data: {
        storeName: 'Doces da Praia',
        invoiceId: inv,
        amountCents: 3990,
        first: true,
        method: 'pix',
        plan: 'Venduá Basic',
      },
    });
    expect(rows[3]).toMatchObject({
      anchor: `onboarding:${id}`,
      dedupe_key: `onboarding:${id}:paid`,
      data: { step: 'paid' },
    });

    // a renewal paid: billing.paid again, not the first; no second "paid" step
    await sql`update subscriptions set current_period_end = now() + interval '2 days' where tenant_id = ${id}`;
    await tick();
    const renewal = (
      await sql`select id from invoices where tenant_id = ${id} and status = 'open'`
    )[0]!.id as string;
    expect((await payInvoice(renewal)).status).toBe(200);
    const paid = await events(id, 'billing.paid');
    expect(paid.map((e) => e.data)).toMatchObject([
      { invoiceId: inv, first: true },
      { invoiceId: renewal, first: false, method: 'pix', amountCents: 3990 },
    ]);
    expect(await events(id, 'store.onboarding')).toHaveLength(2);
  });

  test('access code: billing.manual for the invoice the team marks paid; the CRM click is billing.paid (manual)', async () => {
    const via = createApp(deps);
    const slug = `sev-${nonce}-code`;
    const before = process.env.VENDUA_SIGNUP_ACCESS_CODE;
    fake.platformConfigured = false;
    try {
      process.env.VENDUA_SIGNUP_ACCESS_CODE = 'abre-sem-mp-1234';
      const body = {
        signupToken: await verified(mkPhone(), via),
        planId: 'basic',
        storeName: 'Bolo da Vó',
        slug,
        ownerName: 'Rita Souza',
        email: 'rita@example.com',
        accessCode: 'abre-sem-mp-1234',
      };
      const r = await call('POST', '/admin/v1/signup', body, {}, via);
      expect(r.status).toBe(201);
      expect(r.body.next.kind).toBe('manual');
      const id = r.body.store.id as string;
      created.push(id);
      const inv = r.body.next.invoiceId as string;
      expect((await events(id)).map((e) => e.kind)).toEqual([
        'store.created',
        'billing.manual',
        'store.onboarding',
      ]);
      expect((await events(id, 'store.created'))[0]!.data).toMatchObject({
        storeName: 'Bolo da Vó',
        source: 'access_code',
        owner: 'Rita Souza',
        plan: 'Venduá Basic',
      });
      expect((await events(id, 'billing.manual'))[0]).toMatchObject({
        tenant_id: id,
        anchor: null,
        dedupe_key: `billing.manual:${inv}`,
        data: { storeName: 'Bolo da Vó', invoiceId: inv, amountCents: 3990, plan: 'Venduá Basic' },
      });
      // a replay finds the same invoice: still one of each
      expect((await call('POST', '/admin/v1/signup', body, {}, via)).status).toBe(201);
      expect(await events(id)).toHaveLength(3);

      // the CRM marks it paid; the same click replays
      const key = crypto.randomUUID();
      const mark = () => control('POST', `/control/v1/billing/invoices/${inv}/mark-paid`, {}, key);
      expect((await mark()).status).toBe(200);
      expect((await mark()).status).toBe(200);
      const paid = await events(id, 'billing.paid');
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({
        tenant_id: id,
        data: { invoiceId: inv, amountCents: 3990, first: true, method: 'manual' },
      });
      expect((await events(id, 'store.onboarding')).map((e) => e.data.step)).toEqual([
        'first_login',
        'paid',
      ]);

      // without MP the renewal is one more invoice for the team, told once across ticks
      await sql`update subscriptions set current_period_end = now() + interval '1 day' where tenant_id = ${id}`;
      await tick();
      await tick();
      const renewal = (
        await sql`select id from invoices where tenant_id = ${id} and status = 'open'`
      )[0]!.id as string;
      expect((await events(id, 'billing.manual')).map((e) => e.data.invoiceId)).toEqual([
        inv,
        renewal,
      ]);
    } finally {
      fake.platformConfigured = true;
      if (before === undefined) delete process.env.VENDUA_SIGNUP_ACCESS_CODE;
      else process.env.VENDUA_SIGNUP_ACCESS_CODE = before;
    }
  });

  test('card: a rejected month, the owner cancelling and the period ending — one billing.problem each', async () => {
    const s = await store('card', 'basic', 'bia@example.com');
    const st = await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'card',
      payerEmail: 'bia@example.com',
    });
    expect(st.status).toBe(200);
    const pre = await preapproval(s.id);
    await call('POST', `/admin/v1/dev/billing/subscriptions/${pre}/settle`, { status: 'approved' });
    expect((await events(s.id, 'billing.paid'))[0]!.data).toMatchObject({
      first: true,
      method: 'card',
      amountCents: 3990,
    });

    // a rejected charge, its webhook twice, then MP's retry for the same month
    for (let n = 0; n < 2; n++) {
      fake.settleSubscription(pre, 'rejected');
      const charge = [...fake.subscriptionPayments.values()]
        .filter((p) => p.subscriptionId === pre)
        .at(-1)!;
      await hook('subscription_payment', charge.id);
      await hook('subscription_payment', charge.id);
    }
    const failed = (
      await sql`select id from invoices where tenant_id = ${s.id} and status = 'failed'`
    )[0]!.id as string;
    const rejected = await problems(s.id, 'card_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      tenant_id: s.id,
      anchor: null,
      severity: 'warning',
      dedupe_key: `billing.problem:${s.id}:card_rejected:${failed}`,
      data: { storeName: 'Loja card', problem: 'card_rejected' },
    });
    expect(rejected[0]!.data.detail).toContain('R$ 39,90');

    // cancel, undo, cancel again: one event for the period
    expect((await s.owner('POST', '/account/subscription/cancel', {})).status).toBe(200);
    expect((await s.owner('POST', '/account/subscription/resume', {})).status).toBe(200);
    expect((await s.owner('POST', '/account/subscription/cancel', {})).status).toBe(200);
    let cancelled = await problems(s.id, 'cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.data.detail).toMatch(
      /^O lojista cancelou o plano Venduá Basic; vale até \d\d\/\d\d, depois a loja fecha\.$/,
    );

    // the period ends and the store closes: one more, and the next sweep adds nothing
    await sql`update subscriptions set current_period_end = now() - interval '1 minute' where tenant_id = ${s.id}`;
    await tick();
    await tick();
    expect((await sql`select status from subscriptions where tenant_id = ${s.id}`)[0]!.status).toBe(
      'cancelled',
    );
    cancelled = await problems(s.id, 'cancelled');
    expect(cancelled.map((e) => e.data.detail)).toEqual([
      expect.stringContaining('O lojista cancelou'),
      'O plano Venduá Basic terminou e a loja está fechada.',
    ]);
    expect(cancelled[1]!.dedupe_key).toStartWith(`billing.problem:${s.id}:cancelled:ended:`);
  });

  test('cancelled before the first payment: by Mercado Pago (hook replayed) and by the owner', async () => {
    const s = await store('mpcancel', 'basic', 'bia@example.com');
    await s.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'card',
      payerEmail: 'bia@example.com',
    });
    const pre = await preapproval(s.id);
    await fake.updateSubscription(pre, { status: 'cancelled' });
    await hook('subscription', pre);
    await hook('subscription', pre);
    const byMp = await events(s.id, 'billing.problem');
    expect(byMp).toHaveLength(1);
    expect(byMp[0]!.data).toEqual({
      storeName: 'Loja mpcancel',
      problem: 'cancelled',
      detail:
        'A assinatura do plano Venduá Basic foi cancelada no Mercado Pago antes do primeiro pagamento.',
    });
    expect(byMp[0]!.dedupe_key).toStartWith(`billing.problem:${s.id}:cancelled:pending:`);

    const o = await store('ownercancel', 'basic', 'bia@example.com');
    await o.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    expect((await o.owner('POST', '/account/subscription/cancel', {})).status).toBe(200);
    expect((await events(o.id, 'billing.problem')).map((e) => e.data.detail)).toEqual([
      'O lojista cancelou o plano Venduá Basic antes do primeiro pagamento.',
    ]);
  });

  test('pix: past due once per period; an odd Pix is pix_mismatch once however often it is seen', async () => {
    const s = await paidStore('late', 'basic');
    const ended = new Date(Date.now() - 3_600_000);
    await sql`update subscriptions set current_period_end = ${ended} where tenant_id = ${s.id}`;
    await tick();
    await tick();
    let late = await problems(s.id, 'past_due');
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({
      tenant_id: s.id,
      dedupe_key: `billing.problem:${s.id}:past_due:${ended.toISOString()}`,
      data: { storeName: 'Loja late' },
    });
    expect(late[0]!.data.detail).toMatch(
      /^O período do plano Venduá Basic terminou em \d\d\/\d\d sem pagamento\.$/,
    );
    // paid, then late again in a later period: a new event
    const renewal = (
      await sql`select id from invoices where tenant_id = ${s.id} and status = 'open'`
    )[0]!.id as string;
    expect((await payInvoice(renewal)).status).toBe(200);
    await sql`update subscriptions set current_period_end = now() - interval '5 minutes' where tenant_id = ${s.id}`;
    await tick();
    late = await problems(s.id, 'past_due');
    expect(late).toHaveLength(2);

    // the owner scanned the old QR; MP's webhook lands after a price change
    const o = await store('odd', 'basic', 'bia@example.com');
    await o.owner('POST', '/account/subscription', {
      planId: 'basic',
      method: 'pix',
      payerEmail: 'bia@example.com',
    });
    const oldPix = (
      await sql`select provider_payment_id from invoices where tenant_id = ${o.id}`
    )[0]!.provider_payment_id as string;
    fake.settle(oldPix, 'approved');
    await o.owner('PATCH', '/account/subscription', { planId: 'pro_plus' });
    await hook('payment', oldPix);
    await hook('payment', oldPix);
    // the reconcile sweep finds the same approved Pix again
    await tick();
    let odd = await problems(o.id, 'pix_mismatch');
    expect(odd).toHaveLength(1);
    expect(odd[0]).toMatchObject({
      tenant_id: o.id,
      dedupe_key: `billing.problem:${o.id}:pix_mismatch:invoice-amount:${oldPix}`,
      data: { storeName: 'Loja odd', problem: 'pix_mismatch' },
    });
    expect(odd[0]!.data.detail).toContain('R$ 39,90');
    // the right Pix pays it; the old one landing again is a double payment — also once
    const inv = (await sql`select id from invoices where tenant_id = ${o.id}`)[0]!.id as string;
    expect((await payInvoice(inv)).status).toBe(200);
    await hook('payment', oldPix);
    await hook('payment', oldPix);
    odd = await problems(o.id, 'pix_mismatch');
    expect(odd.map((e) => e.dedupe_key)).toEqual([
      `billing.problem:${o.id}:pix_mismatch:invoice-amount:${oldPix}`,
      `billing.problem:${o.id}:pix_mismatch:invoice-dup:${oldPix}`,
    ]);
    // the team's email/WhatsApp notices still go out
    expect(staff.some((x) => x.startsWith('Pix com valor menor'))).toBe(true);
    expect(staff.some((x) => x.startsWith('Fatura paga duas vezes'))).toBe(true);
  });

  test('PRO+: the site request and the verified custom domain reach the team once', async () => {
    const s = await paidStore('pro', 'pro_plus');
    const sr = (await sql`select id from site_requests where tenant_id = ${s.id}`)[0]!.id as string;
    let req = await events(s.id, 'store.request');
    expect(req).toHaveLength(1);
    expect(req[0]).toMatchObject({
      tenant_id: s.id,
      anchor: null,
      dedupe_key: `store.request:site:${sr}`,
      data: { storeName: 'Loja pro', title: 'site PRO+', detail: null },
    });
    // delivered; the owner asks for another one, in their own words
    expect(
      (await control('PATCH', `/control/v1/site-requests/${sr}`, { status: 'delivered' })).status,
    ).toBe(200);
    const brief = 'Uma página para as encomendas de Natal';
    expect((await s.owner('POST', '/account/site-request', { brief })).status).toBe(201);
    req = await events(s.id, 'store.request');
    expect(req.map((e) => e.data.detail)).toEqual([null, brief]);

    const host = `loja-${nonce}.example.com`;
    const add = await s.owner('POST', '/account/domains', { host });
    expect(add.status).toBe(201);
    const cd = add.body.customDomain;
    const miss = () => Promise.reject(new Error('ENOTFOUND'));
    setDnsResolver({
      resolveCname: async (h) => (h === host ? [`${s.slug}.vendua.test`] : miss()),
      resolve4: async () => miss(),
      resolveTxt: async (h) => (h === `_vendua.${host}` ? [[cd.txtValue]] : miss()),
    });
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 20 * 60_000));
    await runDomainChecks(appSql, jobOpts, new Date(Date.now() + 60 * 60_000));
    await s.owner('POST', `/account/domains/${cd.id}/check`, {});
    expect((await sql`select status from custom_domains where id = ${cd.id}`)[0]!.status).toBe(
      'dns_ok',
    );
    const ready = await events(s.id, 'domain.ready');
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      tenant_id: s.id,
      anchor: null,
      dedupe_key: `domain.ready:${cd.id}`,
      data: { storeName: 'Loja pro', host },
    });
    const steps = await events(s.id, 'store.onboarding');
    expect(steps.map((e) => e.data.step)).toEqual(['first_login', 'paid', 'domain']);
    expect(steps[2]).toMatchObject({
      anchor: `onboarding:${s.id}`,
      dedupe_key: `onboarding:${s.id}:domain`,
    });
  });

  test('merchant help and the first sign-in: one event each, replays add nothing', async () => {
    const s = await store('help', 'basic');
    const steps = await events(s.id, 'store.onboarding');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      tenant_id: s.id,
      anchor: `onboarding:${s.id}`,
      dedupe_key: `onboarding:${s.id}:first_login`,
      data: { step: 'first_login' },
    });
    // signing in again is not a first sign-in
    const m = (await membershipsFor(appSql, s.phone)).find((x) => x.tenant_id === s.id)!;
    await createSession(appSql, m, 'again');
    expect(await events(s.id, 'store.onboarding')).toHaveLength(1);

    const key = crypto.randomUUID();
    const message = 'Não consigo mudar o horário de domingo';
    const ask = () => s.owner('POST', '/help', { message, topic: 'loja' }, key);
    expect((await ask()).status).toBe(201);
    expect((await ask()).status).toBe(201);
    await Bun.sleep(20);
    const help = await events(s.id, 'merchant.help');
    expect(help).toHaveLength(1);
    expect(help[0]).toMatchObject({
      tenant_id: s.id,
      anchor: null,
      severity: 'warning',
      data: {
        storeName: 'Loja help',
        slug: s.slug,
        who: 'Bia Dona',
        message,
        contact: `(${s.phone.slice(0, 2)}) ${s.phone.slice(2, 7)}-${s.phone.slice(7)}`,
      },
    });
  });
});
