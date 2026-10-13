import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import type { ModelGateway } from '@vendua/agent-runtime';
import { createApp } from '../src/app.ts';
import { contactPhone, parseContacts } from '../src/admin/routes-customers.ts';
import { photoItemsOf } from '../src/modules/menu-import/photo.ts';
import { migrate, type Sql } from '../src/platform/db.ts';

// Moving in from a system no link import reads (anota.ai, iFood): the menu from photos of it,
// reviewed before anything is written, and the customer list from its export.

const OWNER_URL = process.env.TEST_DATABASE_URL;
const APP_URL =
  process.env.TEST_APP_DATABASE_URL ?? OWNER_URL?.replace(/\/\/[^@]+@/, '//vendua_app:vendua_app@');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('reading a customer list', () => {
  test('a phone is DDD + number, the country code dropped', () => {
    expect(contactPhone('+55 (21) 99999-0000')).toBe('21999990000');
    expect(contactPhone('5521999990000')).toBe('21999990000');
    expect(contactPhone('(21) 2555-0000')).toBe('2125550000');
    expect(contactPhone('021999990000')).toBe('21999990000');
    // a mobile without the 9, a short number, a DDD that doesn't exist
    expect(contactPhone('21899990000')).toBeNull();
    expect(contactPhone('99990000')).toBeNull();
    expect(contactPhone('10999990000')).toBeNull();
  });

  test('a CSV in any column order, a header, quotes and a paste all read the same', () => {
    const csv = [
      'Telefone;Nome;E-mail',
      '(21) 99999-0001;Ana Souza;ana@x.com',
      '"21 99999-0002";"Bruno, o do 302";',
      '21999990001;Ana de novo;',
      'sem telefone;Carla;',
    ].join('\n');
    const r = parseContacts(csv);
    expect(r.contacts).toEqual([
      { phone: '21999990001', name: 'Ana Souza' },
      { phone: '21999990002', name: 'Bruno, o do 302' },
    ]);
    expect(r.skipped).toBe(2);
    expect(parseContacts('Dona Rita - (21) 98888-7777\n• Zé: 5521977776666').contacts).toEqual([
      { phone: '21988887777', name: 'Dona Rita' },
      { phone: '21977776666', name: 'Zé' },
    ]);
  });

  test("the model's menu JSON is bounded and anything malformed dropped", () => {
    expect(
      photoItemsOf(
        'aqui está: {"items":[{"category":"Pizzas","name":"Calabresa (grande)","description":null,"price":"R$ 54,90"},{"name":"x","price":"1"},{"name":"Sem preço"},{"name":"Suco","price":8}]}',
      ),
    ).toEqual([
      { category: 'Pizzas', name: 'Calabresa (grande)', description: null, price: 'R$ 54,90' },
      { category: null, name: 'Suco', description: null, price: '8' },
    ]);
    expect(photoItemsOf('não é json')).toEqual([]);
  });
});

