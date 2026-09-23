import { createApp } from './app.ts';
import { log } from './platform/log.ts';
import { createSql, migrate } from './platform/db.ts';
import { join } from 'node:path';
import { ingestInbound } from './agent/inbound.ts';
import { startAgentWorker } from './agent/runner.ts';
import { ensureSocket, onInboundMessage } from './agent/channels/whatsapp.ts';
import { getIntegration } from './modules/integrations.ts';
import { setBookingSecret } from './modules/meetings.ts';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vendua_app:vendua_app@localhost:5433/vendua';
const migrationUrl =
  process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const port = Number(process.env.PORT ?? 8787);
// SESSION_SECRET is the HMAC key for cart session tokens AND the dev fallback
// for the control gate — a checked-in default would let anyone forge both.
// Unset = random per boot: dev carts re-mint via POST /session, but restarts
// and replicas disagree — deployments must set it. CONTROL_SECRET is the
// staff key for /control/v1; set it wherever staff access is shared so it
// never doubles as the shopper-signing key.
const sessionSecret = process.env.SESSION_SECRET ?? crypto.randomUUID();
if (!process.env.SESSION_SECRET) {
  log.warn(
    'SESSION_SECRET unset — using a random per-boot secret. Sessions do not survive restarts and replicas disagree; set SESSION_SECRET in any shared environment.',
  );
}

// Boot: apply migrations as the owner role, then serve as vendua_app (RLS on).
const migrator = createSql(migrationUrl);
const applied = await migrate(migrator, join(import.meta.dir, '../db/migrations'));
if (applied.length) log.child({ mod: 'migrate' }).info({ applied }, 'migrations applied');
await migrator.end();

const sql = createSql(databaseUrl);
const app = createApp({ sql, sessionSecret, controlSecret: process.env.CONTROL_SECRET });

// Booking links minted by the agent worker sign with the same staff key the
// app uses (controlSecret ?? sessionSecret) — set before the worker starts.
setBookingSecret(process.env.CONTROL_SECRET ?? sessionSecret);

// Agent harness: in-process worker (durable Postgres queue — runs survive
// restarts) + WhatsApp socket when the baileys driver is enabled.
startAgentWorker(sql);
onInboundMessage(async (jid, text, providerId, pushName) => {
  await ingestInbound(sql, {
    channel: 'whatsapp',
    from: jid,
    ...(pushName ? { fromName: pushName } : {}),
    body: text,
    providerMessageId: providerId,
  });
});
void getIntegration(sql, 'whatsapp')
  .then((i) => ensureSocket(sql, i))
  .catch((e) => log.child({ mod: 'whatsapp' }).error({ err: e }, 'socket start failed'));

log.info({ port }, 'listening');
// idleTimeout must clear the SSE heartbeat (20s): Bun's default 10s kills a
// quiet event stream before the first `:ka`, looping clients forever.
export default { port, fetch: app.fetch, idleTimeout: 60 };
