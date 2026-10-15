// Address → approximate point, to centre the map where the customer (or the merchant) confirms
// the pin (ADR 0024). The pin is what gets priced, so a block's error here only costs a drag.
// Default: OpenStreetMap's public Nominatim — free, keyless, 1 request/second per its usage
// policy, an identifying User-Agent, results cached. NOMINATIM_URL points at another instance.

import { withTenant, type Sql } from '../platform/db.ts';
import { windowCounter } from '../platform/http.ts';
import { foldName, haversineKm, validCoords, viaCep, type CepLookup } from './geo.ts';

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

// ── street suggestions while the address is typed ───────────────────────────
// Nominatim's usage policy forbids autocomplete on the public server; Photon (komoot) is made for
// it: same OSM data, typo- and prefix-tolerant, keyless, fair use (heavy use is throttled).
// PHOTON_URL points at a self-hosted instance when traffic outgrows that.

export interface PlaceHit {
  /** "Rua Barão de Jaguará" */
  street: string;
  /** a house OSM knows; null = the street */
  number: string | null;
  neighborhood: string | null;
  city: string | null;
  /** UF ("SP") */
  state: string | null;
  /** 8 digits — OSM's, often the street's segment or the whole city's */
  cep: string | null;
  lat: number;
  lng: number;
  precision: 'address' | 'street';
}

export interface PlaceQuery {
  text: string;
  /** results near here rank first (the store, or its city) */
  near?: { lat: number; lng: number } | null;
}

/** `[]` = nothing, too short, or over budget; never throws. */
export type PlaceSearch = (q: PlaceQuery, client?: string) => Promise<PlaceHit[]>;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: Record<string, string | undefined>;
}

const UF: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};
const fold = foldName;
const ufOf = (state: string | undefined) => (state ? (UF[fold(state)] ?? null) : null);

export const PLACE_QUERY_MIN = 3;
export const PLACE_QUERY_MAX = 120;
const PLACES_SHOWN = 5;
const NEAR_KM = 60;
/** words that name a kind of street, or join a name, not the street itself */
const GENERIC = new Set([
  'rua',
  'avenida',
  'av',
  'travessa',
  'estrada',
  'rodovia',
  'alameda',
  'praca',
  'largo',
  'beco',
  'via',
  'das',
  'dos',
]);
/** the whole process's share of the public instance */
const PLACES_PER_MIN = 120;
/** a shopper typing a street, debounced, is well under this */
const PLACES_CLIENT_PER_MIN = 40;
const PLACES_CACHE_TTL_MS = 86_400_000;
// Brazil, minLon,minLat,maxLon,maxLat
const BR_BBOX = '-74.1,-33.8,-34.7,5.3';

