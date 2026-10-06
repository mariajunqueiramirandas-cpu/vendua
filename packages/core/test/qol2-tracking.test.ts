import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import {
  orderStatusOf,
  orderTrackToken,
  verifyOrderTrackToken,
  type OrderView,
} from '../src/modules/orders.ts';
import { migrate } from '../src/platform/db.ts';
import {
  configureOrderLinks,
  previewFacts,
  renderOrderMessage,
} from '../src/store-whatsapp/messages.ts';

// The link at the end of each WhatsApp order update: `vot.<orderId>.<exp>.<sig>` reads that
// order's status — never the shopper, the address, the payment or the money — and can't pay,
// card or reorder.

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';

const PII = [
  'Joana',
  '22988887777',
  'Rua das Flores',
  'Centro',
  'portão azul',
  '-22.9',
  'chave-pix',
  '00020126',
  'https://pay',
  'deixar na portaria',
  'BEMVINDO',
  'staff:',
];

const fullView: OrderView = {
  id: ORDER,
  number: 42,
  state: 'preparing',
  customer: { name: 'Joana Lima', phone: '22988887777' },
  delivery: {
    mode: 'delivery',
    address: 'Rua das Flores, 12',
    neighborhood: 'Centro',
    addressParts: { street: 'Rua das Flores', reference: 'portão azul' },
    feeCents: 500,
    etaMin: 30,
    etaMax: 45,
    promisedFrom: '2026-10-02T22:40:00.000Z',
    promisedTo: '2026-10-02T22:55:00.000Z',
    ...({ lat: -22.9, lng: -42.5 } as object),
  },
  payment: {
    provider: 'mercadopago',
    method: 'pix',
    status: 'pending',
    pix: { key: 'chave-pix', copyPaste: '00020126…' },
    redirectUrl: 'https://pay.example',
    changeForCents: 10000,
  },
  items: [
    {
      productId: null,
      slug: 'x',
      name: 'X-Burger',
      qty: 2,
      unitPriceCents: 2500,
      modifiers: [{ name: 'Bacon', priceDeltaCents: 300, qty: 1 }],
      combo: [],
      lineTotalCents: 5600,
      note: 'sem cebola',
    },
  ],
  notes: 'deixar na portaria',
  scheduledFor: null,
  subtotalCents: 5600,
  deliveryFeeCents: 500,
  discountCents: 0,
  paymentAdjustmentCents: 0,
  coupon: { code: 'BEMVINDO' },
  totalCents: 6100,
  placedAt: '2026-10-02T22:00:00.000Z',
  updatedAt: '2026-10-02T22:05:00.000Z',
  version: 3,
  timeline: [
    { at: '2026-10-02T22:00:00.000Z', from: null, to: 'placed', actor: 'customer', meta: {} },
    {
      at: '2026-10-02T22:05:00.000Z',
      from: 'placed',
      to: 'preparing',
      actor: 'staff:abc',
      meta: { by: 'Maria' },
    },
  ],
};

const STATUS_KEYS = [
  'delivery',
  'id',
  'items',
  'number',
  'placedAt',
  'scheduledFor',
  'state',
  'statusOnly',
  'storeName',
  'timeline',
  'updatedAt',
  'version',
];

/** every key path in a JSON value */
const paths = (v: unknown, at = ''): string[] =>
  v && typeof v === 'object'
    ? Object.entries(v).flatMap(([k, x]) => {
        const p = Array.isArray(v) ? `${at}[]` : at ? `${at}.${k}` : k;
        return [p, ...paths(x, p)];
      })
    : [];

const assertStatusOnly = (o: unknown) => {
  const json = JSON.stringify(o);
  for (const bit of PII) expect(json).not.toContain(bit);
  expect(Object.keys(o as object).sort()).toEqual(STATUS_KEYS);
  expect([...new Set(paths(o))].sort()).toEqual(
    [
      ...STATUS_KEYS,
      'delivery.mode',
      'delivery.promisedFrom',
      'delivery.promisedTo',
      'delivery.etaMin',
      'delivery.etaMax',
      'timeline[]',
      'timeline[].at',
      'timeline[].to',
      'items[]',
      'items[].name',
      'items[].qty',
      'items[].modifiers',
      'items[].combo',
      'items[].note',
      ...((o as { items: { modifiers: unknown[] }[] }).items.some((i) => i.modifiers.length)
        ? ['items[].modifiers[]', 'items[].modifiers[].name', 'items[].modifiers[].qty']
        : []),
    ].sort(),
  );
};

