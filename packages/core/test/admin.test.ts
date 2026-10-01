import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { parseMenuPaste, parseMoney } from '../src/admin/routes-catalog.ts';
import { sweepAdmin } from '../src/admin/workers.ts';
import { ingestInbound } from '../src/agent/inbound.ts';
import { sessionAlive } from '../src/admin/auth.ts';
import { encryptPayload } from '../src/admin/webpush.ts';
import { activeCarts } from '../src/modules/presence.ts';
import { migrate } from '../src/platform/db.ts';

describe('admin parsing', () => {
  test('forgiving money', () => {
    expect(parseMoney('12')).toBe(1200);
    expect(parseMoney('12,5')).toBe(1250);
    expect(parseMoney('12.50')).toBe(1250);
    expect(parseMoney('R$ 1.234,56')).toBe(123456);
    expect(parseMoney('1.234')).toBe(123400);
    expect(parseMoney('doze')).toBeNull();
  });

  test('a WhatsApp menu paste becomes products', () => {
    expect(
      parseMenuPaste(
        '*Cardápio*\n• Pudim de leite - R$ 12,50\n2) Brigadeiro gourmet: 4\nSacolé de coco 5,00 reais\n\nobs: sem lactose',
      ),
    ).toEqual([
      { name: 'Pudim de leite', priceCents: 1250 },
      { name: 'Brigadeiro gourmet', priceCents: 400 },
      { name: 'Sacolé de coco', priceCents: 500 },
    ]);
  });

  test('web push payload is RFC 8291 shaped', async () => {
    const ua = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    const pub = Buffer.from(await crypto.subtle.exportKey('raw', ua.publicKey)).toString(
      'base64url',
    );
    const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
    const body = await encryptPayload(new TextEncoder().encode('{"a":1}'), pub, auth);
    // salt 16 · rs 4 · idlen 1 · keyid 65 · ciphertext (7 + delimiter + 16 tag)
    expect(body.length).toBe(16 + 4 + 1 + 65 + 7 + 1 + 16);
    expect(body[20]).toBe(65);
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('merchant admin (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  // TEST_APP_DATABASE_URL=postgres://vendua_app:… runs the API under RLS, as prod does
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
  const slug = `ad-${nonce}`;
  const slug2 = `ad2-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `219${String(Date.now()).slice(-8)}`;
  const attendantPhone = `219${String(Date.now() + 7).slice(-8)}`;
  let tenantId = '';
  let tenant2 = '';
  let idem = 0;
  let catId = '';

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
      ...(body !== undefined
        ? {
            body:
              typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
          }
        : {}),
    });
    const ct = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: (ct.includes('json') ? await res.json() : await res.text()) as any,
      cookie: res.headers.get('set-cookie'),
      headers: res.headers,
    };
  };

  const signIn = async (phone: string, storeId?: string) => {
    const start = await call('POST', '/admin/v1/auth/otp/start', { phone });
    expect(start.status).toBe(200);
    const r = await call('POST', '/admin/v1/auth/otp/verify', { phone, code: codes.get(phone) });
    expect(r.status).toBe(200);
    let cookie = r.cookie;
    if (!r.body.signedIn) {
      const pick = await call('POST', '/admin/v1/auth/select', {
        pickerToken: r.body.pickerToken,
        storeId,
      });
      expect(pick.status).toBe(200);
      cookie = pick.cookie;
    }
    const value = /vendua_admin=([^;]+)/.exec(cookie ?? '')![1]!;
    const fn = (method: string, path: string, body?: unknown, h: Record<string, string> = {}) =>
      call(method, `/admin/v1${path}`, body, { cookie: `vendua_admin=${value}`, ...h });
    return Object.assign(fn, { cookie: `vendua_admin=${value}` });
  };

  let owner: Awaited<ReturnType<typeof signIn>>;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const mk = async (s: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${s}, ${'Loja ' + s}) returning id`
      )[0]!.id;
    tenantId = await mk(slug);
    tenant2 = await mk(slug2);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema')
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 500, 30, 50)
    `;
    catId = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Maria Souza', ${ownerPhone}, 'owner')`;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenant2}, 'Maria Souza', ${ownerPhone}, 'owner')`;
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id in (${tenantId}, ${tenant2})`;
    if (appSql !== sql) await appSql.end();
    await sql.end();
  });

  test('sign-in: unknown phones get no code, wrong codes fail, multi-store picks', async () => {
    const unknown = await call('POST', '/admin/v1/auth/otp/start', { phone: '(11) 90000-0001' });
    expect(unknown.status).toBe(200);
    expect(codes.has('11900000001')).toBe(false);
    expect((await call('POST', '/admin/v1/auth/otp/start', { phone: '123' })).body.error.code).toBe(
      'INVALID_PHONE',
    );

    await call('POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const bad = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: '000000' === codes.get(ownerPhone) ? '111111' : '000000',
    });
    expect(bad.body.error.code).toBe('INVALID_CODE');
    const ok = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    expect(ok.body.signedIn).toBe(false);
    expect(ok.body.stores.map((s: any) => s.id).sort()).toEqual([tenantId, tenant2].sort());
    // a used code can't be replayed
    const replay = await call('POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    expect(replay.body.error.code).toBe('INVALID_CODE');
    expect(
      (await call('POST', '/admin/v1/auth/select', { pickerToken: 'x.1.y', storeId: tenantId }))
        .status,
    ).toBe(401);

    owner = await signIn(ownerPhone, tenantId);
    const me = await owner('GET', '/session');
    expect(me.status).toBe(200);
    expect(me.body.store.id).toBe(tenantId);
    expect(me.body.store.url).toBe(`https://${slug}.vendua.test`);
    expect(me.body.user.role).toBe('owner');
    expect(me.body.stores).toHaveLength(2);
  });

  test('the gate: no cookie 401, forged cookie 401, CSRF header required', async () => {
    expect((await call('GET', '/admin/v1/home')).status).toBe(401);
    const forged = `vendua_admin=${tenantId}.${crypto.randomUUID()}.nope`;
    expect((await call('GET', '/admin/v1/home', undefined, { cookie: forged })).status).toBe(401);
    const noCsrf = await owner('POST', '/store/resume', {}, { 'x-vendua-admin': '' });
    expect(noCsrf.status).toBe(403);
    const cross = await owner('POST', '/store/resume', {}, { origin: 'https://evil.example' });
    expect(cross.status).toBe(403);
    // a cookie names its tenant: swapping the tenant id doesn't open another store
    const me = await owner('GET', '/session');
    expect(me.body.store.id).toBe(tenantId);
  });

  test('own domain: only VENDUA_ADMIN_HOST serves /admin; store hosts redirect or 404', async () => {
    const split = createApp({
      sql: appSql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
      cepLookup: async () => null,
      adminHost: 'Painel.Example.com',
    });
    const on = await split.request('http://painel.example.com/admin/v1/home');
    expect(on.status).toBe(401);
    const api = await split.request(`http://${host}/admin/v1/home`);
    expect(api.status).toBe(404);
    const page = await split.request(`http://${host}/admin/pedidos?x=1`);
    expect(page.status).toBe(301);
    expect(page.headers.get('location')).toBe('https://painel.example.com/admin/pedidos?x=1');
    const post = await split.request(`http://${host}/admin/v1/auth/otp/start`, {
      method: 'POST',
      body: '{}',
    });
    expect(post.status).toBe(404);
  });

  test('Loja: pause/resume reaches the storefront, hours validate, zones CRUD', async () => {
    const paused = await owner('POST', '/store/pause', { for: '1h', message: 'Voltamos já!' });
    expect(paused.status).toBe(200);
    expect(paused.body.status.status).toBe('paused');
    const pub = await call('GET', '/storefront/v1/surfaces', undefined, { host });
    expect(pub.body.store.status).toBe('paused');
    expect(pub.body.notices[0].body).toBe('Voltamos já!');
    expect((await owner('POST', '/store/resume', {})).body.status.status).toBe('open');

    const bad = await owner('PATCH', '/store', {
      hours: [{ days: [1], open: '25:00', close: '10:00' }],
    });
    expect(bad.status).toBe(422);
    const ok = await owner('PATCH', '/store', {
      profile: { name: 'Doces da Maria', whatsapp: '(22) 99999-1234' },
      hours: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }],
      specialDays: [{ date: '2031-12-25', closed: true, label: 'Natal' }],
      operations: { prepTimeMinutes: 20, acceptTargetMinutes: 4 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.profile.name).toBe('Doces da Maria');
    expect(ok.body.profile.whatsapp).toBe('5522999991234');
    expect(ok.body.specialDays).toHaveLength(1);
    expect(
      (
        await owner('PATCH', '/store', {
          operations: { pickupEnabled: false, deliveryEnabled: false },
        })
      ).body.error.code,
    ).toBe('BAD_REQUEST');

    const z = await owner('POST', '/zones', {
      name: 'Bairros do sul',
      neighborhoods: ['Bacaxá', 'Porto'],
      feeCents: 800,
      etaMin: 40,
      etaMax: 60,
    });
    expect(z.status).toBe(201);
    const zone = z.body.zones.find((x: any) => x.name === 'Bairros do sul');
    expect(
      (await owner('PATCH', `/zones/${zone.id}`, { feeCents: 900 })).body.zones.find(
        (x: any) => x.id === zone.id,
      ).feeCents,
    ).toBe(900);
    expect((await owner('DELETE', `/zones/${zone.id}`)).status).toBe(200);
    expect((await owner('PATCH', '/zones/not-a-uuid', { feeCents: 1 })).status).toBe(400);
  });

  test('Loja: polygon zones validate, reach the storefront and resolve quotes', async () => {
    const square = [
      [-22.94, -42.52],
      [-22.94, -42.5],
      [-22.92, -42.5],
      [-22.92, -42.52],
    ];
    const base = { name: 'Mapa', kind: 'polygon', feeCents: 650, etaMin: 20, etaMax: 45 };
    const rejects = async (body: Record<string, unknown>) => {
      const r = await owner('POST', '/zones', body);
      expect(r.status).toBe(422);
      expect(r.body.error.details?.field).toBe('polygon');
    };
    await rejects(base);
    await rejects({ ...base, polygon: square.slice(0, 2) });
    await rejects({ ...base, polygon: [...square.slice(0, 2), square[0]] });
    await rejects({
      ...base,
      polygon: [
        [0, 0],
        [0, 1],
        ['1', 1],
      ],
    });
    await rejects({
      ...base,
      polygon: [
        [0, 0],
        [0, 1],
        [95, 1],
      ],
    });
    await rejects({
      ...base,
      polygon: [
        [0, 0],
        [0, 1],
        [1, 1, 1],
      ],
    });
    await rejects({ ...base, polygon: 'abc' });
    await rejects({
      ...base,
      polygon: Array.from({ length: 201 }, (_, i) => [
        Math.sin((2 * Math.PI * i) / 201),
        Math.cos((2 * Math.PI * i) / 201),
      ]),
    });
    await rejects({ ...base, kind: 'radius', maxDistanceKm: 3, polygon: square });
    await rejects({ ...base, kind: undefined, neighborhoods: ['Centro'], polygon: square });

    const z = await owner('POST', '/zones', { ...base, polygon: [...square, square[0]] });
    expect(z.status).toBe(201);
    const zone = z.body.zones.find((x: any) => x.name === 'Mapa');
    expect(zone).toMatchObject({ kind: 'polygon', polygon: square, neighborhoods: [] });

    const pub = await call('GET', '/storefront/v1/zones', undefined, { host });
    const sz = pub.body.zones.find((x: any) => x.id === zone.id);
    expect(sz).toMatchObject({ kind: 'polygon', polygon: square, feeCents: 650 });
    expect(pub.body.zones.find((x: any) => x.kind !== 'polygon').polygon).toBeNull();

    const inside = await call('POST', '/checkout/v1/quote', { lat: -22.93, lng: -42.51 }, { host });
    expect(inside.body).toMatchObject({
      eligible: true,
      zoneId: zone.id,
      zoneKind: 'polygon',
      feeCents: 650,
      distanceKm: null,
    });
    const outside = await call('POST', '/checkout/v1/quote', { lat: -22.9, lng: -42.51 }, { host });
    expect(outside.body).toEqual({ eligible: false, reason: 'OUT_OF_ZONE' });

    const moved = square.map(([lat, lng]) => [lat! + 0.03, lng!]);
    const p = await owner('PATCH', `/zones/${zone.id}`, { polygon: moved });
    expect(p.body.zones.find((x: any) => x.id === zone.id).polygon).toEqual(moved);
    expect((await owner('PATCH', `/zones/${zone.id}`, { polygon: [[1, 1]] })).status).toBe(422);
    const other = pub.body.zones.find((x: any) => x.kind !== 'polygon');
    const mismatch = await owner('PATCH', `/zones/${other.id}`, { kind: 'polygon' });
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.details.field).toBe('polygon');
    // leaving the polygon kind drops the ring
    const back = await owner('PATCH', `/zones/${zone.id}`, {
      kind: 'neighborhood',
      neighborhoods: ['Centro'],
    });
    expect(back.body.zones.find((x: any) => x.id === zone.id)).toMatchObject({
      kind: 'neighborhood',
      polygon: null,
    });
    expect((await owner('DELETE', `/zones/${zone.id}`)).status).toBe(200);
  });

  let productId = '';
  test('Cardápio: create, edit, options, sold out today, bulk, paste import', async () => {
    const p = await owner('POST', '/products', {
      name: 'Pudim de Leite',
      categoryId: catId,
      priceCents: 2500,
    });
    expect(p.status).toBe(201);
    productId = p.body.product.id;
    expect(p.body.product.slug).toBe('pudim-de-leite');
    const p2 = await owner('POST', '/products', {
      name: 'Pudim de leite',
      categoryId: catId,
      priceCents: 2000,
    });
    expect(p2.body.product.slug).toBe('pudim-de-leite-2');

    const opt = await owner('PUT', `/products/${productId}/options`, {
      groups: [
        {
          name: 'Calda',
          minSelect: 1,
          maxSelect: 1,
          options: [{ name: 'Caramelo' }, { name: 'Doce de leite', priceDeltaCents: 300 }],
        },
      ],
    });
    expect(opt.status).toBe(200);
    const group = opt.body.product.groups[0];
    expect(group.required).toBe(true);
    // re-sending ids keeps them (carts holding a modifier id keep resolving)
    const again = await owner('PUT', `/products/${productId}/options`, {
      groups: [
        { ...group, options: group.options.map((o: any) => ({ ...o, name: o.name + '!' })) },
      ],
    });
    expect(again.body.product.groups[0].options.map((o: any) => o.id)).toEqual(
      group.options.map((o: any) => o.id),
    );
    // a pizzeria's long list: kept ids and new options saved together, in the order sent
    const kept = again.body.product.groups[0];
    const long = await owner('PUT', `/products/${productId}/options`, {
      groups: [
        {
          ...kept,
          maxSelect: 2,
          options: [
            ...Array.from({ length: 98 }, (_, i) => ({
              name: `Sabor ${i}`,
              priceDeltaCents: i * 10,
              ...(i % 2 ? { description: 'com borda' } : {}),
            })),
            ...[...kept.options].reverse().map((o: any) => ({ ...o, name: `${o.name}?` })),
          ],
        },
      ],
    });
    expect(long.status).toBe(200);
    const longOpts = long.body.product.groups[0].options;
    expect(longOpts).toHaveLength(100);
    expect(longOpts.slice(98).map((o: any) => o.id)).toEqual(
      [...kept.options].reverse().map((o: any) => o.id),
    );
    expect(longOpts[5]).toMatchObject({
      name: 'Sabor 5',
      priceDeltaCents: 50,
      description: 'com borda',
    });
    expect(longOpts[98].name).toBe(`${kept.options[1].name}?`);
    const twice = await owner('PUT', `/products/${productId}/options`, {
      groups: [{ ...kept, options: [kept.options[0], { ...kept.options[0], name: 'Outra' }] }],
    });
    expect(twice.status).toBe(422);
    const tooMany = await owner('PUT', `/products/${productId}/options`, {
      groups: [
        { name: 'Sabores', options: Array.from({ length: 101 }, (_, i) => ({ name: `o${i}` })) },
      ],
    });
    expect(tooMany.status).toBe(422);
    expect((await owner('PUT', `/products/${productId}/options`, { groups: [kept] })).status).toBe(
      200,
    );

    const out = await owner('PATCH', `/products/${productId}`, { availability: 'sold_out_today' });
    expect(out.body.product.status).toBe('sold_out');
    expect(out.body.product.soldOutUntil).not.toBeNull();
    // the minute sweep brings it back once the day ends
    await sql`update products set sold_out_until = now() - interval '1 minute' where id = ${productId}`;
    await sweepAdmin(appSql);
    expect((await owner('GET', `/products/${productId}`)).body.product.status).toBe('active');

    const bulk = await owner('POST', '/products/bulk', {
      ids: [productId, p2.body.product.id],
      action: 'price_percent',
      percent: 10,
    });
    expect(bulk.body.updated).toBe(2);
    expect((await owner('GET', `/products/${productId}`)).body.product.priceCents).toBe(2750);

    const preview = await owner('POST', '/products/import/preview', {
      text: 'Sacolé de uva - 4,50\nBolo de pote 12',
    });
    expect(preview.body.items).toHaveLength(2);
    const imp = await owner('POST', '/products/import', {
      text: 'Sacolé de uva - 4,50\nBolo de pote 12',
      categoryId: catId,
    });
    expect(imp.body.created).toBe(2);
    const catalog = await owner('GET', '/catalog');
    expect(catalog.body.categories[0].products.length).toBe(4);

    // a category with live products can't be deleted
    expect((await owner('DELETE', `/categories/${catId}`)).body.error.code).toBe(
      'CATEGORY_NOT_EMPTY',
    );
    expect((await owner('GET', `/products/${crypto.randomUUID()}`)).status).toBe(404);
  });

  let orderId = '';
  test('Pedidos: a checkout rings the board; accept with prep time; mark Pix paid', async () => {
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    const modifiers = (await owner('GET', `/products/${productId}`)).body.product.groups[0].options;
    expect(
      (
        await call(
          'POST',
          '/checkout/v1/cart/items',
          { productId, qty: 2, modifierIds: [modifiers[0].id] },
          auth,
        )
      ).status,
    ).toBe(200);
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Joana Lima', phone: '(22) 98888-7777' },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
      },
      auth,
    );
    expect(placed.status).toBe(201);
    orderId = placed.body.order.id;

    const board = await owner('GET', '/orders/board');
    expect(board.body.orders.map((o: any) => o.id)).toContain(orderId);
    expect(board.body.acceptTargetMinutes).toBe(4);
    const home = await owner('GET', '/home');
    expect(home.body.waiting.n).toBe(1);
    expect(home.body.attention[0].kind).toBe('orders_waiting');
    expect(home.body.today.orders).toBe(1);

    expect(
      (await owner('POST', `/orders/${orderId}/transition`, { to: 'cancelled' })).body.error.code,
    ).toBe('REASON_REQUIRED');
    const acc = await owner('POST', `/orders/${orderId}/transition`, {
      to: 'confirmed',
      prepMinutes: 15,
    });
    expect(acc.status).toBe(200);
    expect(acc.body.order.state).toBe('confirmed');
    const promised = Date.parse(acc.body.order.delivery.promisedTo);
    expect(Math.abs(promised - (Date.now() + 15 * 60_000))).toBeLessThan(60_000);
    expect(
      (await owner('POST', `/orders/${orderId}/transition`, { to: 'delivered' })).body.error.code,
    ).toBe('INVALID_ORDER_TRANSITION');

    const paid = await owner('POST', `/orders/${orderId}/payment`, { status: 'paid' });
    expect(paid.body.order.payment.status).toBe('paid');
    for (const to of ['preparing', 'ready', 'delivered'])
      expect((await owner('POST', `/orders/${orderId}/transition`, { to })).status).toBe(200);

    const hist = await owner('GET', '/orders?q=joana');
    expect(hist.body.orders[0].id).toBe(orderId);
    expect((await owner('GET', '/orders?from=bad')).status).toBe(400);
    const search = await owner('GET', '/search?q=joana');
    expect(search.body.orders).toHaveLength(1);
    expect(search.body.customers[0].phone).toBe('22988887777');
  });

  test('pagamentos: turning a method off stops it at checkout', async () => {
    expect((await owner('PATCH', '/payments', { methods: [] })).status).toBe(422);
    const r = await owner('PATCH', '/payments', {
      methods: ['cash'],
      pix: {
        keyType: 'email',
        key: 'loja@exemplo.com',
        beneficiary: 'Doces da Maria',
        city: 'Saquarema',
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.pix.sample).toContain('br.gov.bcb.pix');
    const s = await call('POST', '/checkout/v1/session', undefined, { host });
    const auth = { host, authorization: `Bearer ${s.body.sessionToken}` };
    await call(
      'POST',
      '/checkout/v1/cart/items',
      {
        productId,
        qty: 1,
        modifierIds: [
          (await owner('GET', `/products/${productId}`)).body.product.groups[0].options[0].id,
        ],
      },
      auth,
    );
    const no = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Leo', phone: '22977776666' },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
      },
      auth,
    );
    expect(no.body.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
    await owner('PATCH', '/payments', { methods: ['pix', 'card_on_delivery', 'cash'] });
  });

  test('Clientes, Relatórios, Marketing', async () => {
    const list = await owner('GET', '/customers');
    expect(list.body.customers[0].name).toBe('Joana Lima');
    expect(list.body.customers[0].orders).toBe(1);
    const one = await owner('GET', '/customers/22988887777');
    expect(one.body.orders).toHaveLength(1);
    expect(one.body.favorites[0].qty).toBe(2);

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const rep = await owner('GET', `/reports?from=${from}&to=${today}`);
    expect(rep.status).toBe(200);
    expect(rep.body.series).toHaveLength(7);
    expect(rep.body.current.orders).toBeGreaterThanOrEqual(1);
    expect(rep.body.products[0].name).toBe('Pudim de Leite');
    expect((await owner('GET', '/reports?from=2020-01-01&to=2026-01-01')).status).toBe(400);
    const csv = await owner('GET', `/reports/orders.csv?from=${from}&to=${today}`);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.body).toContain('Joana Lima');

    const cp = await owner('POST', '/coupons', { code: 'bemvindo', kind: 'percent', value: 10 });
    expect(cp.status).toBe(201);
    expect(cp.body.coupons[0].code).toBe('BEMVINDO');
    expect(
      (await owner('POST', '/coupons', { code: 'BEMVINDO', kind: 'fixed', value: 100 })).body.error
        .code,
    ).toBe('COUPON_EXISTS');
    const loy = await owner('PUT', '/loyalty', {
      program: {
        stampsRequired: 5,
        minOrderCents: 0,
        reward: { kind: 'fixed', value: 1000, label: 'R$ 10 off' },
      },
    });
    expect(loy.body.program.stampsRequired).toBe(5);
    const ann = await owner('PUT', '/announcement', {
      announcement: { title: 'Frete grátis hoje' },
    });
    expect(ann.status).toBe(200);
    const mk = await owner('GET', '/marketing');
    expect(mk.body.announcement.title).toBe('Frete grátis hoje');
    const share = await owner('GET', '/share');
    expect(share.body.products[0].url).toStartWith(`https://${slug}.vendua.test/produto/`);
  });

  test('store links follow the domain the store is served on, never its slug', async () => {
    // the store lives on a host unrelated to its slug (pudim.vendua.com.br for quero-pudim)
    const real = `loja-${nonce}.vendua.test`;
    await sql`insert into domains (host, tenant_id) values (${`zz-${nonce}.example`}, ${tenantId})`;
    await sql`insert into domains (host, tenant_id, is_primary) values (${real}, ${tenantId}, true)`;
    try {
      const want = `https://${real}`;
      expect((await owner('GET', '/session')).body.store.url).toBe(want);
      expect((await owner('GET', '/store')).body.url).toBe(want);
      expect((await owner('GET', '/appearance')).body.url).toBe(want);
      expect((await owner('GET', '/account')).body.address).toBe(want);
      const share = await owner('GET', '/share');
      expect(share.body.products[0].url).toStartWith(`${want}/produto/`);
      // a second primary for the same store is refused by the schema
      const dup =
        await sql`insert into domains (host, tenant_id, is_primary) values (${`x-${nonce}.vendua.test`}, ${tenantId}, true)`.then(
          () => null,
          (e: { code?: string }) => e.code,
        );
      expect(dup).toBe('23505');
    } finally {
      await sql`delete from domains where tenant_id = ${tenantId} and host <> ${host}`;
    }
  });

  test('the slug subdomain fallback always resolves to its store', async () => {
    const res = await app.request(`http://${slug}.vendua.test/storefront/v1/store`, {
      headers: { host: `${slug}.vendua.test` },
    });
    expect(res.status).toBe(200);
    const miss = await app.request(`http://nope-${nonce}.vendua.test/storefront/v1/store`, {
      headers: { host: `nope-${nonce}.vendua.test` },
    });
    expect(miss.status).toBe(404);
  });

  test('Equipe: roles gate the API, the last owner stays, the log records it all', async () => {
    const add = await owner('POST', '/team', {
      name: 'Caio',
      phone: attendantPhone,
      role: 'attendant',
    });
    expect(add.status).toBe(201);
    const caio = await signIn(attendantPhone);
    expect((await caio('GET', '/orders/board')).status).toBe(200);
    expect((await caio('GET', '/catalog')).status).toBe(403);
    expect((await caio('PATCH', '/payments', { methods: ['cash'] })).status).toBe(403);
    expect((await caio('POST', '/store/pause', { for: '15m' })).status).toBe(200);
    await caio('POST', '/store/resume', {});
    const search = await caio('GET', '/search?q=pudim');
    expect(search.body.products).toEqual([]);

    const team = await owner('GET', '/team');
    const me = team.body.members.find((m: any) => m.role === 'owner');
    expect((await owner('PATCH', `/team/${me.id}`, { role: 'manager' })).body.error.code).toBe(
      'LAST_OWNER',
    );
    const member = team.body.members.find((m: any) => m.name === 'Caio');
    expect((await owner('DELETE', `/team/${member.id}`)).status).toBe(200);
    // removal ends every session now
    expect((await caio('GET', '/orders/board')).status).toBe(401);

    const log = await owner('GET', '/activity');
    const summaries = log.body.entries.map((e: any) => e.summary);
    expect(summaries.some((s: string) => s.includes('removeu o acesso de Caio'))).toBe(true);
    expect(summaries.some((s: string) => s.startsWith('pausou a loja'))).toBe(true);
    expect(log.body.entries.find((e: any) => e.summary.startsWith('pausou')).actor).toBe('Caio');
  });

  test('media: upload sniffs the bytes, serves immutable from /v1/media', async () => {
    const png = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    const res = await owner('POST', '/media?w=1&h=1&dominant=%23aabbcc', png, {
      'content-type': 'image/png',
    });
    expect(res.status).toBe(201);
    // uploads are re-encoded server-side (EXIF gone), so a PNG comes back as WebP
    expect(res.body.url).toMatch(/^\/v1\/media\/.+\.webp$/);
    const lie = await owner('POST', '/media', png, { 'content-type': 'image/jpeg' });
    expect(lie.status).toBe(415);
    const got = await app.request(`http://core.localhost${res.body.url}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toContain('immutable');
    expect((await app.request(`http://core.localhost/v1/media/${tenantId}/nope.png`)).status).toBe(
      404,
    );
    const withPhoto = await owner('PUT', `/products/${productId}/media`, {
      media: [{ url: res.body.url }],
    });
    expect(withPhoto.body.product.imageUrl).toBe(res.body.url);
    expect(withPhoto.body.product.dominant).toBe('#aabbcc');
  });

  test('Aparência: tokens validate contrast and go live without a rebuild on Kernel 1.10', async () => {
    const tokens = {
      color: {
        bg: '#ffffff',
        surface: '#ffffff',
        text: '#111111',
        muted: '#555555',
        accent: '#123c32',
        onAccent: '#ffffff',
        danger: '#b3261e',
        success: '#1f7a4d',
      },
      font: { display: 'Georgia', body: 'system-ui' },
      radius: { sm: '4px', md: '8px', lg: '16px' },
      space: { scale: 1 },
      motion: { duration: '200ms', easing: 'ease' },
    };
    const bad = await owner('PUT', '/appearance/tokens', {
      tokens: { ...tokens, color: { ...tokens.color, text: '#fefefe' } },
    });
    expect(bad.body.error.code).toBe('INVALID_TOKENS');
    expect((await owner('PUT', '/appearance/tokens', { tokens })).status).toBe(200);
    const a = await owner('GET', '/appearance');
    // nothing promoted yet: the edge serves the bundle's newest (1.10+) build, which reads them live
    expect(a.body.publish.state).toBe('live');
    const page = await owner('PUT', '/appearance/pages/home', {
      template: {
        version: 1,
        page: 'home',
        sections: [{ id: 'hero', type: 'sdk:rich-text', settings: { title: 'Oi' } }],
      },
    });
    expect(page.body.version).toBe(1);
    const hist = await owner('GET', '/appearance/pages/home/history');
    expect(hist.body.history[0].by).toBe('você');
  });

  test('LGPD: export then forget anonymizes the orders', async () => {
    const ex = await owner('GET', '/customers/22988887777/export');
    expect(ex.body.orders).toHaveLength(1);
    expect(
      (await owner('POST', '/customers/22988887777/forget', { confirm: '0000' })).body.error.code,
    ).toBe('CONFIRMATION_MISMATCH');
    const f = await owner('POST', '/customers/22988887777/forget', { confirm: '7777' });
    expect(f.body.anonymized).toBe(1);
    expect((await owner('GET', '/customers/22988887777')).status).toBe(404);
    const o = await owner('GET', `/orders/${orderId}`);
    expect(o.body.order.customer.name).toBe('Cliente removido');
  });

  test('a store owner writing to the platform WhatsApp is not a lead', async () => {
    const res = await ingestInbound(sql, {
      channel: 'whatsapp',
      from: `+55${ownerPhone}`,
      body: 'valeu pelo código',
      providerMessageId: `adm-${nonce}`,
    });
    expect('ignored' in res && res.ignored).toContain('lojista');
    const leads =
      await sql`select 1 from leads where whatsapp like ${`%${ownerPhone}`} or phone like ${`%${ownerPhone}`}`;
    expect(leads.length).toBe(0);
  });

  test('presence: open storefront streams are viewers, only sacolas with items count', async () => {
    const before = await activeCarts(sql, tenantId);
    // an empty sacola must not count
    await sql`insert into carts (tenant_id, session_hash) values (${tenantId}, ${'presence-empty-' + nonce})`;
    const shop = await app.request(`http://${host}/storefront/v1/events`, { headers: { host } });
    expect(shop.headers.get('content-type')).toContain('text/event-stream');
    const feed = await app.request('http://core.localhost/admin/v1/events', {
      headers: { host: 'core.localhost', cookie: owner.cookie },
    });
    const reader = feed.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (!buf.includes('event: presence')) buf += dec.decode((await reader.read()).value);
    const data = buf.split('\n').find((l) => l.startsWith('data: {"viewers"'))!;
    expect(JSON.parse(data.slice(6))).toEqual({ viewers: 1, carts: before });
    await reader.cancel();
    await shop.body!.cancel();
  });

  test('an open stream learns its session ended (signed out elsewhere)', async () => {
    const other = await signIn(ownerPhone, tenantId);
    const [tid, sid] = decodeURIComponent(other.cookie.split('=')[1]!).split('.');
    expect(await sessionAlive(sql, tid!, sid!)).toBe(true);
    expect((await other('POST', '/auth/logout')).status).toBe(200);
    expect(await sessionAlive(sql, tid!, sid!)).toBe(false);
    // the owner's own session is untouched
    const [otid, osid] = decodeURIComponent(owner.cookie.split('=')[1]!).split('.');
    expect(await sessionAlive(sql, otid!, osid!)).toBe(true);
  });

  test('staff create a store owner from the CRM', async () => {
    const r = await call(
      'POST',
      `/control/v1/storefronts/${slug2}/merchant-users`,
      { name: 'Ana', phone: '(21) 97777-1111', role: 'manager' },
      { 'x-vendua-control': 'ctl' },
    );
    expect(r.status).toBe(201);
    expect(r.body.user.phone).toBe('21977771111');
  });
});
