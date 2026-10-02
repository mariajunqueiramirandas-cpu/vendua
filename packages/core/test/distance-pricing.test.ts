import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import {
  DETOUR_FACTOR,
  effectiveFee,
  haversineKm,
  priceByDistance,
  resolveDelivery,
  routeMatches,
  type DistancePricing,
  type RouteQuote,
} from '../src/modules/geo.ts';
import { mapTilesFromEnv, nominatimGeocoder } from '../src/modules/geocode.ts';
import { orsRouter, routeQuoter, type RouteLeg } from '../src/modules/routing.ts';
import { migrate } from '../src/platform/db.ts';

// ADR 0024: delivery priced by road distance from a confirmed pin.

const STORE = { lat: -22.93, lng: -42.51 };
const NEAR = { lat: -22.93, lng: -42.4555 };
const FAR = { lat: -22.93, lng: -42.4 };
const PRICING: DistancePricing = {
  baseFeeCents: 500,
  feePerKmCents: 150,
  minFeeCents: 700,
  maxKm: 8,
  freeOverCents: 30000,
};
const leg = (to: { lat: number; lng: number }, meters: number, seconds = 900): RouteQuote => ({
  from: [STORE.lat, STORE.lng],
  to: [to.lat, to.lng],
  meters,
  seconds,
});

describe('distance pricing (pure)', () => {
  test('a road route prices base + R$/started km, ETA = prep + drive', () => {
    const m = priceByDistance(PRICING, STORE, NEAR, leg(NEAR, 6400), 25)!;
    expect(m.feeCents).toBe(500 + 7 * 150);
    expect(m.distanceKm).toBe(6.4);
    expect(m.distanceSource).toBe('route');
    expect(m.zone).toMatchObject({ id: 'distance', kind: 'distance', eta_min_minutes: 40 });
    expect(m.zone.eta_max_minutes).toBe(50);
  });

  test('no route (or one for another pin): straight line × detour factor', () => {
    const km = Math.round(haversineKm(STORE, NEAR) * DETOUR_FACTOR * 10) / 10;
    for (const route of [null, leg(FAR, 1000)]) {
      const m = priceByDistance(PRICING, STORE, NEAR, route, 25)!;
      expect(m.distanceSource).toBe('estimate');
      expect(m.feeCents).toBe(500 + Math.ceil(km) * 150);
    }
  });

  test('the km shown is the km charged', () => {
    const m = priceByDistance(PRICING, STORE, NEAR, leg(NEAR, 3049), 25)!;
    expect(m.distanceKm).toBe(3);
    expect(m.feeCents).toBe(500 + 3 * 150);
  });

  test('never below the minimum fee; free above the threshold; refused past the maximum', () => {
    const close = priceByDistance(PRICING, STORE, NEAR, leg(NEAR, 200), 25)!;
    expect(close.feeCents).toBe(700);
    expect(effectiveFee(close, 30000)).toBe(0);
    expect(effectiveFee(close, 29999)).toBe(700);
    expect(priceByDistance(PRICING, STORE, NEAR, leg(NEAR, 8051), 25)).toBeNull();
    expect(priceByDistance(PRICING, STORE, NEAR, leg(NEAR, 8049), 25)).not.toBeNull();
  });

  test('zones price an address without a pin, or a store without distance pricing', () => {
    const zones = [
      {
        id: 'z',
        name: 'Centro',
        kind: 'neighborhood' as const,
        neighborhoods: ['Centro'],
        fee_cents: 400,
        min_order_cents: 0,
        eta_min_minutes: 30,
        eta_max_minutes: 50,
      },
    ];
    const on = { pricing: PRICING, route: null, prepMinutes: 25 };
    expect(resolveDelivery(zones, { neighborhood: 'Centro' }, STORE, on)?.zone.id).toBe('z');
    expect(
      resolveDelivery(zones, { neighborhood: 'Centro', coords: NEAR }, STORE, on)?.zone.id,
    ).toBe('distance');
    // no store pin: distance can't be measured
    expect(
      resolveDelivery(zones, { neighborhood: 'Centro', coords: NEAR }, null, on)?.zone.id,
    ).toBe('z');
    expect(
      resolveDelivery(zones, { neighborhood: 'Centro', coords: NEAR }, STORE, {
        pricing: null,
        prepMinutes: 25,
      })?.zone.id,
    ).toBe('z');
  });

  test('routeMatches compares store and pin to ~1 m', () => {
    expect(routeMatches(leg(NEAR, 1), STORE, { lat: -22.930001, lng: -42.4555 })).toBe(true);
    expect(routeMatches(leg(NEAR, 1), STORE, { lat: -22.93002, lng: -42.4555 })).toBe(false);
    expect(routeMatches(null, STORE, NEAR)).toBe(false);
  });
});

