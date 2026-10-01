// Delivery pricing. With distance pricing on (ADR 0024) an address with a confirmed pin is
// priced by its road distance from the store (`resolveDelivery`); otherwise — and for any
// address without a pin — zone resolution: bairro names (accent/case-insensitive) first, then
// the polygon containing the address, then distance from the store for radius zones.
// Storefronts can't call external APIs (contract), so Core is the only place this can live.

export interface ZoneLike {
  id: string;
  name: string;
  kind?: 'neighborhood' | 'radius' | 'polygon' | 'distance';
  neighborhoods: string[];
  /** kind='polygon': [[lat, lng], ...], ring not closed */
  polygon?: LatLng[] | null;
  fee_cents: number;
  min_order_cents: number;
  eta_min_minutes: number;
  eta_max_minutes: number;
  max_distance_km?: string | number | null;
  fee_per_km_cents?: number;
  free_delivery_over_cents?: number | null;
}

export interface Coords {
  lat: number;
  lng: number;
}

export type LatLng = [number, number];

export const foldName = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

export function haversineKm(a: Coords, b: Coords): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function validCoords(lat: unknown, lng: unknown): Coords | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export interface ZoneMatch<Z extends ZoneLike> {
  zone: Z;
  /** km from the store, when resolved by distance */
  distanceKm: number | null;
  /** fee before any free-delivery threshold */
  feeCents: number;
  /** distance pricing: a road route, or the straight line × DETOUR_FACTOR when none was had */
  distanceSource?: 'route' | 'estimate';
}

export function resolveZone<Z extends ZoneLike>(
  zones: Z[],
  where: { neighborhood?: string | null | undefined; coords?: Coords | null | undefined },
  store: Coords | null,
): ZoneMatch<Z> | null {
  if (where.neighborhood) {
    const needle = foldName(where.neighborhood);
    const hit = zones.find(
      (z) =>
        (z.kind ?? 'neighborhood') === 'neighborhood' &&
        z.neighborhoods.some((n) => foldName(n) === needle),
    );
    if (hit) return { zone: hit, distanceKm: null, feeCents: hit.fee_cents };
  }
  if (where.coords) {
    const point = where.coords;
    const poly = zones
      .filter((z) => z.kind === 'polygon' && Array.isArray(z.polygon) && z.polygon.length >= 3)
      .filter((z) => pointInPolygon(point, z.polygon!))
      .map((z) => ({ z, area: polygonArea(z.polygon!) }))
      .sort((a, b) => a.area - b.area || (a.z.id < b.z.id ? -1 : a.z.id > b.z.id ? 1 : 0))[0];
    if (poly) return { zone: poly.z, distanceKm: null, feeCents: poly.z.fee_cents };
  }
  if (where.coords && store) {
    const km = haversineKm(store, where.coords);
    const radius = zones
      .filter((z) => z.kind === 'radius' && z.max_distance_km != null)
      .map((z) => ({ z, max: Number(z.max_distance_km) }))
      .filter(({ max }) => km <= max)
      .sort((a, b) => a.max - b.max)[0];
    if (radius) {
      return {
        zone: radius.z,
        distanceKm: Math.round(km * 10) / 10,
        feeCents: radiusFeeCents(radius.z, km),
      };
    }
  }
  return null;
}

/** A radius zone's fee for an address `km` from the store, before any free-delivery threshold. */
export function radiusFeeCents(
  z: Pick<ZoneLike, 'fee_cents' | 'fee_per_km_cents'>,
  km: number,
): number {
  return z.fee_cents + Math.ceil(km) * (z.fee_per_km_cents ?? 0);
}

/** The least any address in the zone pays before free-delivery thresholds (the storefront's
 *  "a partir de"). A radius zone's nearest address lies just past the largest smaller ring
 *  (`resolveZone` gives anything inside it to that ring), or just past the store itself, and the
 *  per-km fee ceils its distance. */
export function zoneMinFeeCents(
  z: Pick<ZoneLike, 'kind' | 'fee_cents' | 'fee_per_km_cents' | 'max_distance_km'>,
  zones: readonly Pick<ZoneLike, 'kind' | 'max_distance_km'>[] = [],
): number {
  if (z.kind !== 'radius') return z.fee_cents;
  const max = Number(z.max_distance_km);
  const inner = zones
    .filter((o) => o.kind === 'radius' && o.max_distance_km != null)
    .map((o) => Number(o.max_distance_km))
    .filter((m) => m < max)
    .reduce((a, m) => Math.max(a, m), 0);
  return radiusFeeCents(z, Math.floor(inner) + 1);
}

