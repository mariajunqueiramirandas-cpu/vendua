import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Server } from 'bun';
import { openArtifactStore, type ArtifactStore } from '../src/artifacts.ts';
import type { FetchImpl, Route } from '../src/core.ts';
import { createManifest, uploadRelease, type StorefrontManifest } from '../src/manifest.ts';
import { createEdge, type Edge, type EdgeOptions } from '../src/server.ts';

process.env.VENDUA_EDGE_QUIET = '1';

export const SECRET = 'edge-secret-for-tests';

export function tempDir(prefix = 'edge-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export const INDEX_HTML = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Loja</title>
    <script src="/v1/v.js" defer></script>
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-def456.css">
  </head>
  <body><div id="root"></div></body>
</html>
`;

export const BUILD_MANIFEST = {
  manifestVersion: 1,
  storefront: 'template',
  contract: 1,
  kernel: '1.9.0',
  coreApi: { storefront: 1, checkout: 1 },
  builtAt: '2026-09-30T10:00:00.000Z',
  templates: { source: 'repo', pages: ['home'], hash: 'x' },
  tokens: { source: 'repo', hash: 'y' },
  sections: {},
  overrides: [],
};

/** A small built storefront in a temp dir (index, hashed assets, a binary, a text file). */
export function makeDist(extra: Record<string, string | Uint8Array> = {}): string {
  const dir = tempDir('edge-dist-');
  const files: Record<string, string | Uint8Array> = {
    'index.html': INDEX_HTML,
    'assets/index-abc123.js': `console.log(${JSON.stringify('x'.repeat(600))});\n`,
    'assets/index-def456.css': `body{margin:0}\n${'.a{color:red}\n'.repeat(40)}`,
    'assets/logo.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...Array(400).fill(7)]),
    'robots.txt': 'User-agent: *\nAllow: /\n',
    'vendua-manifest.json': `${JSON.stringify(BUILD_MANIFEST, null, 2)}\n`,
    ...extra,
  };
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  return dir;
}

export async function publish(
  store: ArtifactStore,
  bundle = '_template',
  dist = makeDist(),
): Promise<StorefrontManifest> {
  const m = createManifest({ dir: dist, bundle, tenant: 'loja-modelo', commit: 'test' });
  await uploadRelease(store, dist, m);
  return m;
}

export interface FakeCore {
  url: string;
  server: Server<unknown>;
  routes: Map<string, Route['release'] | 'unknown'>;
  states: Map<string, unknown>;
  /** `<host> <slug>` → the product Core serves, or a status code to answer with */
  products: Map<string, unknown>;
  productDelayMs: number;
  calls: { resolve: string[]; surfaces: string[]; secrets: string[]; products: string[] };
  seen: Request[];
  echo: Record<string, unknown>[];
  /** fetchImpl for the edge: fails like a refused connection while `down` */
  fetchImpl: FetchImpl;
  down: boolean;
  status5xx: boolean;
  sse: { push(data: string): void; close(): void };
  stop(): void;
}

export function fakeCore(): FakeCore {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const enc = new TextEncoder();
  const core: FakeCore = {
    url: '',
    server: null as unknown as Server<unknown>,
    routes: new Map(),
    states: new Map(),
    products: new Map(),
    productDelayMs: 0,
    calls: { resolve: [], surfaces: [], secrets: [], products: [] },
    seen: [],
    echo: [],
    down: false,
    status5xx: false,
    fetchImpl: (input, init) =>
      core.down
        ? Promise.reject(
            new TypeError('Unable to connect. Is the computer able to access the url?'),
          )
        : fetch(input, init),
    sse: {
      push: (data) => controller?.enqueue(enc.encode(`data: ${data}\n\n`)),
      close: () => controller?.close(),
    },
    stop: () => core.server.stop(true),
  };
  core.server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const host = url.hostname;
      if (core.status5xx) return new Response('boom', { status: 503 });
      if (url.pathname === '/edge/v1/resolve') {
        const h = url.searchParams.get('host') ?? '';
        core.calls.resolve.push(h);
        core.calls.secrets.push(req.headers.get('x-vendua-edge') ?? '');
        if (req.headers.get('x-vendua-edge') !== SECRET)
          return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
        const release = core.routes.get(h);
        if (release === undefined || release === 'unknown')
          return Response.json({ error: { code: 'UNKNOWN_HOST' } }, { status: 404 });
        return Response.json({
          host: h,
          tenant: { id: 't-1', slug: h.split('.')[0], status: 'active' },
          primaryHost: h,
          release,
        });
      }
      if (url.pathname === '/storefront/v1/surfaces') {
        core.calls.surfaces.push(url.search === '?design=1' ? host : `${host}${url.search}`);
        return Response.json(core.states.get(host) ?? { status: 'open', host });
      }
      if (url.pathname.startsWith('/storefront/v1/products/')) {
        const key = `${host} ${decodeURIComponent(url.pathname.slice(24))}`;
        core.calls.products.push(key);
        if (core.productDelayMs) await Bun.sleep(core.productDelayMs);
        const p = core.products.get(key);
        if (typeof p === 'number') return new Response('nope', { status: p });
        if (p === undefined)
          return Response.json({ error: { code: 'PRODUCT_NOT_FOUND' } }, { status: 404 });
        return Response.json({ product: p });
      }
      if (url.pathname === '/storefront/v1/state')
        return Response.json({ state: 'open', host, q: url.search });
      if (url.pathname === '/v1/v.js')
        return new Response(`window.__VENDUA_LOADER__={v:1};${'/*pad*/'.repeat(60)}`, {
          headers: { 'content-type': 'text/javascript; charset=utf-8' },
        });
      if (url.pathname === '/storefront/v1/events')
        return new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              controller = c;
              c.enqueue(enc.encode('data: first\n\n'));
            },
          }),
          { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } },
        );
      if (url.pathname === '/checkout/v1/echo') {
        const rec = {
          method: req.method,
          host: req.headers.get('host'),
          body: await req.text(),
          xff: req.headers.get('x-forwarded-for'),
          xfh: req.headers.get('x-forwarded-host'),
          xfp: req.headers.get('x-forwarded-proto'),
          dropped: req.headers.get('x-drop-me'),
          query: url.search,
        };
        core.echo.push(rec);
        return Response.json(rec, { status: 201, headers: { 'x-core': '1' } });
      }
      return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
    },
  });
  core.url = `http://127.0.0.1:${core.server.port}`;
  return core;
}