describe('providers', () => {
  test('routeQuoter caches legs and pauses after a failure', async () => {
    let calls = 0;
    let fail = false;
    const quote = routeQuoter(async () => {
      calls++;
      if (fail) throw new Error('down');
      return { meters: 1234, seconds: 120 };
    });
    expect(await quote(STORE, NEAR)).toEqual(leg(NEAR, 1234, 120));
    expect(await quote(STORE, NEAR)).toEqual(leg(NEAR, 1234, 120));
    expect(calls).toBe(1);
    fail = true;
    expect(await quote(STORE, FAR)).toBeNull();
    expect(await quote(STORE, { lat: -22.9, lng: -42.4 })).toBeNull();
    expect(calls).toBe(2);
    expect(await routeQuoter(null)(STORE, NEAR)).toBeNull();
  });

  test('orsRouter: no key = no router; reads the summary; 404 = unroutable', async () => {
    expect(orsRouter({})).toBeNull();
    const sent: { url: string; init?: RequestInit }[] = [];
    let status = 200;
    const router = orsRouter({ ORS_API_KEY: 'k' }, async (url, init) => {
      sent.push({ url, ...(init ? { init } : {}) });
      return new Response(
        JSON.stringify({ routes: [{ summary: { distance: 6400.4, duration: 901.6 } }] }),
        { status },
      );
    })!;
    expect(await router(STORE, NEAR)).toEqual({ meters: 6400, seconds: 902 });
    expect(sent[0]!.url).toBe('https://api.openrouteservice.org/v2/directions/driving-car/json');
    expect((sent[0]!.init!.headers as Record<string, string>).authorization).toBe('k');
    expect(JSON.parse(String(sent[0]!.init!.body)).coordinates).toEqual([
      [STORE.lng, STORE.lat],
      [NEAR.lng, NEAR.lat],
    ]);
    status = 404;
    expect(await router(STORE, NEAR)).toBeNull();
    status = 429;
    expect(router(STORE, NEAR)).rejects.toThrow('openrouteservice 429');
  });

  test('nominatimGeocoder: structured street search first, with its precision', async () => {
    const urls: string[] = [];
    const geocode = nominatimGeocoder({}, async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify([{ lat: '-22.9301', lon: '-42.4801', type: 'house', place_rank: 30 }]),
      );
    });
    expect(
      await geocode({
        street: 'Rua A',
        number: '10',
        city: 'Saquarema',
        state: 'RJ',
        cep: '28990000',
      }),
    ).toEqual({ lat: -22.9301, lng: -42.4801, precision: 'address' });
    const u = new URL(urls[0]!);
    expect(u.searchParams.get('street')).toBe('10 Rua A');
    expect(u.searchParams.get('countrycodes')).toBe('br');
    // cached: no second request for the same address
    await geocode({ street: 'Rua A', number: '10', city: 'Saquarema', state: 'RJ' });
    expect(urls.length).toBe(1);
    // transport failure answers null, never throws
    const down = nominatimGeocoder({}, async () => new Response('', { status: 503 }));
    expect(await down({ city: 'Saquarema' })).toBeNull();
  });

  test('mapTilesFromEnv: https XYZ templates only', () => {
    expect(mapTilesFromEnv({}).url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(
      mapTilesFromEnv({
        MAP_TILE_URL: 'https://t.example/{z}/{x}/{y}.png',
        MAP_TILE_MAX_ZOOM: '18',
      }),
    ).toEqual({
      url: 'https://t.example/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap',
      maxZoom: 18,
    });
    expect(mapTilesFromEnv({ MAP_TILE_URL: 'http://t.example/{z}/{x}/{y}.png' }).url).toContain(
      'openstreetmap',
    );
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('distance pricing (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const codes = new Map<string, string>();
  const legs = new Map<string, RouteLeg>();
  let routerCalls = 0;
  let routerDown = false;
  const app = createApp({
    sql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    geocoder: async (q) =>
      q.city || q.text ? { lat: -22.931, lng: -42.48, precision: 'street' } : null,
    router: async (_from, to) => {
      routerCalls++;
      if (routerDown) throw new Error('down');
      return legs.get(`${to.lat},${to.lng}`) ?? null;
    },
    mapTiles: { url: 'https://t.example/{z}/{x}/{y}.png', attribution: '© OSM', maxZoom: 19 },
    otpSender: async (phone, text) => {
      codes.set(phone, /(\d{6})/.exec(text)![1]!);
    },
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `dp-${nonce}`;
  const host = `${slug}.localhost`;
  const ownerPhone = `219${String(Date.now() + 47).slice(-8)}`;
  let tenantId = '';
  let productId = '';
  let idem = 0;
  let cookie = '';

  const request = async (
    h: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const res = await app.request(`http://${h}${path}`, {
      method,
      headers: {
        host: h,
        'content-type': 'application/json',
        ...(method === 'GET'
          ? {}
          : { 'idempotency-key': `${nonce}-${++idem}`, 'x-vendua-admin': '1' }),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      body: (await res.json()) as any,
      cookie: res.headers.get('set-cookie'),
    };
  };
  const call = (method: string, path: string, body?: unknown, headers?: Record<string, string>) =>
    request(host, method, path, body, headers);
  const admin = (method: string, path: string, body?: unknown) =>
    request('core.localhost', method, `/admin/v1${path}`, body, { cookie });
  const cartWithItem = async () => {
    const s = await call('POST', '/checkout/v1/session');
    const auth = { authorization: `Bearer ${s.body.sessionToken}` };
    expect(
      (await call('POST', '/checkout/v1/cart/items', { productId, qty: 1 }, auth)).status,
    ).toBe(200);
    return auth;
  };
  const order = (
    pin: { lat: number; lng: number } | null,
    extra: Record<string, unknown> = {},
  ) => ({
    customer: { name: 'Ana', phone: '(22) 99999-0001' },
    delivery: {
      mode: 'delivery',
      street: 'Rua A',
      number: '10',
      neighborhood: 'Centro',
      ...(pin ? { lat: pin.lat, lng: pin.lng } : {}),
      ...extra,
    },
    payment: { method: 'cash' },
  });

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${'Loja ' + slug}) returning id`
    )[0]!.id;
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    await sql`
      insert into store_settings (tenant_id, hours, prep_time_minutes, min_order_cents, currency, vocabulary, city,
                                  latitude, longitude)
      values (${tenantId}, ${sql.json({ timezone: 'America/Sao_Paulo', windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '00:00' }] })},
              25, 0, 'BRL', ${sql.json({})}, 'Saquarema', ${STORE.lat}, ${STORE.lng})
    `;
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${sql.json(['Centro'])}, 400, 0, 30, 50)
    `;
    const cat = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    productId = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${cat}, 'pudim', 'Pudim', 2000) returning id`
    )[0]!.id;
    await sql`insert into merchant_users (tenant_id, name, phone, role) values (${tenantId}, 'Ana', ${ownerPhone}, 'owner')`;
    await request('core.localhost', 'POST', '/admin/v1/auth/otp/start', { phone: ownerPhone });
    const r = await request('core.localhost', 'POST', '/admin/v1/auth/otp/verify', {
      phone: ownerPhone,
      code: codes.get(ownerPhone),
    });
    expect(r.body.signedIn).toBe(true);
    cookie = `vendua_admin=${/vendua_admin=([^;]+)/.exec(r.cookie ?? '')![1]!}`;
    legs.set(`${NEAR.lat},${NEAR.lng}`, { meters: 6400, seconds: 900 });
    legs.set(`${FAR.lat},${FAR.lng}`, { meters: 12000, seconds: 1500 });
  });

  afterAll(async () => {
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  test('off by default: a pin still prices by zone, and no route is fetched', async () => {
    const q = await call('POST', '/checkout/v1/quote', { neighborhood: 'Centro', ...NEAR });
    expect(q.body).toMatchObject({ eligible: true, zoneName: 'Centro', feeCents: 400 });
    expect(routerCalls).toBe(0);
    expect((await call('GET', '/storefront/v1/store')).body.distancePricing).toBeNull();
  });

  test('admin: needs the store pin, bounds the numbers, reads back', async () => {
    const noPin = await admin('PATCH', '/store', {
      location: null,
      distancePricing: { enabled: true },
    });
    expect(noPin.status).toBe(422);
    expect(noPin.body.error.code).toBe('LOCATION_REQUIRED');
    expect((await admin('PATCH', '/store', { distancePricing: { maxKm: 0.2 } })).status).toBe(422);
    expect(
      (await admin('PATCH', '/store', { distancePricing: { feePerKmCents: -1 } })).status,
    ).toBe(422);
    const ok = await admin('PATCH', '/store', {
      distancePricing: {
        enabled: true,
        baseFeeCents: 500,
        feePerKmCents: 150,
        minFeeCents: 700,
        maxKm: 8,
        freeOverCents: 30000,
      },
    });
    expect(ok.status).toBe(200);
    expect((await admin('GET', '/store')).body.distancePricing).toEqual({
      enabled: true,
      ...PRICING,
    });
    // the store pin can't be dropped while it prices by distance
    expect((await admin('PATCH', '/store', { location: null })).body.error.code).toBe(
      'LOCATION_REQUIRED',
    );
    const g = await admin('GET', '/geocode?q=Rua%20A%2C%2010%2C%20Saquarema');
    expect(g.body.point).toEqual({ lat: -22.931, lng: -42.48, precision: 'street' });
  });

  test('storefront: the store says how it prices and where the map opens', async () => {
    const s = (await call('GET', '/storefront/v1/store')).body;
    expect(s.distancePricing).toEqual({
      ...PRICING,
      fromFeeCents: 700,
      center: { lat: STORE.lat, lng: STORE.lng },
      tiles: { url: 'https://t.example/{z}/{x}/{y}.png', attribution: '© OSM', maxZoom: 19 },
    });
    expect((await call('GET', '/storefront/v1/geocode?city=Saquarema')).body.point).toMatchObject({
      precision: 'street',
    });
    expect((await call('GET', '/storefront/v1/geocode')).body.point).toBeNull();
    expect((await call('GET', `/storefront/v1/geocode?street=${'x'.repeat(200)}`)).status).toBe(
      400,
    );
  });

  test('quote → address → checkout charge the road distance the shopper saw', async () => {
    const auth = await cartWithItem();
    const q = await call('POST', '/checkout/v1/quote', { ...NEAR }, auth);
    expect(q.body).toMatchObject({
      eligible: true,
      zoneId: 'distance',
      zoneKind: 'distance',
      feeCents: 1550,
      distanceKm: 6.4,
      distanceSource: 'route',
      etaMin: 40,
      etaMax: 50,
      freeDeliveryOverCents: 30000,
    });
    expect(q.body.totals.deliveryFeeCents).toBe(1550);

    const set = await call('POST', '/checkout/v1/cart/delivery', order(NEAR).delivery, auth);
    expect(set.body.cart.totals.deliveryFeeCents).toBe(1550);
    expect(set.body.cart.delivery).toMatchObject({ zoneId: 'distance', distanceSource: 'route' });
    const [row] = await sql<{ delivery_route: RouteQuote }[]>`
      select c.delivery_route from carts c
      where c.tenant_id = ${tenantId} and c.delivery_route is not null
      order by c.updated_at desc limit 1`;
    expect(row!.delivery_route).toEqual(leg(NEAR, 6400));

    const placed = await call('POST', '/checkout/v1/checkout', order(NEAR), auth);
    expect(placed.status).toBe(201);
    expect(placed.body.order.deliveryFeeCents).toBe(1550);
    expect(placed.body.order.totalCents).toBe(2000 + 1550);
    expect(placed.body.order.delivery).toMatchObject({
      zoneName: 'Entrega por distância',
      distanceKm: 6.4,
      distanceSource: 'route',
    });
  });

  test('past the maximum: out of zone at quote and at checkout', async () => {
    const auth = await cartWithItem();
    expect((await call('POST', '/checkout/v1/quote', { ...FAR }, auth)).body).toEqual({
      eligible: false,
      reason: 'OUT_OF_ZONE',
    });
    const r = await call('POST', '/checkout/v1/checkout', order(FAR), auth);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('OUT_OF_ZONE');
  });

  test('no route for the pin: the straight line × detour factor; no pin: the zone', async () => {
    const pin = { lat: -22.935, lng: -42.47 };
    const auth = await cartWithItem();
    const q = await call('POST', '/checkout/v1/quote', { ...pin }, auth);
    const km = Math.round(haversineKm(STORE, pin) * DETOUR_FACTOR * 10) / 10;
    expect(q.body).toMatchObject({
      distanceSource: 'estimate',
      feeCents: Math.max(700, 500 + Math.ceil(km) * 150),
    });
    const zoned = await call('POST', '/checkout/v1/checkout', order(null), auth);
    expect(zoned.status).toBe(201);
    expect(zoned.body.order.deliveryFeeCents).toBe(400);
    expect(zoned.body.order.delivery.zoneName).toBe('Centro');
  });

  test('the routing quota is spent only by a cart session with an idempotency key', async () => {
    const before = routerCalls;
    const pin = { lat: -22.941, lng: -42.46 };
    const q = await call('POST', '/checkout/v1/quote', { ...pin });
    expect(q.body).toMatchObject({ eligible: true, distanceSource: 'estimate' });
    expect(routerCalls).toBe(before);
  });

  // last: the failure pauses this app's router for a minute
  test('checkout keeps the estimate the cart showed when a route turns up later', async () => {
    const pin = { lat: -22.94, lng: -42.48 };
    legs.set(`${pin.lat},${pin.lng}`, { meters: 3000, seconds: 400 });
    const auth = await cartWithItem();
    routerDown = true;
    const set = await call('POST', '/checkout/v1/cart/delivery', order(pin).delivery, auth);
    routerDown = false;
    expect(set.body.cart.delivery.distanceSource).toBe('estimate');
    const shown = set.body.cart.totals.deliveryFeeCents;
    // another instance whose router answers: the order still charges what the cart showed
    const other = createApp({
      sql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
      cepLookup: async () => null,
      router: async () => ({ meters: 3000, seconds: 400 }),
    });
    const res = await other.request(`http://${host}/checkout/v1/checkout`, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        'idempotency-key': `${nonce}-other`,
        ...auth,
      },
      body: JSON.stringify(order(pin)),
    });
    const placed = (await res.json()) as any;
    expect(res.status).toBe(201);
    expect(placed.order.deliveryFeeCents).toBe(shown);
    expect(placed.order.delivery.distanceSource).toBe('estimate');
  });
});
