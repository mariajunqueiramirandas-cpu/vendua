// Address → approximate point, to centre the map where the customer (or the merchant) confirms
// the pin (ADR 0024). The pin is what gets priced, so a block's error here only costs a drag.
// Default: OpenStreetMap's public Nominatim — free, keyless, 1 request/second per its usage
// policy, an identifying User-Agent, results cached. NOMINATIM_URL points at another instance.

export interface GeoQuery {
  /** a one-line address ("Rua das Flores, 120 — Centro, Saquarema"), tried first */
  text?: string | null;
  cep?: string | null;
  street?: string | null;
  number?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
  /** how close the point is: the door, the street, the CEP's area, or just the city */
  precision: 'address' | 'street' | 'postcode' | 'area';
}

/** `null` = nothing found or the geocoder is busy; never throws. */
export type Geocoder = (q: GeoQuery) => Promise<GeoPoint | null>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

interface NominatimHit {
  lat: string;
  lon: string;
  type?: string;
  addresstype?: string;
  place_rank?: number;
}

const CACHE_MAX = 5000;
const CACHE_TTL_MS = 30 * 86_400_000;
const GAP_MS = 1100;
/** a caller waits at most this long for its turn; past it, the map starts elsewhere */
const MAX_WAIT_MS = 3000;

function precisionOf(h: NominatimHit): GeoPoint['precision'] {
  const rank = h.place_rank ?? 0;
  if (h.type === 'postcode' || h.addresstype === 'postcode') return 'postcode';
  if (rank >= 28) return 'address';
  if (rank >= 26) return 'street';
  return 'area';
}

export function nominatimGeocoder(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: Fetch = fetch,
): Geocoder {
  const base = (env.NOMINATIM_URL?.trim() || 'https://nominatim.openstreetmap.org').replace(
    /\/+$/,
    '',
  );
  const agent =
    env.NOMINATIM_USER_AGENT?.trim() || 'Vendua delivery pricing (https://vendua.com.br)';
  const cache = new Map<string, { at: number; value: GeoPoint | null }>();
  let nextSlot = 0;

  // one request per GAP_MS across this process; false = the queue is too long, give up
  const turn = async () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    if (at - now > MAX_WAIT_MS) return false;
    nextSlot = at + GAP_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return true;
  };

  const search = async (params: Record<string, string>): Promise<GeoPoint | null | 'busy'> => {
    const key = new URLSearchParams(params).toString();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    if (!(await turn())) return 'busy';
    const url = `${base}/search?${key}&countrycodes=br&format=jsonv2&limit=1`;
    const res = await fetchImpl(url, {
      headers: { 'user-agent': agent, accept: 'application/json', 'accept-language': 'pt-BR' },
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const rows = (await res.json()) as NominatimHit[];
    const first = Array.isArray(rows) ? rows[0] : undefined;
    const lat = Number(first?.lat);
    const lng = Number(first?.lon);
    const value =
      first && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng, precision: precisionOf(first) }
        : null;
    cache.set(key, { at: Date.now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return value;
  };

  return async (q) => {
    const cep = q.cep?.replace(/\D/g, '');
    const street = q.street?.trim();
    const city = q.city?.trim();
    const state = q.state?.trim();
    // most precise first; each attempt is a request, so stop at the first hit
    const attempts: Record<string, string>[] = [];
    const text = q.text?.trim();
    if (text) attempts.push({ q: text });
    if (street && city)
      attempts.push({
        street: q.number?.trim() ? `${q.number.trim()} ${street}` : street,
        city,
        ...(state ? { state } : {}),
      });
    if (cep?.length === 8) attempts.push({ postalcode: `${cep.slice(0, 5)}-${cep.slice(5)}` });
    if (city) attempts.push({ city, ...(state ? { state } : {}) });
    try {
      for (const params of attempts) {
        const found = await search(params);
        if (found === 'busy') return null;
        if (found) return found;
      }
    } catch {
      return null;
    }
    return null;
  };
}

export interface MapTiles {
  /** raster XYZ template: {z}/{x}/{y} */
  url: string;
  attribution: string;
  maxZoom: number;
}

/** The raster tiles the pin maps draw (MAP_TILE_URL to switch provider without a release). */
export function mapTilesFromEnv(env: Record<string, string | undefined> = process.env): MapTiles {
  const url = env.MAP_TILE_URL?.trim();
  const maxZoom = Number(env.MAP_TILE_MAX_ZOOM);
  return url && /^https:\/\/[^\s]+\{z\}[^\s]*\{x\}[^\s]*\{y\}/.test(url)
    ? {
        url,
        attribution: env.MAP_TILE_ATTRIBUTION?.trim() || '© OpenStreetMap',
        maxZoom: Number.isInteger(maxZoom) && maxZoom > 0 && maxZoom <= 22 ? maxZoom : 19,
      }
    : {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      };
}
