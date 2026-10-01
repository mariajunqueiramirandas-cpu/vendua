// Delivery-zone resolution: bairro names (accent/case-insensitive) first, then the
// polygon containing the address, then distance from the store for radius zones. Coordinates come from the customer's
// device ("usar minha localização") or a CEP lookup Core performs — storefronts
// can't call external APIs (contract), so Core is the only place this can live.

export interface ZoneLike {
  id: string;
  name: string;
  kind?: 'neighborhood' | 'radius' | 'polygon';
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
 *  "a partir de"). A real address is never 0 km from the store, so a per-km zone charges at
 *  least its first km. */
export function zoneMinFeeCents(
  z: Pick<ZoneLike, 'kind' | 'fee_cents' | 'fee_per_km_cents'>,
): number {
  return z.kind === 'radius' ? radiusFeeCents(z, Number.MIN_VALUE) : z.fee_cents;
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
