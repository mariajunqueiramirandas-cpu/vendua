import { afterAll, describe, expect, setSystemTime, test } from 'bun:test';
import { Hono } from 'hono';
import postgres from 'postgres';
import type { AdminHub } from '../src/admin/live.ts';
import { createApp } from '../src/app.ts';
import { bookingToken, LINK_BOOKINGS_PER_DAY } from '../src/modules/meetings.ts';
import { PresenceTracker } from '../src/modules/presence.ts';
import { MAX_STREAMS_PER_IP, mountStorefrontEvents } from '../src/modules/storefront-live.ts';
import { errorJson, idempotency, knownOrigin, tenantMiddleware } from '../src/platform/http.ts';
import { TenantResolver, type Tenant } from '../src/platform/tenancy.ts';

const offlineSql = () => postgres('postgres://localhost:1/vendua');

describe('Host validation and the tenant cache', () => {
  test('an overlong or malformed Host is 400 before any DB query', async () => {
    const app = new Hono<{ Variables: { tenant: Tenant } }>();
    app.onError((e, c) => errorJson(e, c));
    // an unreachable DB: a query would surface as a 500
    app.use('*', tenantMiddleware(new TenantResolver(offlineSql())));
    app.get('/x', (c) => c.json({ ok: true }));
    for (const host of [`${'a'.repeat(250)}.com.br`, 'evil.com/<script>', 'a b.com', 'x%00.com']) {
      const res = await app.request('/x', { headers: { host } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
    }
  });

  test('cache is bounded and misses expire quickly', async () => {
    let queries = 0;
    const fake = Object.assign(async () => {
      queries++;
      return [];
    }) as never;
    const r = new TenantResolver(fake);
    for (let i = 0; i < 10_050; i++) await r.resolve(`h${i}.example.com`);
    expect(r.cacheSize).toBeLessThanOrEqual(10_000);

    const t0 = new Date('2026-09-30T12:00:00Z');
    setSystemTime(t0);
    try {
      queries = 0;
      await r.resolve('miss.example.com');
      await r.resolve('miss.example.com');
      expect(queries).toBe(1);
      setSystemTime(new Date(t0.getTime() + 6_000));
      await r.resolve('miss.example.com');
      expect(queries).toBe(2);
    } finally {
      setSystemTime();
    }
  });
});

describe('knownOrigin (admin links, MP back_url)', () => {
  const origin = async (host: string, adminDomain?: string, stores: string[] = []) => {
    let out = '';
    const app = new Hono();
    app.get('/o', (c) => {
      out = knownOrigin(c, {
        adminDomain,
        storeDomain: 'vendua.com.br',
        trustProxy: false,
        isStoreHost: (h) => stores.includes(h),
      });
      return c.body(null, 204);
    });
    await app.request('http://core/o', { headers: { host } });
    return out;
  };

  test('a configured admin domain always wins', async () => {
    expect(await origin('evil.com', 'painel.vendua.com.br')).toBe('https://painel.vendua.com.br');
  });

  test('an unknown Host never becomes the origin', async () => {
    expect(await origin('evil.com')).toBe('https://admin.vendua.com.br');
    expect(await origin('evil.com:443')).toBe('https://admin.vendua.com.br');
  });

  test('dev loopback, the platform hosts and resolved store hosts are kept', async () => {
    expect(await origin('localhost:8787')).toBe('http://localhost:8787');
    expect(await origin('admin.vendua.com.br')).toBe('http://admin.vendua.com.br');
    expect(await origin('loja.com', undefined, ['loja.com'])).toBe('http://loja.com');
  });
});

describe('storefront live streams per IP', () => {
  test(`caps open streams at ${MAX_STREAMS_PER_IP} per client IP`, async () => {
    const hub = { subscribe: async () => () => {} } as unknown as AdminHub;
    const fakeSql = Object.assign(async () => {}, { listen: async () => {} }) as never;
    const app = new Hono<{ Variables: { tenant: Tenant } }>();
    app.onError((e, c) => errorJson(e, c));
    app.use('*', async (c, next) => {
      c.set('tenant', { id: 't1' } as Tenant);
      await next();
    });
    const presence = new PresenceTracker(fakeSql);
    mountStorefrontEvents(app, hub, presence, { trustForwardedFor: true, proxyHops: 0 });
    const open = (ip: string) => app.request('/events', { headers: { 'x-forwarded-for': ip } });
    const streams: Response[] = [];
    for (let i = 0; i < MAX_STREAMS_PER_IP; i++) {
      const res = await open('1.1.1.1');
      expect(res.status).toBe(200);
      streams.push(res);
    }
    expect((await open('1.1.1.1')).status).toBe(429);
    const other = await open('2.2.2.2');
    expect(other.status).toBe(200);
    streams.push(other);
    // closing one frees a slot for that IP
    await streams[0]!.body!.cancel();
    let again = 429;
    for (let i = 0; i < 100 && again === 429; i++) {
      await Bun.sleep(5);
      const r = await open('1.1.1.1');
      again = r.status;
      if (r.status === 200) streams.push(r);
    }
    expect(again).toBe(200);
    for (const s of streams.slice(1)) await s.body!.cancel();
    presence.stop();
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('idempotency replay binding (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  afterAll(() => sql.end());
  let tenantId = '';
  let runs = 0;
  const app = new Hono<{ Variables: { tenant: Tenant } }>();
  app.onError((e, c) => errorJson(e, c));
  app.use('*', async (c, next) => {
    c.set('tenant', { id: tenantId, slug: 'x', name: 'x', status: 'active' });
    await next();
  });
  const handler = idempotency(sql, async () => ({ status: 201, body: { run: ++runs } }));
  app.post('/a', handler);
  app.post('/b', handler);
  const post = (path: string, key: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'idempotency-key': key, ...headers } });

  test('setup', async () => {
    const slug = `idem-${crypto.randomUUID().slice(0, 8)}`;
    tenantId = (
      await sql<{ id: string }[]>`
        insert into tenants (slug, name) values (${slug}, ${slug}) returning id
      `
    )[0]!.id;
  });

  test('same caller + route replays; another caller or route gets 422', async () => {
    const key = crypto.randomUUID();
    const first = await post('/a', key, { authorization: 'Bearer vst.cart-1.sig' });
    expect(first.status).toBe(201);
    const again = await post('/a', key, { authorization: 'Bearer vst.cart-1.sig' });
    expect(again.status).toBe(201);
    expect(again.headers.get('x-idempotent-replay')).toBe('true');
    expect(await again.json()).toEqual(await first.json());

    for (const [path, headers] of [
      ['/a', {}],
      ['/a', { authorization: 'Bearer vst.cart-2.sig' }],
      ['/a', { authorization: 'Bearer vst.cart-1.sig', 'x-vendua-customer': 'other' }],
      ['/b', { authorization: 'Bearer vst.cart-1.sig' }],
    ] as const) {
      const res = await post(path, key, headers);
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    expect(runs).toBe(1);
  });

  test('the fingerprint is a hash, never the raw credential', async () => {
    const key = crypto.randomUUID();
    await post('/a', key, { authorization: 'Bearer secret-token-xyz' });
    const [row] = await sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return tx<{ fingerprint: string }[]>`
        select fingerprint from idempotency_keys where tenant_id = ${tenantId} and key = ${key}
      `;
    });
    expect(row!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test('legacy rows (no fingerprint) still replay', async () => {
    const key = crypto.randomUUID();
    await sql.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      await tx`
        insert into idempotency_keys (tenant_id, key, response, status_code)
        values (${tenantId}, ${key}, ${tx.json({ legacy: true })}, 201)
      `;
    });
    const res = await post('/a', key, { authorization: 'Bearer anyone' });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ legacy: true });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('self-service booking cap (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl-book', autoDrain: false });
  afterAll(() => sql.end());
  const asStaff = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`select set_config('vendua.control', '1', true)`;
      return fn(tx);
    }) as Promise<T>;

  test(`a lead that booked ${LINK_BOOKINGS_PER_DAY}× in a day gets 429 BOOKING_LIMIT`, async () => {
    const leadId = await asStaff(
      async (tx) =>
        (await tx<{ id: string }[]>`insert into leads (name) values ('Loop') returning id`)[0]!.id,
    );
    // book → cancel, over and over
    await asStaff(async (tx) => {
      for (let i = 0; i < LINK_BOOKINGS_PER_DAY; i++) {
        const at = new Date(Date.now() + (2 + i) * 86_400_000);
        await tx`
          insert into meetings (lead_id, starts_at, ends_at, status, source)
          values (${leadId}, ${at}, ${new Date(at.getTime() + 1_800_000)}, 'cancelled', 'link')
        `;
      }
    });
    const res = await app.request('/book/v1/book', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        t: bookingToken(leadId, 'ctl-book'),
        start: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BOOKING_LIMIT');
  });
});
