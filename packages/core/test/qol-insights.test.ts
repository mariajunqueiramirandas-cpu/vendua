import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { auditChanges } from '../src/admin/audit.ts';
import { csvMoney, presetRange } from '../src/admin/routes-reports.ts';
import { migrate } from '../src/platform/db.ts';

// Relatórios presets, the Mercado Pago statement spreadsheet, customer notes and tags, and the
// readable "what changed" in Equipe's activity. (Money reads like the admin's: R$ and a no-break space.)

describe('report presets: the store calendar', () => {
  const SP = 'America/Sao_Paulo';
  // 23:30 on Oct 5 in São Paulo, already Oct 6 in UTC
  const late = new Date('2026-10-06T02:30:00Z');
  const pick = (r: ReturnType<typeof presetRange>) => [r.from, r.to, r.prevFrom, r.prevTo];

  test('days are the store’s, not UTC’s', () => {
    expect(pick(presetRange('hoje', SP, late))).toEqual([
      '2026-10-05',
      '2026-10-05',
      '2026-10-04',
      '2026-10-04',
    ]);
    expect(presetRange('hoje', 'UTC', late).from).toBe('2026-10-06');
    expect(pick(presetRange('ontem', SP, late))).toEqual([
      '2026-10-04',
      '2026-10-04',
      '2026-10-03',
      '2026-10-03',
    ]);
  });

  test('rolling windows compare with the same number of days before', () => {
    const w = presetRange('7d', SP, late);
    expect(pick(w)).toEqual(['2026-09-29', '2026-10-05', '2026-09-22', '2026-09-28']);
    expect(w.days).toBe(7);
    const m = presetRange('30d', SP, late);
    expect(pick(m)).toEqual(['2026-09-06', '2026-10-05', '2026-08-07', '2026-09-05']);
    expect(m.days).toBe(30);
  });

  test('months compare with the month before (to the same day, clamped)', () => {
    expect(pick(presetRange('mes', SP, late))).toEqual([
      '2026-10-01',
      '2026-10-05',
      '2026-09-01',
      '2026-09-05',
    ]);
    expect(pick(presetRange('mes-passado', SP, late))).toEqual([
      '2026-09-01',
      '2026-09-30',
      '2026-08-01',
      '2026-08-31',
    ]);
    const endOfMarch = new Date('2026-03-31T15:00:00Z');
    expect(pick(presetRange('mes', SP, endOfMarch))).toEqual([
      '2026-03-01',
      '2026-03-31',
      '2026-02-01',
      '2026-02-28',
    ]);
    const january = new Date('2026-01-15T15:00:00Z');
    expect(pick(presetRange('mes-passado', SP, january))).toEqual([
      '2025-12-01',
      '2025-12-31',
      '2025-11-01',
      '2025-11-30',
    ]);
    expect(presetRange('mes', SP, new Date('2026-01-01T12:00:00Z')).prevTo).toBe('2025-12-01');
  });

  test('spreadsheet money is formatted from integer cents', () => {
    expect(csvMoney(0)).toBe('0,00');
    expect(csvMoney(5)).toBe('0,05');
    expect(csvMoney(123456)).toBe('1234,56');
    expect(csvMoney(-150)).toBe('-1,50');
  });
});

