import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { pruneTenant } from '../src/admin/workers.ts';
import { eventsBetween } from '../src/admin/routes-reports.ts';
import { nominatimGeocoder } from '../src/modules/geocode.ts';
import { liveSlots } from '../src/modules/storefront-live.ts';
import { HttpError } from '../src/platform/http.ts';
import { migrate, withTenant } from '../src/platform/db.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code}` : String(e);
  }
};

describe('liveSlots', () => {
  test('caps per key (a store, an order), per IP and per process; release frees once', () => {
    const s = liveSlots({ max: 5, perIp: 3, perKey: 2 });
    const a1 = s.take('1.1.1.1', 'store-a');
    s.take('2.2.2.2', 'store-a');
    // store-a is full for everyone; store-b isn't
    expect(code(() => s.take('3.3.3.3', 'store-a'))).toBe('503 STREAM_UNAVAILABLE');
    s.take('1.1.1.1', 'store-b');
    s.take('1.1.1.1', 'store-c');
    expect(code(() => s.take('1.1.1.1', 'store-d'))).toBe('429 RATE_LIMITED');
    s.take('4.4.4.4', 'store-d');
    expect(s.count()).toBe(5);
    expect(code(() => s.take('5.5.5.5', 'store-e'))).toBe('503 STREAM_UNAVAILABLE');
    a1();
    a1();
    expect(s.count()).toBe(4);
    expect(code(() => s.take('3.3.3.3', 'store-a'))).toBe('ok');
  });
});

describe('nominatimGeocoder client share', () => {
  test('one client gets a few requests a minute; cache hits and other clients are unaffected', async () => {
    let calls = 0;
    const geocode = nominatimGeocoder({ NOMINATIM_URL: 'http://n.test' }, async () => {
      calls++;
      return new Response(JSON.stringify([]));
    });
    // each city is one request; the queue spaces them 1.1 s apart, so stay under its 3 s wait
    for (let i = 0; i < 6; i++) {
      await geocode({ city: `c${i}` }, 'ip-a');
      if (i % 2) await Bun.sleep(1100);
    }
    expect(calls).toBe(6);
    expect(await geocode({ city: 'c-new' }, 'ip-a')).toBeNull();
    expect(calls).toBe(6);
    // a cached answer costs nothing
    await geocode({ city: 'c0' }, 'ip-a');
    expect(calls).toBe(6);
    await geocode({ city: 'c-new' }, 'ip-b');
    expect(calls).toBe(7);
  }, 15_000);
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('retention and report ranges (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const slug = `aq-${crypto.randomUUID().slice(0, 8)}`;
  let tenantId = '';

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
    tenantId = (
      await sql<
        { id: string }[]
      >`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`
    )[0]!.id;
  });
  afterAll(async () => {
    if (tenantId) {
      await sql`delete from analytics_events where tenant_id = ${tenantId}`;
      await sql`delete from cart_reminders where tenant_id = ${tenantId}`;
      await sql`delete from carts where tenant_id = ${tenantId}`;
      await sql`delete from tenants where id = ${tenantId}`;
    }
    await sql.end();
  });

  test('the sargable range keeps exactly the store days the ::date filter kept', async () => {
    const instants = [
      '2026-03-01T02:59:59Z',
      '2026-03-01T03:00:00Z',
      '2026-03-03T02:59:59.999Z',
      '2026-03-03T03:00:00Z',
      '2026-03-02T12:00:00Z',
      '2018-11-04T02:59:59Z',
      '2018-11-04T03:00:00Z',
      '2019-02-17T01:59:59Z',
      '2019-02-17T02:00:00Z',
      '2019-02-17T03:00:00Z',
    ];
    for (const [tz, from, to] of [
      ['America/Sao_Paulo', '2026-03-01', '2026-03-02'],
      ['America/Sao_Paulo', '2018-11-04', '2018-11-04'],
      ['America/Sao_Paulo', '2019-02-16', '2019-02-16'],
      ['America/Manaus', '2026-03-02', '2026-03-02'],
      ['UTC', '2026-03-01', '2026-03-03'],
    ] as const) {
      const rows = await sql<{ at: Date; old: boolean; now: boolean }[]>`
        select at,
          (at at time zone ${tz})::date between ${from}::date and ${to}::date as old,
          ${eventsBetween(sql, tz, from, to)} as now
        from unnest(${instants}::timestamptz[]) as at
      `;
      for (const r of rows)
        expect({ tz, at: r.at, in: r.now }).toEqual({ tz, at: r.at, in: r.old });
    }
  });

  test('pruneTenant: old funnel events go; quiet empty carts go unless something points at them', async () => {
    await sql`
      insert into analytics_events (tenant_id, name, at, session_id)
      values (${tenantId}, 'page_view', now() - interval '14 months', 's-old'),
             (${tenantId}, 'page_view', now() - interval '11 months', 's-kept')
    `;
    const cart = async (name: string, age: string) =>
      (
        await sql<{ id: string }[]>`
          insert into carts (tenant_id, session_hash, updated_at)
          values (${tenantId}, ${`${slug}-${name}`}, now() - ${age}::interval) returning id
        `
      )[0]!.id;
    const stale = await cart('stale', '20 days');
    const recent = await cart('recent', '2 days');
    const reminded = await cart('reminded', '20 days');
    await sql`insert into cart_reminders (cart_id, tenant_id) values (${reminded}, ${tenantId})`;

    await pruneTenant(sql, tenantId);

    const sessions = await withTenant(
      sql,
      tenantId,
      (tx) =>
        tx<
          { session_id: string }[]
        >`select session_id from analytics_events where tenant_id = ${tenantId}`,
    );
    expect(sessions.map((s) => s.session_id)).toEqual(['s-kept']);
    const left = await sql<{ id: string }[]>`select id from carts where tenant_id = ${tenantId}`;
    const ids = left.map((r) => r.id);
    expect(ids).not.toContain(stale);
    expect(ids).toContain(recent);
    expect(ids).toContain(reminded);
  });
});