describe.skipIf(!OWNER_URL)('moving in: menu photos and the customer list (db)', () => {
  const sql = postgres(OWNER_URL!, { onnotice: () => {} });
  const appSql = postgres(APP_URL!, { onnotice: () => {} }) as unknown as Sql;
  const codes = new Map<string, string>();
  let seen: string | null = null;
  let reads = 0;
  const gateway = {
    generate: async () => {
      reads++;
      if (seen === null) throw new Error('no route');
      return { text: seen };
    },
  } as unknown as ModelGateway;
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
    duaMedia: { media: null, gateway },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const stamp = String(Date.now()).slice(-7);
  let idem = 0;
  let phones = 0;
  const phone = () => `22${String(++phones).padStart(2, '0')}${stamp}`.slice(0, 11);
  let tenantId = '';
  let owner = '';
  let attendant = '';

  const request = async (cookie: string, method: string, path: string, body?: unknown) => {
    const res = await app.request(`http://core.localhost/admin/v1${path}`, {
      method,
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        cookie,
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  async function signIn(p: string) {
    await request('', 'POST', '/auth/otp/start', { phone: p });
    const r = await app.request('http://core.localhost/admin/v1/auth/otp/verify', {
      method: 'POST',
      headers: {
        host: 'core.localhost',
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-${++idem}`,
        'x-vendua-admin': '1',
      },
      body: JSON.stringify({ phone: p, code: codes.get(p) }),
    });
    return `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')![1]!}`;
  }

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const [t] = await sql<{ id: string }[]>`
      insert into tenants (slug, name, plan) values (${`mi-${nonce}`}, 'Pizza da Nena', 'mirim')
      returning id`;
    tenantId = t!.id;
    await sql`insert into categories (tenant_id, slug, name) values (${tenantId}, 'pizzas', 'Pizzas')`;
    const o = phone();
    const a = phone();
    await sql`insert into merchant_users (tenant_id, name, phone, role)
      values (${tenantId}, 'Nena', ${o}, 'owner'), (${tenantId}, 'Gil', ${a}, 'attendant')`;
    owner = await signIn(o);
    attendant = await signIn(a);
  });

  afterAll(async () => {
    await sql`delete from tenants where id = ${tenantId}`;
    await (appSql as unknown as { end: () => Promise<void> }).end();
    await sql.end();
  });

  test('a menu photo comes back for review, priced by Core, and nothing is written', async () => {
    seen = JSON.stringify({
      items: [
        {
          category: 'Pizzas',
          name: 'Calabresa (grande)',
          description: 'molho, calabresa',
          price: 'R$ 54,90',
        },
        { category: 'Bebidas', name: 'Guaraná 2L', description: null, price: '12' },
        { category: 'Pizzas', name: 'Do dia', description: null, price: 'consulte' },
      ],
    });
    const before = reads;
    const r = await request(owner, 'POST', '/products/import/photo', {
      mime: 'image/png',
      data: PNG.toString('base64'),
    });
    expect(r.status).toBe(200);
    expect(reads).toBe(before + 1);
    expect(r.body.items).toEqual([
      {
        category: 'Pizzas',
        name: 'Calabresa (grande)',
        description: 'molho, calabresa',
        priceCents: 5490,
      },
      { category: 'Bebidas', name: 'Guaraná 2L', description: null, priceCents: 1200 },
    ]);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from products where tenant_id = ${tenantId}`;
    expect(n).toBe(0);
    // not a photo: refused before the paid call; an unreadable one is a stable 422
    const fake = await request(owner, 'POST', '/products/import/photo', {
      mime: 'image/png',
      data: Buffer.from('not a png at all').toString('base64'),
    });
    expect(fake.status).toBe(415);
    seen = null;
    expect(
      (
        await request(owner, 'POST', '/products/import/photo', {
          mime: 'image/png',
          data: PNG.toString('base64'),
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(attendant, 'POST', '/products/import/photo', {
          mime: 'image/png',
          data: PNG.toString('base64'),
        })
      ).status,
    ).toBe(403);
  });

  test('the reviewed list lands in its categories, a new one created by name', async () => {
    const r = await request(owner, 'POST', '/products/import/items', {
      items: [
        {
          category: 'pizzas',
          name: 'Calabresa (grande)',
          description: 'molho, calabresa',
          priceCents: 5490,
        },
        { category: 'Bebidas', name: 'Guaraná 2L', priceCents: 1200 },
        { category: 'Bebidas', name: 'Água', priceCents: 400 },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: 3, categories: 1 });
    const rows = await sql<{ name: string; cat: string; price: number; sort: number }[]>`
      select p.name, c.name as cat, p.base_price_cents as price, p.sort from products p
      join categories c on c.id = p.category_id where p.tenant_id = ${tenantId} order by c.name, p.sort`;
    expect(rows).toEqual([
      { name: 'Guaraná 2L', cat: 'Bebidas', price: 1200, sort: 0 },
      { name: 'Água', cat: 'Bebidas', price: 400, sort: 1 },
      { name: 'Calabresa (grande)', cat: 'Pizzas', price: 5490, sort: 0 },
    ]);
    // a bad price or an empty list is a 422, never a 500
    for (const items of [
      [],
      [{ name: 'X tudo', priceCents: 0 }],
      [{ name: 'Y', priceCents: 1.5 }],
      'x',
    ])
      expect((await request(owner, 'POST', '/products/import/items', { items })).status).toBe(422);
  });

  test('a customer list joins Clientes, without pretending they ordered', async () => {
    const list = 'nome;telefone\nAna Souza;(21) 99999-1001\nBruno;21 99999-1002\nlinha ruim';
    const p = await request(owner, 'POST', '/customers/import/preview', { text: list });
    expect(p.body).toMatchObject({ total: 2, skipped: 2 });
    const r = await request(owner, 'POST', '/customers/import', { text: list });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ imported: 2, known: 0, skipped: 2 });
    // again: nothing new, names kept
    const again = await request(owner, 'POST', '/customers/import', {
      text: 'Ana Outra;21999991001',
    });
    expect(again.body).toEqual({ imported: 0, known: 1, skipped: 0 });

    // one of them orders: the order's name wins, and they sort first
    await sql`
      insert into orders (tenant_id, number, source, state, customer, customer_phone, delivery, payment,
                          subtotal_cents, total_cents, placed_at)
      values (${tenantId}, 1, 'pdv', 'delivered', ${sql.json({ name: 'Bruno Lima', phone: '21999991002' })},
              '21999991002', ${sql.json({ mode: 'pickup' })}, ${sql.json({ method: 'cash' })}, 3000, 3000, now())`;
    const l = await request(owner, 'GET', '/customers');
    expect(l.status).toBe(200);
    const mine = l.body.customers.filter((c: { phone: string }) =>
      ['21999991001', '21999991002'].includes(c.phone),
    );
    expect(mine).toMatchObject([
      { phone: '21999991002', name: 'Bruno Lima', orders: 1, imported: true },
      { phone: '21999991001', name: 'Ana Souza', orders: 0, lastAt: null, imported: true },
    ]);
    expect(l.body.stats).toMatchObject({ customers: 1, imported: 1 });
    const ana = await request(owner, 'GET', '/customers/21999991001');
    expect(ana.status).toBe(200);
    expect(ana.body.customer).toMatchObject({ name: 'Ana Souza', orders: 0, lastAt: null });
    expect(ana.body.orders).toEqual([]);

    const exp = await request(owner, 'GET', '/customers/21999991001/export');
    expect(exp.status).toBe(200);
    expect(exp.body.importedContact).toMatchObject({ name: 'Ana Souza', source: 'import' });
    const gone = await request(owner, 'POST', '/customers/21999991001/forget', { confirm: '1001' });
    expect(gone.status).toBe(200);
    expect((await request(owner, 'GET', '/customers/21999991001')).status).toBe(404);
    // the audit log holds counts, never the phones
    const [a] = await sql<{ summary: string; after: unknown }[]>`
      select summary, after from audit_log where tenant_id = ${tenantId} and action = 'customer.import'
      order by at limit 1`;
    expect(a!.summary).not.toContain('99999');
    expect(JSON.stringify(a!.after ?? null)).not.toContain('99999');
    expect((await request(attendant, 'POST', '/customers/import', { text: list })).status).toBe(
      403,
    );
  });
});
