import { createHash } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Sql } from '../platform/db.ts';
import { bodyJson, clientIp, HttpError } from '../platform/http.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { controlTx } from './control.ts';

// Privacy-first page views for Venduá's own surfaces (the marketing site, the merchant admin),
// plus the CRM's cross-store read of the storefront funnel (15-analytics.md). The collector keeps
// no cookie, IP or user agent: a visitor is a hash under a salt that lives one day, so it counts
// unique visitors per day and can't follow anyone across days, properties or back to an IP.

export const WEB_PROPERTIES = ['site', 'admin'] as const;
export type WebProperty = (typeof WEB_PROPERTIES)[number];
export const REPORT_DAYS = [7, 30, 90] as const;
export type ReportDays = (typeof REPORT_DAYS)[number];

const TZ = 'America/Sao_Paulo';
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|externalhit|curl|wget|python|go-http|node-fetch|axios|playwright|puppeteer/i;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
/** Brazil's calendar day, YYYY-MM-DD. */
export const brDay = (d = new Date()) => dayFmt.format(d);

/** Route shape, not the address: ids, phones and order numbers become `:id`; query and hash go. */
export function normalizePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.length > 400) return null;
  const segs = raw
    .split(/[?#]/)[0]!
    .split('/')
    .map((seg) => {
      let s: string;
      try {
        s = decodeURIComponent(seg);
      } catch {
        return ':id';
      }
      if (/\d{4,}|@|^[0-9a-f-]{20,}$/i.test(s)) return ':id';
      return s.toLowerCase().replace(/[^a-z0-9:_.~-]/g, '');
    });
  return segs.join('/').slice(0, 200) || '/';
}

const host = (v: unknown) => {
  if (typeof v !== 'string') return null;
  const h = v
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) && h.length <= 100 ? h : null;
};

const utm = (v: unknown) => {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase().slice(0, 60);
  return /^[a-z0-9 ._+-]+$/.test(s) ? s : null;
};

export const deviceOf = (w: unknown) =>
  typeof w !== 'number' || !(w > 0)
    ? 'desktop'
    : w < 640
      ? 'mobile'
      : w < 1024
        ? 'tablet'
        : 'desktop';

/** One process-wide cache of the day's salt; every replica gets the same one from the DB. */
let salt: { day: string; value: string } | null = null;
async function daySalt(sql: Sql, day: string): Promise<string> {
  if (salt?.day === day) return salt.value;
  const row = (await sql<{ s: string }[]>`select web_analytics_salt(${day}::date) as s`)[0]!;
  salt = { day, value: row.s };
  return row.s;
}

export interface CollectInput {
  body: Record<string, unknown>;
  ip: string;
  userAgent: string;
  /** the page's own host — a referrer from it is internal navigation, not a source */
  host: string;
  now?: Date | undefined;
}

/** Records one page view; false when it was dropped (a bot, a replayed beacon). */
export async function collectPageview(sql: Sql, input: CollectInput): Promise<boolean> {
  const b = input.body;
  const property = b.p;
  if (!WEB_PROPERTIES.includes(property as WebProperty))
    throw new HttpError(400, 'BAD_REQUEST', `p must be one of ${WEB_PROPERTIES.join(', ')}`);
  const beaconId = typeof b.id === 'string' ? b.id : '';
  if (!ID.test(beaconId)) throw new HttpError(400, 'BAD_REQUEST', 'id must be 8–64 url-safe chars');
  const path = normalizePath(b.path);
  if (!path) throw new HttpError(400, 'BAD_REQUEST', 'path must start with / (≤ 400 chars)');
  if (!input.userAgent || BOT_UA.test(input.userAgent)) return false;

  const self = host(input.host.split(':')[0]);
  const ref = host(b.ref);
  const u = (b.utm && typeof b.utm === 'object' ? b.utm : {}) as Record<string, unknown>;
  const day = brDay(input.now);
  const visitor = createHash('sha256')
    .update(`${await daySalt(sql, day)}|${property}|${input.ip}|${input.userAgent}`)
    .digest('hex')
    .slice(0, 16);
  // a plain insert: ON CONFLICT and RETURNING both need to read the table, which the collector's
  // role can't (RLS) — a replayed beacon is the unique violation instead
  try {
    await sql`
      insert into web_analytics_events
        (beacon_id, property, day, path, referrer, utm_source, utm_medium, utm_campaign, device, visitor)
      values (${beaconId}, ${property as string}, ${day}::date, ${path},
        ${ref && ref !== self ? ref : null}, ${utm(u.source)}, ${utm(u.medium)}, ${utm(u.campaign)},
        ${deviceOf(b.w)}, ${visitor})
    `;
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return false;
    throw err;
  }
}

