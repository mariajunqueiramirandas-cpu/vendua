// Road distance for distance pricing (ADR 0024). The default provider is OpenRouteService's
// free hosted API (ORS_API_KEY); without a key, or while it fails, Core prices the straight
// line × DETOUR_FACTOR instead (geo.ts priceByDistance), so checkout never waits on it.

import type { Coords, RouteQuote } from './geo.ts';

export interface RouteLeg {
  meters: number;
  seconds: number | null;
}

/** `null` = no road between the points (an unroutable pin); throws on transport failure. */
export type Router = (from: Coords, to: Coords) => Promise<RouteLeg | null>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export function orsRouter(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: Fetch = fetch,
): Router | null {
  const key = env.ORS_API_KEY?.trim();
  if (!key) return null;
  const base = (env.ORS_URL?.trim() || 'https://api.openrouteservice.org').replace(/\/+$/, '');
  return async (from, to) => {
    const res = await fetchImpl(`${base}/v2/directions/driving-car/json`, {
      method: 'POST',
      headers: {
        authorization: key,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      // ORS snaps each point to a road within these metres
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
        radiuses: [500, 500],
      }),
      signal: AbortSignal.timeout(3000),
    });
    // 404 = "no routable point near this coordinate"
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`openrouteservice ${res.status}`);
    const body = (await res.json()) as {
      routes?: { summary?: { distance?: number; duration?: number } }[];
    };
    const summary = body.routes?.[0]?.summary;
    if (!summary) return null;
    // a zero-length route has an empty summary
    return {
      meters: Math.max(0, Math.round(summary.distance ?? 0)),
      seconds: summary.duration == null ? null : Math.round(summary.duration),
    };
  };
}

const CACHE_MAX = 5000;
const CACHE_TTL_MS = 30 * 86_400_000;
const COOLDOWN_MS = 60_000;

/** Never throws: a cached leg, a fresh one, or null (no provider, unroutable, provider down).
 *  A failure pauses calls for a minute — a free quota that ran out is not hammered. */
export function routeQuoter(router: Router | null) {
  const cache = new Map<string, { at: number; value: RouteLeg | null }>();
  let pausedUntil = 0;
  return async (from: Coords, to: Coords): Promise<RouteQuote | null> => {
    if (!router) return null;
    const key = [from.lat, from.lng, to.lat, to.lng].map((n) => n.toFixed(5)).join(',');
    const quote = (leg: RouteLeg | null): RouteQuote | null =>
      leg && {
        from: [from.lat, from.lng],
        to: [to.lat, to.lng],
        meters: leg.meters,
        seconds: leg.seconds,
      };
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      cache.delete(key);
      cache.set(key, hit);
      return quote(hit.value);
    }
    if (Date.now() < pausedUntil) return null;
    let leg: RouteLeg | null;
    try {
      leg = await router(from, to);
    } catch {
      pausedUntil = Date.now() + COOLDOWN_MS;
      return null;
    }
    cache.set(key, { at: Date.now(), value: leg });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return quote(leg);
  };
}

export type RouteQuoter = ReturnType<typeof routeQuoter>;
