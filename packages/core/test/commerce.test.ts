import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { MAX_WATCHERS_PER_ORDER } from '../src/modules/commerce-routes.ts';
import { migrate } from '../src/platform/db.ts';

// Phase 2 end to end over HTTP: every roadmap 2a–2c item against a real Postgres.
describe.skipIf(!process.env.TEST_DATABASE_URL)('commerce completeness (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const cepCalls: string[] = [];
  const app = createApp({
    sql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async (cep) => {
      cepCalls.push(cep);
      if (cep === '00000000') return null;
      return {
        cep,
        street: 'Rua das Flores',
        neighborhood: 'Centro',
        city: 'Saquarema',
        state: 'RJ',
      };
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `cm-${nonce}`;
  const host = `${slug}.localhost`;
  let tenantId = '';
  const ids: Record<string, string> = {};
  let idem = 0;

  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://${host}${path}`, {
      method,
      headers: {
        host,
        'content-type': 'application/json',
        ...(method === 'GET' ? {} : { 'idempotency-key': `${nonce}-${++idem}` }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const ctl = (method: string, path: string, body?: unknown) =>
    call(method, `/control/v1/storefronts/${slug}/commerce${path}`, body, {
      'x-vendua-control': 'ctl',
    });
  const session = async () => {
    const r = await call('POST', '/checkout/v1/session');
    expect(r.status).toBe(201);
    return { authorization: `Bearer ${r.body.sessionToken}` };
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city,
                                  latitude, longitude)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema', -22.93, -42.51)
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes, free_delivery_over_cents)
      values (${tenantId}, 'Centro', ${sql.json(['Centro', 'Bacaxá'])}, 500, 0, 30, 50, 20000)
    `;
    const cat = (
      await sql<
        { id: string }[]
      >`insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    const prod = async (s: string, price: number, extra: Record<string, unknown> = {}) =>
      (ids[s] = (
        await sql<{ id: string }[]>`
          insert into products ${sql({ tenant_id: tenantId, category_id: cat, slug: s, name: s, base_price_cents: price, ...extra } as never)}
          returning id
        `
      )[0]!.id);
    await prod('pudim', 2000, { stock_quantity: 5, low_stock_threshold: 3 });
    await prod('coco', 1500);
    await prod('maracuja', 1600, { stock_quantity: 0 });
    await prod('bolo', 9000, { requires_preorder: true, preorder_lead_days: 2 });
    await prod('kit', 5000);
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('staff: media, combo, zones, pix, loyalty, coupons are configurable', async () => {
    expect(
      (
        await ctl('PUT', '/products/pudim/media', {
          media: [{ url: 'https://cdn.x/p.webp', alt: 'Pudim' }, { url: '/img/2.webp' }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await ctl('PUT', '/products/pudim/media', { media: [{ url: 'javascript:alert(1)' }] }))
        .status,
    ).toBe(400);
    const combo = await ctl('PUT', '/products/kit/combo', {
      slots: [
        {
          name: 'Sabores',
          minSelect: 4,
          maxSelect: 4,
          qtyPerItem: 2,
          items: [{ slug: 'pudim' }, { slug: 'coco', priceDeltaCents: 200 }, { slug: 'maracuja' }],
        },
      ],
    });
    expect(combo.status).toBe(200);
    expect(combo.body.product.kind).toBe('combo');
    ids.slot = combo.body.product.comboSlots[0].id;
    expect(
      (
        await ctl('POST', '/zones', {
          name: 'Raio 8km',
          kind: 'radius',
          maxDistanceKm: 8,
          feeCents: 300,
          feePerKmCents: 100,
          etaMin: 40,
          etaMax: 70,
        })
      ).status,
    ).toBe(201);
    // control-plane zones accept polygons too (far from the store, so later quotes are unaffected)
    const ring = [
      [10, 10],
      [10, 10.1],
      [10.1, 10.1],
    ];
    const poly = await ctl('POST', '/zones', { name: 'Mapa', kind: 'polygon', polygon: ring });
    expect(poly.status).toBe(201);
    expect(poly.body.zone).toMatchObject({ kind: 'polygon', polygon: ring });
    expect((await ctl('POST', '/zones', { name: 'Mapa 2', kind: 'polygon' })).status).toBe(400);
    expect(
      (await ctl('POST', '/zones', { name: 'Mapa 3', kind: 'polygon', polygon: [[1, 1]] })).status,
    ).toBe(400);
    expect(
      (await ctl('PATCH', `/zones/${poly.body.zone.id}`, { kind: 'polygon', polygon: 'x' })).status,
    ).toBe(400);
    const flat = await ctl('PATCH', `/zones/${poly.body.zone.id}`, {
      kind: 'neighborhood',
      neighborhoods: ['Longe'],
    });
    expect(flat.body.zone).toMatchObject({ kind: 'neighborhood', polygon: null });
    expect(
      (
        await ctl('PATCH', '/settings', {
          pix: {
            key: 'loja@exemplo.com.br',
            keyType: 'email',
            beneficiary: 'Quero Pudim',
            city: 'Saquarema',
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (await ctl('PATCH', '/settings', { pix: { key: '123', keyType: 'cpf', beneficiary: 'X' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await ctl('PATCH', '/settings', {
          loyalty: {
            stampsRequired: 2,
            minOrderCents: 1000,
            reward: { kind: 'fixed', value: 1500, label: '1 pudim grátis' },
            rewardValidDays: 30,
          },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await ctl('POST', '/coupons', {
          code: 'bemvindo',
          kind: 'percent',
          value: 10,
          minSubtotalCents: 5000,
        })
      ).status,
    ).toBe(201);
    expect(
      (await ctl('POST', '/coupons', { code: 'BEMVINDO', kind: 'fixed', value: 100 })).status,
    ).toBe(409);
    expect(
      (
        await ctl('POST', '/coupons', {
          code: 'FRETE',
          kind: 'free_delivery',
          firstOrderOnly: true,
        })
      ).status,
    ).toBe(201);
  });

  test('catalog: images, stock, low stock, stock-derived sold out, combo slots, preorder date', async () => {
    const cat = await call('GET', '/storefront/v1/catalog');
    const all = cat.body.categories[0].products as any[];
    const pudim = all.find((p) => p.slug === 'pudim');
    expect(pudim.imageUrl).toBe('https://cdn.x/p.webp');
    expect(pudim.stockQuantity).toBe(5);
    expect(pudim.lowStock).toBe(false);
    // cards offer one-tap add only where nothing needs choosing (Kernel 1.5)
    expect(pudim.needsChoices).toBe(false);
    expect(all.find((p) => p.slug === 'kit').needsChoices).toBe(true);
    expect(all.find((p) => p.slug === 'maracuja').status).toBe('sold_out');
    const detail = await call('GET', '/storefront/v1/products/pudim');
    expect(detail.body.product.gallery).toHaveLength(2);
    const kit = await call('GET', '/storefront/v1/products/kit');
    expect(kit.body.product.comboSlots[0].items.map((i: any) => i.slug)).toEqual([
      'pudim',
      'coco',
      'maracuja',
    ]);
    const bolo = await call('GET', '/storefront/v1/products/bolo');
    expect(bolo.body.product.requiresPreorder).toBe(true);
    expect(bolo.body.product.preorderEarliestDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const store = await call('GET', '/storefront/v1/store');
    expect(store.body.pix.copyPaste).toStartWith('000201');
    expect(store.body.loyalty.stampsRequired).toBe(2);
  });

  let orderId = '';
  let orderToken = '';
  let customerToken = '';

  test('cart → checkout: stock caps, kits, coupon, distance fee, schedule, notes, structured address', async () => {
    const auth = await session();
    orderToken = auth.authorization.slice(7);
    const over = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: ids.pudim, qty: 6 },
      auth,
    );
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: 'OUT_OF_STOCK', details: { available: 5 } });

    const bad = await call(
      'POST',
      '/checkout/v1/cart/items',
      {
        productId: ids.kit,
        qty: 1,
        comboSelections: [{ slotId: ids.slot, productId: ids.pudim, qty: 2 }],
      },
      auth,
    );
    expect(bad.body.error.code).toBe('COMBO_SLOT_COUNT');
    const soldOutPick = await call(
      'POST',
      '/checkout/v1/cart/items',
      {
        productId: ids.kit,
        qty: 1,
        comboSelections: [
          { slotId: ids.slot, productId: ids.maracuja, qty: 2 },
          { slotId: ids.slot, productId: ids.coco, qty: 2 },
        ],
      },
      auth,
    );
    expect(soldOutPick.body.error.code).toBe('COMBO_ITEM_SOLD_OUT');
    const tooMany = await call(
      'POST',
      '/checkout/v1/cart/items',
      {
        productId: ids.kit,
        qty: 1,
        comboSelections: [{ slotId: ids.slot, productId: ids.coco, qty: 4 }],
      },
      auth,
    );
    expect(tooMany.body.error.code).toBe('COMBO_ITEM_LIMIT');
    const kit = await call(
      'POST',
      '/checkout/v1/cart/items',
      {
        productId: ids.kit,
        qty: 1,
        comboSelections: [
          { slotId: ids.slot, productId: ids.coco, qty: 2 },
          { slotId: ids.slot, productId: ids.pudim, qty: 2 },
        ],
      },
      auth,
    );
    expect(kit.status).toBe(200);
    // 5000 + 2×200 (coco delta)
    expect(kit.body.cart.items[0].unitPriceCents).toBe(5400);
    // each pick carries its stock so the storefront can cap the kit's qty
    expect(kit.body.cart.items[0].combo.find((c: any) => c.productId === ids.pudim)).toMatchObject({
      qty: 2,
      stockQuantity: 5,
    });
    // the kit drew 2 pudins from stock-to-be: 4 more pudins would exceed 5
    const capped = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: ids.pudim, qty: 4 },
      auth,
    );
    expect(capped.body.error.code).toBe('OUT_OF_STOCK');

    const coupon = await call('POST', '/checkout/v1/cart/coupon', { code: 'bemvindo' }, auth);
    expect(coupon.status).toBe(200);
    expect(coupon.body.cart.coupon).toMatchObject({ code: 'BEMVINDO', applies: true });
    expect(coupon.body.cart.totals.discountCents).toBe(540);
    const nope = await call('POST', '/checkout/v1/cart/coupon', { code: 'NOPE' }, auth);
    expect(nope.body.error.code).toBe('COUPON_NOT_FOUND');

    await call('POST', '/checkout/v1/cart/items', { productId: ids.bolo, qty: 1 }, auth);
    // ~5.6 km east of the store: radius zone, 300 + ceil(5.6)×100
    const del = await call(
      'POST',
      '/checkout/v1/cart/delivery',
      { mode: 'delivery', lat: -22.93, lng: -42.4555, street: 'Rua A', number: '10' },
      auth,
    );
    expect(del.body.cart.delivery.zoneName).toBe('Raio 8km');
    expect(del.body.cart.totals.deliveryFeeCents).toBe(900);
    expect(del.body.cart.schedule.required).toBe(true);
    const date = del.body.cart.schedule.dates[0];
    expect(del.body.cart.schedule.leadDays).toBe(2);

    const input = {
      customer: { name: 'Ana', phone: '(22) 99999-0001' },
      delivery: {
        mode: 'delivery',
        lat: -22.93,
        lng: -42.4555,
        street: 'Rua A',
        number: '10',
        complement: 'casa 2',
        cep: '28990-000',
      },
      payment: { method: 'pix' },
      notes: 'Sem granulado, por favor',
    };
    expect((await call('POST', '/checkout/v1/checkout', input, auth)).body.error.code).toBe(
      'SCHEDULE_REQUIRED',
    );
    expect(
      (
        await call(
          'POST',
          '/checkout/v1/checkout',
          { ...input, scheduledFor: date, payment: { method: 'cash' } },
          auth,
        )
      ).body.error.code,
    ).toBe('PAYMENT_NOT_ALLOWED');
    expect(
      (await call('POST', '/checkout/v1/checkout', { ...input, scheduledFor: '2020-01-01' }, auth))
        .body.error.code,
    ).toBe('INVALID_SCHEDULE');
    const placed = await call(
      'POST',
      '/checkout/v1/checkout',
      { ...input, scheduledFor: date },
      auth,
    );
    expect(placed.status).toBe(201);
    const o = placed.body.order;
    orderId = o.id;
    customerToken = placed.body.customerToken;
    expect(o.items.map((i: any) => i.name)).toEqual(['kit', 'bolo']);
    expect(o.items[0].combo).toHaveLength(2);
    expect(o.notes).toBe('Sem granulado, por favor');
    expect(o.scheduledFor).toBe(date);
    expect(o.delivery.address).toBe('Rua A, 10 — casa 2');
    expect(o.delivery.addressParts).toMatchObject({
      street: 'Rua A',
      number: '10',
      cep: '28990000',
    });
    expect(o.subtotalCents).toBe(14400);
    expect(o.discountCents).toBe(1440);
    expect(o.deliveryFeeCents).toBe(900);
    expect(o.totalCents).toBe(14400 + 900 - 1440);
    expect(o.payment.pix.copyPaste).toContain('5406138.60');
    expect(o.version).toBe(1);
    const stock = await sql`select stock_quantity from products where id = ${ids.pudim!}`;
    expect(stock[0]!.stock_quantity).toBe(3);
    const lowNow = await call('GET', '/storefront/v1/products/pudim');
    expect(lowNow.body.product.lowStock).toBe(true);
  });

  test('free-delivery coupon is first-order-only, checked with the phone at checkout', async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 1 }, auth);
    await call(
      'POST',
      '/checkout/v1/cart/delivery',
      { mode: 'delivery', neighborhood: 'bacaxa' },
      auth,
    );
    const applied = await call('POST', '/checkout/v1/cart/coupon', { code: 'frete' }, auth);
    // accent/case-insensitive bairro match
    expect(applied.body.cart.delivery.zoneName).toBe('Centro');
    expect(applied.body.cart.totals.discountCents).toBe(500);
    expect(applied.body.cart.totals.freeDeliveryRemainingCents).toBe(20000 - 1500);
    const r = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Ana', phone: '22999990001' },
        delivery: { mode: 'delivery', neighborhood: 'Bacaxá', address: 'Rua B, 2' },
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(r.body.error.code).toBe('COUPON_FIRST_ORDER_ONLY');
    await call('DELETE', '/checkout/v1/cart/coupon', undefined, auth);
    const ok = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Ana', phone: '5522999990001' },
        delivery: { mode: 'delivery', neighborhood: 'Bacaxá', address: 'Rua B, 2' },
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.order.discountCents).toBe(0);
  });

  test('a phone without digits is refused; free delivery on a pickup spends no reward', async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 1 }, auth);
    expect((await call('POST', '/checkout/v1/cart/coupon', { code: 'frete' }, auth)).status).toBe(
      200,
    );
    const input = (phone: string) => ({
      customer: { name: 'Bia', phone },
      delivery: { mode: 'pickup' },
      payment: { method: 'cash' },
    });
    const blank = await call('POST', '/checkout/v1/checkout', input('--------'), auth);
    expect(blank.status).toBe(422);
    expect(blank.body.error).toMatchObject({
      code: 'INVALID_CUSTOMER',
      details: { field: 'customer.phone' },
    });
    const ok = await call('POST', '/checkout/v1/checkout', input('22977770000'), auth);
    expect(ok.status).toBe(201);
    expect(ok.body.order.discountCents).toBe(0);
    const [row] = await sql<{ coupon_code: string | null; redemptions: number }[]>`
      select coupon_code, (select count(*)::int from coupon_redemptions where order_id = o.id) as redemptions
      from orders o where id = ${ok.body.order.id}
    `;
    expect(row).toEqual({ coupon_code: null, redemptions: 0 });
  });

  test('staff coupon dates: a bad date or an end before the start is a 400', async () => {
    const make = (extra: Record<string, unknown>) =>
      ctl('POST', '/coupons', { code: `D${++idem}`, kind: 'fixed', value: 100, ...extra });
    expect((await make({ endsAt: 'foo' })).status).toBe(400);
    expect(
      (await make({ startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' })).status,
    ).toBe(400);
    const made = await make({ startsAt: '2026-10-10T00:00:00Z' });
    expect(made.status).toBe(201);
    const code = made.body.coupon.code;
    const bad = await ctl('PATCH', `/coupons/${code}`, { endsAt: 'foo' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
    expect(
      (await ctl('PATCH', `/coupons/${code}`, { endsAt: '2026-10-09T00:00:00Z' })).status,
    ).toBe(400);
    const ok = await ctl('PATCH', `/coupons/${code}`, { endsAt: '2026-10-11T00:00:00Z' });
    expect(ok.status).toBe(200);
    expect(new Date(ok.body.coupon.ends_at).toISOString()).toBe('2026-10-11T00:00:00.000Z');
  });

  test('live order: a waiting read wakes on the transition', async () => {
    const auth = { authorization: `Bearer ${orderToken}` };
    const waiting = call('GET', `/checkout/v1/orders/${orderId}?since=1&wait=10`, undefined, auth);
    await new Promise((r) => setTimeout(r, 300));
    const started = Date.now();
    expect((await ctl('POST', `/orders/${orderId}/transition`, { to: 'confirmed' })).status).toBe(
      200,
    );
    const woke = await waiting;
    expect(woke.body.changed).toBe(true);
    expect(woke.body.order.state).toBe('confirmed');
    expect(woke.body.order.version).toBe(2);
    expect(Date.now() - started).toBeLessThan(5000);
    const idle = await call(
      'GET',
      `/checkout/v1/orders/${orderId}?since=2&wait=1`,
      undefined,
      auth,
    );
    expect(idle.body.changed).toBe(false);
  });

  test('SSE: the stream sends the current order, then each new version as it commits', async () => {
    const ctl2 = new AbortController();
    const res = await app.request(`http://${host}/checkout/v1/orders/${orderId}/events`, {
      headers: { host, authorization: `Bearer ${orderToken}` },
      signal: ctl2.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const nextOrder = async () => {
      for (;;) {
        const i = buf.indexOf('\n\n');
        if (i >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split('\n').find((l) => l.startsWith('data:'));
          if (frame.includes('event: order') && data) return JSON.parse(data.slice(5));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buf += dec.decode(value, { stream: true });
      }
    };
    const first = await nextOrder();
    expect(first).toMatchObject({ id: orderId, state: 'confirmed', version: 2 });
    const t = Date.now();
    await ctl('POST', `/orders/${orderId}/transition`, { to: 'preparing' });
    const second = await nextOrder();
    expect(second).toMatchObject({ state: 'preparing', version: 3 });
    expect(Date.now() - t).toBeLessThan(3000);
    ctl2.abort();
    await reader.cancel().catch(() => {});

    // another session's token can't open this order's stream
    const other = await session();
    const denied = await app.request(`http://${host}/checkout/v1/orders/${orderId}/events`, {
      headers: { host, ...other },
    });
    expect(denied.status).toBe(404);
  });

  test('live order: one order holds at most MAX_WATCHERS_PER_ORDER streams and long-polls', async () => {
    const headers = { host, authorization: `Bearer ${orderToken}` };
    const open: { a: AbortController; res: Response }[] = [];
    for (let i = 0; i < MAX_WATCHERS_PER_ORDER; i++) {
      const a = new AbortController();
      const res = await app.request(`http://${host}/checkout/v1/orders/${orderId}/events`, {
        headers,
        signal: a.signal,
      });
      expect(res.status).toBe(200);
      open.push({ a, res });
    }
    const over = await app.request(`http://${host}/checkout/v1/orders/${orderId}/events`, {
      headers,
    });
    expect(over.status).toBe(503);
    expect(((await over.json()) as any).error.code).toBe('STREAM_UNAVAILABLE');
    // the long-poll shares the order's slots; a plain read doesn't take one
    const poll = await call('GET', `/checkout/v1/orders/${orderId}?since=99&wait=1`, undefined, {
      authorization: `Bearer ${orderToken}`,
    });
    expect(poll.status).toBe(503);
    const plain = await call('GET', `/checkout/v1/orders/${orderId}`, undefined, {
      authorization: `Bearer ${orderToken}`,
    });
    expect(plain.status).toBe(200);
    for (const o of open) {
      o.a.abort();
      await o.res.body?.cancel().catch(() => {});
    }
    let again = 503;
    for (let i = 0; i < 100 && again !== 200; i++) {
      await new Promise((r) => setTimeout(r, 10));
      again = (
        await call('GET', `/checkout/v1/orders/${orderId}?since=99&wait=1`, undefined, {
          authorization: `Bearer ${orderToken}`,
        })
      ).status;
    }
    expect(again).toBe(200);
  });

  test('customer: orders by phone need a token for that phone; verification by order number', async () => {
    const h = { 'x-vendua-customer': customerToken };
    expect((await call('GET', '/checkout/v1/customer/orders')).status).toBe(401);
    const mine = await call('GET', '/checkout/v1/customer/orders?phone=22999990001', undefined, h);
    expect(mine.status).toBe(200);
    // not delivered yet: the checkout token only proves "this device placed order #1"
    expect(mine.body.orders).toHaveLength(1);
    expect(mine.body.orders[0].items[0]).toEqual({ name: 'kit', qty: 1 });
    expect(JSON.stringify(mine.body)).not.toContain('Rua A');
    expect(
      (await call('GET', '/checkout/v1/customer/orders?phone=21988887777', undefined, h)).status,
    ).toBe(403);
    expect(
      (
        await call('POST', '/checkout/v1/customer/session', {
          phone: '22999990001',
          orderNumber: 999,
        })
      ).body.error.code,
    ).toBe('CUSTOMER_NOT_VERIFIED');
    const v = await call('POST', '/checkout/v1/customer/session', {
      phone: '+55 22 99999-0001',
      orderNumber: 1,
    });
    expect(v.status).toBe(201);
    const again = await call('GET', '/checkout/v1/customer/orders', undefined, {
      'x-vendua-customer': v.body.customerToken,
    });
    expect(again.body.orders.map((o: any) => o.number)).toEqual([1]);
  });

  test('loyalty: delivered orders stamp the card and mint a personal reward coupon', async () => {
    const h = { 'x-vendua-customer': customerToken };
    const before = await call('GET', '/checkout/v1/customer/loyalty', undefined, h);
    expect(before.body.loyalty).toMatchObject({ enabled: true, stamps: 0, stampsRequired: 2 });
    expect(before.body.loyalty.rewards).toEqual([]);
    const all = await ctl('GET', '/orders');
    for (const o of all.body.orders)
      for (const to of ['confirmed', 'preparing', 'ready', 'delivered'])
        if (o.state !== to) await ctl('POST', `/orders/${o.id}/transition`, { to });
    // the anchor (order #1) is delivered now: the same token is proven and sees the codes
    const after = await call('GET', '/checkout/v1/customer/loyalty', undefined, h);
    expect(after.body.loyalty.stamps).toBe(0);
    expect(after.body.loyalty.rewards).toHaveLength(1);
    const code = after.body.loyalty.rewards[0].code as string;
    expect(code).toStartWith('FIEL-');
    // the reward is personal: only a proven token for its phone applies it, and another
    // phone's checkout refuses it
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 2 }, auth);
    expect((await call('POST', '/checkout/v1/cart/coupon', { code }, auth)).body.error.code).toBe(
      'COUPON_NOT_YOURS',
    );
    expect(
      (await call('POST', '/checkout/v1/cart/coupon', { code }, { ...auth, ...h })).status,
    ).toBe(200);
    const stranger = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Bia', phone: '21988887777' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(stranger.body.error.code).toBe('COUPON_NOT_YOURS');
  });

  test('cancel returns stock; restock wakes the waitlist', async () => {
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.pudim, qty: 2 }, auth);
    const o = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Cris', phone: '21977776666' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      auth,
    );
    expect(
      (await sql`select stock_quantity from products where id = ${ids.pudim!}`)[0]!.stock_quantity,
    ).toBe(1);
    await ctl('POST', `/orders/${o.body.order.id}/transition`, { to: 'cancelled' });
    expect(
      (await sql`select stock_quantity from products where id = ${ids.pudim!}`)[0]!.stock_quantity,
    ).toBe(3);

    // tracked only after the sale: the cancel gives back nothing it never took
    expect(
      (await sql`select stock_quantity from products where id = ${ids.coco!}`)[0]!.stock_quantity,
    ).toBeNull();
    const untracked = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 2 }, untracked);
    const o2 = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Cris', phone: '21977776666' },
        delivery: { mode: 'pickup' },
        payment: { method: 'cash' },
      },
      untracked,
    );
    await sql`update products set stock_quantity = 10 where id = ${ids.coco!}`;
    await ctl('POST', `/orders/${o2.body.order.id}/transition`, { to: 'cancelled' });
    expect(
      (await sql`select stock_quantity from products where id = ${ids.coco!}`)[0]!.stock_quantity,
    ).toBe(10);
    await sql`update products set stock_quantity = null where id = ${ids.coco!}`;

    const w = await call('POST', '/storefront/v1/waitlist', {
      productId: ids.maracuja,
      phone: '21966665555',
    });
    expect(w.status).toBe(201);
    expect(w.body.waiting).toBe(1);
    expect((await call('GET', '/storefront/v1/products/maracuja')).body.product.waitlistCount).toBe(
      1,
    );
    const restock = await ctl('PATCH', '/products/maracuja', { stockQuantity: 10 });
    expect(restock.body).toMatchObject({ restocked: true, waitlistWoken: 1 });
    const outbox =
      await sql`select payload from outbox where tenant_id = ${tenantId} and topic = 'waitlist.restocked'`;
    expect(outbox[0]!.payload.contacts).toEqual(['21966665555']);
  });

  test('share link, import and reorder report what they could not add', async () => {
    const a = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 2 }, a);
    const share = await call('POST', '/checkout/v1/cart/share', undefined, a);
    expect(share.status).toBe(201);
    const b = await session();
    const imported = await call(
      'POST',
      '/checkout/v1/cart/import',
      { shareCode: share.body.code },
      b,
    );
    expect(imported.body.report).toEqual({ added: 1, skipped: [] });
    expect(imported.body.cart.items[0].qty).toBe(2);
    const mixed = await call(
      'POST',
      '/checkout/v1/cart/import',
      {
        items: [
          { slug: 'pudim', qty: 1 },
          { slug: 'nao-existe', qty: 1 },
          { slug: 'kit', qty: 1 },
        ],
      },
      b,
    );
    expect(mixed.body.report.added).toBe(1);
    expect(mixed.body.report.skipped.map((s: any) => s.code)).toEqual([
      'PRODUCT_NOT_FOUND',
      'COMBO_SLOT_COUNT',
    ]);
    expect(
      (await call('POST', '/checkout/v1/cart/import', { shareCode: 'zzzzzzzz' }, b)).body.error
        .code,
    ).toBe('SHARE_NOT_FOUND');

    const c = await session();
    const denied = await call('POST', '/checkout/v1/cart/reorder', { orderId }, c);
    expect(denied.status).toBe(404);
    const re = await call('POST', '/checkout/v1/cart/reorder', { orderId, orderToken }, c);
    expect(re.status).toBe(200);
    // kit + bolo come back with the same picks and price
    expect(re.body.cart.items.map((i: any) => i.name)).toEqual(['kit', 'bolo']);
    expect(re.body.cart.items[0].unitPriceCents).toBe(5400);
  });

  test('CEP lookup answers the address and the zone; quote takes coordinates', async () => {
    const r = await call('GET', '/storefront/v1/cep/28990-000');
    expect(r.body.address.neighborhood).toBe('Centro');
    expect(r.body.zone).toMatchObject({ eligible: true, zoneName: 'Centro', feeCents: 500 });
    expect((await call('GET', '/storefront/v1/cep/00000000')).status).toBe(404);
    expect((await call('GET', '/storefront/v1/cep/123')).status).toBe(400);
    const q = await call('POST', '/checkout/v1/quote', { lat: -22.93, lng: -42.48 });
    expect(q.body).toMatchObject({ eligible: true, zoneName: 'Raio 8km' });
    // the zones list's "a partir de" is exactly what the nearest address is quoted
    const zones = (await call('GET', '/storefront/v1/zones')).body.zones;
    const raio = zones.find((z: any) => z.name === 'Raio 8km');
    const near = await call('POST', '/checkout/v1/quote', { lat: -22.93, lng: -42.5099 });
    expect(near.body).toMatchObject({ eligible: true, zoneId: raio.id, feeCents: 400 });
    expect(raio.minFeeCents).toBe(near.body.feeCents);
    expect(zones.find((z: any) => z.name === 'Centro').minFeeCents).toBe(500);
    const far = await call('POST', '/checkout/v1/quote', { lat: -22.0, lng: -42.0 });
    expect(far.body.eligible).toBe(false);
  });

  test('closed: only a bag of encomendas checks out, and only while the store allows it', async () => {
    await sql`update store_settings set status_override = 'closed' where tenant_id = ${tenantId}`;
    try {
      const store = await call('GET', '/storefront/v1/store');
      expect(store.body).toMatchObject({ status: 'closed', preorder: { whileClosed: true } });
      const bag = async (...products: string[]) => {
        const auth = await session();
        let cart: any;
        for (const p of products)
          cart = (
            await call('POST', '/checkout/v1/cart/items', { productId: ids[p], qty: 1 }, auth)
          ).body.cart;
        return { auth, date: cart.schedule.dates[0] as string };
      };
      const input = (date: string) => ({
        customer: { name: 'Bia', phone: '22988887777' },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
        scheduledFor: date,
      });

      const mixed = await bag('bolo', 'coco');
      const refused = await call('POST', '/checkout/v1/checkout', input(mixed.date), mixed.auth);
      expect(refused.status).toBe(423);
      expect(refused.body.error).toMatchObject({
        code: 'STORE_CLOSED',
        details: { preordersOnly: true },
      });

      const encomendas = await bag('bolo');
      const placed = await call(
        'POST',
        '/checkout/v1/checkout',
        input(encomendas.date),
        encomendas.auth,
      );
      expect(placed.status).toBe(201);
      expect(placed.body.order.scheduledFor).toBe(encomendas.date);

      await sql`update store_settings set preorders_while_closed = false where tenant_id = ${tenantId}`;
      expect((await call('GET', '/storefront/v1/store')).body.preorder.whileClosed).toBe(false);
      const off = await bag('bolo');
      const none = await call('POST', '/checkout/v1/checkout', input(off.date), off.auth);
      expect(none.status).toBe(423);
      expect(none.body.error).toMatchObject({
        code: 'STORE_CLOSED',
        details: { preordersOnly: false },
      });
    } finally {
      await sql`
        update store_settings set status_override = null, preorders_while_closed = true
        where tenant_id = ${tenantId}
      `;
    }
  });
  test("a coupon's per-phone limit holds under either 9th-digit spelling", async () => {
    expect(
      (
        await ctl('POST', '/coupons', {
          code: 'UMAVEZ',
          kind: 'fixed',
          value: 100,
          perPhoneLimit: 1,
        })
      ).status,
    ).toBe(201);
    const order = async (phone: string) => {
      const auth = await session();
      await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 1 }, auth);
      await call('POST', '/checkout/v1/cart/coupon', { code: 'UMAVEZ' }, auth);
      return call(
        'POST',
        '/checkout/v1/checkout',
        {
          customer: { name: 'Edu', phone },
          delivery: { mode: 'pickup' },
          payment: { method: 'cash' },
        },
        auth,
      );
    };
    expect((await order('21987651234')).status).toBe(201);
    // the same WhatsApp typed without the 9th digit is the same customer
    const again = await order('2187651234');
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('COUPON_ALREADY_USED');
  });

  test('a coupon that covers the whole order leaves nothing to charge', async () => {
    expect(
      (await ctl('POST', '/coupons', { code: 'TUDO', kind: 'percent', value: 100 })).status,
    ).toBe(201);
    const auth = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 1 }, auth);
    expect((await call('POST', '/checkout/v1/cart/coupon', { code: 'TUDO' }, auth)).status).toBe(
      200,
    );
    const o = await call(
      'POST',
      '/checkout/v1/checkout',
      {
        customer: { name: 'Gil', phone: '21944443333' },
        delivery: { mode: 'pickup' },
        payment: { method: 'pix' },
      },
      auth,
    );
    expect(o.status).toBe(201);
    expect(o.body.order.totalCents).toBe(0);
    // no open-amount Pix, no R$ 0 charge at Mercado Pago
    expect(o.body.order.payment).toMatchObject({ status: 'paid', online: false, pix: null });
  });

  test('a bag stops at 50 lines; checkout refuses a total the shopper did not see', async () => {
    const auth = await session();
    for (let i = 0; i < 50; i++)
      expect(
        (
          await call(
            'POST',
            '/checkout/v1/cart/items',
            { productId: ids.coco, qty: 1, note: `n${i}` },
            auth,
          )
        ).status,
      ).toBe(200);
    const full = await call(
      'POST',
      '/checkout/v1/cart/items',
      { productId: ids.coco, qty: 1, note: 'one more' },
      auth,
    );
    expect(full.status).toBe(422);
    expect(full.body.error.code).toBe('CART_FULL');
    // a merge into a line already there still works
    expect(
      (
        await call(
          'POST',
          '/checkout/v1/cart/items',
          { productId: ids.coco, qty: 1, note: 'n0' },
          auth,
        )
      ).status,
    ).toBe(200);

    const small = await session();
    await call('POST', '/checkout/v1/cart/items', { productId: ids.coco, qty: 1 }, small);
    const body = {
      customer: { name: 'Lia', phone: '21955554444' },
      delivery: { mode: 'pickup' },
      payment: { method: 'cash' },
    };
    const stale = await call(
      'POST',
      '/checkout/v1/checkout',
      { ...body, expectedTotalCents: 1000 },
      small,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('PRICES_CHANGED');
    expect(stale.body.error.details).toMatchObject({ totalCents: 1500, expectedTotalCents: 1000 });
    const ok = await call(
      'POST',
      '/checkout/v1/checkout',
      { ...body, expectedTotalCents: 1500 },
      small,
    );
    expect(ok.status).toBe(201);
    expect(ok.body.order.totalCents).toBe(1500);
  });
});
