// A store on the merchant's own domain (docs/menu-import.md §4.4): which platform serves it.
// The platforms answer first, on their own hosts: Goomer through DNS, OlaClick and Saipos
// through their host lookups. Only when none claims the host does the merchant's server get one
// GET (Cardápio Web and Delivery Direto have no lookup), and that GET lives here alone: DNS
// resolved once with every address checked, a connection to the address that was checked, no
// redirect followed, 256 KB at most.

import { lookup, resolveCname } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { isPrivateHost } from '../../platform/net-guard.ts';
import { isPublicHostname } from './adapters/index.ts';
import { cardapioweb } from './adapters/cardapioweb.ts';
import { deliverydireto } from './adapters/deliverydireto.ts';
import { goomer } from './adapters/goomer.ts';
import { olaclick } from './adapters/olaclick.ts';
import { saipos } from './adapters/saipos.ts';
import { numOf } from './adapters/shared.ts';
import { isRaw, str, type Adapter } from './adapters/types.ts';
import { CHALLENGE, ImportFailure, USER_AGENT, createImportHttp } from './http.ts';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export const PLACE = {
  dnsMs: 5_000,
  lookupsMs: 20_000,
  // per platform: its lookup and one redirect
  lookupRequests: 2,
  pageMs: 8_000,
  pageBytes: 256 * 1024,
};
/** the longest a placement takes, added to the read lease */
export const PLACE_MS = 2 * PLACE.dnsMs + PLACE.lookupsMs + PLACE.pageMs;

export interface Placed {
  adapter: Adapter;
  ref: string;
}

export interface Dns {
  /** the host's CNAME targets */
  cname(host: string): Promise<string[]>;
  /** every A and AAAA address */
  lookup(host: string): Promise<string[]>;
}

/** What the merchant's server answered; a redirect's body is never read. */
export interface Page {
  status: number;
  location: string | null;
  body: string;
}

/** The GET to `ip`, already checked, for `host`. */
export type Fingerprint = (host: string, ip: string) => Promise<Page>;

export interface PlaceDeps {
  /** the platform lookups (through createImportHttp) */
  fetch?: Fetch;
  dns?: Partial<Dns>;
  fingerprint?: Fingerprint;
}

const systemDns: Dns = {
  cname: (host) => resolveCname(host),
  lookup: async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address),
};

