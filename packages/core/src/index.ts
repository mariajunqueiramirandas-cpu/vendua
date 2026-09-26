import { createApp } from './app.ts';
import { log } from './platform/log.ts';
import { createSql, migrate } from './platform/db.ts';
import { join } from 'node:path';
import { ingestInbound } from './agent/inbound.ts';
import { startScheduler, stopScheduler } from './agent/scheduler.ts';
import { ensureSocket, onHistoryMessage, onInboundMessage } from './agent/channels/whatsapp.ts';
import { getIntegration } from './modules/integrations.ts';
import { setBookingSecret } from './modules/meetings.ts';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vendua_app:vendua_app@localhost:5433/vendua';
const migrationUrl =
  process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const port = Number(process.env.PORT ?? 8787);
// SESSION_SECRET signs cart session tokens and is the dev fallback for the control
// gate — deployments must set it. CONTROL_SECRET is the staff key for /control/v1.
const sessionSecret = process.env.SESSION_SECRET ?? crypto.randomUUID();
if (!process.env.SESSION_SECRET) {
  log.warn(
    'SESSION_SECRET unset — using a random per-boot secret. Sessions do not survive restarts and replicas disagree; set SESSION_SECRET in any shared environment.',
  );
}

// Migrate as the owner role, then serve as vendua_app (RLS on).
const migrator = createSql(migrationUrl);
const applied = await migrate(migrator, join(import.meta.dir, '../db/migrations'));
if (applied.length) log.child({ mod: 'migrate' }).info({ applied }, 'migrations applied');
await migrator.end();

const sql = createSql(databaseUrl);
const app = createApp({ sql, sessionSecret, controlSecret: process.env.CONTROL_SECRET });

// Booking links sign with the same staff key the app verifies — set before the worker starts.
setBookingSecret(process.env.CONTROL_SECRET ?? sessionSecret);

// Scheduler (work loop + job loop over the durable pg queue) + WhatsApp socket when the
// baileys driver is enabled.
startScheduler(sql);
onInboundMessage(async (jid, text, providerId, pushName, altJid) => {
  await ingestInbound(sql, {
    channel: 'whatsapp',
    from: jid,
    ...(pushName ? { fromName: pushName } : {}),
    ...(altJid ? { fromAlias: altJid } : {}),
    body: text,
    providerMessageId: providerId,
  });
});
// Pairing-time history lands as context only (never queues a reply); fromMe echoes staff's phone replies.
onHistoryMessage(async (m) => {
  await ingestInbound(sql, {
    channel: 'whatsapp',
    from: m.jid,
    direction: m.fromMe ? 'out' : 'in',
    ...(m.pushName ? { fromName: m.pushName } : {}),
    ...(m.altJid ? { fromAlias: m.altJid } : {}),
    ...(m.sentAt ? { sentAt: m.sentAt } : {}),
    body: m.text,
    providerMessageId: m.providerId,
    historical: true,
  });
});
void getIntegration(sql, 'whatsapp')
  .then((i) => ensureSocket(sql, i))
  .catch((e) => log.child({ mod: 'whatsapp' }).error({ err: e }, 'socket start failed'));

// Deploys send SIGTERM: stop claiming, let the run in hand finish (bounded), then exit —
// a run cut off anyway is recovered by its lease on the next boot.
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ sig }, 'shutting down — draining the scheduler');
    void stopScheduler()
      .then(() => sql.end({ timeout: 5 }))
      .finally(() => process.exit(0));
  });
}

log.info({ port }, 'listening');
// idleTimeout must clear the SSE heartbeat (20s): Bun's default 10s kills a
// quiet event stream before the first `:ka`, looping clients forever.
export default { port, fetch: app.fetch, idleTimeout: 60 };
