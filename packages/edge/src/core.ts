import { BUNDLE_RE, RELEASE_RE } from './artifacts.ts';
import { log } from './log.ts';

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Route {
  host: string;
  tenant: { id: string; slug: string; status: string };
  primaryHost: string;
  release: { id: string; bundle: string; uri: string; fallback: boolean } | null;
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

function parseRoute(x: unknown): Route {
  const r = x as Route;
  const rel = r?.release;
  if (
    !r ||
    typeof r.host !== 'string' ||
    typeof r.primaryHost !== 'string' ||
    typeof r.tenant?.slug !== 'string' ||
    (rel !== null &&
      (typeof rel !== 'object' || !RELEASE_RE.test(rel.id) || !BUNDLE_RE.test(rel.bundle)))
  )
    throw new CoreError('malformed resolve response');
  return r;
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
  };
}

export type CoreClient = ReturnType<typeof coreClient>;
