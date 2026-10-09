import { log } from './log.ts';
import { createSync, repair } from './sync.ts';

const env = process.env;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(+v) && +v > 0 ? +v : d);

const intervalMs = num(env.DOMAINS_SYNC_INTERVAL_MS, 30_000);
let stopped = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let running: Promise<unknown> = Promise.resolve();

async function shutdown() {
  if (stopped) return;
  stopped = true;
  if (timer) clearTimeout(timer);
  await running;
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const render = {
  out: env.DOMAINS_SYNC_OUT || '/traefik-dynamic/vendua-custom-domains.yml',
  storeDomain: env.VENDUA_STORE_DOMAIN || 'vendua.com.br',
  deny: (env.DOMAINS_SYNC_DENY ?? '').split(','),
  service: env.DOMAINS_SYNC_SERVICE || 'vendua-edge@docker',
  middleware: env.DOMAINS_SYNC_MIDDLEWARE || 'vendua-edge-https@docker',
  resolver: env.DOMAINS_SYNC_RESOLVER || 'letsencrypt',
};

if (!env.VENDUA_SYNC_SECRET) {
  // idle rather than exit: `restart: unless-stopped` would turn an exit into a crash loop
  log('warn', 'VENDUA_SYNC_SECRET is unset: domains-sync is idle and writes no routes');
  running = repair(render);
  timer = setInterval(() => {}, 1 << 30);
} else {
  const tick = createSync({
    ...render,
    coreUrl: env.VENDUA_CORE_URL || 'http://core:8787',
    secret: env.VENDUA_SYNC_SECRET,
    timeoutMs: 10_000,
  });
  const loop = () => {
    if (stopped) return;
    running = tick().finally(() => {
      if (!stopped) timer = setTimeout(loop, intervalMs);
    });
  };
  log('info', 'domains-sync started', { intervalMs });
  loop();
}