export interface Harness {
  core: FakeCore;
  store: ArtifactStore;
  storeDir: string;
  cacheDir: string;
  edge: Edge;
  server: Server<unknown>;
  base: string;
  get(path: string, host?: string, init?: RequestInit): Promise<Response>;
  restart(opts?: Partial<EdgeOptions>): Promise<void>;
  close(): Promise<void>;
}

export async function harness(opts: Partial<EdgeOptions> = {}): Promise<Harness> {
  const core = fakeCore();
  const storeDir = tempDir('edge-store-');
  const cacheDir = tempDir('edge-cache-');
  const store = openArtifactStore(`file://${storeDir}`);
  const make = (o: Partial<EdgeOptions>) =>
    createEdge({
      coreUrl: core.url,
      edgeSecret: SECRET,
      store,
      cacheDir,
      fetchImpl: core.fetchImpl,
      snapshotIntervalMs: 20,
      ...opts,
      ...o,
    });
  const serve = (edge: Edge) =>
    Bun.serve({ port: 0, idleTimeout: 0, fetch: (req, srv) => edge.fetch(req, srv) });
  const h: Harness = {
    core,
    store,
    storeDir,
    cacheDir,
    edge: make({}),
    server: null as unknown as Server<unknown>,
    base: '',
    get: (path, host = 'loja.test', init = {}) =>
      fetch(`${h.base}${path}`, {
        ...init,
        headers: { host, ...(init.headers as Record<string, string>) },
      }),
    async restart(o = {}) {
      h.server.stop(true);
      await h.edge.stop();
      h.edge = make(o);
      h.server = serve(h.edge);
      h.base = `http://127.0.0.1:${h.server.port}`;
    },
    async close() {
      h.server.stop(true);
      await h.edge.stop();
      core.stop();
      for (const d of [storeDir, cacheDir]) rmSync(d, { recursive: true, force: true });
    },
  };
  h.server = serve(h.edge);
  h.base = `http://127.0.0.1:${h.server.port}`;
  return h;
}

export function releaseRoute(m: StorefrontManifest, store: ArtifactStore): Route['release'] {
  return {
    id: m.release,
    bundle: m.bundle,
    uri: `${store.uri}/storefronts/${m.bundle}/${m.release}`,
    fallback: false,
  };
}

/** The JSON a page carries in its vendua-state script, parsed. */
export function injected(html: string): unknown {
  const m = /<script id="vendua-state">window.__VENDUA_STATE__=(.*?)<\/script>/s.exec(html);
  return m ? JSON.parse(m[1]!) : undefined;
}
