import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { createSession } from '../src/admin/auth.ts';
import { FakeProvider } from '../src/modules/payments/fake.ts';
import { migrate } from '../src/platform/db.ts';

describe.skipIf(!process.env.TEST_DATABASE_URL)('onboarding (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const fake = new FakeProvider();
  (fake as unknown as { seq: number }).seq = Math.floor(Math.random() * 1e9);
  const wa: { phone: string; text: string }[] = [];
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    paymentProvider: fake,
    notify: {
      whatsapp: async (phone: string, text: string) => void wa.push({ phone, text }),
      email: async () => {},
    },
  });
  const nonce = crypto.randomUUID().slice(0, 6);
  const phone = `218${String(Date.now()).slice(-8)}`;
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
      location: res.headers.get('location'),
    };
  };

  const as =
    (value: string) =>
    (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}`, ...h });

  let tenantId = '';
  let owner: ReturnType<typeof as>;

  const events = (kind: string) =>
    sql<{ data: any; dedupe_key: string | null; anchor: string | null }[]>`
      select data, dedupe_key, anchor from staff_events
      where tenant_id = ${tenantId} and kind = ${kind} order by id
    `;
  const audits = () =>
    sql<{ summary: string; after: any }[]>`
      select summary, after from audit_log where tenant_id = ${tenantId} and action = 'store.onboarding'
      order by id
    `;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    await call('POST', '/admin/v1/signup/otp/start', { phone });
    const code = /(\d{6})/.exec(wa.filter((m) => m.phone === phone).at(-1)!.text)![1]!;
    const v = await call('POST', '/admin/v1/signup/otp/verify', { phone, code });
    const r = await call('POST', '/admin/v1/signup', {
      signupToken: v.body.signupToken,
      planId: 'basic',
      method: 'pix',
      storeName: 'Açaí da Onda',
      slug: `onb-${nonce}`,
      ownerName: 'Bia Costa',
      email: 'bia@example.com',
      segment: 'acai',
    });
    expect(r.status).toBe(201);
    tenantId = r.body.store.id;
    created.push(tenantId);
    owner = as(/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!);
  });

  afterAll(async () => {
    if (created.length) await sql`delete from tenants where id in ${sql(created)}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('a new store reads its onboarding: from signup, the segment, the setup checklist', async () => {
    const r = await owner('GET', '/onboarding');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      segment: 'acai',
      from: 'signup',
      step: null,
      skipped: [],
      finishedAt: null,
      dismissedAt: null,
      checklist: [
        { id: 'profile', label: 'Logo e WhatsApp da loja', done: false, href: '/loja#perfil' },
        { id: 'hours', label: 'Horário de funcionamento', done: false, href: '/loja#horarios' },
        { id: 'delivery', label: 'Entrega ou retirada', done: false, href: '/loja#entrega' },
        { id: 'pix', label: 'Chave Pix para receber', done: false, href: '/pagamentos' },
        { id: 'menu', label: '3 produtos com foto', done: false, href: '/cardapio' },
        {
          id: 'first_order',
          label: 'Primeiro pedido',
          done: false,
          href: '/marketing#compartilhar',
        },
      ],
    });
    const home = await owner('GET', '/home');
    expect(home.body.onboarding).toEqual({
      finished: false,
      dismissed: false,
      from: 'signup',
      step: null,
    });
    expect(home.body.checklist).toEqual(r.body.checklist);
  });

  test('step, skipped and segment move without an audit row; segment changes are audited', async () => {
    const a = await owner('PATCH', '/onboarding', { step: 'hours', skipped: ['pix', 'menu'] });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ step: 'hours', skipped: ['pix', 'menu'], segment: 'acai' });
    // skipped replaces the list
    const b = await owner('PATCH', '/onboarding', { step: 'delivery', skipped: ['menu'] });
    expect(b.body).toMatchObject({ step: 'delivery', skipped: ['menu'] });
    expect(await audits()).toHaveLength(0);

    const seg = await owner('PATCH', '/onboarding', { segment: 'doces' });
    expect(seg.body.segment).toBe('doces');
    expect(seg.body.from).toBe('signup');
    // the same value again is no change
    await owner('PATCH', '/onboarding', { segment: 'doces' });
    expect((await audits()).map((x) => x.after)).toEqual([{ segment: 'doces' }]);

    const cleared = await owner('PATCH', '/onboarding', { step: null, segment: null });
    expect(cleared.body).toMatchObject({ step: null, segment: null, skipped: ['menu'] });
    const row = (
      await sql`select segment, onboarding from store_settings where tenant_id = ${tenantId}`
    )[0]!;
    expect(row).toEqual({ segment: null, onboarding: { from: 'signup', skipped: ['menu'] } });
    expect(await audits()).toHaveLength(2);
    expect((await owner('GET', '/home')).body.onboarding.step).toBeNull();
  });

  test('bad input is a 422 naming the field; an empty body changes nothing', async () => {
    const bad = async (body: unknown, field?: string) => {
      const r = await owner('PATCH', '/onboarding', body);
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('BAD_REQUEST');
      if (field) expect(r.body.error.details.field).toBe(field);
    };
    await bad({ step: 'Hours!' }, 'step');
    await bad({ step: 'a' }, 'step');
    await bad({ step: 'x'.repeat(25) }, 'step');
    await bad({ step: 3 }, 'step');
    await bad({ skipped: 'pix' }, 'skipped');
    await bad(
      { skipped: Array.from({ length: 21 }, (_, i) => `s_${'abcdefghijklmnopqrstu'[i]}`) },
      'skipped',
    );
    await bad({ skipped: ['pix', 'pix'] }, 'skipped');
    await bad({ skipped: ['pix', 'Menu'] }, 'skipped');
    await bad({ segment: 'sorvetes' }, 'segment');
    await bad({ finished: 'yes' }, 'finished');
    await bad({ finished: false }, 'finished');
    await bad({ dismissed: 1 }, 'dismissed');
    await bad({});
    await bad({ other: true });
    const big = await owner('PATCH', '/onboarding', { step: 'hours', pad: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    expect((await owner('PATCH', '/onboarding', [1])).status).toBe(400);
    // twenty is fine
    const twenty = Array.from({ length: 20 }, (_, i) => `s_${'abcdefghijklmnopqrst'[i]}`);
    expect((await owner('PATCH', '/onboarding', { skipped: twenty })).body.skipped).toEqual(twenty);
    expect((await owner('PATCH', '/onboarding', { skipped: [] })).body.skipped).toEqual([]);
  });

  test('finished: the first time is kept, audited and told to the team once', async () => {
    const one = await owner('PATCH', '/onboarding', { finished: true, step: 'done' });
    expect(one.status).toBe(200);
    const at = one.body.finishedAt as string;
    expect(new Date(at).toISOString()).toBe(at);
    expect(Math.abs(Date.parse(at) - Date.now())).toBeLessThan(60_000);
    await new Promise((r) => setTimeout(r, 20));
    const two = await owner('PATCH', '/onboarding', { finished: true });
    expect(two.body.finishedAt).toBe(at);
    const steps = (await events('store.onboarding')).filter((e) => e.data.step === 'setup');
    expect(steps).toEqual([
      {
        data: { step: 'setup' },
        dedupe_key: `onboarding:${tenantId}:setup`,
        anchor: `onboarding:${tenantId}`,
      },
    ]);
    const finishes = (await audits()).filter((x) => x.after?.finishedAt);
    expect(finishes).toHaveLength(1);
    expect(finishes[0]!.summary).toContain('concluiu');
    expect((await owner('GET', '/home')).body.onboarding).toMatchObject({
      finished: true,
      dismissed: false,
    });
  });

  test('dismissed true then false; the same idempotency key replays', async () => {
    const key = `${nonce}-dismiss`;
    const on = await owner('PATCH', '/onboarding', { dismissed: true }, { 'idempotency-key': key });
    expect(on.status).toBe(200);
    expect(on.body.dismissedAt).toEqual(expect.any(String));
    const replay = await owner(
      'PATCH',
      '/onboarding',
      { dismissed: true },
      { 'idempotency-key': key },
    );
    expect(replay.body).toEqual(on.body);
    expect((await owner('GET', '/home')).body.onboarding.dismissed).toBe(true);
    const off = await owner('PATCH', '/onboarding', { dismissed: false });
    expect(off.body.dismissedAt).toBeNull();
    expect(off.body.finishedAt).toEqual(expect.any(String));
    expect((await owner('GET', '/home')).body.onboarding.dismissed).toBe(false);
    const notes = (await audits()).map((x) => x.summary);
    expect(notes.filter((s) => s.includes('dispensou'))).toHaveLength(1);
    expect(notes.filter((s) => s.includes('reabriu'))).toHaveLength(1);
  });

  test('an attendant can see neither the onboarding nor change it', async () => {
    const userId = (
      await sql<{ id: string }[]>`
        insert into merchant_users (tenant_id, name, phone, role)
        values (${tenantId}, 'Caio', ${`217${String(Date.now()).slice(-8)}`}, 'attendant')
        returning id
      `
    )[0]!.id;
    const cookie = await createSession(
      appSql,
      { tenant_id: tenantId, user_id: userId, slug: `onb-${nonce}`, name: 'x', role: 'attendant' },
      'test',
    );
    const caio = as(cookie);
    expect((await caio('GET', '/home')).status).toBe(200);
    expect((await caio('GET', '/onboarding')).status).toBe(403);
    expect((await caio('PATCH', '/onboarding', { step: 'hours' })).status).toBe(403);
  });

  test('delivery is done with distance pricing and no zones; pickup alone too', async () => {
    const delivery = async () =>
      ((await owner('GET', '/onboarding')).body.checklist as any[]).find((x) => x.id === 'delivery')
        .done as boolean;
    await sql`update store_settings set delivery_enabled = true, pickup_enabled = false, distance_pricing = false where tenant_id = ${tenantId}`;
    expect(await delivery()).toBe(false);
    await sql`update store_settings set distance_pricing = true where tenant_id = ${tenantId}`;
    expect(await delivery()).toBe(true);
    const home = (await owner('GET', '/home')).body.checklist as any[];
    expect(home.find((x) => x.id === 'delivery').done).toBe(true);
    await sql`update store_settings set delivery_enabled = false, pickup_enabled = true, distance_pricing = false where tenant_id = ${tenantId}`;
    expect(await delivery()).toBe(true);
  });

  test('the Pix key item is done when the store takes no Pix', async () => {
    const pix = async () =>
      ((await owner('GET', '/onboarding')).body.checklist as any[]).find((x) => x.id === 'pix')
        .done as boolean;
    await sql`update store_settings set pix_key = null, payment_methods = '["pix","cash"]'::jsonb where tenant_id = ${tenantId}`;
    expect(await pix()).toBe(false);
    await sql`update store_settings set payment_methods = '["cash"]'::jsonb where tenant_id = ${tenantId}`;
    expect(await pix()).toBe(true);
  });

  test('Mercado Pago connect from the wizard comes back to the wizard — and only to it', async () => {
    const start = await owner('POST', '/payments/mercadopago/connect', { back: 'onboarding' });
    expect(start.status).toBe(200);
    const u = new URL(start.body.url);
    const path = `${u.pathname.replace('/admin/v1', '')}`;
    const st = u.searchParams.get('state')!;
    const denied = await owner('GET', `${path}?error=access_denied&state=${st}`);
    expect(denied.location).toBe('/admin/bem-vindo?mp=error&reason=access_denied');
    const tampered = await owner('GET', `${path}?code=fake-code-x&state=${st.slice(0, -2)}xx`);
    expect(tampered.location).toBe('/admin/pagamentos?mp=error&reason=invalid_state');
    const cb = await owner('GET', `${path}${u.search}`);
    expect(cb.status).toBe(302);
    expect(cb.location).toBe('/admin/bem-vindo?mp=connected');

    // anything but the literal is today's page
    for (const body of [{ back: 'https://evil.example' }, { back: '/admin/bem-vindo' }, {}]) {
      const other = await owner('POST', '/payments/mercadopago/connect', body);
      expect(other.status).toBe(200);
      const o = new URL(other.body.url);
      const res = await owner(
        'GET',
        `${path}?error=access_denied&state=${o.searchParams.get('state')}`,
      );
      expect(res.location).toBe('/admin/pagamentos?mp=error&reason=access_denied');
    }
  });
});