describe('activity: what changed, in words', () => {
  test('a product edit reads as fields, money formatted by Core', () => {
    const { changes, more } = auditChanges(
      { name: 'Pudim', priceCents: 1200, status: 'active', categoryId: crypto.randomUUID() },
      { name: 'Pudim', priceCents: 1450, status: 'sold_out', categoryId: crypto.randomUUID() },
    );
    expect(more).toBe(0);
    expect(changes).toEqual([
      { label: 'preço', from: 'R$\u00a012,00', to: 'R$\u00a014,50' },
      { label: 'situação', from: 'disponível', to: 'esgotado' },
      { label: 'categoria', from: null, to: null, hidden: true },
    ]);
  });

  test('secrets and personal data say they changed, never what they hold', () => {
    const token = 'APP_USR-1234567890123456-abcdef';
    const r = auditChanges(null, {
      pixKey: '12345678909',
      accessToken: token,
      phone: '(22) 99999-0001',
      message: 'ligue 22 99999 0001',
      note: 'mora na rua X',
      location: { latitude: -22.9, longitude: -42.5 },
      title: 'Promo de sábado',
    });
    const json = JSON.stringify(r);
    for (const s of [token, '12345678909', '99999', '-22.9', 'rua X'])
      expect(json).not.toContain(s);
    expect(r.changes).toContainEqual({ label: 'chave Pix', from: null, to: null, hidden: true });
    expect(r.changes).toContainEqual({ label: 'mensagem', from: null, to: null, hidden: true });
    expect(r.changes).toContainEqual({ label: 'localização', from: null, to: null, hidden: true });
    expect(r.changes).toContainEqual({ label: 'título', from: null, to: 'Promo de sábado' });
    // unknown fields are left out rather than shown as code names
    expect(json).not.toContain('accessToken');
  });

  test('bounded: six changes, long text clipped, the rest counted', () => {
    const before = {
      prepTimeMinutes: 20,
      minOrderCents: 0,
      pickupEnabled: false,
      deliveryEnabled: true,
      demand: 'normal',
      maxDays: 3,
      maxKm: 5,
      description: 'a',
    };
    const after = {
      prepTimeMinutes: 35,
      minOrderCents: 2500,
      pickupEnabled: true,
      deliveryEnabled: false,
      demand: 'high',
      maxDays: 7,
      maxKm: 8.5,
      description: 'x'.repeat(500),
    };
    const r = auditChanges({ operations: before }, { operations: after });
    expect(r.changes).toHaveLength(6);
    expect(r.more).toBe(2);
    expect(r.changes[0]).toEqual({ label: 'tempo de preparo', from: '20 min', to: '35 min' });
    expect(r.changes[1]).toEqual({
      label: 'pedido mínimo',
      from: 'R$\u00a00,00',
      to: 'R$\u00a025,00',
    });
    expect(r.changes[4]).toEqual({ label: 'movimento', from: 'normal', to: 'movimento alto' });
    const long = auditChanges(null, { description: 'pudim de leite '.repeat(40) }).changes[0]!;
    expect(long.to!.length).toBeLessThanOrEqual(60);
    expect(long.to!.endsWith('…')).toBe(true);
    expect(auditChanges(null, null)).toEqual({ changes: [], more: 0 });
    // a coupon's value reads by its kind
    expect(auditChanges(null, { kind: 'percent', value: 10 }).changes).toContainEqual({
      label: 'valor',
      from: null,
      to: '10%',
    });
    expect(auditChanges(null, { kind: 'fixed', value: 500 }).changes).toContainEqual({
      label: 'valor',
      from: null,
      to: 'R$\u00a05,00',
    });
    expect(auditChanges({ truncated: true }, { truncated: true })).toEqual({
      changes: [],
      more: 0,
    });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('qol insights (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const appSql = process.env.TEST_APP_DATABASE_URL
    ? postgres(process.env.TEST_APP_DATABASE_URL, { onnotice: () => {} })
    : sql;
  const codes = new Map<string, string>();
  const app = createApp({
    sql: appSql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  const ownerPhone = `2195${stamp}`;
  const attendantPhone = `2196${stamp}`;
  const otherOwner = `2197${stamp}`;
  const shopper = `2297${stamp}`;
  const shopper2 = `2298${stamp}`;
  let tenantId = '';
  let tenant2 = '';
  let idem = 0;
  let number = 0;
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date())
    .slice(0, 7);

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
      headers: res.headers,
    };
  };
  const signIn = async (phone: string) => {
    await call('POST', '/admin/v1/auth/otp/start', { phone });
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.body.signedIn).toBe(true);
    const cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
    return (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie, ...h });
  };
  let owner: Awaited<ReturnType<typeof signIn>>;
  let attendant: Awaited<ReturnType<typeof signIn>>;
  let other: Awaited<ReturnType<typeof signIn>>;

  const order = async (tenant: string, phone: string, totalCents = 2000) => {
    const cart = (
      await sql<{ id: string }[]>`
        insert into carts (tenant_id, session_hash) values (${tenant}, ${`qi-${nonce}-${++number}`})
        returning id
      `
    )[0]!.id;
    return (
      await sql<{ id: string; number: number }[]>`
        insert into orders (tenant_id, cart_id, number, customer, customer_phone, delivery, payment,
                            state, subtotal_cents, total_cents)
        values (${tenant}, ${cart}, ${number}, ${sql.json({ name: 'Bia Souza', phone })}, ${phone},
                ${sql.json({ mode: 'pickup' })},
                ${sql.json({ provider: 'mercadopago', method: 'pix', status: 'paid', online: true })},
                'delivered', ${totalCents}, ${totalCents})
        returning id, number
      `
    )[0]!;
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const mk = async (slug: string, phone: string, name: string) => {
      const id = (
        await sql<{ id: string }[]>`
          insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id
        `
      )[0]!.id;
      await sql`
        insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary)
        values (${id}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [] })}, 25, 0, 'BRL', ${sql.json({})})
      `;
      await sql`insert into merchant_users (tenant_id, name, phone, role) values (${id}, ${name}, ${phone}, 'owner')`;
      return id;
    };
    tenantId = await mk(`qi-${nonce}`, ownerPhone, 'Rita');
    tenant2 = await mk(`qi2-${nonce}`, otherOwner, 'Outra');
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Caio', ${attendantPhone}, 'attendant')`;
    owner = await signIn(ownerPhone);
    attendant = await signIn(attendantPhone);
    other = await signIn(otherOwner);
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id in (${tenantId}, ${tenant2})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('reports: a preset is resolved by Core, in the store calendar', async () => {
    await order(tenantId, shopper);
    const r = await owner('GET', '/reports?period=mes');
    expect(r.status).toBe(200);
    expect(r.body.range.period).toBe('mes');
    expect(r.body.range.from).toBe(`${month}-01`);
    expect(r.body.current.orders).toBeGreaterThanOrEqual(1);
    const y = await owner('GET', '/reports?period=ontem');
    expect(y.body.range.days).toBe(1);
    expect(y.body.range.from).toBe(y.body.range.to);
    expect((await owner('GET', '/reports?period=semana')).status).toBe(400);
    // custom still works, and the CSV takes the same presets
    const c = await owner('GET', `/reports?period=custom&from=${month}-01&to=${month}-01`);
    expect(c.body.range).toMatchObject({ period: 'custom', days: 1 });
    const csv = await owner('GET', '/reports/orders.csv?period=hoje');
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-disposition')).toMatch(/pedidos-\d{4}-\d{2}-\d{2}-a-/);
  });

  test('statement CSV: one month of settled payments, money from Core', async () => {
    const o = await order(tenantId, shopper, 10_000);
    const o2 = await order(tenantId, shopper, 2_550);
    await sql`
      insert into payments (tenant_id, order_id, provider, kind, status, amount_cents,
                            provider_fee_cents, application_fee_cents, refunded_cents, approved_at, attempt)
      values (${tenantId}, ${o.id}, 'fake', 'pix', 'approved', 10000, 499, 100, 0, now(), 1),
             (${tenantId}, ${o2.id}, 'fake', 'pix', 'rejected', 2550, null, 0, 0, null, 1),
             (${tenantId}, ${o2.id}, 'fake', 'card', 'partially_refunded', 2550, null, 0, 550, now(), 2)
    `;
    const csv = await owner('GET', `/payments/statement.csv?month=${month}`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain(`extrato-mercado-pago-${month}.csv`);
    const [head, ...rows] = (csv.body as string).replace(/^﻿/, '').split('\r\n');
    expect(head).toBe(
      'pedido;aprovado em;forma;situação;valor;taxa Mercado Pago;taxa Venduá;você recebe;reembolsado',
    );
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(expect.stringMatching(new RegExp(`^${o.number};`)));
    const pix = rows.find((r) => r.startsWith(`${o.number};`))!.split(';');
    expect(pix.slice(2)).toEqual([
      'Pix',
      'aprovado',
      '"100,00"',
      '"4,99"',
      '"1,00"',
      '"94,01"',
      '"0,00"',
    ]);
    const card = rows.find((r) => r.startsWith(`${o2.number};`))!.split(';');
    expect(card.slice(2)).toEqual([
      'cartão',
      'reembolso parcial',
      '"25,50"',
      '',
      '"0,00"',
      '"25,50"',
      '"5,50"',
    ]);
    // the on-screen statement agrees on the month's net
    const st = await owner('GET', `/payments/statement?month=${month}`);
    expect(st.body.totals.netCents).toBe(9401 + 2550);
    expect((await owner('GET', '/payments/statement.csv?month=2026-13')).status).toBe(400);
    expect((await attendant('GET', `/payments/statement.csv?month=${month}`)).status).toBe(403);
    // another store's month is empty
    const theirs = await other('GET', `/payments/statement.csv?month=${month}`);
    expect((theirs.body as string).trim().split('\r\n')).toHaveLength(1);
  });

  test('customer notes and tags: autosaved, bounded, filterable', async () => {
    await order(tenantId, shopper2);
    const put = (phone: string, body: unknown) => owner('PUT', `/customers/${phone}/notes`, body);
    const first = await put(shopper, { note: '  Prefere sem açúcar  ' });
    expect(first.status).toBe(200);
    expect(first.body.notes).toMatchObject({
      note: 'Prefere sem açúcar',
      tags: [],
      updatedBy: 'Rita',
    });
    // tags alone leave the note; lowercase, trimmed, de-duplicated
    const tagged = await put(shopper, { tags: [' VIP ', 'vip', 'Encomenda  grande', ''] });
    expect(tagged.body.notes).toMatchObject({
      note: 'Prefere sem açúcar',
      tags: ['vip', 'encomenda grande'],
    });
    expect(tagged.body.knownTags).toEqual(expect.arrayContaining(['vip', 'encomenda grande']));
    await put(shopper2, { tags: ['vip'] });

    const one = await owner('GET', `/customers/${shopper}`);
    expect(one.body.notes.tags).toEqual(['vip', 'encomenda grande']);
    expect(one.body.customer.avgTicketCents).toBeGreaterThan(0);
    expect(one.body.knownTags[0]).toBe('vip');

    const list = await owner('GET', '/customers?tag=VIP');
    expect(list.body.customers.map((c: { phone: string }) => c.phone).sort()).toEqual(
      [shopper, shopper2].sort(),
    );
    expect(list.body.tags[0]).toEqual({ tag: 'vip', customers: 2 });
    const big = await owner('GET', '/customers?tag=encomenda%20grande');
    expect(big.body.customers).toHaveLength(1);
    expect(big.body.customers[0].tags).toEqual(['vip', 'encomenda grande']);
    expect((await owner('GET', `/customers?tag=${'x'.repeat(40)}`)).status).toBe(400);

    // bounds and stable 4xx
    const tooMany = await put(shopper, { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) });
    expect(tooMany.body.error.code).toBe('TOO_MANY_TAGS');
    expect((await put(shopper, { tags: ['x'.repeat(25)] })).body.error.code).toBe('TAG_TOO_LONG');
    expect((await put(shopper, { tags: 'vip' })).status).toBe(422);
    expect((await put(shopper, { tags: [7] })).status).toBe(422);
    expect((await put(shopper, { note: 'x'.repeat(2001) })).status).toBe(422);
    expect((await put(shopper, {})).status).toBe(422);
    expect((await put('123', { note: 'oi' })).status).toBe(400);
    expect((await put('21900000000', { note: 'oi' })).body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect((await attendant('PUT', `/customers/${shopper}/notes`, { note: 'x' })).status).toBe(403);

    // a retried save is answered, not applied again
    const key = { 'idempotency-key': `${nonce}-replay` };
    const a = await owner(
      'PUT',
      `/customers/${shopper}/notes`,
      { note: 'Sem açúcar, sempre' },
      key,
    );
    const b = await owner(
      'PUT',
      `/customers/${shopper}/notes`,
      { note: 'Sem açúcar, sempre' },
      key,
    );
    expect(b.status).toBe(a.status);
    expect(b.headers.get('x-idempotent-replay')).toBe('true');

    // a burst of autosaves is one line in Equipe, and the words never reach the log
    const log = await sql`
      select summary, before, after from audit_log
      where tenant_id = ${tenantId} and action = 'customer.notes' and entity_id = ${`…${shopper.slice(-4)}`}
    `;
    expect(log).toHaveLength(1);
    expect(log[0]!.before).toBeNull();
    expect(log[0]!.after).toBeNull();
    const feed = await owner('GET', '/activity?kind=clientes');
    expect(feed.body.entries[0].summary).toContain('anotação de um cliente');
    expect(JSON.stringify(feed.body)).not.toContain('açúcar');
  });

  test('customer notes are the store’s own: other stores and other tenants see nothing', async () => {
    // the other store has no customer with this phone
    expect((await other('GET', `/customers/${shopper}`)).status).toBe(404);
    expect((await other('PUT', `/customers/${shopper}/notes`, { note: 'x' })).status).toBe(404);
    expect((await other('GET', '/customers')).body.tags).toEqual([]);
    // and RLS keeps the rows apart even for a raw read
    const seen = await sql.begin(async (tx) => {
      await tx`set local role vendua_app`;
      await tx`select set_config('vendua.tenant_id', ${tenant2}, true)`;
      return tx`select phone from customer_notes`;
    });
    expect(seen).toHaveLength(0);
    const mine = await sql.begin(async (tx) => {
      await tx`set local role vendua_app`;
      await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
      return tx`select phone from customer_notes`;
    });
    expect(mine.length).toBe(2);
  });

  test('LGPD: the export carries the notes, the forget deletes them', async () => {
    const ex = await owner('GET', `/customers/${shopper}/export`);
    expect(ex.status).toBe(200);
    expect(ex.body.notes).toMatchObject({
      note: 'Sem açúcar, sempre',
      tags: ['vip', 'encomenda grande'],
    });
    const f = await owner('POST', `/customers/${shopper}/forget`, { confirm: shopper.slice(-4) });
    expect(f.status).toBe(200);
    const left =
      await sql`select 1 from customer_notes where tenant_id = ${tenantId} and phone = ${shopper}`;
    expect(left).toHaveLength(0);
    // the other customer's tags stay
    expect((await owner('GET', '/customers')).body.tags).toEqual([{ tag: 'vip', customers: 1 }]);
  });

  test('activity: filter by kind of thing, readable changes, nothing raw', async () => {
    const token = 'APP_USR-9999999999999999-secret';
    await sql`
      insert into audit_log (tenant_id, actor_label, action, entity, entity_id, summary, before, after)
      values
        (${tenantId}, 'Rita', 'product.update', 'product', ${crypto.randomUUID()}, 'alterou preço de "Pudim"',
         ${sql.json({ name: 'Pudim', priceCents: 1200 })}, ${sql.json({ name: 'Pudim', priceCents: 1500 })}),
        (${tenantId}, 'Rita', 'payments.update', 'payments', null, 'mudou a chave Pix',
         ${sql.json({ pixKey: '12345678909', accessToken: token })}, ${sql.json({ pixKey: 'loja@exemplo.com' })}),
        (${tenantId}, 'Rita', 'vendedor.knowledge', 'store_knowledge', ${crypto.randomUUID()}, 'ensinou o Duá', null, null)
    `;
    const menu = await owner('GET', '/activity?kind=cardapio');
    expect(menu.status).toBe(200);
    expect(menu.body.entries.every((e: { entity: string }) => e.entity === 'product')).toBe(true);
    const e = menu.body.entries[0];
    expect(e.changes).toEqual([{ label: 'preço', from: 'R$\u00a012,00', to: 'R$\u00a015,00' }]);
    expect(e).not.toHaveProperty('before');
    expect(e).not.toHaveProperty('after');

    const pay = await owner('GET', '/activity?kind=pagamentos');
    expect(pay.body.entries[0].changes).toEqual([
      { label: 'chave Pix', from: null, to: null, hidden: true },
    ]);
    const all = JSON.stringify((await owner('GET', '/activity')).body);
    for (const s of [token, '12345678909', 'loja@exemplo.com']) expect(all).not.toContain(s);

    // entities with an underscore filter too, by kind or by name
    expect((await owner('GET', '/activity?kind=vendedor')).body.entries[0].entity).toBe(
      'store_knowledge',
    );
    expect((await owner('GET', '/activity?entity=store_knowledge')).body.entries).toHaveLength(1);
    expect((await owner('GET', '/activity?kind=tudo')).status).toBe(400);
    expect((await owner('GET', '/activity?entity=Product;drop')).status).toBe(400);
    expect((await attendant('GET', '/activity')).status).toBe(403);
    // another store's feed has none of it
    expect((await other('GET', '/activity?kind=cardapio')).body.entries).toHaveLength(0);
  });
});