export function photonPlaces(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: Fetch = fetch,
): PlaceSearch {
  const base = (env.PHOTON_URL?.trim() || 'https://photon.komoot.io').replace(/\/+$/, '');
  const agent = env.NOMINATIM_USER_AGENT?.trim() || 'Vendua address search (https://vendua.com.br)';
  const cache = new Map<string, { at: number; value: PlaceHit[] }>();
  const processShare = windowCounter({ windowMs: 60_000, max: PLACES_PER_MIN });
  const clientShare = windowCounter({ windowMs: 60_000, max: PLACES_CLIENT_PER_MIN });

  return async (q, client) => {
    const text = q.text.replace(/\s+/g, ' ').trim().slice(0, PLACE_QUERY_MAX);
    if (text.length < PLACE_QUERY_MIN) return [];
    // ~10 km cells: neighbours share a cache entry and the bias barely moves
    const near = q.near
      ? { lat: Math.round(q.near.lat * 10) / 10, lng: Math.round(q.near.lng * 10) / 10 }
      : null;
    const key = `${fold(text)}|${near ? `${near.lat},${near.lng}` : ''}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < PLACES_CACHE_TTL_MS) return hit.value;
    if (client !== undefined && !clientShare(client)) return [];
    if (!processShare('all')) return [];
    const params = new URLSearchParams({ q: text, limit: '10', lang: 'default', bbox: BR_BBOX });
    params.append('layer', 'house');
    params.append('layer', 'street');
    if (near) {
      params.set('lat', String(near.lat));
      params.set('lon', String(near.lng));
    }
    let features: PhotonFeature[];
    try {
      const res = await fetchImpl(`${base}/api/?${params}`, {
        headers: { 'user-agent': agent, accept: 'application/json' },
        // the public instance can take ~2 s; a slow list beats none (a miss isn't cached)
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return [];
      const body = (await res.json()) as { features?: PhotonFeature[] };
      features = Array.isArray(body?.features) ? body.features : [];
    } catch {
      return [];
    }
    const words = fold(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !GENERIC.has(w));
    const typedNumber = /\b(\d{1,6})\b/.exec(text)?.[1] ?? null;
    const seen = new Set<string>();
    const value: PlaceHit[] = [];
    for (const f of features) {
      const p = f.properties ?? {};
      const [lng, lat] = f.geometry?.coordinates ?? [];
      if (p.countrycode !== 'BR' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const house = p.type === 'house';
      const street = (house ? p.street : p.name)?.trim().slice(0, 120);
      if (!street) continue;
      // Photon pads a typed number with any street that has that number: keep the named one
      const streetWords = fold(street).split(/[^a-z0-9]+/);
      if (words.length && !words.some((w) => streetWords.some((s) => s.startsWith(w)))) continue;
      // a house is trusted only as the number the shopper typed (a bus stop's "1600" isn't)
      const number =
        house && typedNumber && p.housenumber?.trim() === typedNumber ? typedNumber : null;
      // OSM in Brazil tags the bairro as a suburb (Photon's district); a quarter is the fallback
      const neighborhood = (p.district ?? p.locality)?.trim().slice(0, 80) ?? null;
      const city = p.city?.trim().slice(0, 80) ?? null;
      // one road comes back in several segments: one row per street, bairro and city
      const id = fold([street, number, neighborhood, city].join('|'));
      if (seen.has(id)) continue;
      seen.add(id);
      const cep = p.postcode?.replace(/\D/g, '') ?? '';
      value.push({
        street,
        number,
        neighborhood,
        city,
        state: ufOf(p.state),
        cep: cep.length === 8 ? cep : null,
        lat: lat!,
        lng: lng!,
        precision: number ? 'address' : 'street',
      });
    }
    // Photon's bias is soft: what is within reach of the store goes first, in Photon's order
    if (near) {
      const close = (h: PlaceHit) => haversineKm(near, h) <= NEAR_KM;
      value.sort((x, y) => Number(close(y)) - Number(close(x)));
    }
    value.splice(PLACES_SHOWN);
    cache.set(key, { at: Date.now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
    return value;
  };
}

const NEAR_TTL_MS = 10 * 60_000;
const NEAR_MAX = 5000;

/** Where a store's suggestions centre: its own pin, else its city (placed once, then cached by the
 *  geocoder). The read is memoised per store, so typing doesn't open a tx per keystroke. */
export function storeNearby(sql: Sql, geocode: Geocoder) {
  const memo = new Map<string, { at: number; value: { lat: number; lng: number } | null }>();
  return async (tenantId: string) => {
    const hit = memo.get(tenantId);
    if (hit && Date.now() - hit.at < NEAR_TTL_MS) return hit.value;
    const [s] = await withTenant(
      sql,
      tenantId,
      (tx) => tx<{ latitude: number | null; longitude: number | null; city: string | null }[]>`
        select latitude, longitude, city from store_settings where tenant_id = ${tenantId}`,
    );
    // the geocoder is an HTTP call: never inside the tx
    const value =
      validCoords(s?.latitude ?? null, s?.longitude ?? null) ??
      (s?.city ? await geocode({ city: s.city }) : null);
    const near = value ? { lat: value.lat, lng: value.lng } : null;
    memo.set(tenantId, { at: Date.now(), value: near });
    if (memo.size > NEAR_MAX) memo.delete(memo.keys().next().value!);
    return near;
  };
}