function within<T>(ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ImportFailure('TIMEOUT', 'dns timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The adapter's own reading of one of its links: the ref a pasted platform URL would give. */
function on(adapter: Adapter, link: string): Placed | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const m = adapter.match(url);
  return m ? { adapter, ref: m.ref } : null;
}

/** Goomer keeps a store's domain as a CNAME to `<slug>.goomer.app`. */
async function viaCname(host: string, cname: Dns['cname']): Promise<Placed | null> {
  const targets = await within(PLACE.dnsMs, cname(host)).catch(() => [] as string[]);
  for (const t of targets) {
    const placed = on(goomer, `https://${t.toLowerCase().replace(/\.$/, '')}/`);
    if (placed) return placed;
  }
  return null;
}

/** One platform's host lookup on its own API host; the ref is the host, as its read expects. */
async function viaLookup(
  adapter: Adapter,
  url: string,
  claims: (body: unknown) => boolean,
  host: string,
  d: PlaceDeps,
  deadline: number,
): Promise<Placed | null | 'blocked'> {
  const http = createImportHttp({
    hosts: adapter.hosts.api,
    deadline,
    maxRequests: PLACE.lookupRequests,
    ...(d.fetch ? { fetch: d.fetch } : {}),
  });
  try {
    return claims(await http.json(url)) ? { adapter, ref: host } : null;
  } catch (e) {
    // a block is that platform's answer, never retried; the deadline ends the import; any
    // other answer is "not ours"
    if (e instanceof ImportFailure && e.code === 'BLOCKED') return 'blocked';
    if (e instanceof ImportFailure && e.code !== 'TIMEOUT') return null;
    throw e;
  }
}

const olaclickClaims = (b: unknown) =>
  isRaw(b) && isRaw(b.data) && /^[0-9a-f-]{36}$/i.test(str(b.data.company_id));

const saiposClaims = (b: unknown) =>
  Array.isArray(b) && b.some((s) => isRaw(s) && numOf(s.id_store) !== null);

// Cardápio Web's server writes the store into the page it serves for the domain
const CW_SLUG =
  /Object\.defineProperty\(\s*window\s*,\s*["']companySlug["']\s*,\s*\{\s*value\s*:\s*["']([^"'\\]{1,100})["']/;
// Delivery Direto's page loads the brand's build from its own host
const DD_ASSETS =
  /(?:https:)?\/\/(?:www\.)?deliverydireto\.com\.br\/bs\/([a-z0-9_.-]{1,80})\/dist\//i;

/** `/<brand>` (or https://<host>/<brand>) on the same host: Delivery Direto's domain root. */
function redirectBrand(host: string, location: string | null): string | null {
  if (!location) return null;
  let u: URL;
  try {
    u = new URL(location, `https://${host}/`);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== host || u.port || u.username) return null;
  const segments = u.pathname.split('/').filter(Boolean);
  return segments.length === 1 ? segments[0]! : null;
}

export function placeByPage(host: string, page: Page): Placed | null {
  if (page.status >= 300 && page.status < 400) {
    // not followed: Delivery Direto's own read then checks the brand on deliverydireto.com.br
    const brand = redirectBrand(host, page.location);
    return brand ? on(deliverydireto, `https://deliverydireto.com.br/${brand}`) : null;
  }
  if ([401, 403, 429, 503].includes(page.status))
    throw new ImportFailure('BLOCKED', `http ${page.status}`);
  if (page.status >= 200 && page.status < 300) {
    const slug = CW_SLUG.exec(page.body)?.[1];
    const cw = slug
      ? on(cardapioweb, `https://app.cardapioweb.com/${encodeURIComponent(slug)}`)
      : null;
    if (cw) return cw;
    const brand = DD_ASSETS.exec(page.body)?.[1];
    const dd = brand ? on(deliverydireto, `https://deliverydireto.com.br/${brand}`) : null;
    if (dd) return dd;
  }
  if (CHALLENGE.test(page.body)) throw new ImportFailure('BLOCKED', 'challenge page');
  return null;
}

/**
 * GET https://<host>/ on `ip`: SNI, the certificate check and the Host header all name the host,
 * and the socket goes to the address given, so nothing resolves the name a second time. No
 * redirect followed, no cookies, the first 256 KB of the body. `port` and `ca` are for tests.
 */
export function pinnedGet(
  host: string,
  ip: string,
  opts: { port?: number; ca?: string; timeoutMs?: number } = {},
): Promise<Page> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = request(
      {
        host: ip,
        port: opts.port ?? 443,
        servername: host,
        method: 'GET',
        path: '/',
        agent: false,
        headers: {
          host,
          'user-agent': USER_AGENT,
          accept: 'text/html',
          'accept-encoding': 'identity',
        },
        ...(opts.ca ? { ca: opts.ca } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        res.on('error', () =>
          settle(() => reject(new ImportFailure('UNREADABLE', `body read failed: ${host}`))),
        );
        if (status >= 300 && status < 400) {
          settle(() => resolve({ status, location, body: '' }));
          req.destroy();
          return;
        }
        const parts: Buffer[] = [];
        let size = 0;
        const finish = () =>
          settle(() => resolve({ status, location, body: Buffer.concat(parts).toString('utf8') }));
        res.on('data', (chunk: Buffer) => {
          if (settled) return;
          const room = PLACE.pageBytes - size;
          parts.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
          size += Math.min(chunk.length, room);
          if (size >= PLACE.pageBytes) {
            finish();
            req.destroy();
          }
        });
        res.on('end', finish);
      },
    );
    const timer = setTimeout(() => {
      settle(() => reject(new ImportFailure('TIMEOUT', `timed out: ${host}`)));
      req.destroy();
    }, opts.timeoutMs ?? PLACE.pageMs);
    req.on('error', (e: NodeJS.ErrnoException) =>
      settle(() => reject(new ImportFailure('NOT_FOUND', `${host}: ${e.code ?? e.message}`))),
    );
    req.end();
  });
}

/** Resolves once, refuses the host if any answer is inside, then the one GET. */
export async function fingerprintHost(host: string, d: PlaceDeps = {}): Promise<Placed | null> {
  if (!isPublicHostname(host)) return null;
  let addrs: string[];
  try {
    addrs = await within(PLACE.dnsMs, (d.dns?.lookup ?? systemDns.lookup)(host));
  } catch (e) {
    if (e instanceof ImportFailure) throw e;
    throw new ImportFailure('NOT_FOUND', `dns: ${host}`);
  }
  if (!addrs.length) throw new ImportFailure('NOT_FOUND', `dns: ${host}`);
  if (addrs.some((a) => !isIP(a) || isPrivateHost(a)))
    throw new ImportFailure('NOT_FOUND', `refused: ${host} resolves to a private address`);
  const ip = addrs.find((a) => isIP(a) === 4) ?? addrs[0]!;
  const page = await (d.fingerprint ?? ((h, a) => pinnedGet(h, a)))(host, ip);
  return placeByPage(host, page);
}

/** Which platform serves `host`, in a fixed order, stopping at the first claim; null when none
 *  does. A platform lookup that refused us only rules that platform out — unless nothing else
 *  claims the host, then the import is BLOCKED. A timeout, or a block on the page itself, ends it. */
export async function placeHost(host: string, d: PlaceDeps = {}): Promise<Placed | null> {
  if (!isPublicHostname(host)) return null;
  const goomerStore = await viaCname(host, d.dns?.cname ?? systemDns.cname);
  if (goomerStore) return goomerStore;
  const deadline = Date.now() + PLACE.lookupsMs;
  const filter = encodeURIComponent(JSON.stringify({ domain_name: host }));
  let blocked = false;
  const look = async (...args: Parameters<typeof viaLookup>) => {
    const r = await viaLookup(...args);
    if (r !== 'blocked') return r;
    blocked = true;
    return null;
  };
  const placed =
    (await look(
      olaclick,
      `https://api.olaclick.app/ms-companies/public/hosts/${encodeURIComponent(host)}`,
      olaclickClaims,
      host,
      d,
      deadline,
    )) ??
    (await look(
      saipos,
      `https://delivery-api.saipos.com/v1/stores?filter=${filter}`,
      saiposClaims,
      host,
      d,
      deadline,
    )) ??
    (await fingerprintHost(host, d));
  if (!placed && blocked) throw new ImportFailure('BLOCKED', 'a platform lookup refused us');
  return placed;
}
