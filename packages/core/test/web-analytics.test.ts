import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { createApp } from '../src/app.ts';
import { migrate } from '../src/platform/db.ts';
import { brDay, collectPageview, deviceOf, normalizePath } from '../src/modules/web-analytics.ts';

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
    await sql`delete from web_analytics_salts where day > now()::date + 1`;
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

  test('a visitor hash lives one day: the next day it is another hash and the old salt is gone', async () => {
    const at = (iso: string) => new Date(iso);
    const input = (id: string, now: Date) => ({
      body: { p: 'admin', id: `b${run}${id}`, path: `/t-${run}/day` },
      ip: '203.0.113.9',
      userAgent: UA,
      host: 'painel.vendua.com.br',
      now,
    });
    await collectPageview(sql, input('d1a', at('2099-01-01T15:00:00Z')));
    await collectPageview(sql, input('d1b', at('2099-01-01T16:00:00Z')));
    await collectPageview(sql, input('d2a', at('2099-01-02T15:00:00Z')));
    const v = (await rows()).filter((r) => r.path === `/t-${run}/day`).map((r) => r.visitor);
    expect(v[0]).toBe(v[1]!);
    expect(v[2]).not.toBe(v[0]!);
    const salts = await sql<{ day: string }[]>`select day::text from web_analytics_salts`;
    expect(salts.map((s) => s.day)).toEqual(['2099-01-02']);
    // leave today's salt for the next run instead of a future one
    await sql`delete from web_analytics_salts`;
    await collectPageview(sql, input('d3a', new Date()));
    expect(brDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
        orders: number;
        revenueCents: number;
      }[];
    };
    expect(s.series).toHaveLength(7);
    expect(s.stores.find((r) => r.slug === slug)).toMatchObject({
      sessions: 2,
      pageviews: 2,
      carts: 1,
      checkouts: 1,
      orders: 1,
      revenueCents: 4590,
    });
  });

  test('the app role collects (salt through the definer function) without reading back', async () => {
    const ok = await sql.begin(async (tx) => {
      await tx`set local role vendua_app`;
      const [salt] = await tx<{ s: string }[]>`select web_analytics_salt(${brDay()}::date) as s`;
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

  test('the collector never reads page views back', async () => {
    // the app role (no vendua.control) can insert but sees nothing
    const seen = await sql.begin(async (tx) => {
      await tx`set local role vendua_app`;
      return tx`select count(*)::int as n from web_analytics_events`;
    });
    expect(seen[0]!.n).toBe(0);
  });
});
