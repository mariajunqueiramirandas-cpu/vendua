import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { parseItemNote, type CartView, type PricedItem } from '../src/modules/cart.ts';
import type { OrderView } from '../src/modules/orders.ts';
import { renderOrderTicket } from '../src/modules/printing/ticket.ts';
import { migrate } from '../src/platform/db.ts';
import { lineText } from '../src/vendedor/cards.ts';
import { cartHash } from '../src/vendedor/gate.ts';

// A note on one line ("sem cebola"): part of the line's identity in the bag, carried to the
// order, the kitchen, the ticket, a shared or replayed bag, and gone with an LGPD forget.

describe('item notes (units)', () => {
  test('a note is one bounded line of text', () => {
    expect(parseItemNote(undefined)).toBe('');
    expect(parseItemNote(null)).toBe('');
    expect(parseItemNote('  sem   cebola\n e sem tomate ')).toBe('sem cebola e sem tomate');
    expect(parseItemNote('x'.repeat(140))).toHaveLength(140);
    expect(() => parseItemNote('x'.repeat(141))).toThrow();
    expect(() => parseItemNote(42)).toThrow();
  });

  const item: PricedItem = {
    id: 'l1',
    productId: 'p1',
    slug: 'x-burger',
    name: 'X-Burger',
    qty: 2,
    unitPriceCents: 2500,
    productStatus: 'active',
    modifiers: [{ id: 'm1', name: 'Bacon', priceDeltaCents: 300, qty: 1, status: 'active' }],
    modifierIds: ['m1'],
    modifierQty: {},
    combo: [],
    comboSelections: [],
    lineTotalCents: 5600,
    imageUrl: null,
    stockQuantity: null,
    requiresPreorder: false,
    preorderLeadDays: 0,
  };
  const cart = (items: PricedItem[]) =>
    ({
      id: 'c',
      status: 'open',
      items,
      totals: { deliveryFeeCents: 0, discountCents: 0, paymentAdjustmentCents: 0, totalCents: 1 },
      delivery: null,
      coupon: null,
    }) as unknown as CartView;

  test("the Vendedor's line and the confirmation hash carry the note", () => {
    expect(lineText(item)).toBe('2× X-Burger (Bacon)');
    expect(lineText({ ...item, note: 'sem cebola' })).toBe(
      '2× X-Burger (Bacon) — obs.: sem cebola',
    );
    // a cart without notes keeps its hash; a note (or another one) is a new yes
    const plain = cartHash(cart([item]), {});
    expect(cartHash(cart([{ ...item, note: null }]), {})).toBe(plain);
    const noted = cartHash(cart([{ ...item, note: 'sem cebola' }]), {});
    expect(noted).not.toBe(plain);
    expect(cartHash(cart([{ ...item, note: 'sem tomate' }]), {})).not.toBe(noted);
  });

  test('the thermal ticket prints the note under its line', () => {
    const order = {
      id: crypto.randomUUID(),
      number: 7,
      state: 'confirmed',
      customer: { name: 'Ana', phone: '22988887777' },
      delivery: { mode: 'pickup' },
      payment: { provider: 'sandbox', method: 'pix', status: 'paid' },
      items: [
        {
          productId: null,
          slug: 'x',
          name: 'X-Burger',
          qty: 1,
          unitPriceCents: 2500,
          modifiers: [],
          combo: [],
          lineTotalCents: 2500,
          note: 'sem cebola',
        },
      ],
      notes: null,
      scheduledFor: null,
      subtotalCents: 2500,
      deliveryFeeCents: 0,
      discountCents: 0,
      paymentAdjustmentCents: 0,
      coupon: null,
      totalCents: 2500,
      placedAt: '2026-10-02T15:30:00.000Z',
      updatedAt: '2026-10-02T15:30:00.000Z',
      version: 1,
      timeline: [],
    } as OrderView;
    const now = new Date('2026-10-02T15:31:00Z');
    const t = renderOrderTicket(
      order,
      { name: 'Loja', timezone: 'America/Sao_Paulo' },
      { paper: 80, codepage: 'ascii', copies: 1, cut: false },
      now,
      now,
    );
    expect(Buffer.from(t).toString('latin1')).toContain('OBS: sem cebola');
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('item notes (db)', () => {
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
  const slug = `in-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `218${String(Date.now()).slice(-8)}`;
  const shopper = `229${String(Date.now()).slice(-8)}`;
  let tenantId = '';
  let productId = '';
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

  const signIn = async (phone: string) => {
    expect((await call('POST', '/admin/v1/auth/otp/start', { phone })).status).toBe(200);
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    const value = /vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!;
    return (method: string, path: string, body?: unknown) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}` });
  };
  let owner: Awaited<ReturnType<typeof signIn>>;

  const session = async () => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    return { host, authorization: `Bearer ${s.body.sessionToken}` };
  };
  type Line = { id: string; qty: number; note: string | null };
  const lines = (r: { body: { cart: { items: Line[] } } }) =>
    r.body.cart.items.map((i) => ({ qty: i.qty, note: i.note })).sort((a, b) => a.qty - b.qty);

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner')`;
    owner = await signIn(ownerPhone);
    const catId = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'lanches', 'Lanches') returning id`
    )[0]!.id;
    const p = await owner('POST', '/products', {
      name: 'X-Burger',
      categoryId: catId,
      priceCents: 2500,
    });
    expect(p.status).toBe(201);
    productId = p.body.product.id;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('a note splits the line, the same note merges, bad notes are 422', async () => {
    const auth = await session();
    const add = (body: Record<string, unknown>) =>
      call('POST', '/checkout/v1/cart/items', { productId, ...body }, auth);
    expect((await add({ qty: 1 })).status).toBe(200);
    const noted = await add({ qty: 1, note: ' sem  cebola ' });
    expect(noted.status).toBe(200);
    expect(lines(noted)).toEqual([
      { qty: 1, note: null },
      { qty: 1, note: 'sem cebola' },
    ]);
    const merged = await add({ qty: 2, note: 'sem cebola' });
    expect(lines(merged)).toEqual([
      { qty: 1, note: null },
      { qty: 3, note: 'sem cebola' },
    ]);
    for (const note of ['x'.repeat(141), 12, ['a']]) {
      const bad = await add({ qty: 1, note });
      expect(bad.status).toBe(422);
      expect(bad.body.error.code).toBe('INVALID_NOTES');
    }
  });

  test('PATCH edits a note; a line that becomes another folds into it', async () => {
    const auth = await session();
    const add = (note?: string) =>
      call(
        'POST',
        '/checkout/v1/cart/items',
        { productId, qty: 1, ...(note ? { note } : {}) },
        auth,
      );
    await add();
    const two = await add('sem cebola');
    const item = (note: string | null) =>
      (two.body.cart.items as Line[]).find((i) => i.note === note)!;
    const patch = (id: string, body: unknown) =>
      call('PATCH', `/checkout/v1/cart/items/${id}`, body, auth);

    const edited = await patch(item('sem cebola').id, { note: 'sem tomate' });
    expect(edited.status).toBe(200);
    expect(lines(edited)).toEqual([
      { qty: 1, note: null },
      { qty: 1, note: 'sem tomate' },
    ]);
    // qty and note together; then clearing the note makes it the plain line: one line of 4
    const both = await patch(item('sem cebola').id, { qty: 3, note: 'sem tomate' });
    expect(lines(both)).toEqual([
      { qty: 1, note: null },
      { qty: 3, note: 'sem tomate' },
    ]);
    const folded = await patch(item('sem cebola').id, { note: '' });
    expect(folded.status).toBe(200);
    expect(lines(folded)).toEqual([{ qty: 4, note: null }]);
    const survivor = (folded.body.cart.items as Line[])[0]!;
    expect(survivor.id).toBe(item(null).id);
    // qty alone still works; bounds hold
    expect(lines(await patch(survivor.id, { qty: 2 }))).toEqual([{ qty: 2, note: null }]);
    expect((await patch(survivor.id, { note: 'x'.repeat(141) })).status).toBe(422);
    expect((await patch(survivor.id, {})).status).toBe(422);
    expect((await patch('nope', { note: 'a' })).status).toBe(400);
    // a fold past 99 is refused, and nothing changes
    const big = await add('sem sal');
    const big2 = (big.body.cart.items as Line[]).find((i) => i.note === 'sem sal')!;
    await patch(big2.id, { qty: 98 });
    const over = await patch(big2.id, { note: '' });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('INVALID_QTY');
  });

  test('the order, the admin, the kitchen, a share and "pedir de novo" carry it', async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, auth);
    await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId, qty: 2, note: 'sem cebola, alergia a amendoim' },
      auth,
    );
    // a share link snapshots the bag with its notes
    const share = await call('POST', '/checkout/v1/cart/share', undefined, auth);
    expect(share.status).toBe(201);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Joana Lima', phone: shopper },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
      },
      auth,
    );
    expect(placed.status).toBe(201);
    const order = placed.body.order;
    const notes = (items: { note?: string | null }[]) => items.map((i) => i.note ?? null).sort();
    expect(notes(order.items)).toEqual([null, 'sem cebola, alergia a amendoim']);
    const stored = await sql<{ note: string | null }[]>`
      select note from order_items where order_id = ${order.id} order by sort`;
    expect(stored.map((r) => r.note)).toEqual([null, 'sem cebola, alergia a amendoim']);

    const read = await call('GET', `/checkout/v1/orders/${order.id}`, undefined, auth);
    expect(notes(read.body.order.items)).toEqual([null, 'sem cebola, alergia a amendoim']);
    const admin = await owner('GET', `/orders/${order.id}`);
    expect(notes(admin.body.order.items)).toEqual([null, 'sem cebola, alergia a amendoim']);
    const kitchen = await owner('GET', '/kitchen');
    expect(kitchen.status).toBe(200);
    const ticket = kitchen.body.tickets.find((t: { id: string }) => t.id === order.id);
    expect(notes(ticket.items)).toEqual([null, 'sem cebola, alergia a amendoim']);

    const imported = async (body: unknown) => {
      const a = await session();
      const r = await call('POST', '/checkout/v1/cart/import', body, a);
      expect(r.status).toBe(200);
      return r.body.cart.items as Line[];
    };
    expect(notes(await imported({ shareCode: share.body.code }))).toEqual([
      null,
      'sem cebola, alergia a amendoim',
    ]);
    expect(
      notes(await imported({ items: [{ productId, qty: 1, note: ' bem  passado ' }] })),
    ).toEqual(['bem passado']);
    const tooLong = await call(
      'POST',
      '/checkout/v1/cart/import',
      { items: [{ productId, qty: 1, note: 'x'.repeat(141) }] },
      await session(),
    );
    expect(tooLong.status).toBe(422);

    const again = await session();
    const reorder = await call(
      'POST',
      '/checkout/v1/cart/reorder',
      { orderId: order.id, orderToken: auth.authorization.slice(7) },
      again,
    );
    expect(reorder.status).toBe(200);
    expect(notes(reorder.body.cart.items)).toEqual([null, 'sem cebola, alergia a amendoim']);
  });

  test('LGPD: the export has the notes and the Vendedor memory; forget clears the notes', async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId, qty: 1, note: 'sem cebola' }, auth);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Bia Lima', phone: shopper },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
      },
      auth,
    );
    expect(placed.status).toBe(201);
    const thread = (
      await sql<{ id: string }[]>`
        insert into shopper_threads (tenant_id, channel, address, phone)
        values (${tenantId}, 'whatsapp', ${`55${shopper}@s.whatsapp.net`}, ${shopper}) returning id`
    )[0]!.id;
    await sql`
      insert into agent_memory (tenant_id, scope, key, value, confidence, provenance)
      values (${tenantId}, ${`shopper_thread:${thread}`}, 'nota_da_loja.entrega', ${sql.json('portão azul')}, 1, 'store'),
             (${tenantId}, ${`shopper_thread:${thread}`}, 'prefere', ${sql.json('sem cebola')}, 0.8, 'turn')`;
    const exported = await owner('GET', `/customers/${shopper}/export`);
    expect(exported.status).toBe(200);
    const items = exported.body.orders.flatMap(
      (o: { items: { note: string | null }[] }) => o.items,
    );
    expect(items.map((i: { note: string | null }) => i.note)).toContain('sem cebola');
    expect(exported.body.agentMemory.map((m: { key: string }) => m.key).sort()).toEqual([
      'nota_da_loja.entrega',
      'prefere',
    ]);

    const forgot = await owner('POST', `/customers/${shopper}/forget`, {
      confirm: shopper.slice(-4),
    });
    expect(forgot.status).toBe(200);
    const left = await sql<{ n: number }[]>`
      select count(*)::int as n from order_items i join orders o on o.id = i.order_id
      where o.tenant_id = ${tenantId} and i.note is not null`;
    expect(left[0]!.n).toBe(0);
    const cartNotes = await sql<{ n: number }[]>`
      select count(*)::int as n from cart_items where tenant_id = ${tenantId} and note <> ''
        and cart_id in (select cart_id from orders where tenant_id = ${tenantId})`;
    expect(cartNotes[0]!.n).toBe(0);
    const memory = await sql`select 1 from agent_memory where tenant_id = ${tenantId}`;
    expect(memory.length).toBe(0);
  });
});
