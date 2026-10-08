import { BUNDLE_RE, RELEASE_RE } from './artifacts.ts';
import { log } from './log.ts';
import type { ProductHead } from './meta.ts';

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Route {
  host: string;
  tenant: { id: string; slug: string; status: string };
  primaryHost: string;
  release: { id: string; bundle: string; uri: string; fallback: boolean } | null;
  /** Set for a custom domain's alias (→ its host, permanent) or a lapsed domain (→ the store's
   *  platform address, temporary): every GET/HEAD on the host is answered with this redirect. */
  redirect?: { to: string; permanent: boolean } | null;
}

export type RouteValue = Route | 'unknown';

export class UnknownHost extends Error {}

/** Tracks whether Core answered the edge's last calls (for /_edge/healthz). */
export class CoreHealth {
  private okAt = 0;
  private downAt = 0;
  ok() {
    this.okAt = Date.now();
  }
  down(reason?: string) {
    if (this.status === 'ok') log('warn', 'core down', { reason });
    this.downAt = Date.now();
  }
  get status(): 'ok' | 'down' {
    return this.downAt > this.okAt ? 'down' : 'ok';
  }
}

export class CoreError extends Error {}

export interface CoreClientOptions {
  coreUrl: string;
  edgeSecret?: string | undefined;
  fetchImpl: FetchImpl;
  timeoutMs: number;
  health: CoreHealth;
}

const REDIRECT_HOST_RE =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** `https://<host>` and nothing else (the edge appends the request's path and query), as its
 *  origin; undefined when the field is malformed. */
function parseRedirect(x: unknown): Route['redirect'] | undefined {
  if (x === undefined || x === null) return null;
  const r = x as { to?: unknown; permanent?: unknown };
  if (typeof r !== 'object' || typeof r.to !== 'string' || typeof r.permanent !== 'boolean')
    return undefined;
  if (r.to.length > 300 || /[?#\s\\]/.test(r.to)) return undefined;
  let u: URL;
  try {
    u = new URL(r.to);
  } catch {
    return undefined;
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.pathname !== '/' && u.pathname !== '') ||
    !REDIRECT_HOST_RE.test(u.hostname)
  )
    return undefined;
  return { to: u.origin, permanent: r.permanent };
}

function parseRoute(x: unknown): Route {
  const r = x as Route;
  const rel = r?.release;
  const redirect = parseRedirect(r?.redirect);
  if (
    !r ||
    typeof r.host !== 'string' ||
    typeof r.primaryHost !== 'string' ||
    typeof r.tenant?.slug !== 'string' ||
    (rel !== null &&
      (typeof rel !== 'object' || !RELEASE_RE.test(rel.id) || !BUNDLE_RE.test(rel.bundle))) ||
    redirect === undefined
  )
    throw new CoreError('malformed resolve response');
  return { ...r, redirect };
}

export function coreClient(o: CoreClientOptions) {
  const base = o.coreUrl.replace(/\/+$/, '');

  async function call(path: string, headers: Record<string, string>): Promise<Response> {
    let res: Response;
    try {
      res = await o.fetchImpl(`${base}${path}`, {
        headers,
        signal: AbortSignal.timeout(o.timeoutMs),
        redirect: 'manual',
      });
    } catch (e) {
      o.health.down((e as Error).message);
      throw new CoreError(`core unreachable: ${(e as Error).message}`);
    }
    if (res.status >= 500) o.health.down(`${path.split('?')[0]} → ${res.status}`);
    else o.health.ok();
    return res;
  }

  return {
    async resolve(host: string): Promise<RouteValue> {
      const res = await call(`/edge/v1/resolve?host=${encodeURIComponent(host)}`, {
        'x-vendua-edge': o.edgeSecret ?? '',
        accept: 'application/json',
      });
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      if (res.status === 404 && body?.error?.code === 'UNKNOWN_HOST') return 'unknown';
      if (res.status !== 200) throw new CoreError(`resolve ${host} → ${res.status}`);
      return parseRoute(body);
    },

    /** The state injected on this host's pages: its surfaces plus its live design (templates,
     *  tokens) — `GET /storefront/v1/surfaces?design=1`, read by Kernel 1.10. */
    async surfaces(host: string): Promise<unknown> {
      const res = await call('/storefront/v1/surfaces?design=1', {
        host,
        'x-forwarded-host': host,
        accept: 'application/json',
      });
      if (res.status !== 200) throw new CoreError(`surfaces ${host} → ${res.status}`);
      try {
        return await res.json();
      } catch {
        throw new CoreError(`surfaces ${host}: body is not JSON`);
      }
    },

    /** A product page's head (`GET /storefront/v1/products/:slug`); null when there is no such
     *  product. Only what the head needs is kept, bounded. */
    async product(host: string, slug: string): Promise<ProductHead | null> {
      const res = await call(`/storefront/v1/products/${encodeURIComponent(slug)}`, {
        host,
        'x-forwarded-host': host,
        accept: 'application/json',
      });
      if (res.status === 404 || res.status === 422) return null;
      if (res.status !== 200) throw new CoreError(`product ${host} → ${res.status}`);
      const p = ((await res.json().catch(() => null)) as { product?: Record<string, unknown> })
        ?.product;
      if (!p || typeof p.name !== 'string') throw new CoreError(`product ${host}: malformed`);
      const text = (v: unknown) => (typeof v === 'string' ? v.slice(0, 2_000) : null);
      return {
        name: p.name.slice(0, 500),
        description: text(p.description),
        imageUrl: text(p.imageUrl),
      };
    },
  };
}

export type CoreClient = ReturnType<typeof coreClient>;
