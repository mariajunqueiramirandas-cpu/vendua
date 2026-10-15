// Address → approximate point, to centre the map where the customer (or the merchant) confirms
// the pin (ADR 0024). The pin is what gets priced, so a block's error here only costs a drag.
// Default: OpenStreetMap's public Nominatim — free, keyless, 1 request/second per its usage
// policy, an identifying User-Agent, results cached. NOMINATIM_URL points at another instance.

import { windowCounter } from '../platform/http.ts';
import { viaCep, type CepLookup } from './geo.ts';

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

/** `null` = nothing found or the geocoder is busy; never throws. `client` (an IP) spends from its
 *  own share of the provider's rate. */
export type Geocoder = (q: GeoQuery, client?: string) => Promise<GeoPoint | null>;

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
/** of the ~54 requests a minute the process may send, one client (an IP, across every store) gets
 *  this many: a shopper's address is a few, a script can't hold the queue for everyone */
const CLIENT_REQUESTS_PER_MIN = 6;

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
  cepLookup: CepLookup = viaCep,
): Geocoder {
  const base = (env.NOMINATIM_URL?.trim() || 'https://nominatim.openstreetmap.org').replace(
    /\/+$/,
    '',
  );
  const agent =
    env.NOMINATIM_USER_AGENT?.trim() || 'Vendua delivery pricing (https://vendua.com.br)';
  const cache = new Map<string, { at: number; value: GeoPoint | null }>();
  let nextSlot = 0;
  const clientShare = windowCounter({ windowMs: 60_000, max: CLIENT_REQUESTS_PER_MIN });

  // one request per GAP_MS across this process; false = the queue is too long, give up
  const turn = async () => {
    const now = Date.now();
    const at = Math.max(now, nextSlot);
    if (at - now > MAX_WAIT_MS) return false;
    nextSlot = at + GAP_MS;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
    return true;
  };

  const search = async (
    params: Record<string, string>,
    client: string | undefined,
  ): Promise<GeoPoint | null | 'busy'> => {
    const key = new URLSearchParams(params).toString();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
    if (client !== undefined && !clientShare(client)) return 'busy';
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

  return async (q, client) => {
    const cep = q.cep?.replace(/\D/g, '');
    const text = q.text?.trim();
    const street = q.street?.trim();
    const number = q.number?.trim();
    let city = q.city?.trim();
    let state = q.state?.trim();
    const tried = new Set<string>();
    // stop at the first hit: each attempt is a request
    const attempt = async (params: Record<string, string>, as?: GeoPoint['precision']) => {
      const key = JSON.stringify(params);
      if (tried.has(key)) return null;
      tried.add(key);
      const found = await search(params, client);
      if (found === 'busy') throw new Error('busy');
      return found && as ? { ...found, precision: as } : found;
    };
    const onStreet = (name: string) =>
      city
        ? attempt({
            street: number ? `${number} ${name}` : name,
            city,
            ...(state ? { state } : {}),
          })
        : null;
    try {
      if (text) {
        const found = await attempt({ q: text });
        if (found) return found;
      }
      if (street) {
        const found = await onStreet(street);
        if (found) return found;
      }
      // OSM barely knows Brazilian CEPs, so a postalcode search finds nothing: ViaCEP names the
      // CEP's street and bairro, and the bairro (when the street isn't mapped) is still close
      const place = cep?.length === 8 ? await cepLookup(cep).catch(() => null) : null;
      // the CEP's city beats a caller's guess (the checkout sends the store's when it has none)
      if (place?.city) {
        city = place.city;
        state = place.state ?? state;
        if (place.street) {
          const found = await onStreet(place.street);
          if (found) return found;
        }
        for (const bairro of bairrosOf(place.neighborhood)) {
          const found = await attempt(
            { q: [bairro, city, state].filter(Boolean).join(', ') },
            'postcode',
          );
          if (found) return found;
        }
      }
      if (city) return await attempt({ city, ...(state ? { state } : {}) });
    } catch {
      return null;
    }
    return null;
  };
}

/** ViaCEP's "Verde Vale (Bacaxá)" is a bairro inside a larger one: try the inner, then the outer */
function bairrosOf(name: string | null | undefined): string[] {
  const n = name?.trim();
  if (!n) return [];
  const m = /^(.+?)\s*\((.+)\)$/.exec(n);
  return m ? [m[1]!.trim(), m[2]!.trim()] : [n];
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
