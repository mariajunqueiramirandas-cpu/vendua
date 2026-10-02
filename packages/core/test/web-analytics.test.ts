import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';
import {
  brDay,
  collectPageview,
  deviceOf,
  normalizePath,
  visitorHash,
} from '../src/modules/web-analytics.ts';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';

describe('page view normalising', () => {
  test('paths keep the route, never ids, phones, query or hash', () => {
    expect(normalizePath('/precos/?utm_source=ig#top')).toBe('/precos/');
    expect(normalizePath('/pedidos/1042')).toBe('/pedidos/:id');
    expect(normalizePath('/clientes/5511999990000')).toBe('/clientes/:id');
    expect(normalizePath('/cardapio/produto/3f1c2a9e-0d4b-4c6e-9a51-7b2f0c1d8e33')).toBe(
      '/cardapio/produto/:id',
    );
    expect(normalizePath('/a/joao%40mail.com')).toBe('/a/:id');
    expect(normalizePath('/Comecar')).toBe('/comecar');
    expect(normalizePath('https://x.com/')).toBeNull();
    expect(normalizePath(42)).toBeNull();
  });

  test('device is a viewport class, not a user agent', () => {
    expect(deviceOf(375)).toBe('mobile');
    expect(deviceOf(820)).toBe('tablet');
    expect(deviceOf(1440)).toBe('desktop');
    expect(deviceOf('wide')).toBe('desktop');
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('web analytics (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const app = createApp({ sql, sessionSecret: 's', controlSecret: 'ctl', autoDrain: false });
  // letters only: 4+ digits in a path segment would be normalised to :id
  const run = Array.from(
    { length: 8 },
    () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)],
  ).join('');
  const slug = `wa-${run}`;
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
    await sql`delete from web_analytics_events where path like ${`/t-${run}%`}`;
    if (tenantId) await sql`delete from tenants where id = ${tenantId}`;
    await sql.end();
  });

  const collect = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    app.request('/analytics/v1/collect', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': UA,
        host: 'vendua.com.br',
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const rows = () =>
    sql<
      {
        path: string;
        referrer: string | null;
        visitor: string;
        device: string;
        utm_source: string | null;
      }[]
    >`
      select path, referrer, visitor, device, utm_source from web_analytics_events
      where path like ${`/t-${run}%`} order by id
    `;

  test('one page view per beacon id; no IP or user agent is stored', async () => {
    const id = `b${run}aaaa`;
    const view = {
      p: 'site',
      id,
      path: `/t-${run}/?utm_source=Instagram`,
      ref: 'www.google.com',
      w: 390,
      utm: { source: 'Instagram', medium: 'bio' },
    };
    const first = await collect(view);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: true });
    expect(await (await collect(view)).json()).toEqual({ accepted: false });
    const [r, ...rest] = await rows();
    expect(rest).toHaveLength(0);
    expect(r).toMatchObject({
      path: `/t-${run}/`,
      referrer: 'google.com',
      device: 'mobile',
      utm_source: 'instagram',
    });
    expect(r!.visitor).toMatch(/^[0-9a-f]{16}$/);
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'web_analytics_events'
    `;
    expect(cols.map((c) => c.column_name)).not.toContain('ip');
    expect(cols.map((c) => c.column_name)).not.toContain('user_agent');
  });

  test('bots, Do Not Track and Global Privacy Control are not counted', async () => {
    const view = (n: string) => ({ p: 'site', id: `b${run}${n}`, path: `/t-${run}/x` });
    expect(await (await collect(view('bot1'), { 'user-agent': 'Googlebot/2.1' })).json()).toEqual({
      accepted: false,
    });
    expect(await (await collect(view('gpc1'), { 'sec-gpc': '1' })).json()).toEqual({
      accepted: false,
    });
    expect(await (await collect(view('dnt1'), { dnt: '1' })).json()).toEqual({ accepted: false });
    expect((await rows()).filter((r) => r.path === `/t-${run}/x`)).toHaveLength(0);
  });

  test('bad input is a stable 400', async () => {
    expect((await collect({ p: 'crm', id: `b${run}zzzz`, path: '/' })).status).toBe(400);
    expect((await collect({ p: 'site', id: 'x', path: '/' })).status).toBe(400);
    expect((await collect({ p: 'site', id: `b${run}zzzz`, path: 'nope' })).status).toBe(400);
  });

  test('a visitor hash lives one day: the DB picks the day, minting it deletes every other salt', async () => {
    const h = (salt: string) => visitorHash(salt, 'admin', '203.0.113.9', UA);
    expect(h('a')).toBe(h('a'));
    expect(h('a')).not.toBe(h('b'));
    expect(h('a')).toMatch(/^[0-9a-f]{16}$/);
    // yesterday's and a stray future salt: both go when today's is minted
    await sql`delete from web_analytics_salts`;
    await sql`
      insert into web_analytics_salts (day, salt) values
        (current_date - 1, 'old'), (current_date + 30, 'future')
    `;
    const [minted] = await sql<{ day: string; salt: string }[]>`
      select day::text, salt from web_analytics_salt()
    `;
    expect(minted!.day).toBe(brDay());
    expect(minted!.salt).toMatch(/^[0-9a-f]{64}$/);
    const salts = await sql<{ day: string }[]>`select day::text from web_analytics_salts`;
    expect(salts.map((s) => s.day)).toEqual([brDay()]);
    // the same day hands back the same salt
    const [again] = await sql<{ salt: string }[]>`select salt from web_analytics_salt()`;
    expect(again!.salt).toBe(minted!.salt);
  });

  test('expiry runs without traffic: stale salts and page views past 13 months go', async () => {
    await sql`insert into web_analytics_salts (day, salt) values (current_date - 3, 'stale')
      on conflict do nothing`;
    await sql`
      insert into web_analytics_events (beacon_id, property, day, at, path, device, visitor)
      values (${`b${run}old1`}, 'site', current_date - 400, now() - interval '14 months',
        ${`/t-${run}/old`}, 'mobile', '0123456789abcdef')
    `;
    await sql.begin(async (tx) => {
      await tx`set local role vendua_app`;
      await tx`select web_analytics_prune()`;
    });
    const salts = await sql<{ day: string }[]>`select day::text from web_analytics_salts`;
    expect(salts.every((x) => x.day === brDay())).toBe(true);
    expect((await rows()).filter((r) => r.path === `/t-${run}/old`)).toHaveLength(0);
  });

  test('a visitor from google who opens another page is google, not also direct', async () => {
    const before = await app.request('/control/v1/analytics/web?property=admin&days=7', {
      headers: { 'x-vendua-control': 'ctl' },
    });
    const direct = (r: { referrers: { referrer: string; visitors: number }[] }) =>
      r.referrers.find((x) => x.referrer === '')?.visitors ?? 0;
    const d0 = direct((await before.json()) as never);
    const ip = { 'x-forwarded-for': '192.0.2.44', 'user-agent': `${UA} ${run}` };
    await collect(
      { p: 'admin', id: `b${run}ref1`, path: `/t-${run}/a`, ref: `ref-${run}.com` },
      ip,
    );
    await collect({ p: 'admin', id: `b${run}ref2`, path: `/t-${run}/b` }, ip);
    const after = (await (
      await app.request('/control/v1/analytics/web?property=admin&days=7', {
        headers: { 'x-vendua-control': 'ctl' },
      })
    ).json()) as { referrers: { referrer: string; visitors: number }[] };
    expect(after.referrers.find((x) => x.referrer === `ref-${run}.com`)?.visitors).toBe(1);
    expect(direct(after)).toBe(d0);
  });

  test('utm values that look like a phone or an order number are dropped', async () => {
    await collect({
      p: 'site',
      id: `b${run}utm1`,
      path: `/t-${run}/utm`,
      utm: { source: '5511987654321', medium: 'whatsapp' },
    });
    const r = (await rows()).find((x) => x.path === `/t-${run}/utm`);
    expect(r?.utm_source).toBeNull();
  });

  test('the CRM reads the site report and the cross-store funnel; others get 404', async () => {
    const staff = { 'x-vendua-control': 'ctl' };
    expect((await app.request('/control/v1/analytics/web?property=site&days=7')).status).toBe(404);
    expect((await app.request('/control/v1/analytics/web?days=5', { headers: staff })).status).toBe(
      422,
    );
    expect(
      (await app.request('/control/v1/analytics/web?property=crm', { headers: staff })).status,
    ).toBe(422);

    const web = await app.request('/control/v1/analytics/web?property=site&days=7', {
      headers: staff,
    });
    expect(web.status).toBe(200);
    const w = (await web.json()) as {
      totals: { visitors: number; pageviews: number };
      series: unknown[];
      pages: { path: string; pageviews: number }[];
      referrers: { referrer: string }[];
    };
    expect(w.series).toHaveLength(7);
    expect(w.totals.pageviews).toBeGreaterThanOrEqual(1);
    expect(w.pages.find((p) => p.path === `/t-${run}/`)?.pageviews).toBe(1);
    expect(w.referrers.map((r) => r.referrer)).toContain('google.com');

    await sql.begin(async (tx) => {
      await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
      await tx`
        insert into analytics_events (tenant_id, name, at, session_id, props) values
          (${tenantId}, 'page_view', now(), 's1aaaaaaaa', '{}'),
          (${tenantId}, 'page_view', now(), 's2aaaaaaaa', '{}'),
          (${tenantId}, 'add_to_cart', now(), 's1aaaaaaaa', '{}'),
          (${tenantId}, 'checkout_start', now(), 's1aaaaaaaa', '{}'),
          (${tenantId}, 'order_placed', now(), 'cartaaaaaa', ${tx.json({ value: 4590 })})
      `;
      // revenue is the orders' own: a cancelled one doesn't count
      for (const [n, state, total] of [
        [1, 'delivered', 4590],
        [2, 'cancelled', 9900],
      ] as const) {
        const [cart] = await tx<{ id: string }[]>`
          insert into carts (tenant_id, session_hash) values (${tenantId}, ${`h${run}${n}`}) returning id
        `;
        await tx`
          insert into orders (tenant_id, cart_id, number, customer, delivery, payment,
            subtotal_cents, total_cents, state)
          values (${tenantId}, ${cart!.id}, ${n}, '{}', '{}', '{}', ${total}, ${total}, ${state})
        `;
      }
    });
    const sf = await app.request('/control/v1/analytics/storefronts?days=7', { headers: staff });
    expect(sf.status).toBe(200);
    const s = (await sf.json()) as {
      series: unknown[];
      stores: {
        slug: string;
        sessions: number;
        pageviews: number;
        carts: number;
        checkouts: number;
        ordered: number;
        orders: number;
        revenueCents: number;
      }[];
      totals: { avgTicketCents: number | null };
    };
    expect(s.series).toHaveLength(7);
    expect(s.stores.find((r) => r.slug === slug)).toMatchObject({
      sessions: 2,
      pageviews: 2,
      carts: 1,
      checkouts: 1,
      ordered: 1,
      orders: 1,
      revenueCents: 4590,
    });
    expect(s.totals.avgTicketCents).toBeGreaterThan(0);
  });

  test('the app role collects (salt through the definer function) without reading back', async () => {
    const ok = await sql.begin(async (tx) => {
      await tx`set local role vendua_app`;
      const [salt] = await tx<{ s: string }[]>`select salt as s from web_analytics_salt()`;
      expect(salt!.s).toMatch(/^[0-9a-f]{64}$/);
      return collectPageview(tx as never, {
        body: { p: 'site', id: `b${run}role`, path: `/t-${run}/role` },
        ip: '198.51.100.7',
        userAgent: UA,
        host: 'vendua.com.br',
      });
    });
    expect(ok).toBe(true);
    expect((await rows()).filter((r) => r.path === `/t-${run}/role`)).toHaveLength(1);
  });

  test('outside vendua.control the app role reads no page views and no order totals', async () => {
    const seen = await sql.begin(async (tx) => {
      await tx`set local role vendua_app`;
      return tx`
        select (select count(*) from web_analytics_events)::int as views,
          (select count(*) from store_order_days(current_date - 30))::int as order_days
      `;
    });
    expect(seen[0]).toEqual({ views: 0, order_days: 0 });
  });
});
