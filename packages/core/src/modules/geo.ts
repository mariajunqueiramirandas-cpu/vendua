// Delivery-zone resolution: bairro names (accent/case-insensitive) first, then
// distance from the store for radius zones. Coordinates come from the customer's
// device ("usar minha localização") or a CEP lookup Core performs — storefronts
// can't call external APIs (contract), so Core is the only place this can live.

export interface ZoneLike {
  id: string;
  name: string;
  kind?: 'neighborhood' | 'radius';
  neighborhoods: string[];
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
      (z) => z.kind !== 'radius' && z.neighborhoods.some((n) => foldName(n) === needle),
    );
    if (hit) return { zone: hit, distanceKm: null, feeCents: hit.fee_cents };
  }
  if (where.coords && store) {
    const km = haversineKm(store, where.coords);
    const radius = zones
      .filter((z) => z.kind === 'radius' && z.max_distance_km != null)
      .map((z) => ({ z, max: Number(z.max_distance_km) }))
      .filter(({ max }) => km <= max)
      .sort((a, b) => a.max - b.max)[0];
    if (radius) {
      const perKm = radius.z.fee_per_km_cents ?? 0;
      return {
        zone: radius.z,
        distanceKm: Math.round(km * 10) / 10,
        feeCents: radius.z.fee_cents + Math.ceil(km) * perKm,
      };
    }
  }
  return null;
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
