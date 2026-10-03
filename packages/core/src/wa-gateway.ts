import { createSql } from './platform/db.ts';
import { log } from './platform/log.ts';
import { Gateway } from './store-whatsapp/gateway.ts';
import { baileysRuntime } from './store-whatsapp/runtime.ts';

// The wa-gateway process (ADR 0026): every store's own WhatsApp, apart from the API so a Core
// deploy or crash never drops them and a baileys crash never takes checkout down. Same image as
// Core, started with `bun src/wa-gateway.ts`; it never migrates (Core does, on boot).

const gwLog = log.child({ mod: 'wa-gateway' });
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vendua_app:vendua_app@localhost:5433/vendua';
// logins are sealed under VENDUA_SECRETS_KEY, else a key derived from SESSION_SECRET — the same
// pair Core uses, so both processes must share them
const sealSecret = process.env.SESSION_SECRET;
if (!sealSecret) {
  gwLog.fatal('SESSION_SECRET unset — the gateway could not open the logins it stores');
  process.exit(1);
}
const num = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
const port = num(process.env.WA_GATEWAY_PORT, 8791);

const sql = createSql(databaseUrl);
const gateway = new Gateway({
  sql,
  runtime: await baileysRuntime(gwLog),
  sealSecret,
  version: process.env.VENDUA_VERSION || 'dev',
  maxSessions: num(process.env.WA_MAX_SESSIONS, 300),
  minSendGapMs: num(process.env.WA_MIN_SEND_GAP_MS, 1_500),
  maxPerHour: num(process.env.WA_MAX_PER_HOUR, 200),
  chatGapMs: num(process.env.WA_CHAT_GAP_MS, 1_500),
  conversationGapMs: num(process.env.WA_CONVERSATION_GAP_MS, 250),
  log: gwLog,
});

// baileys rejects promises nobody awaits on a dying socket — one store's must never kill the rest
process.on('unhandledRejection', (err) => gwLog.error({ err }, 'unhandled rejection'));

const server = Bun.serve({
  port,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== '/healthz') return new Response('not found', { status: 404 });
    const h = gateway.health();
    return Response.json({ ok: !h.stopping, ...h }, { status: h.stopping ? 503 : 200 });
  },
});

await gateway.start();
gwLog.info({ port, id: gateway.id }, 'wa-gateway running');

let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    gwLog.info({ sig }, 'shutting down — closing sockets and handing leases back');
    const hardStop = setTimeout(() => process.exit(1), 15_000);
    void gateway
      .stop()
      .then(() => server.stop(true))
      .then(() => sql.end({ timeout: 5 }))
      .finally(() => {
        clearTimeout(hardStop);
        process.exit(0);
      });
  });
}
