import { openArtifactStore } from './artifacts.ts';
import { log } from './log.ts';
import { MAX_REQUEST_BODY_BYTES, createEdge } from './server.ts';

const env = process.env;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(+v) ? +v : d);

if (!env.VENDUA_ARTIFACTS) {
  log('error', 'VENDUA_ARTIFACTS is required (file:///abs/path or s3://bucket/prefix)');
  process.exit(1);
}
if (!env.VENDUA_EDGE_SECRET)
  log('warn', 'VENDUA_EDGE_SECRET is unset: Core will refuse to resolve hosts');

const edge = createEdge({
  coreUrl: env.VENDUA_CORE_URL || 'http://core:8787',
  edgeSecret: env.VENDUA_EDGE_SECRET,
  store: openArtifactStore(env.VENDUA_ARTIFACTS),
  cacheDir: env.VENDUA_EDGE_CACHE_DIR || '/var/cache/vendua-edge',
  routeTtlMs: num(env.VENDUA_EDGE_ROUTE_TTL_MS, 30_000),
  stateTtlMs: num(env.VENDUA_EDGE_STATE_TTL_MS, 30_000),
});

const server = Bun.serve({
  port: num(env.PORT, 8080),
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  fetch: (req, srv) => edge.fetch(req, srv),
});

// keep serving this long after SIGTERM: a proxy routing to task IPs (Traefik's swarm provider
// re-reads them every 15 s) still sends requests here until it sees the new task (ADR 0041)
const drainMs = num(env.VENDUA_EDGE_DRAIN_MS, 0);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  if (drainMs > 0) await Bun.sleep(drainMs);
  // SSE streams never finish on their own: give requests a moment, then cut them
  await Promise.race([server.stop(), Bun.sleep(5_000)]);
  void server.stop(true);
  await edge.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