describe('order tracking token', () => {
  const placed = new Date('2026-10-02T22:00:00Z');
  const now = new Date('2026-10-03T10:00:00Z');

  test('signs one order of one store for 30 days', () => {
    const t = orderTrackToken('s', T1, ORDER, placed);
    expect(t).toMatch(/^vot\.[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyOrderTrackToken(t, 's', T1, now)).toBe(ORDER);
    // another store, another secret
    expect(verifyOrderTrackToken(t, 's', T2, now)).toBeNull();
    expect(verifyOrderTrackToken(t, 'other', T1, now)).toBeNull();
    // 30 days after the order it's gone
    const later = new Date(placed.getTime() + 30 * 86_400_000 + 1000);
    expect(verifyOrderTrackToken(t, 's', T1, later)).toBeNull();
    expect(verifyOrderTrackToken(t, 's', T1, new Date(placed.getTime() + 29 * 86_400_000))).toBe(
      ORDER,
    );
  });

  test('a tampered or malformed token is refused', () => {
    const t = orderTrackToken('s', T1, ORDER, placed);
    const [p, id, exp, sig] = t.split('.') as [string, string, string, string];
    const flip = (s: string) => s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
    expect(verifyOrderTrackToken([p, id, exp, flip(sig)].join('.'), 's', T1, now)).toBeNull();
    expect(verifyOrderTrackToken([p, T2, exp, sig].join('.'), 's', T1, now)).toBeNull();
    expect(
      verifyOrderTrackToken([p, id, String(Number(exp) + 1), sig].join('.'), 's', T1, now),
    ).toBeNull();
    expect(verifyOrderTrackToken(['vst', id, exp, sig].join('.'), 's', T1, now)).toBeNull();
    expect(verifyOrderTrackToken(`${t}.x`, 's', T1, now)).toBeNull();
    expect(verifyOrderTrackToken('vot.x.1.y', 's', T1, now)).toBeNull();
    expect(verifyOrderTrackToken('', 's', T1, now)).toBeNull();
    // an expiry no fresh token could have (a future order) is refused even when signed
    const future = orderTrackToken('s', T1, ORDER, new Date(now.getTime() + 86_400_000));
    expect(verifyOrderTrackToken(future, 's', T1, now)).toBeNull();
  });

  test('the status-only projection keeps only the whitelist', () => {
    const s = orderStatusOf(fullView, 'Doce Lar');
    assertStatusOnly(s);
    expect(s).toMatchObject({
      statusOnly: true,
      number: 42,
      state: 'preparing',
      storeName: 'Doce Lar',
      delivery: { mode: 'delivery', etaMin: 30, etaMax: 45 },
      items: [
        { name: 'X-Burger', qty: 2, modifiers: [{ name: 'Bacon', qty: 1 }], note: 'sem cebola' },
      ],
      timeline: [{ to: 'placed' }, { to: 'preparing' }],
    });
  });

  test('every order message ends with the link when there is one', () => {
    const facts = {
      ...previewFacts('Doce Lar', 'America/Sao_Paulo'),
      trackUrl: 'https://x.test/pedido/1?t=vot.a',
    };
    expect(renderOrderMessage('placed', facts)).toEndWith(
      '\n\nAcompanhe o pedido: https://x.test/pedido/1?t=vot.a',
    );
    expect(renderOrderMessage('delivered', facts)).toEndWith(
      '\n\nVer o pedido: https://x.test/pedido/1?t=vot.a',
    );
    // a step with nothing to say stays silent; no link, no line
    expect(renderOrderMessage('ready', facts)).toBeNull();
    expect(renderOrderMessage('placed', { ...facts, trackUrl: null })).not.toContain('pedido:');
    expect(previewFacts('Doce Lar', 'America/Sao_Paulo', 'https://loja.test').trackUrl).toBe(
      'https://loja.test/pedido/128',
    );
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('order tracking (db)', () => {
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
  const slug = `tk-${nonce}`;
  const host = `${slug}.localhost`;
  const publicHost = `pedidos-${nonce}.com.br`;
  const ownerPhone = `217${String(Date.now()).slice(-8)}`;
  let tenantId = '';
  let tenant2 = '';
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
  let order: { id: string; number: number };
  let session = '';
  let link = '';
  let vot = '';
  const track = (token = vot) => ({ host, authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    configureOrderLinks({
      storeDomain: 'vendua.test',
      token: (t, o, at) => orderTrackToken('s', t, o, at),
    });
    const mk = async (s: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id`
      )[0]!.id;
    tenantId = await mk(slug);
    tenant2 = await mk(`${slug}-b`);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`insert into domains (host, tenant_id, is_primary) values (${publicHost}, ${tenantId}, true)`;
    await sql`insert into domains (host, tenant_id) values (${`${slug}-b.localhost`}, ${tenant2})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner')`;
    await sql`insert into store_whatsapp (tenant_id, wanted, state) values (${tenantId}, true, 'open')`;
    owner = await signIn(ownerPhone);
    const catId = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    const p = await owner('POST', '/products', {
      name: 'Pudim de Leite',
      categoryId: catId,
      priceCents: 1250,
    });
    productId = p.body.product.id;

    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    session = s.body.sessionToken;
    const auth = { host, authorization: `Bearer ${session}` };
    await call('POST', '/checkout/v1/cart/items', { productId, qty: 2, note: 'sem calda' }, auth);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
        notes: 'deixar na portaria',
      },
      auth,
    );
    expect(placed.status).toBe(201);
    order = placed.body.order;
    const msg = (
      await sql<{ body: string }[]>`
        select body from store_wa_messages where order_id = ${order.id} and event = 'placed'`
    )[0]!;
    link = /https:\/\/\S+/.exec(msg.body)![0];
    vot = new URL(link).searchParams.get('t')!;
  });

  afterAll(async () => {
    configureOrderLinks(null);
    if (tenantId) await sql`delete from tenants where id in (${tenantId}, ${tenant2})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test("the message links the store's own address to that order", () => {
    expect(link.startsWith(`https://${publicHost}/pedido/${order.id}?t=vot.`)).toBe(true);
    expect(verifyOrderTrackToken(vot, 's', tenantId)).toBe(order.id);
  });

  test('the order read, long poll and stream answer the link with the status only', async () => {
    const read = await call('GET', `/checkout/v1/orders/${order.id}`, undefined, track());
    expect(read.status).toBe(200);
    assertStatusOnly(read.body.order);
    expect(read.body.order).toMatchObject({
      id: order.id,
      number: order.number,
      state: 'placed',
      storeName: `Loja ${slug}`,
      items: [{ name: 'Pudim de Leite', qty: 2, note: 'sem calda' }],
    });
    // the cart session still reads it all
    const full = await call('GET', `/checkout/v1/orders/${order.id}`, undefined, {
      host,
      authorization: `Bearer ${session}`,
    });
    expect(full.body.order.customer.name).toBe('Joana Lima');

    const poll = await call(
      'GET',
      `/checkout/v1/orders/${order.id}?since=0&wait=1`,
      undefined,
      track(),
    );
    expect(poll.status).toBe(200);
    expect(poll.body.changed).toBe(true);
    assertStatusOnly(poll.body.order);

    const ctl = new AbortController();
    const res = await app.request(`http://${host}/checkout/v1/orders/${order.id}/events`, {
      headers: track(),
      signal: ctl.signal,
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    let buf = '';
    while (!buf.includes('\n\n')) buf += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    await reader.cancel().catch(() => {});
    const data = buf.split('\n').find((l) => l.startsWith('data:'))!;
    assertStatusOnly(JSON.parse(data.slice(5)));
  });

  test('the link is refused for another order, another store, once tampered', async () => {
    const other = (await sql<{ id: string }[]>`select gen_random_uuid() as id`)[0]!.id;
    expect((await call('GET', `/checkout/v1/orders/${other}`, undefined, track())).status).toBe(
      404,
    );
    const forged = orderTrackToken('s', tenant2, order.id, new Date());
    expect(
      (await call('GET', `/checkout/v1/orders/${order.id}`, undefined, track(forged))).status,
    ).toBe(404);
    const bad = `${vot.slice(0, -2)}xx`;
    const r = await call('GET', `/checkout/v1/orders/${order.id}`, undefined, track(bad));
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('ORDER_NOT_FOUND');
    // from the other store's host, the same link reads nothing
    const cross = await call('GET', `/checkout/v1/orders/${order.id}`, undefined, {
      host: `${slug}-b.localhost`,
      authorization: `Bearer ${vot}`,
    });
    expect(cross.status).toBe(404);
  });

  test('pay, card and reorder refuse it', async () => {
    const pay = await call('POST', `/checkout/v1/orders/${order.id}/pay`, {}, track());
    expect(pay.status).toBe(401);
    expect(pay.body.error.code).toBe('SESSION_REQUIRED');
    const card = await call('POST', `/checkout/v1/orders/${order.id}/card`, {}, track());
    expect(card.status).toBe(401);
    const fresh = await call('POST', '/checkout/v1/session', undefined, { host });
    const reorder = await call(
      'POST',
      '/checkout/v1/cart/reorder',
      { orderId: order.id, orderToken: vot },
      { host, authorization: `Bearer ${fresh.body.sessionToken}` },
    );
    expect(reorder.status).toBe(404);
    const asSession = await call(
      'POST',
      '/checkout/v1/cart/reorder',
      { orderId: order.id },
      track(),
    );
    expect(asSession.status).toBe(401);
  });

  test("the admin's previews show a sample link on the store's address", async () => {
    const wa = await owner('GET', '/whatsapp');
    expect(wa.status).toBe(200);
    expect(wa.body.previews.placed).toEndWith(
      `Acompanhe o pedido: https://${publicHost}/pedido/128`,
    );
  });
});
