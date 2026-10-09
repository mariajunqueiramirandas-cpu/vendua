import { join } from 'node:path';
import type { Server } from 'bun';
import type { ArtifactStore } from './artifacts.ts';
import { Lru, SwrCache } from './cache.ts';
import { CoreHealth, UnknownHost, coreClient, type FetchImpl, type Route } from './core.ts';
import { createReleases } from './files.ts';
import { log } from './log.ts';
import type { ProductHead } from './meta.ts';
import { API_RE, createProxy, type Lkg } from './proxy.ts';
import { readSnapshot, writeSnapshot, type Snapshot } from './snapshot.ts';
import { createStorefront } from './storefront.ts';

export { injectState } from './inject.ts';
export { injectMeta } from './meta.ts';

export interface EdgeOptions {
  coreUrl: string;
  edgeSecret?: string | undefined;
  store: ArtifactStore;
  cacheDir: string;
  routeTtlMs?: number;
  stateTtlMs?: number;
  negativeTtlMs?: number;
  /** Core calls the edge must not wait on forever (resolve, state, last-known-good APIs) */
  upstreamTimeoutMs?: number;
  stateWaitMs?: number;
  snapshotIntervalMs?: number;
  maxHosts?: number;
  /** byte budget of the last-known-good API bodies (all hosts; they go into every snapshot) */
  maxApiBytes?: number;
  fetchImpl?: FetchImpl;
}

export interface Edge {
  fetch(req: Request, server?: Server<unknown>): Promise<Response>;
  /** Writes the snapshot now if anything changed since the last write. */
  flush(): Promise<void>;
  stop(): Promise<void>;
  stats(): { routes: number; states: number; api: number; core: 'ok' | 'down' };
}

/** Bun.serve's maxRequestBodySize. Only /storefront/v1, /checkout/v1 and /v1 bodies reach Core
 *  through here, and its largest cap on them is 64 KiB (checkout's cart import); the margin
 *  leaves Core's own 413 to answer anything modestly over. */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

export function normalizeHost(raw: string | null): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/:\d+$/, '');
  return HOST_RE.test(host) ? host : null;
}

export function createEdge(o: EdgeOptions): Edge {
  const routeTtl = o.routeTtlMs ?? 30_000;
  const stateTtl = o.stateTtlMs ?? 30_000;
  const negativeTtl = o.negativeTtlMs ?? 10_000;
  const timeoutMs = o.upstreamTimeoutMs ?? 5_000;
  const maxHosts = o.maxHosts ?? 10_000;
  const interval = o.snapshotIntervalMs ?? 10_000;
  const fetchImpl = o.fetchImpl ?? fetch;
  const snapshotFile = join(o.cacheDir, 'snapshot.json');

  const health = new CoreHealth();
  const core = coreClient({
    coreUrl: o.coreUrl,
    edgeSecret: o.edgeSecret,
    fetchImpl,
    timeoutMs,
    health,
  });

  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  let stopped = false;
  const changed = () => {
    dirty = true;
    if (!timer && !stopped) {
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, interval);
      timer.unref?.();
    }
  };

  // unknown hosts live apart from routes: a flood of random Host headers must not evict real stores
  const unknownHosts = new Lru<string, number>(maxHosts);
  const routes: SwrCache<Route> = new SwrCache<Route>(
    maxHosts,
    async (host) => {
      const value = await core.resolve(host);
      if (value === 'unknown') {
        unknownHosts.set(host, Date.now() + negativeTtl);
        if (routes.peek(host)) routes.delete(host);
        throw new UnknownHost(host);
      }
      unknownHosts.delete(host);
      return { value, ttl: routeTtl };
    },
    changed,
  );
  const states = new SwrCache<unknown>(
    maxHosts,
    async (host) => ({ value: await core.surfaces(host), ttl: stateTtl }),
    changed,
  );
  // product heads stay out of the snapshot: without one a page falls back to the store's head
  const products = new SwrCache<ProductHead | null>(maxHosts, async (key) => {
    const at = key.indexOf(' ');
    return { value: await core.product(key.slice(0, at), key.slice(at + 1)), ttl: stateTtl };
  });
  // state, state?templates=1 and surfaces per host, plus the shared v.js
  const lkg = new Lru<string, Lkg>(
    maxHosts * 3 + 1,
    (v) => v.body.length,
    o.maxApiBytes ?? 64 * 1024 * 1024,
  );

  const snap = readSnapshot(snapshotFile);
  if (snap) {
    routes.restore(snap.routes);
    states.restore(snap.states);
    for (const [k, v] of snap.api)
      lkg.set(k, { body: Buffer.from(v.body, 'base64'), type: v.type, at: v.at });
  }

  async function flush(): Promise<void> {
    if (!dirty) return writing;
    dirty = false;
    const s: Snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      routes: routes.dump(),
      states: states.dump(),
      api: lkg
        .entries()
        .map(([k, v]) => [
          k,
          { body: Buffer.from(v.body).toString('base64'), type: v.type, at: v.at },
        ]),
    };
    writing = writing
      .then(() => writeSnapshot(snapshotFile, s))
      .catch((e) => log('error', 'snapshot write failed', { error: (e as Error).message }));
    return writing;
  }

  const proxy = createProxy({
    coreUrl: o.coreUrl,
    fetchImpl,
    timeoutMs,
    health,
    lkg,
    onChange: changed,
  });
  const storefront = createStorefront({
    routes,
    unknownHosts,
    states,
    products,
    releases: createReleases({ store: o.store, cacheDir: o.cacheDir }),
    stateWaitMs: o.stateWaitMs ?? Math.min(timeoutMs, 1_500),
  });

  const stats = () => ({
    routes: routes.size,
    states: states.size,
    api: lkg.size,
    core: health.status,
  });

  async function handle(req: Request, server?: Server<unknown>): Promise<Response> {
    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return new Response('bad request\n', { status: 400 });
    }
    if (url.pathname === '/_edge/healthz')
      return Response.json(
        { ok: true, routes: routes.size, core: health.status },
        { headers: { 'cache-control': 'no-store' } },
      );
    const host = normalizeHost(req.headers.get('host'));
    if (!host) return new Response('bad host\n', { status: 400 });
    if (API_RE.test(url.pathname)) return proxy(req, url, host, server);
    return storefront(req, url, host);
  }

  return {
    async fetch(req, server) {
      try {
        return await handle(req, server);
      } catch (e) {
        log('error', 'unhandled', { url: req.url, error: (e as Error).stack ?? String(e) });
        return new Response('internal error\n', { status: 500 });
      }
    },
    flush,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await flush();
    },
    stats,
  };
}