/** Fixed window per client IP, in memory — the collector has no store to key a tenant limit by. */
function ipLimiter(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let nextSweep = 0;
  return (ip: string) => {
    const now = Date.now();
    if (now >= nextSweep) {
      nextSweep = now + windowMs;
      for (const [k, b] of hits) if (b.resetAt <= now) hits.delete(k);
    }
    const b = hits.get(ip);
    if (!b || b.resetAt <= now) hits.set(ip, { count: 1, resetAt: now + windowMs });
    else if (++b.count > max) return false;
    return true;
  };
}

// ── reports (the CRM) ──────────────────────────────────────────────────────────

export interface WebReport {
  property: WebProperty;
  days: ReportDays;
  totals: { visitors: number; pageviews: number; prevVisitors: number; prevPageviews: number };
  series: { day: string; visitors: number; pageviews: number }[];
  pages: { path: string; visitors: number; pageviews: number }[];
  referrers: { referrer: string; visitors: number }[];
  campaigns: { source: string; medium: string; campaign: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
}

export async function webReport(
  sql: Sql,
  property: WebProperty,
  days: ReportDays,
): Promise<WebReport> {
  const today = brDay();
  return controlTx(sql, async (tx) => {
    const since = tx`${today}::date - ${days - 1}::int`;
    const ev = tx`web_analytics_events where property = ${property} and day >= ${since}`;
    const [series, prev, pages, referrers, campaigns, devices] = await Promise.all([
      tx<WebReport['series']>`
        select d::date::text as day,
          coalesce(count(distinct e.visitor), 0)::int as visitors,
          count(e.id)::int as pageviews
        from generate_series(${since}, ${today}::date, interval '1 day') d
        left join web_analytics_events e on e.property = ${property} and e.day = d::date
        group by d order by d
      `,
      tx<{ visitors: number; pageviews: number }[]>`
        select coalesce(sum(v), 0)::int as visitors, coalesce(sum(n), 0)::int as pageviews from (
          select count(distinct visitor) as v, count(*) as n from web_analytics_events
          where property = ${property} and day >= ${since} - ${days}::int and day < ${since}
          group by day
        ) x
      `,
      tx<WebReport['pages']>`
        select path, count(distinct (day, visitor))::int as visitors, count(*)::int as pageviews
        from ${ev} group by path order by pageviews desc, path limit 10
      `,
      tx<WebReport['referrers']>`
        select coalesce(referrer, '') as referrer, count(distinct (day, visitor))::int as visitors
        from ${ev} group by 1 order by visitors desc, 1 limit 10
      `,
      tx<WebReport['campaigns']>`
        select utm_source as source, coalesce(utm_medium, '') as medium,
          coalesce(utm_campaign, '') as campaign, count(distinct (day, visitor))::int as visitors
        from ${ev} and utm_source is not null
        group by 1, 2, 3 order by visitors desc, 1 limit 10
      `,
      tx<WebReport['devices']>`
        select device, count(distinct (day, visitor))::int as visitors
        from ${ev} group by device order by visitors desc
      `,
    ]);
    return {
      property,
      days,
      totals: {
        // a visitor is unique per day: a range counts visitor-days
        visitors: series.reduce((t, d) => t + d.visitors, 0),
        pageviews: series.reduce((t, d) => t + d.pageviews, 0),
        prevVisitors: prev[0]?.visitors ?? 0,
        prevPageviews: prev[0]?.pageviews ?? 0,
      },
      series,
      pages,
      referrers,
      campaigns,
      devices,
    };
  });
}

interface Funnel {
  sessions: number;
  pageviews: number;
  carts: number;
  checkouts: number;
  orders: number;
  revenueCents: number;
}
export interface StorefrontReport {
  days: ReportDays;
  totals: Funnel & { stores: number };
  series: { day: string; sessions: number; orders: number }[];
  stores: (Funnel & { tenantId: string; slug: string; name: string })[];
}

/** The storefront funnel across every store (15-analytics "Platform-facing"): counts, no PII. */
export async function storefrontReport(sql: Sql, days: ReportDays): Promise<StorefrontReport> {
  const today = brDay();
  return controlTx(sql, async (tx) => {
    const since = tx`(${today}::date - ${days - 1}::int)::timestamp at time zone ${TZ}`;
    // `order_placed` is Core's, keyed by cart: it counts orders, not browsing sessions
    const funnel = tx`
      count(distinct e.session_id) filter (where e.name <> 'order_placed')::int as sessions,
      count(*) filter (where e.name = 'page_view')::int as pageviews,
      count(distinct e.session_id) filter (where e.name = 'add_to_cart')::int as carts,
      count(distinct e.session_id) filter (where e.name = 'checkout_start')::int as checkouts,
      count(*) filter (where e.name = 'order_placed')::int as orders,
      coalesce(sum(case when e.props ->> 'value' ~ '^[0-9]{1,12}$' then (e.props ->> 'value')::bigint end)
        filter (where e.name = 'order_placed'), 0)::bigint as "revenueCents"
    `;
    const [totals, series, stores] = await Promise.all([
      tx<(Funnel & { stores: number })[]>`
        select ${funnel}, count(distinct e.tenant_id)::int as stores
        from analytics_events e where e.at >= ${since}
      `,
      tx<StorefrontReport['series']>`
        select d::date::text as day,
          count(distinct e.session_id) filter (where e.name <> 'order_placed')::int as sessions,
          count(e.id) filter (where e.name = 'order_placed')::int as orders
        from generate_series(${today}::date - ${days - 1}::int, ${today}::date, interval '1 day') d
        left join analytics_events e
          on e.at >= d::timestamp at time zone ${TZ}
          and e.at < (d + interval '1 day')::timestamp at time zone ${TZ}
        group by d order by d
      `,
      tx<StorefrontReport['stores']>`
        select t.id as "tenantId", t.slug, t.name, ${funnel}
        from analytics_events e join tenants t on t.id = e.tenant_id
        where e.at >= ${since}
        group by t.id order by sessions desc, orders desc, t.slug limit 100
      `,
    ]);
    const num = <T extends object>(r: T) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          typeof v === 'string' && /Cents$/.test(k) ? Number(v) : v,
        ]),
      ) as T;
    return {
      days,
      totals: num(totals[0]!),
      series,
      stores: stores.map(num),
    };
  });
}

