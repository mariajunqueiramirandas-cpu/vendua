import { openArtifactStore } from './artifacts.ts';
import { log } from './log.ts';
import { createEdge } from './server.ts';

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
  fetch: (req, srv) => edge.fetch(req, srv),
});

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  // SSE streams never finish on their own: give requests a moment, then cut them
  await Promise.race([server.stop(), Bun.sleep(5_000)]);
  void server.stop(true);
  await edge.stop();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