// ── distance pricing (ADR 0024) ──────────────────────────────────────────────

export interface DistancePricing {
  baseFeeCents: number;
  feePerKmCents: number;
  minFeeCents: number;
  maxKm: number;
  freeOverCents: number | null;
}

/** A road leg Core fetched for store → pin. It lives on the cart, so checkout charges the
 *  distance the quote showed instead of asking the provider again. */
export interface RouteQuote {
  from: LatLng;
  to: LatLng;
  meters: number;
  seconds: number | null;
}

/** Roads are longer than the straight line; used only while no route could be had. */
export const DETOUR_FACTOR = 1.3;
/** Urban courier speed for an estimated leg's travel time. */
const ESTIMATE_KMH = 25;
export const DISTANCE_ZONE_ID = 'distance';

export interface DistanceZone extends ZoneLike {
  kind: 'distance';
  max_distance_km: number;
  fee_per_km_cents: number;
  free_delivery_over_cents: number | null;
}

const key5 = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/** Same store and same pin, to the 5th decimal (~1 m) — what the route was fetched for. */
export function routeMatches(route: RouteQuote | null | undefined, from: Coords, to: Coords) {
  return (
    !!route &&
    Array.isArray(route.from) &&
    Array.isArray(route.to) &&
    key5(route.from[0], route.from[1]) === key5(from.lat, from.lng) &&
    key5(route.to[0], route.to[1]) === key5(to.lat, to.lng) &&
    Number.isFinite(route.meters)
  );
}

/** base + R$/started km, never below the minimum fee — before any free-delivery threshold. */
export function distanceFeeCents(p: DistancePricing, km: number): number {
  return Math.max(p.minFeeCents, p.baseFeeCents + Math.ceil(km) * p.feePerKmCents);
}

export function priceByDistance(
  pricing: DistancePricing,
  store: Coords,
  to: Coords,
  route: RouteQuote | null | undefined,
  prepMinutes: number,
): ZoneMatch<DistanceZone> | null {
  const leg = routeMatches(route, store, to) ? route! : null;
  // the km shown is the km charged ("3,0 km" never pays for a 4th)
  const km =
    Math.round((leg ? leg.meters / 1000 : haversineKm(store, to) * DETOUR_FACTOR) * 10) / 10;
  if (km > pricing.maxKm) return null;
  const drive = Math.ceil(leg?.seconds != null ? leg.seconds / 60 : (km / ESTIMATE_KMH) * 60);
  const etaMin = prepMinutes + drive;
  return {
    zone: {
      id: DISTANCE_ZONE_ID,
      name: 'Entrega por distância',
      kind: 'distance',
      neighborhoods: [],
      fee_cents: pricing.baseFeeCents,
      min_order_cents: 0,
      eta_min_minutes: etaMin,
      eta_max_minutes: etaMin + Math.max(10, Math.ceil(drive / 2)),
      max_distance_km: pricing.maxKm,
      fee_per_km_cents: pricing.feePerKmCents,
      free_delivery_over_cents: pricing.freeOverCents,
    },
    distanceKm: km,
    feeCents: distanceFeeCents(pricing, km),
    distanceSource: leg ? 'route' : 'estimate',
  };
}

/** The one pricing entry point: a pinned address under distance pricing is priced by distance
 *  (refused past the maximum); zones price everything else. */
export function resolveDelivery<Z extends ZoneLike>(
  zones: Z[],
  where: { neighborhood?: string | null | undefined; coords?: Coords | null | undefined },
  store: Coords | null,
  distance: { pricing: DistancePricing | null; route?: RouteQuote | null; prepMinutes: number } = {
    pricing: null,
    prepMinutes: 0,
  },
): ZoneMatch<Z | DistanceZone> | null {
  if (distance.pricing && where.coords && store)
    return priceByDistance(
      distance.pricing,
      store,
      where.coords,
      distance.route,
      distance.prepMinutes,
    );
  return resolveZone(zones, where, store);
}