// ── routes ─────────────────────────────────────────────────────────────────────

export function mountWebAnalytics(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  trustProxy: boolean;
  proxyHops: number;
}) {
  const { app, sql, controlGate } = o;
  const allow = ipLimiter(120, 60_000);

  // Public, reached through the site's and the admin's own nginx (first-party, same origin).
  app.post('/analytics/v1/collect', async (c) => {
    const ip = clientIp(c, { trustForwardedFor: o.trustProxy, proxyHops: o.proxyHops });
    if (!allow(ip)) throw new HttpError(429, 'RATE_LIMITED', 'too many requests — retry later');
    const body = await bodyJson(c, 2048);
    // a browser asking not to be tracked isn't counted at all
    if (c.req.header('sec-gpc') === '1' || c.req.header('dnt') === '1')
      return c.json({ accepted: false }, 202);
    const accepted = await collectPageview(sql, {
      body,
      ip,
      userAgent: (c.req.header('user-agent') ?? '').slice(0, 400),
      host:
        (o.trustProxy ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host') ?? '',
    });
    return c.json({ accepted }, 202);
  });

  const days = (c: Context): ReportDays => {
    const d = Number(c.req.query('days') ?? '30');
    if (!REPORT_DAYS.includes(d as ReportDays))
      throw new HttpError(422, 'BAD_REQUEST', `days must be one of ${REPORT_DAYS.join(', ')}`);
    return d as ReportDays;
  };

  app.get('/control/v1/analytics/web', async (c) => {
    controlGate(c);
    const p = c.req.query('property') ?? 'site';
    if (!WEB_PROPERTIES.includes(p as WebProperty))
      throw new HttpError(
        422,
        'BAD_REQUEST',
        `property must be one of ${WEB_PROPERTIES.join(', ')}`,
      );
    c.header('cache-control', 'no-store');
    return c.json(await webReport(sql, p as WebProperty, days(c)));
  });

  app.get('/control/v1/analytics/storefronts', async (c) => {
    controlGate(c);
    c.header('cache-control', 'no-store');
    return c.json(await storefrontReport(sql, days(c)));
  });
}
