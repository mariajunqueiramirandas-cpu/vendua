import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { runBillingTick } from '../src/modules/billing/jobs.ts';
import { handleBillingWebhook } from '../src/modules/billing/webhook.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

// Migration 0120: a store's link gives the new store a month on top of its trial, and the
// referrer a free month once the new store pays; a partner's stores earn it 20% of their plan
// invoices for 12 months.

const DAY = 86_400_000;

describe.skipIf(!process.env.TEST_DATABASE_URL)('referrals and partners (db)', () => {
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
    const r = await signup(signupToken, `ref-${nonce}-${tag}`);
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
  });

  beforeEach(() => {
    app = createApp(deps);
  });

  afterAll(async () => {
    if (created.length) {
      await sql`delete from partner_commissions where tenant_id in ${sql(created)}`;
      await sql`delete from tenants where id in ${sql(created)}`;
    }
    await sql`delete from partner_payouts where partner_id in (select id from partners where code like ${`T${nonce.toUpperCase()}%`})`;
    await sql`delete from partners where code like ${`T${nonce.toUpperCase()}%`}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  /** pay the store's next invoice while it trials: the period's Pix goes out, then settles */
  const payFirstMonth = async (id: string) => {
    await endAt(id, new Date(Date.now() + 3 * DAY));
    await tick();
    const inv = (
      await sql`select id from invoices where tenant_id = ${id} and status = 'open' and kind = 'period'`
    )[0]!;
    expect((await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {})).status).toBe(
      200,
    );
    return inv.id as string;
  };

  test('a store link: the new store trials a month longer, once per WhatsApp', async () => {
    const referrer = await trialStore('r1');
    const slug = (await sql`select slug from tenants where id = ${referrer.id}`)[0]!.slug;
    const pre = await call('GET', `/admin/v1/signup/referral?code=${slug}&planId=bandeira`);
    expect(pre.status).toBe(200);
    expect(pre.body.referral).toEqual({ kind: 'store', name: 'Doces da Lia', welcomeDays: 44 });
    expect((await call('GET', '/admin/v1/signup/referral?code=nobody-here')).status).toBe(404);

    const phone = mkPhone();
    const { signupToken } = await verified(phone);
    const r = await signup(signupToken, `ref-${nonce}-n1`, { referral: slug });
    expect(r.status).toBe(201);
    expect(r.body.next.kind).toBe('trial');
    const days = (Date.parse(r.body.next.endsAt) - Date.now()) / DAY;
    expect(Math.round(days)).toBe(44);
    const row = (await sql`select * from store_referrals where tenant_id = ${r.body.store.id}`)[0]!;
    expect(row).toMatchObject({
      referrer_tenant_id: referrer.id,
      welcome_days: 44,
      rewarded_at: null,
    });
    const ev = (
      await sql`select data from staff_events where tenant_id = ${r.body.store.id} and kind = 'store.created'`
    )[0]!;
    expect(ev.data.referral).toBe('loja Doces da Lia');

    // the same WhatsApp, another store: no second welcome month
    const again = await call(
      'GET',
      `/admin/v1/signup/referral?code=${slug}&planId=bandeira&signupToken=${encodeURIComponent((await verified(phone)).signupToken)}`,
    );
    expect(again.body.referral.welcomeDays).toBe(0);
  });

  test('a store referring itself gets nothing', async () => {
    const referrer = await trialStore('self');
    const slug = (await sql`select slug from tenants where id = ${referrer.id}`)[0]!.slug;
    const { signupToken } = await verified(referrer.phone);
    const r = await signup(signupToken, `ref-${nonce}-self2`, {
      referral: slug,
      trial: false,
      method: 'pix',
    });
    expect(r.status).toBe(201);
    expect(r.body.next.kind).toBe('pix');
    expect(
      await sql`select 1 from store_referrals where tenant_id = ${r.body.store.id}`,
    ).toHaveLength(0);
  });

  test("the referred store pays its first month: the referrer's next charge moves a month on", async () => {
    const referrer = await trialStore('r2');
    const slug = (await sql`select slug from tenants where id = ${referrer.id}`)[0]!.slug;
    const { signupToken } = await verified(mkPhone());
    const r = await signup(signupToken, `ref-${nonce}-n2`, { referral: slug });
    expect(r.status).toBe(201);
    const newId = r.body.store.id as string;

    await payFirstMonth(newId);
    expect(
      (await sql`select rewarded_at from store_referrals where tenant_id = ${newId}`)[0]!
        .rewarded_at,
    ).not.toBeNull();
    const credit = (await sql`select * from billing_credits where tenant_id = ${referrer.id}`)[0]!;
    expect(credit).toMatchObject({ status: 'pending', source_tenant_id: newId, months: 1 });

    const before = (await sub(referrer.id)).current_period_end as Date;
    await tick();
    const after = await sub(referrer.id);
    const moved = (after.current_period_end as Date).getTime() - before.getTime();
    expect(moved).toBeGreaterThanOrEqual(28 * DAY);
    expect(moved).toBeLessThanOrEqual(31 * DAY);
    expect(
      (await sql`select status, applied_how from billing_credits where id = ${credit.id}`)[0],
    ).toEqual({
      status: 'applied',
      applied_how: 'period',
    });
    expect(wa.some((m) => m.phone === referrer.phone && m.text.includes('mês grátis'))).toBe(true);
    // the owner sees it in Indique e ganhe
    const mine = await referrer.owner('GET', '/account/referrals');
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ code: slug, appliedMonths: 1, pendingMonths: 0 });
    expect(mine.body.stores[0]).toMatchObject({ name: 'Doces da Lia', rewarded: true });

    // a second paid month earns nothing more
    await tick();
    expect(await sql`select 1 from billing_credits where tenant_id = ${referrer.id}`).toHaveLength(
      1,
    );
  });

  test('a card plan takes its free month as a refund of the next charge', async () => {
    const t = await trialStore('card');
    const pre = await fake.createSubscription({
      reason: 'Venduá Bandeira',
      amountCents: 16900,
      payerEmail: 'lia@example.com',
      externalReference: t.id,
      backUrl: 'https://painel.vendua.test/admin/',
      notificationUrl: 'https://painel.vendua.test/hook',
      idempotencyKey: `card-${nonce}`,
      startDate: null,
    });
    await sql`
      update subscriptions set method = 'card', provider_subscription_id = ${pre.id},
        checkout_url = null, status = 'active' where tenant_id = ${t.id}
    `;
    const credit = (
      await sql`insert into billing_credits (tenant_id, reason) values (${t.id}, 'referral') returning id`
    )[0]!;
    const charge = fake.settleSubscription(pre.id, 'approved');
    await handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind: 'subscription_payment',
      resourceId: charge.id,
      providerUserId: null,
      action: null,
    });
    const c = (await sql`select * from billing_credits where id = ${credit.id}`)[0]!;
    expect(c).toMatchObject({ status: 'applied', applied_how: 'refund' });
    const inv = (await sql`select * from invoices where id = ${c.invoice_id}`)[0]!;
    expect(inv).toMatchObject({ status: 'paid', amount_cents: 16900, credited_cents: 16900 });
    expect(fake.refunds.some((x) => x.id === `R-credit:${credit.id}`)).toBe(true);
    // the replayed webhook refunds nothing twice
    await handleBillingWebhook({ sql: appSql, provider: fake, notify } as never, {
      kind: 'subscription_payment',
      resourceId: charge.id,
      providerUserId: null,
      action: null,
    });
    expect(fake.refunds.filter((x) => x.id === `R-credit:${credit.id}`)).toHaveLength(1);
  });

  test('a partner: applies on the site, staff approve, its store earns it 20%, staff pay out', async () => {
    const code = `T${nonce.toUpperCase()}-LIMA`;
    const phone = `21${String(Date.now()).slice(-9)}`;
    const site = (body: unknown) =>
      call('POST', '/site/v1/partners', body, { 'x-forwarded-for': `198.51.100.${seq % 250}` });
    expect((await site({ name: 'Escritório Lima', kind: 'contador', phone: 'abc' })).status).toBe(
      422,
    );
    const applied = await site({
      name: 'Escritório Lima',
      kind: 'contador',
      phone,
      city: 'Niterói',
    });
    expect(applied.status).toBe(202);
    expect((await site({ name: 'Outro nome', kind: 'outro', phone })).status).toBe(202);
    const list = await control('GET', '/control/v1/partners');
    const p = list.body.partners.find((x: any) => x.phone === phone);
    expect(p).toMatchObject({ name: 'Escritório Lima', status: 'pending', commissionBps: 2000 });

    // pending: its code is no one's yet
    const ok = await control('PATCH', `/control/v1/partners/${p.id}`, { status: 'active', code });
    expect(ok.status).toBe(200);
    expect(ok.body.partner).toMatchObject({ status: 'active', code });
    const look = await call('GET', `/admin/v1/signup/referral?code=${code.toLowerCase()}`);
    expect(look.body.referral).toEqual({
      kind: 'partner',
      name: 'Escritório Lima',
      welcomeDays: 0,
    });

    const { signupToken } = await verified(mkPhone());
    const r = await signup(signupToken, `ref-${nonce}-p1`, { referral: code });
    expect(r.status).toBe(201);
    expect(Math.round((Date.parse(r.body.next.endsAt) - Date.now()) / DAY)).toBe(14);
    const inv = await payFirstMonth(r.body.store.id);
    const k = (await sql`select * from partner_commissions where invoice_id = ${inv}`)[0]!;
    expect(k).toMatchObject({
      partner_id: p.id,
      paid_cents: 16900,
      commission_cents: 3380,
      status: 'due',
    });

    const detail = await control('GET', `/control/v1/partners/${p.id}`);
    expect(detail.body.partner.dueCents).toBe(3380);
    expect(detail.body.stores).toHaveLength(1);
    const paid = await control('POST', `/control/v1/partners/${p.id}/payouts`, {
      note: 'pix 10/10',
    });
    expect(paid.status).toBe(201);
    expect(paid.body.payout).toMatchObject({ totalCents: 3380, commissions: 1 });
    expect((await control('POST', `/control/v1/partners/${p.id}/payouts`, {})).status).toBe(409);
    expect((await control('GET', `/control/v1/partners/${p.id}`)).body.partner).toMatchObject({
      dueCents: 0,
      paidCents: 3380,
    });
  });
});
