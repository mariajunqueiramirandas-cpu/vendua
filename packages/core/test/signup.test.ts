import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { foldSlug, slugify } from '../src/admin/context.ts';
import { createApp } from '../src/app.ts';
import { cpfCnpj, validDocument, validEmail } from '../src/modules/billing/input.ts';
import { runBillingTick } from '../src/modules/billing/jobs.ts';
import {
  normalizeSlug,
  readSignupToken,
  signupToken,
  startSignupOtp,
} from '../src/modules/billing/signup.ts';
import { billingStaff } from '../src/modules/billing/subscriptions.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import type { PixRequest } from '../src/modules/payments/provider.ts';
import { migrate } from '../src/platform/db.ts';

describe('signup units', () => {
  test('only an email Mercado Pago takes as the payer passes', () => {
    expect(validEmail('  Ana.Lima+doces@Gmail.com ', 'email')).toBe('ana.lima+doces@gmail.com');
    expect(validEmail('ana_lima@doces-da-ana.com.br', 'email')).toBe(
      'ana_lima@doces-da-ana.com.br',
    );
    for (const bad of [
      'niná@gmail.com',
      'ana@gmail.com.',
      'ana..lima@gmail.com',
      '.ana@gmail.com',
      'ana.@gmail.com',
      'ana@gmail,com.br',
      'ana@gmail',
      'ana@-gmail.com',
      'ana@gmail.c',
      'ana lima@gmail.com',
    ])
      expect(() => validEmail(bad, 'email')).toThrow('email looks wrong');
  });

  test('CPF and CNPJ: any formatting, check digits verified, alphanumeric CNPJ too', () => {
    expect(cpfCnpj('529.982.247-25')).toBe('52998224725');
    expect(cpfCnpj(' 390 533 447 05 ')).toBe('39053344705');
    expect(cpfCnpj('11.222.333/0001-81')).toBe('11222333000181');
    // the Receita Federal's own example of the alphanumeric CNPJ (July 2026)
    expect(cpfCnpj('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    expect(cpfCnpj('12abc34501de35')).toBe('12ABC34501DE35');
    for (const bad of [
      '529.982.247-24',
      '111.111.111-11',
      '11.222.333/0001-82',
      '00000000000000',
      '12ABC34501DE34',
      '12ABC34501DEAB',
      '1234567890',
      '',
    ])
      expect(cpfCnpj(bad)).toBeNull();
    expect(validDocument('529.982.247-25', 'document')).toBe('52998224725');
    expect(() => validDocument('529.982.247-24', 'document')).toThrow('cpf or cnpj looks wrong');
    expect(() => validDocument(52998224725, 'document')).toThrow();
  });

  test('slugs normalize like slugify, capped at 40', () => {
    expect(normalizeSlug('Açaí da Praia!!')).toBe('acai-da-praia');
    expect(normalizeSlug('  --Doces   da Maria-- ')).toBe('doces-da-maria');
    expect(normalizeSlug('!!!')).toBe('');
    expect(normalizeSlug('a'.repeat(50))).toHaveLength(40);
  });

  test('& reads as "e", and slugify shares the same fold', () => {
    expect(normalizeSlug('Pão & Mel')).toBe('pao-e-mel');
    expect(normalizeSlug('Doces&Cia')).toBe('doces-e-cia');
    expect(slugify('Pão & Mel')).toBe('pao-e-mel');
    expect(slugify('!!!')).toBe('item');
    for (const name of [
      'Açaí & Cia',
      '  --Bolo   de Pote-- ',
      'x'.repeat(80),
      'R&B Café'.repeat(9),
    ]) {
      expect(normalizeSlug(name)).toBe(foldSlug(name, 40));
      expect(slugify(name)).toBe(foldSlug(name, 60));
    }
  });

  test('signup tokens are signed, bound to the phone, and expire', () => {
    const t = signupToken('s', '21999990000');
    expect(readSignupToken('s', t)).toBe('21999990000');
    expect(readSignupToken('other', t)).toBeNull();
    expect(readSignupToken('s', t.replace('21999990000', '21999990001'))).toBeNull();
    expect(
      readSignupToken('s', signupToken('s', '21999990000', Date.now() - 31 * 60_000)),
    ).toBeNull();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('self-serve signup (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  // provider ids are process-local counters; start past anything another run left behind
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const mails: { to: string; subject: string; text: string; key: string }[] = [];
  const staff: { subject: string; body: string }[] = [];
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
    notify: {
      whatsapp: async (phone: string, text: string) => void wa.push({ phone, text }),
      email: async (to: string, subject: string, text: string, key: string) =>
        void mails.push({ to, subject, text, key }),
    },
  };
  const app = createApp(deps);
  const nonce = crypto.randomUUID().slice(0, 6);
  const mkPhone = (n: number) => `219${String(Date.now() + n * 17).slice(-8)}`;
  const created: string[] = [];
  let idem = 0;
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
      cookie: res.headers.get('set-cookie'),
    };
  };

  const verified = async (phone: string, via = app) => {
    const start = await call('POST', '/admin/v1/signup/otp/start', { phone }, {}, via);
    expect(start.status).toBe(200);
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const v = await call('POST', '/admin/v1/signup/otp/verify', { phone, code }, {}, via);
    expect(v.status).toBe(200);
    return v.body as { signupToken: string; existingStores: any[] };
  };

  const signup = async (
    token: string,
    slug: string,
    extra: Record<string, unknown> = {},
    via = app,
  ) => {
    const r = await call(
      'POST',
      '/admin/v1/signup',
      {
        signupToken: token,
        planId: 'mirim',
        method: 'pix',
        storeName: 'Doces da Praia',
        slug,
        ownerName: 'Ana Lima',
        email: 'ana@example.com',
        document: '529.982.247-25',
        ...extra,
      },
      {},
      via,
    );
    if (r.body?.store?.id && !created.includes(r.body.store.id)) created.push(r.body.store.id);
    return r;
  };

  const session = (cookie: string | null) => {
    const value = /vendua_admin=([^;]+)/.exec(cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}` });
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    // these run billing on the top plan, which launches closed to new stores (ADR 0032)
    await sql`update plans set available = true where id = 'pangolim'`;
    billingStaff.notify = async (_sql, n) => void staff.push({ subject: n.subject, body: n.body });
  });

  afterAll(async () => {
    billingStaff.notify = originalStaff;
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('plans and slug check', async () => {
    const plans = await call('GET', '/admin/v1/signup/plans');
    expect(plans.status).toBe(200);
    expect(plans.body.storeDomain).toBe('vendua.test');
    expect(plans.body.billing.available).toBe(true);
    expect(plans.body.plans.map((p: any) => p.id)).toEqual(['mirim', 'bandeira', 'pangolim']);
    const mirim = plans.body.plans.find((p: any) => p.id === 'mirim');
    expect(mirim).toEqual({
      id: 'mirim',
      name: 'Venduá Mirim',
      priceCents: 6990,
      feeBps: 0,
      features: {
        customDomain: false,
        customSite: false,
        kds: false,
        printing: false,
        loyalty: false,
        vendedor: false,
      },
      trialDays: 0,
      recommended: false,
      aiConversations: 0,
      aiTrialConversations: 0,
      available: true,
    });
    expect(plans.body.plans.find((p: any) => p.id === 'bandeira')).toMatchObject({
      priceCents: 16900,
      trialDays: 14,
      recommended: true,
      aiConversations: 250,
      aiTrialConversations: 50,
    });
    expect(plans.body.plans.find((p: any) => p.id === 'pangolim').priceCents).toBe(44900);

    const reserved = await call('GET', '/admin/v1/signup/slug?slug=Admin');
    expect(reserved.body).toMatchObject({ slug: 'admin', available: false, reason: 'reserved' });
    expect(reserved.body.suggestion).toMatch(/^admin-\d+$/);
    expect((await call('GET', '/admin/v1/signup/slug?slug=ab')).body.reason).toBe('invalid');
    const free = await call('GET', `/admin/v1/signup/slug?slug=Signup ${nonce} Açaí`);
    expect(free.body).toEqual({ slug: `signup-${nonce}-acai`, available: true });
  });

  test('otp: wrong codes fail, a login code never verifies a signup', async () => {
    const phone = mkPhone(1);
    await call('POST', '/admin/v1/signup/otp/start', { phone });
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const bad = await call('POST', '/admin/v1/signup/otp/verify', {
      phone,
      code: code === '000000' ? '111111' : '000000',
    });
    expect(bad.body.error.code).toBe('INVALID_CODE');
    const ok = await call('POST', '/admin/v1/signup/otp/verify', { phone, code });
    expect(ok.status).toBe(200);
    expect(ok.body.existingStores).toEqual([]);
    const replay = await call('POST', '/admin/v1/signup/otp/verify', { phone, code });
    expect(replay.body.error.code).toBe('INVALID_CODE');
    expect((await call('POST', '/admin/v1/signup', { signupToken: 'x.1.y' })).status).toBe(401);
  });

  let pixStore = '';
  let pixToken = '';
  let pixCookie: string | null = null;
  const pixSlug = `signup-${nonce}-pix`;

  test('pix signup: store paused behind the hold → pay → open, period set', async () => {
    const phone = mkPhone(2);
    pixToken = (await verified(phone)).signupToken;
    const r = await signup(pixToken, pixSlug.toUpperCase());
    expect(r.status).toBe(201);
    expect(r.body.signedIn).toBe(true);
    expect(r.body.store).toMatchObject({ slug: pixSlug, name: 'Doces da Praia', role: 'owner' });
    expect(r.body.next.kind).toBe('pix');
    // the owner's welcome: where the store is, how to get in, what happens next
    const welcome = mails.filter((m) => m.key === `signup-welcome:${r.body.store.id}`);
    expect(welcome).toHaveLength(1);
    expect(welcome[0]).toMatchObject({
      to: 'ana@example.com',
      subject: 'Doces da Praia está criada na Venduá',
    });
    expect(welcome[0]!.text).toContain('Oi, Ana!');
    expect(welcome[0]!.text).toContain(`https://${pixSlug}.vendua.test`);
    expect(welcome[0]!.text).toContain('primeiro pagamento');
    pixStore = r.body.store.id;
    pixCookie = r.cookie;
    expect(pixCookie).toContain('vendua_admin=');

    const st = (
      await sql`select billing_hold, status_override, pause_message from store_settings where tenant_id = ${pixStore}`
    )[0]!;
    expect(st).toMatchObject({ billing_hold: true, status_override: 'paused' });
    const owner = session(pixCookie);
    const acct = await owner('GET', '/account');
    expect(acct.status).toBe(200);
    expect(acct.body.plan).toMatchObject({ id: 'mirim', priceCents: 6990 });
    expect(acct.body.subscription).toMatchObject({
      status: 'pending',
      method: 'pix',
      planId: 'mirim',
      payerEmail: 'ana@example.com',
    });
    expect(acct.body.invoices).toHaveLength(1);
    const inv = acct.body.invoices[0];
    expect(inv).toMatchObject({ id: r.body.next.invoiceId, number: 1, amountCents: 6990 });
    expect(inv.pix.copyPaste).toContain('FAKEPIX');
    expect(acct.body.address).toBe(`https://${pixSlug}.vendua.test`);
    const audit =
      await sql`select action, actor_label from audit_log where tenant_id = ${pixStore}`;
    expect(audit.map((a) => a.action)).toContain('store.signup');

    const paid = await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {});
    expect(paid.status).toBe(200);
    const after = await owner('GET', '/account');
    expect(after.body.subscription.status).toBe('active');
    expect(after.body.invoices[0].status).toBe('paid');
    const end = new Date(after.body.subscription.currentPeriodEnd).getTime();
    expect(end - Date.now()).toBeGreaterThan(27 * 86_400_000);
    expect(end - Date.now()).toBeLessThan(32 * 86_400_000);
    const st2 = (
      await sql`select billing_hold, status_override from store_settings where tenant_id = ${pixStore}`
    )[0]!;
    expect(st2).toEqual({ billing_hold: false, status_override: null });
    // the owner can open and close the store as usual
    expect((await owner('POST', '/store/pause', { for: '1h' })).status).toBe(200);
    expect((await owner('POST', '/store/resume', {})).status).toBe(200);

    // a replayed webhook changes nothing
    expect((await call('POST', `/admin/v1/dev/billing/invoices/${inv.id}/pay`, {})).status).toBe(
      200,
    );
    const inv2 = await sql`select status, paid_at from invoices where tenant_id = ${pixStore}`;
    expect(inv2).toHaveLength(1);
  });

  test('the payer CPF/CNPJ: required, checked, stored, sent to MP, changed in Conta', async () => {
    // its own app: three signups here would spend the shared one's per-IP limit
    const other = createApp(deps);
    const token = (await verified(mkPhone(15), other)).signupToken;
    const slug = `signup-${nonce}-doc`;
    const missing = await signup(token, slug, { document: undefined }, other);
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual({ field: 'document' });
    const wrong = await signup(token, slug, { document: '529.982.247-24' }, other);
    expect(wrong.body.error.details).toEqual({ field: 'document' });
    expect((await sql`select 1 from tenants where slug = ${slug}`).length).toBe(0);

    const seen: PixRequest[] = [];
    const realPix = fake.platformPix.bind(fake);
    fake.platformPix = async (req) => {
      seen.push(req);
      return realPix(req);
    };
    let r: Awaited<ReturnType<typeof signup>>;
    try {
      r = await signup(token, slug, { document: '12.abc.345/01de-35' }, other);
    } finally {
      fake.platformPix = realPix;
    }
    expect(r.status).toBe(201);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ payerDocument: '12ABC34501DE35', payerName: 'Ana Lima' });

    const owner = session(r.cookie);
    expect((await owner('GET', '/account')).body.subscription.payerDocument).toBe('12ABC34501DE35');
    // a signup resumed from before it asked: the replay fills the document in, never overwrites it
    const docOf = async () =>
      (await sql`select payer_document from subscriptions where tenant_id = ${r.body.store.id}`)[0]!
        .payer_document;
    await sql`update subscriptions set payer_document = null where tenant_id = ${r.body.store.id}`;
    expect((await signup(token, slug, { document: '390.533.447-05' }, other)).status).toBe(201);
    expect(await docOf()).toBe('39053344705');
    expect((await signup(token, slug, { document: '529.982.247-25' }, other)).status).toBe(201);
    expect(await docOf()).toBe('39053344705');
    const bad = await owner('PATCH', '/account/subscription', { payerDocument: '123' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toEqual({ field: 'payerDocument' });
    const changed = await owner('PATCH', '/account/subscription', {
      payerDocument: '529.982.247-25',
    });
    expect(changed.status).toBe(200);
    expect(changed.body.subscription.payerDocument).toBe('52998224725');
    // the audit names the change, never the number
    const audit = await sql`
      select summary, after::text as after from audit_log
      where tenant_id = ${r.body.store.id} and action = 'subscription.change'
    `;
    expect(audit[0]!.summary).toContain('CPF/CNPJ de cobrança');
    expect(JSON.stringify(audit)).not.toContain('52998224725');
  });

  test('the same token+slug again is the same store — no second store, no second charge', async () => {
    const again = await signup(pixToken, pixSlug);
    expect(again.status).toBe(201);
    expect(again.body.store.id).toBe(pixStore);
    // a replay finds the store: no second welcome
    expect(mails.filter((m) => m.key === `signup-welcome:${pixStore}`)).toHaveLength(1);
    expect(again.body.next).toEqual({ kind: 'pix', invoiceId: expect.any(String) });
    expect((await sql`select 1 from tenants where slug = ${pixSlug}`).length).toBe(1);
    expect((await sql`select 1 from invoices where tenant_id = ${pixStore}`).length).toBe(1);
  });

  test('closed until the CRM switch, WhatsApp, email and billing are all there', async () => {
    let gate = { on: false, whatsapp: true, email: true, billing: true, open: false };
    const closed = createApp({ ...deps, signupReady: async () => gate });
    const phone = mkPhone(12);
    expect(
      (await call('GET', '/admin/v1/signup/plans', undefined, {}, closed)).body.signup,
    ).toEqual({
      open: false,
    });
    const otp = await call('POST', '/admin/v1/signup/otp/start', { phone }, {}, closed);
    expect(otp.status).toBe(503);
    expect(otp.body.error.code).toBe('SIGNUP_CLOSED');
    expect(wa.some((m) => m.phone === phone)).toBe(false);
    // a token from when it was open can't create a store once it closed
    const token = (await verified(phone, createApp(deps))).signupToken;
    const r = await signup(token, `signup-${nonce}-shut`, {}, closed);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('SIGNUP_CLOSED');
    // a WhatsApp reconnecting doesn't fail an owner whose code already came: only the code needs it
    gate = { on: true, whatsapp: false, email: true, billing: true, open: false };
    expect((await call('POST', '/admin/v1/signup/otp/start', { phone }, {}, closed)).status).toBe(
      503,
    );
    expect((await signup(token, `signup-${nonce}-shut`, {}, closed)).status).toBe(201);
  });

  test('readiness: the switch, a WhatsApp and an email integration, and billing', async () => {
    const { signupReadiness } = await import('../src/modules/billing/signup-gate.ts');
    const ready = () => signupReadiness(appSql, { platformConfigured: true });
    const put = (enabled: boolean) =>
      call(
        'PUT',
        '/control/v1/settings/signup',
        { value: { enabled } },
        { 'x-vendua-control': 'ctl' },
      );
    const before = (await sql`select value from control_settings where key = 'signup'`)[0]?.value;
    const added: string[] = [];
    try {
      expect((await put('yes' as never)).status).toBe(422);
      expect((await put(false)).status).toBe(200);
      expect(await ready()).toMatchObject({ on: false, open: false, billing: true });
      expect((await put(true)).status).toBe(200);
      for (const kind of ['whatsapp', 'email'])
        added.push(
          ...(
            await sql<{ id: string }[]>`
              insert into control_integrations (kind, driver, enabled, updated_at)
              values (${kind}, 'log', true, now() + interval '1 minute')
              on conflict do nothing returning id`
          ).map((r) => r.id),
        );
      expect(await ready()).toMatchObject({ on: true, whatsapp: true, email: true, open: true });
      expect((await signupReadiness(appSql, { platformConfigured: false })).open).toBe(
        !!process.env.VENDUA_SIGNUP_ACCESS_CODE,
      );
      const crm = await call('GET', '/control/v1/signup', undefined, { 'x-vendua-control': 'ctl' });
      expect(crm.body).toMatchObject({ on: true, billing: true });
      // the panel asks MP whether it takes the token: the fake's is a test one
      expect(crm.body.mercadoPago).toEqual({ state: 'test', account: 'VENDUA_FAKE', detail: null });
      fake.revoked.add('platform');
      try {
        const refused = await call(
          'GET',
          '/control/v1/signup',
          undefined,
          { 'x-vendua-control': 'ctl' },
          createApp(deps),
        );
        expect(refused.body.open).toBe(true);
        expect(refused.body.mercadoPago).toEqual({
          state: 'failed',
          account: null,
          detail: 'unauthorized: token revoked',
        });
      } finally {
        fake.revoked.delete('platform');
      }
    } finally {
      if (added.length) await sql`delete from control_integrations where id = any(${added})`;
      if (before === undefined) await sql`delete from control_settings where key = 'signup'`;
      else
        await sql`update control_settings set value = ${sql.json(before as never)} where key = 'signup'`;
    }
  });

  test('a welcome that fails to send is tried again on the next try', async () => {
    let fail = true;
    const sent: string[] = [];
    const flaky = createApp({
      ...deps,
      notify: {
        ...deps.notify,
        email: async (_to: string, _s: string, _t: string, key: string) => {
          if (fail) throw new Error('provider down');
          sent.push(key);
        },
      },
    });
    const token = (await verified(mkPhone(13), flaky)).signupToken;
    const slug = `signup-${nonce}-flaky`;
    const r = await signup(token, slug, {}, flaky);
    expect(r.status).toBe(201);
    const marker = () =>
      sql`select 1 from push_deliveries where tenant_id = ${r.body.store.id} and key = 'signup.welcome'`;
    // the send runs after the answer: wait for it to settle
    const until = async (ok: () => Promise<boolean> | boolean) => {
      for (let i = 0; i < 50 && !(await ok()); i++) await Bun.sleep(20);
    };
    await until(async () => (await marker()).length === 0);
    expect((await marker()).length).toBe(0);
    fail = false;
    expect((await signup(token, slug, {}, flaky)).status).toBe(201);
    await until(() => sent.length === 1);
    expect(sent).toEqual([`signup-welcome:${r.body.store.id}`]);
    expect((await marker()).length).toBe(1);
  });

  test('a first charge MP refuses: its own code, the team hears why once, a retry goes through', async () => {
    const own = createApp(deps);
    const token = (await verified(mkPhone(14), own)).signupToken;
    const slug = `signup-${nonce}-mprefused`;
    fake.revoked.add('platform');
    try {
      const r = await signup(token, slug, {}, own);
      expect(r.status).toBe(503);
      expect(r.body.error).toMatchObject({
        code: 'BILLING_PROVIDER_ERROR',
        details: { provider: 'unauthorized' },
      });
      // MP's own words are for the team, not the visitor
      expect(JSON.stringify(r.body)).not.toContain('token revoked');
      expect((await signup(token, slug, {}, own)).status).toBe(503);
    } finally {
      fake.revoked.delete('platform');
    }
    const ok = await signup(token, slug, {}, own);
    expect(ok.status).toBe(201);
    expect(ok.body.next).toEqual({ kind: 'pix', invoiceId: expect.any(String) });
    const events = await sql<{ data: { problem: string; detail: string } }[]>`
      select data from staff_events where tenant_id = ${ok.body.store.id} and kind = 'billing.problem'`;
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toMatchObject({ problem: 'other' });
    expect(events[0]!.data.detail).toContain('token revoked');
  });

  test('a plan that is listed but closed is refused before anything is created', async () => {
    const other = createApp(deps);
    const token = (await verified(mkPhone(11), other)).signupToken;
    await sql`update plans set available = false where id = 'pangolim'`;
    try {
      const r = await signup(token, `signup-${nonce}-closed`, { planId: 'pangolim' }, other);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatchObject({
        code: 'PLAN_UNAVAILABLE',
        details: { field: 'planId' },
      });
      expect(
        (await sql`select 1 from tenants where slug = ${`signup-${nonce}-closed`}`).length,
      ).toBe(0);
      // a store that went through on Mirim can't come back for the closed plan
      const made = await signup(token, `signup-${nonce}-resume`, {}, other);
      expect(made.status).toBe(201);
      const again = await signup(token, `signup-${nonce}-resume`, { planId: 'pangolim' }, other);
      expect(again.body.error?.code).toBe('PLAN_UNAVAILABLE');
      expect(
        (await sql`select plan from tenants where slug = ${`signup-${nonce}-resume`}`)[0]!.plan,
      ).toBe('mirim');
      // …while the same request again still finds its store
      expect((await signup(token, `signup-${nonce}-resume`, {}, other)).status).toBe(201);
    } finally {
      await sql`update plans set available = true where id = 'pangolim'`;
    }
  });

  test('segment: kept with the store, onboarding marked from signup; a replay changes neither', async () => {
    // its own app: the shared one's per-IP signup budget belongs to the tests below
    const other = createApp(deps);
    const token = (await verified(mkPhone(10), other)).signupToken;
    const slug = `signup-${nonce}-seg`;
    const bad = await signup(token, slug, { segment: 'sorvetes' }, other);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatchObject({ code: 'BAD_REQUEST', details: { field: 'segment' } });
    expect((await signup(token, slug, { segment: 7 }, other)).body.error.details.field).toBe(
      'segment',
    );

    const r = await signup(token, slug, { segment: 'doces' }, other);
    expect(r.status).toBe(201);
    const id = r.body.store.id;
    const row = async () =>
      (await sql`select segment, onboarding from store_settings where tenant_id = ${id}`)[0]!;
    expect(await row()).toEqual({ segment: 'doces', onboarding: { from: 'signup' } });
    const born =
      await sql`select data from staff_events where tenant_id = ${id} and kind = 'store.created'`;
    expect(born[0]!.data.segment).toBe('doces');

    const again = await signup(token, slug, { segment: 'pizzaria' }, other);
    expect(again.status).toBe(201);
    expect(again.body.store.id).toBe(id);
    expect(await row()).toEqual({ segment: 'doces', onboarding: { from: 'signup' } });

    // no segment: still from signup, segment null
    const plain = await signup(token, `signup-${nonce}-noseg`, { segment: '' }, other);
    expect(plain.status).toBe(201);
    const p = (
      await sql`select segment, onboarding from store_settings where tenant_id = ${plain.body.store.id}`
    )[0]!;
    expect(p).toEqual({ segment: null, onboarding: { from: 'signup' } });
  });

  test('taken and reserved slugs', async () => {
    const other = (await verified(mkPhone(3))).signupToken;
    const taken = await signup(other, pixSlug);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLUG_TAKEN');
    const reserved = await signup(other, 'painel');
    expect(reserved.status).toBe(422);
    expect(reserved.body.error.code).toBe('INVALID_SLUG');
    const slug = await call('GET', `/admin/v1/signup/slug?slug=${pixSlug}`);
    expect(slug.body).toMatchObject({
      available: false,
      reason: 'taken',
      suggestion: `${pixSlug}-2`,
    });
    const bad = await signup(other, `signup-${nonce}-x`, { storeName: 'x' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.field).toBe('storeName');
    const badPlan = await signup(other, `signup-${nonce}-x`, { planId: 'spike' });
    expect(badPlan.body.error.code).toBe('UNKNOWN_PLAN');
  });

  test('card signup → assinatura authorized → active', async () => {
    const token = (await verified(mkPhone(4))).signupToken;
    const r = await signup(token, `signup-${nonce}-card`, { method: 'card' });
    expect(r.status).toBe(201);
    expect(r.body.next.kind).toBe('card');
    expect(r.body.next.url).toContain('/admin/?assinatura=retorno');
    const tenant = r.body.store.id;
    const sub = (
      await sql`select provider_subscription_id, status from subscriptions where tenant_id = ${tenant}`
    )[0]!;
    expect(sub.status).toBe('pending');
    expect(fake.subscriptions.get(sub.provider_subscription_id)!.amountCents).toBe(6990);
    expect(fake.subscriptions.get(sub.provider_subscription_id)!.externalReference).toBe(tenant);
    const s = await call(
      'POST',
      `/admin/v1/dev/billing/subscriptions/${sub.provider_subscription_id}/settle`,
      { status: 'approved' },
    );
    expect(s.status).toBe(200);
    const acct = await session(r.cookie)('GET', '/account');
    expect(acct.body.subscription).toMatchObject({
      status: 'active',
      method: 'card',
      checkoutUrl: null,
    });
    expect(acct.body.invoices[0]).toMatchObject({
      method: 'card',
      status: 'paid',
      amountCents: 6990,
    });
    const st = (await sql`select billing_hold from store_settings where tenant_id = ${tenant}`)[0]!;
    expect(st.billing_hold).toBe(false);
  });

  test('Pangolim signup opens a site request for the team once paid', async () => {
    const token = (await verified(mkPhone(5))).signupToken;
    const r = await signup(token, `signup-${nonce}-pro`, { planId: 'pangolim' });
    expect(r.status).toBe(201);
    const tenant = r.body.store.id;
    await call('POST', `/admin/v1/dev/billing/invoices/${r.body.next.invoiceId}/pay`, {});
    const reqs = await sql`select status from site_requests where tenant_id = ${tenant}`;
    expect([...reqs]).toEqual([{ status: 'requested' }]);
    expect(staff.some((n) => n.subject.includes('Site sob medida'))).toBe(true);
    const acct = await session(r.cookie)('GET', '/account');
    expect(acct.body.plan.features).toEqual({
      customDomain: true,
      customSite: true,
      kds: true,
      printing: true,
      loyalty: true,
      vendedor: true,
    });
    expect(acct.body.siteRequest.status).toBe('requested');
  });

  test('signup codes: a durable daily cap per IP', async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${nonce}`;
    const notify = { whatsapp: async () => {}, email: async () => {} };
    await startSignupOtp(appSql, mkPhone(7), notify, { ip, perIpDay: 2 });
    await startSignupOtp(appSql, mkPhone(8), notify, { ip, perIpDay: 2 });
    await expect(
      startSignupOtp(appSql, mkPhone(9), notify, { ip, perIpDay: 2 }),
    ).rejects.toMatchObject({
      status: 429,
    });
  });

  test('at most 3 stores per phone per day; billing off → 503', async () => {
    const other = createApp(deps);
    const phone = mkPhone(6);
    const token = (await verified(phone, other)).signupToken;
    // four at once: the per-phone lock lets exactly three through
    const res = await Promise.all(
      [1, 2, 3, 4].map((n) => signup(token, `signup-${nonce}-cap${n}`, {}, other)),
    );
    expect(res.map((r) => r.status).sort()).toEqual([201, 201, 201, 429]);
    expect(res.find((r) => r.status === 429)!.body.error.code).toBe('SIGNUP_LIMIT');
    // the verified phone now sees its stores
    const again = await verified(phone, other);
    expect(again.existingStores).toHaveLength(3);

    fake.platformConfigured = false;
    try {
      const off = await signup(token, `signup-${nonce}-off`, {}, other);
      expect(off.status).toBe(503);
      expect(off.body.error.code).toBe('BILLING_UNAVAILABLE');
    } finally {
      fake.platformConfigured = true;
    }
  });

  test('access code: no Mercado Pago, the store waits on its invoice until the team marks it paid', async () => {
    const other = createApp(deps);
    const token = (await verified(mkPhone(7), other)).signupToken;
    const slug = `signup-${nonce}-code`;
    const before = process.env.VENDUA_SIGNUP_ACCESS_CODE;
    fake.platformConfigured = false;
    try {
      process.env.VENDUA_SIGNUP_ACCESS_CODE = 'short-code';
      expect((await call('GET', '/admin/v1/signup/plans')).body.billing).toEqual({
        available: false,
        accessCode: false,
      });
      const short = await signup(token, slug, { accessCode: 'short-code' }, other);
      expect(short.body.error.code).toBe('INVALID_ACCESS_CODE');

      process.env.VENDUA_SIGNUP_ACCESS_CODE = ' abre-sem-mp-1234 ';
      expect((await call('GET', '/admin/v1/signup/plans')).body.billing.accessCode).toBe(true);
      const wrong = await signup(token, slug, { accessCode: 'abre-sem-mp-0000' }, other);
      expect(wrong.status).toBe(422);
      expect(wrong.body.error).toMatchObject({
        code: 'INVALID_ACCESS_CODE',
        details: { field: 'accessCode' },
      });
      // no code still needs billing
      expect((await signup(token, slug, {}, other)).status).toBe(503);

      const r = await signup(
        token,
        slug,
        { accessCode: 'abre-sem-mp-1234', method: undefined },
        other,
      );
      expect(r.status).toBe(201);
      expect(r.body.next).toMatchObject({ kind: 'manual' });
      const id = r.body.store.id;
      const invoiceId = r.body.next.invoiceId;
      const hold = async () =>
        (
          await sql`select billing_hold, status_override from store_settings where tenant_id = ${id}`
        )[0]!;
      // still closed behind the hold; one open invoice, no Pix asked of the provider
      expect(await hold()).toMatchObject({ billing_hold: true, status_override: 'paused' });
      const sub = (await sql`select status, method from subscriptions where tenant_id = ${id}`)[0]!;
      expect(sub).toEqual({ status: 'pending', method: 'pix' });
      const inv = (
        await sql`select id, status, amount_cents, pix_copy_paste, provider_payment_id
                  from invoices where tenant_id = ${id}`
      )[0]!;
      expect(inv).toMatchObject({
        id: invoiceId,
        status: 'open',
        amount_cents: 6990,
        pix_copy_paste: null,
        provider_payment_id: null,
      });

      // a replay finds the same store and invoice, and audits once
      const again = await signup(token, slug, { accessCode: 'abre-sem-mp-1234' }, other);
      expect(again.status).toBe(201);
      expect(again.body.next).toEqual({ kind: 'manual', invoiceId });
      const audit =
        await sql`select action from audit_log where tenant_id = ${id} and action = 'store.signup'`;
      expect(audit).toHaveLength(1);

      // the CRM sees the invoice, and marking it paid activates the plan and opens the store
      const control = (method: string, path: string, key = crypto.randomUUID()) =>
        call(method, path, method === 'GET' ? undefined : {}, {
          'x-vendua-control': 'ctl',
          'idempotency-key': key,
        });
      const list = await control('GET', '/control/v1/billing/stores');
      const row = list.body.stores.find((st: { tenantId: string }) => st.tenantId === id);
      expect(row.subscription.status).toBe('pending');
      expect(row.openInvoice).toMatchObject({ id: invoiceId, number: 1, amountCents: 6990 });
      expect(
        (await call('POST', `/control/v1/billing/invoices/${invoiceId}/mark-paid`, {})).status,
      ).toBe(404);
      const key = crypto.randomUUID();
      const paid = await control(
        'POST',
        `/control/v1/billing/invoices/${invoiceId}/mark-paid`,
        key,
      );
      expect(paid.status).toBe(200);
      expect(await hold()).toEqual({ billing_hold: false, status_override: null });
      const acct = await session(r.cookie)('GET', '/account');
      expect(acct.body.subscription.status).toBe('active');
      expect(acct.body.invoices[0].status).toBe('paid');
      // the same click replays; a second one is refused
      expect(
        (await control('POST', `/control/v1/billing/invoices/${invoiceId}/mark-paid`, key)).status,
      ).toBe(200);
      const twice = await control('POST', `/control/v1/billing/invoices/${invoiceId}/mark-paid`);
      expect(twice.status).toBe(409);
      expect(twice.body.error.code).toBe('INVOICE_PAID');
      expect(
        (await control('POST', `/control/v1/billing/invoices/${crypto.randomUUID()}/mark-paid`))
          .status,
      ).toBe(404);
      const after = await control('GET', '/control/v1/billing/stores');
      expect(
        after.body.stores.find((st: { tenantId: string }) => st.tenantId === id).openInvoice,
      ).toBeNull();

      // without MP the renewal is an invoice for the team to mark, made once, never a Pix retry
      await sql`update subscriptions set current_period_end = now() + interval '1 day' where tenant_id = ${id}`;
      const jobOpts = {
        provider: fake,
        notify: deps.notify,
        adminOrigin: null,
        storeDomain: 'vendua.test',
      };
      await runBillingTick(appSql, jobOpts, new Date());
      await runBillingTick(appSql, jobOpts, new Date());
      const renewals = await sql`
        select status, pix_copy_paste, pix_attempt from invoices
        where tenant_id = ${id} and status = 'open'
      `;
      expect(renewals).toHaveLength(1);
      expect(renewals[0]).toMatchObject({ pix_copy_paste: null, pix_attempt: 0 });
    } finally {
      fake.platformConfigured = true;
      if (before === undefined) delete process.env.VENDUA_SIGNUP_ACCESS_CODE;
      else process.env.VENDUA_SIGNUP_ACCESS_CODE = before;
    }
  });

  test('CRM mark-paid with MP on: a live Pix is cancelled; a card assinatura is never doubled', async () => {
    const control = (path: string) =>
      call('POST', path, {}, { 'x-vendua-control': 'ctl', 'idempotency-key': crypto.randomUUID() });
    const other = createApp(deps);
    const token = (await verified(mkPhone(8), other)).signupToken;
    const pix = await signup(token, `signup-${nonce}-crm-pix`, {}, other);
    expect(pix.body.next.kind).toBe('pix');
    const before = (
      await sql`select provider_payment_id from invoices where id = ${pix.body.next.invoiceId}`
    )[0]!;
    expect(before.provider_payment_id).toBeTruthy();
    const ok = await control(`/control/v1/billing/invoices/${pix.body.next.invoiceId}/mark-paid`);
    expect(ok.status).toBe(200);
    const inv = (
      await sql`select status, provider_payment_id, pix_copy_paste, pix_superseded
                from invoices where id = ${pix.body.next.invoiceId}`
    )[0]!;
    expect(inv).toMatchObject({ status: 'paid', provider_payment_id: null, pix_copy_paste: null });
    expect(inv.pix_superseded).toContain(before.provider_payment_id);
    expect(fake.payments.get(before.provider_payment_id)!.status).toBe('cancelled');

    const card = await signup(token, `signup-${nonce}-crm-card`, { method: 'card' }, other);
    expect(card.body).toMatchObject({ next: { kind: 'card' } });
    const cardInv = (
      await sql`
        insert into invoices (tenant_id, number, plan_id, amount_cents, method, status, provider,
                              period_start, period_end, due_at)
        values (${card.body.store.id}, 1, 'mirim', 6990, 'card', 'open', 'fake',
                now(), now() + interval '1 month', now())
        returning id
      `
    )[0]!;
    const refused = await control(`/control/v1/billing/invoices/${cardInv.id}/mark-paid`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('CARD_SUBSCRIPTION');
  });
});