// ── polygons ─────────────────────────────────────────────────────────────────
// Planar maths on (lng, lat): delivery areas span a few km, far from the poles and the
// antimeridian, so the distortion never changes which side of an edge a point is on.

export const POLYGON_MAX_VERTICES = 200;
// in squared degrees; ~1 m² near the equator — anything smaller is a line, not an area
const MIN_AREA = 1e-10;
const EDGE_EPS = 1e-12;

/** Ray casting; a point on an edge or vertex counts as inside. */
export function pointInPolygon(p: Coords, ring: LatLng[]): boolean {
  const x = p.lng;
  const y = p.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) <= EDGE_EPS &&
      x >= Math.min(xi, xj) &&
      x <= Math.max(xi, xj) &&
      y >= Math.min(yi, yj) &&
      y <= Math.max(yi, yj)
    )
      return true;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shoelace area in squared degrees, longitude scaled by cos(latitude) — for ranking only. */
export function polygonArea(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const k = Math.cos((ring.reduce((s, [lat]) => s + lat, 0) / ring.length) * (Math.PI / 180));
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    twice += xj * k * yi - xi * k * yj;
  }
  return Math.abs(twice) / 2;
}

/** Validates a merchant-supplied ring: 3..200 [lat, lng] points enclosing an area. */
export function parsePolygon(v: unknown): { polygon: LatLng[] } | { error: string } {
  // +1: a closed ring (GeoJSON style) repeats its first point, which is dropped below
  if (!Array.isArray(v) || v.length > POLYGON_MAX_VERTICES + 1)
    return { error: `polygon must be a list of 3 to ${POLYGON_MAX_VERTICES} [lat, lng] points` };
  const ring: LatLng[] = [];
  for (const p of v) {
    const c = Array.isArray(p) && p.length === 2 ? validCoords(p[0], p[1]) : null;
    if (!c) return { error: 'each polygon point must be [lat, lng] within range' };
    ring.push([c.lat, c.lng]);
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 3 && first && last && first[0] === last[0] && first[1] === last[1]) ring.pop();
  if (ring.length < 3 || ring.length > POLYGON_MAX_VERTICES)
    return { error: `polygon must be a list of 3 to ${POLYGON_MAX_VERTICES} [lat, lng] points` };
  if (new Set(ring.map(([lat, lng]) => `${lat},${lng}`)).size < 3)
    return { error: 'a polygon needs at least 3 distinct points' };
  if (polygonArea(ring) < MIN_AREA) return { error: 'the polygon points do not enclose an area' };
  return { polygon: ring };
}

/** Fee after the zone's free-delivery threshold (checked against the pre-discount subtotal). */
export function effectiveFee(match: ZoneMatch<ZoneLike>, subtotalCents: number): number {
  const over = match.zone.free_delivery_over_cents;
  return over != null && subtotalCents >= over ? 0 : match.feeCents;
}

// ── CEP ──────────────────────────────────────────────────────────────────────

export interface CepResult {
  cep: string;
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
}

export type CepLookup = (cep: string) => Promise<CepResult | null>;

export const normalizeCep = (cep: string) => {
  const d = cep.replace(/\D/g, '');
  return d.length === 8 ? d : null;
};

const CEP_CACHE_MAX = 2000;
const cepCache = new Map<string, { at: number; value: CepResult | null }>();

/** ViaCEP with a bounded LRU; `null` = unknown CEP. Throws only on transport failure. */
export const viaCep: CepLookup = async (cep) => {
  const hit = cepCache.get(cep);
  if (hit && Date.now() - hit.at < 7 * 86_400_000) {
    cepCache.delete(cep);
    cepCache.set(cep, hit);
    return hit.value;
  }
  const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
    signal: AbortSignal.timeout(3500),
  });
  if (!res.ok) throw new Error(`viacep ${res.status}`);
  const body = (await res.json()) as Record<string, string | boolean>;
  const value: CepResult | null = body.erro
    ? null
    : {
        cep,
        street: (body.logradouro as string) || null,
        neighborhood: (body.bairro as string) || null,
        city: (body.localidade as string) || null,
        state: (body.uf as string) || null,
      };
  cepCache.set(cep, { at: Date.now(), value });
  if (cepCache.size > CEP_CACHE_MAX) cepCache.delete(cepCache.keys().next().value!);
  return value;
};
