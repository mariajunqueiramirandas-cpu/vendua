import type { Server } from 'bun';
import { Lru } from './cache.ts';
import type { CoreHealth, FetchImpl } from './core.ts';
import { acceptsGzip, withGzip } from './http.ts';

export const API_RE = /^\/(checkout\/v1|storefront\/v1|v1)(\/|$)/;

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function stripHop(src: Headers, extra: string[] = []): Headers {
  const drop = new Set([...HOP, ...extra]);
  for (const t of (src.get('connection') ?? '').split(','))
    if (t.trim()) drop.add(t.trim().toLowerCase());
  const out = new Headers();
  src.forEach((v, k) => {
    if (!drop.has(k)) out.append(k, v);
  });
  return out;
}

/** The socket peer as nginx's $remote_addr writes it: a dual-stack listener reports an IPv4
 *  client as `::ffff:a.b.c.d`, which would otherwise end up in X-Forwarded-For. */
export function peerAddress(address: string | undefined): string | undefined {
  return address?.replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i, '$1');
}

export interface Lkg {
  body: Uint8Array;
  type: string;
  at: number;
}

/** Last-known-good key: these three GETs keep serving their last 200 while Core is down. Only
 *  the exact queries the loader and Kernel send are kept — Core ignores unknown params, so any
 *  other query would let a client fill the cache with copies of one answer. */
export function lkgKey(host: string, url: URL): string | null {
  const p = url.pathname;
  const q = url.search;
  if (p === '/storefront/v1/state' && (q === '' || q === '?templates=1')) return `${host}${p}${q}`;
  if (p === '/storefront/v1/surfaces' && q === '') return `${host}${p}`;
  if (p === '/v1/v.js' && q === '') return `*${p}`;
  return null;
}

export interface ProxyOptions {
  coreUrl: string;
  fetchImpl: FetchImpl;
  timeoutMs: number;
  health: CoreHealth;
  lkg: Lru<string, Lkg>;
  onChange: () => void;
}

export function createProxy(o: ProxyOptions) {
  const base = o.coreUrl.replace(/\/+$/, '');

  function forwardHeaders(req: Request, host: string, ip: string | undefined): Headers {
    const h = stripHop(req.headers, ['host', 'x-vendua-edge']);
    const xff = req.headers.get('x-forwarded-for');
    const chain = [xff, ip].filter(Boolean).join(', ');
    if (chain) h.set('x-forwarded-for', chain);
    h.set('host', host);
    h.set('x-forwarded-host', host);
    h.set('x-forwarded-proto', req.headers.get('x-forwarded-proto') || 'http');
    return h;
  }

  function stale(req: Request, hit: Lkg): Response {
    const headers = new Headers({
      'content-type': hit.type,
      'cache-control': 'no-cache',
      'x-vendua-edge-stale': '1',
    });
    return withGzip(hit.body, headers, acceptsGzip(req));
  }

  async function lkgFetch(req: Request, url: URL, key: string, headers: Headers) {
    headers.delete('accept-encoding');
    try {
      const res = await o.fetchImpl(`${base}${url.pathname}${url.search}`, {
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(o.timeoutMs),
      });
      const body = new Uint8Array(await res.arrayBuffer());
      if (res.status >= 500) {
        o.health.down(`${url.pathname} → ${res.status}`);
        const hit = o.lkg.get(key);
        if (hit) return stale(req, hit);
      } else o.health.ok();
      const out = stripHop(res.headers, ['content-length', 'content-encoding']);
      if (res.status === 200) {
        o.lkg.set(key, {
          body,
          type: res.headers.get('content-type') ?? 'application/octet-stream',
          at: Date.now(),
        });
        o.onChange();
        return withGzip(body, out, acceptsGzip(req));
      }
      return new Response(body, { status: res.status, headers: out });
    } catch (e) {
      o.health.down((e as Error).message);
      const hit = o.lkg.get(key);
      if (hit) return stale(req, hit);
      return unavailable();
    }
  }

  return async function proxy(
    req: Request,
    url: URL,
    host: string,
    server?: Server<unknown>,
  ): Promise<Response> {
    const ip = peerAddress(server?.requestIP(req)?.address);
    const headers = forwardHeaders(req, host, ip);
    const key = req.method === 'GET' ? lkgKey(host, url) : null;
    if (key) return lkgFetch(req, url, key, headers);

    // long-lived streams (SSE) must outlive the server's idle timeout
    server?.timeout(req, 0);
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    try {
      const res = await o.fetchImpl(`${base}${url.pathname}${url.search}`, {
        method: req.method,
        headers,
        redirect: 'manual',
        ...(hasBody ? { body: req.body, duplex: 'half' } : {}),
        decompress: false,
        timeout: false,
      } as RequestInit);
      if (res.status >= 500) o.health.down(`${url.pathname} → ${res.status}`);
      else o.health.ok();
      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: stripHop(res.headers, ['content-length']),
      });
    } catch (e) {
      o.health.down((e as Error).message);
      return unavailable();
    }
  };
}

function unavailable(): Response {
  return Response.json(
    { error: { code: 'CORE_UNAVAILABLE', message: 'Core is unreachable' } },
    { status: 502, headers: { 'cache-control': 'no-store' } },
  );
}
