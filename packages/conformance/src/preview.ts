/**
 * Preview server — serves the storefront's built dist/ and proxies the
 * reserved API prefixes to Core, mirroring the production edge: the incoming
 * Host header is forwarded untouched so Core resolves the QA tenant exactly
 * like a real public domain.
 *
 * Hostile fixture: for the qa-edge host only, GET /storefront/v1/surfaces is
 * answered locally with an envelope containing unknown notice kinds,
 * severities and action types — S03/S04 verify the storefront degrades
 * instead of crashing. Every other request proxies normally.
 */
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

const API_PREFIXES = ['/storefront/v1', '/checkout/v1', '/v1'];

/** The hostile surfaces envelope for the qa-edge host — unknown kind, unknown
 *  severity, unknown action types, one notice with no title. */
const HOSTILE_SURFACES = {
  version: 1,
  store: { status: 'open' },
  notices: [
    {
      id: 'qa-edge-kind',
      kind: 'quantum_entanglement',
      severity: 'warning',
      title: 'QA: unknown notice kind',
      body: 'Este aviso tem kind desconhecido — deve degradar para system.Notice.',
      dismissible: true,
      priority: 50,
      actions: [{ type: 'link', label: 'Ver cardápio', href: '/' }],
    },
    {
      id: 'qa-edge-severity',
      kind: 'edge_note',
      severity: 'catastrophic',
      title: 'QA: unknown severity',
      body: 'Severity desconhecida — deve cair para info.',
      dismissible: true,
      priority: 40,
      actions: [
        { type: 'teleport', label: 'Teleport', href: '/' },
        { type: 'bogus-action', label: 'Boom' },
      ],
    },
    {
      id: 'qa-edge-bare',
      kind: '',
      severity: 'info',
      dismissible: true,
      priority: 30,
    },
  ],
};

export interface PreviewOptions {
  distDir: string;
  port: number;
  coreOrigin: string;
  edgeHost?: string;
}

function isApiPath(pathname: string): boolean {
  return API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const proxyStats = {
  /** `${host} ${status}` → count — observability for bursts (e.g. a run of
   *  checkout requests tripping Core's rate limiter). */
  requests: new Map<string, number>(),
  reset() {
    this.requests.clear();
  },
};

function track(req: IncomingMessage, status: number) {
  const host = (req.headers.host ?? '').split(':')[0];
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const key = `${host} ${req.method} ${path} → ${status}`;
  proxyStats.requests.set(key, (proxyStats.requests.get(key) ?? 0) + 1);
}

function proxy(req: IncomingMessage, res: ServerResponse, coreOrigin: string) {
  const upstream = new URL(coreOrigin);
  const headers = { ...req.headers } as Record<string, string | string[] | undefined>;
  // Host untouched: the storefront's public hostname is how Core resolves the
  // tenant — exactly what the production edge forwards.
  const out = httpRequest(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (up) => {
      track(req, up.statusCode ?? 502);
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  out.on('error', (err) => {
    track(req, 502);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'PREVIEW_PROXY', message: String(err) } }));
  });
  req.pipe(out);
}

export function startPreview(opts: PreviewOptions): Promise<Server> {
  const { distDir, port, coreOrigin } = opts;
  const edgeHost = opts.edgeHost ?? 'qa-edge.localhost';
  const indexHtml = join(distDir, 'index.html');

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const pathname = decodeURIComponent(url.pathname);
    const host = (req.headers.host ?? '').split(':')[0]!.toLowerCase();

    if (isApiPath(pathname)) {
      if (host === edgeHost && req.method === 'GET' && pathname === '/storefront/v1/surfaces') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(HOSTILE_SURFACES));
        return;
      }
      proxy(req, res, coreOrigin);
      return;
    }

    // Static dist with SPA history fallback.
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(distDir, safe);
    if (!existsSync(file) || statSync(file).isDirectory()) {
      if (extname(safe)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      file = indexHtml;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    // Dual-stack '::' — Chromium reaches us via 127.0.0.1 (--host-resolver-rules
    // maps *.localhost to IPv4) while Node/Playwright's request fixture resolves
    // *.localhost to ::1 through NSS.
    server.listen(port, '::', () => resolvePromise(server));
  });
}
