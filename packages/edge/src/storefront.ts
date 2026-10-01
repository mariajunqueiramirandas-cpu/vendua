import type { Lru, SwrCache } from './cache.ts';
import { UnknownHost, type Route } from './core.ts';
import { ArtifactError, type Releases } from './files.ts';
import { SECURITY_HEADERS, acceptsGzip, etagMatches, shouldGzip, withGzip } from './http.ts';
import { injectState } from './inject.ts';
import { log } from './log.ts';
import { isTextType, type StorefrontManifest } from './manifest.ts';
import {
  injectMeta,
  pageHead,
  productPattern,
  productSlug,
  storeMeta,
  type ProductHead,
} from './meta.ts';
import { UNAVAILABLE_HTML, UNKNOWN_STORE_HTML } from './pages.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';

function page(html: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

function plain(text: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(`${text}\n`, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      ...extra,
    },
  });
}

/** The artifact path a URL path names, or null when it must be refused (traversal, NUL, …). */
export function artifactPath(pathname: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\\\0]/.test(p) || p.split('/').some((s) => s === '..' || s === '.')) return null;
  p = p.replace(/^\/+/, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  if (p.split('/').some((s) => s === '')) return null;
  return p;
}

/** A manifest path for `path`, falling back to the entry for extension-less or .html misses. */
function pick(m: StorefrontManifest, path: string): string | null {
  if (path in m.files) return path;
  const last = path.slice(path.lastIndexOf('/') + 1);
  if (!last.includes('.') || /\.html?$/i.test(last)) return m.entry;
  return null;
}

export interface StorefrontDeps {
  routes: SwrCache<Route>;
  /** host → until when Core's UNKNOWN_HOST answer stands */
  unknownHosts: Lru<string, number>;
  states: SwrCache<unknown>;
  /** `<host> <slug>` → a product page's head (null: Core has no such product) */
  products: SwrCache<ProductHead | null>;
  releases: Releases;
  /** how long a first HTML request waits for a state (or product) Core has not given us yet */
  stateWaitMs: number;
}

/** `got`'s value if it lands before `deadline`; null when it is late or fails. */
async function within<T>(got: Promise<{ value: T }>, deadline: Promise<null>) {
  try {
    const r = await Promise.race([got, deadline]);
    return r ? { value: r.value } : null;
  } catch {
    return null;
  }
}

export function createStorefront(d: StorefrontDeps) {
  return async function serve(req: Request, url: URL, host: string): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return plain('method not allowed', 405, { allow: 'GET, HEAD' });
    const path = artifactPath(url.pathname);
    if (!path) return plain('bad request', 400);

    if ((d.unknownHosts.get(host) ?? 0) > Date.now()) return page(UNKNOWN_STORE_HTML, 404);
    let route: Route;
    try {
      route = (await d.routes.get(host)).value;
    } catch (e) {
      if (e instanceof UnknownHost) return page(UNKNOWN_STORE_HTML, 404);
      log('warn', 'resolve failed with nothing cached', { host, error: (e as Error).message });
      return page(UNAVAILABLE_HTML, 503, { 'retry-after': '30' });
    }
    if (!route.release) return page(UNAVAILABLE_HTML, 503, { 'retry-after': '60' });
    const { id, bundle } = route.release;
    const rel = { 'x-vendua-release': id };

    let m: StorefrontManifest;
    let file: string | null;
    let body: Uint8Array;
    try {
      m = await d.releases.manifest(bundle, id);
      file = pick(m, path);
      if (!file) return plain('not found', 404, rel);
      body = await d.releases.file(m, file);
    } catch (e) {
      if (!(e instanceof ArtifactError)) throw e;
      log('error', 'artifact unavailable', { host, release: id, path, error: e.message });
      return plain('bad gateway', 502, rel);
    }

    const meta = m.files[file]!;
    const isHtml = meta.type.startsWith('text/html');
    const headers = new Headers({
      'content-type': meta.type,
      'cache-control': file.startsWith('assets/') ? IMMUTABLE : 'no-cache',
      ...SECURITY_HEADERS,
      ...rel,
    });
    const gz = acceptsGzip(req);

    if (isHtml) {
      headers.set('vary', 'accept-encoding');
      if (req.method === 'HEAD') return new Response(null, { headers });
      let html = new TextDecoder().decode(body);
      // the head is the SPA shell's; another HTML file the store ships keeps its own
      const slug = file === m.entry ? productSlug(url.pathname, productPattern(m.build)) : null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>((r) => {
        timer = setTimeout(r, d.stateWaitMs, null);
      });
      const [state, product] = await Promise.all([
        within(d.states.get(host), deadline),
        slug ? within(d.products.get(`${host} ${slug}`), deadline) : null,
      ]);
      clearTimeout(timer);
      if (state) {
        const store = file === m.entry ? storeMeta(state.value) : null;
        if (store) html = injectMeta(html, pageHead(store, url.pathname, product?.value ?? null));
        html = injectState(html, state.value);
      }
      return withGzip(new TextEncoder().encode(html), headers, gz);
    }

    const tag = meta.sha256.slice(0, 32);
    const zipped = gz && shouldGzip(meta.type, body.length);
    headers.set('etag', zipped ? `"${tag}-gz"` : `"${tag}"`);
    if (isTextType(meta.type)) headers.set('vary', 'accept-encoding');
    if (etagMatches(req, tag)) return new Response(null, { status: 304, headers });
    if (req.method === 'HEAD') {
      if (zipped) headers.set('content-encoding', 'gzip');
      return new Response(null, { headers });
    }
    return withGzip(body, headers, gz, () => d.releases.gzipOf(m, file!, body));
  };
}
