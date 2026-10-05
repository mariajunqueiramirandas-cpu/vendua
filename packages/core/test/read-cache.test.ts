import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';
import { STORE_CACHE_CHANNEL, StoreReadCache } from '../src/platform/read-cache.ts';

// The storefront read cache: a committed write to any table a read depends on drops it (the
// migration-0088 triggers notify), a read that raced a write is never kept, and time-bound
// values expire by themselves.
describe.skipIf(!process.env.TEST_DATABASE_URL)('storefront read cache (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const nonce = crypto.randomUUID().slice(0, 8);
  const slug = `rc-${nonce}`;
  const host = `${slug}.localhost`;
  let tenantId = '';
  let otherTenant = '';
  let categoryId = '';
  let productId = '';

  // the production cache: notify-driven, no per-read barrier
  const cache = new StoreReadCache(sql);
  const app = createApp({
    sql,
    sessionSecret: 's',
    controlSecret: 'ctl',
    autoDrain: false,
    cepLookup: async () => null,
    storeDomain: 'vendua.test',
    readCache: cache,
  });
  const get = async (path: string) => {
    const res = await app.request(`http://${host}${path}`, { headers: { host } });
    return (await res.json()) as any;
  };
  const price = async () =>
    (await get('/storefront/v1/catalog')).categories[0].products[0].basePriceCents as number;
  /** a notify sent now lands after every notify of a write that already committed */
  const settle = async () => {
    const tag = crypto.randomUUID();
    let seen!: () => void;
    const landed = new Promise<void>((r) => (seen = r));
    const sub = await sql.listen(STORE_CACHE_CHANNEL, (p) => p === `test|${tag}` && seen());
    await sql`select pg_notify(${STORE_CACHE_CHANNEL}, ${`test|${tag}`})`;
    await landed;
    await sub.unlisten();
  };
  const counter = () => {
    let n = 0;
    return {
      load: async <T>(v: T) => {
        n++;
        return v;
      },
      get calls() {
        return n;
      },
    };
  };

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    const store = async (s: string) =>
      (
        await sql<
          { id: string }[]
        >`insert into tenants (slug, name) values (${s}, 'Loja') returning id`
      )[0]!.id;
    tenantId = await store(slug);
    otherTenant = await store(`${slug}-b`);
    await sql`insert into domains (host, tenant_id) values (${host}, ${tenantId})`;
    categoryId = (
      await sql<{ id: string }[]>`
        insert into categories (tenant_id, slug, name) values (${tenantId}, 'doces', 'Doces') returning id`
    )[0]!.id;
    productId = (
      await sql<{ id: string }[]>`
        insert into products (tenant_id, category_id, slug, name, base_price_cents)
        values (${tenantId}, ${categoryId}, 'pudim', 'Pudim', 1000) returning id`
    )[0]!.id;
    // nothing is kept until the LISTEN is up
    expect(await cache.ready()).toBe(true);
  });
  afterAll(async () => {
    cache.stop();
    await sql.end();
  });

  test('a write to a table a read depends on drops it; other stores and tables keep theirs', async () => {
    expect(await price()).toBe(1000);
    const c = counter();
    const read = (t: string, key: string, deps: string[]) =>
      cache.read(t, key, () => c.load(key), { deps });
    await read(tenantId, 't-zones', ['delivery_zones']);
    await read(otherTenant, 't-catalog', ['products']);
    expect(c.calls).toBe(2);
    await read(tenantId, 't-zones', ['delivery_zones']);
    await read(otherTenant, 't-catalog', ['products']);
    expect(c.calls).toBe(2);

    await sql`update products set base_price_cents = 1200 where id = ${productId}`;
    await settle();
    expect(await price()).toBe(1200);
    // products changed for tenantId only: its zones and the other store's catalog stay
    await read(tenantId, 't-zones', ['delivery_zones']);
    await read(otherTenant, 't-catalog', ['products']);
    expect(c.calls).toBe(2);
  });

  test('every table a cached read lists notifies, with its store and name', async () => {
    const tables = [
      'tenants',
      'plans',
      'subscriptions',
      'domains',
      'store_settings',
      'payment_connections',
      'store_agent',
      'delivery_zones',
      'categories',
      'products',
      'product_media',
      'modifier_groups',
      'modifiers',
      'combo_slots',
      'combo_slot_items',
      'notify_requests',
      'storefront_templates',
      'storefront_tokens',
      'storefront_ops',
    ];
    const rows = await sql<{ table: string; events: number }[]>`
      select c.relname as table, count(*)::int as events from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname in ('store_cache_notify', 'store_cache_notify_truncate') and not t.tgisinternal
      group by c.relname`;
    expect(Object.fromEntries(rows.map((r) => [r.table, r.events]))).toEqual(
      Object.fromEntries(tables.map((t) => [t, 2])),
    );

    const got: string[] = [];
    const sub = await sql.listen(STORE_CACHE_CHANNEL, (p) => got.push(p));
    await sql`update tenants set name = 'Loja Nova' where id = ${tenantId}`;
    await sql`update categories set name = 'Doces finos' where id = ${categoryId}`;
    await settle();
    await sub.unlisten();
    expect(got).toContain(`${tenantId}|tenants`);
    expect(got).toContain(`${tenantId}|categories`);
  });

  test('a read that raced a committed write is handed back but not kept', async () => {
    const c = counter();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = cache.read(
      tenantId,
      'race',
      async () => {
        await gate;
        return c.load('old');
      },
      { deps: ['store_settings'] },
    );
    await sql`insert into store_settings (tenant_id) values (${tenantId})
              on conflict (tenant_id) do update set tagline = 'x'`;
    await settle();
    release();
    expect(await first).toBe('old');
    expect(
      await cache.read(tenantId, 'race', () => c.load('new'), { deps: ['store_settings'] }),
    ).toBe('new');
    expect(c.calls).toBe(2);
  });

  test('until and keep: a value past its time or not worth keeping is read again', async () => {
    const c = counter();
    const opts = { deps: ['products'], until: () => Date.now() + 40 };
    await cache.read(tenantId, 'timed', () => c.load(1), opts);
    await cache.read(tenantId, 'timed', () => c.load(1), opts);
    expect(c.calls).toBe(1);
    await Bun.sleep(60);
    await cache.read(tenantId, 'timed', () => c.load(1), opts);
    expect(c.calls).toBe(2);

    const none = { deps: ['products'], keep: (v: null) => v !== null };
    await cache.read(tenantId, 'missing', () => c.load(null), none);
    await cache.read(tenantId, 'missing', () => c.load(null), none);
    expect(c.calls).toBe(4);
  });

  test('concurrent misses share one load; kept values are frozen', async () => {
    const c = counter();
    const load = async () => {
      await Bun.sleep(10);
      return c.load({ settings: { hours: { windows: [1] } } });
    };
    const [a, b] = await Promise.all([
      cache.read(tenantId, 'shared', load, { deps: ['store_settings'] }),
      cache.read(tenantId, 'shared', load, { deps: ['store_settings'] }),
    ]);
    expect(c.calls).toBe(1);
    expect(a).toBe(b);
    expect(() => {
      (a.settings.hours.windows as number[]).push(2);
    }).toThrow();
  });

  test('a store evicted mid-load never hands that load to a read after a write', async () => {
    const small = new StoreReadCache(sql, { maxStores: 1 });
    expect(await small.ready()).toBe(true);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = small.read(
      tenantId,
      'k',
      async () => {
        await gate;
        return 'before';
      },
      { deps: ['products'] },
    );
    // another store takes the only slot, then a write lands for the first one
    await small.read(otherTenant, 'k', async () => 'other', { deps: ['products'] });
    small.invalidate(tenantId, 'products');
    const after = small.read(tenantId, 'k', async () => 'after', { deps: ['products'] });
    release();
    expect(await first).toBe('before');
    expect(await after).toBe('after');
    small.stop();
  });

  test('the default (strict) cache sees a write on the very next read', async () => {
    const strict = createApp({
      sql,
      sessionSecret: 's',
      controlSecret: 'ctl',
      autoDrain: false,
      cepLookup: async () => null,
      storeDomain: 'vendua.test',
    });
    const zones = async () =>
      (
        (await (
          await strict.request(`http://${host}/storefront/v1/zones`, { headers: { host } })
        ).json()) as any
      ).zones.map((z: any) => z.name);
    expect(await zones()).toEqual([]);
    await sql`
      insert into delivery_zones (tenant_id, name, neighborhoods, fee_cents, eta_min_minutes, eta_max_minutes)
      values (${tenantId}, 'Centro', ${['Centro']}, 500, 30, 50)`;
    expect(await zones()).toEqual(['Centro']);
  });
});
