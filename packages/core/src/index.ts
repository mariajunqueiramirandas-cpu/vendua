import { createApp } from './app.ts';
import { AdminHub } from './admin/live.ts';
import { startAdminSweeper, startPushNotifier } from './admin/workers.ts';
import { log } from './platform/log.ts';
import { createSql, migrate } from './platform/db.ts';
import { join } from 'node:path';
import { ingestInbound } from './agent/inbound.ts';
import { startScheduler, stopScheduler } from './agent/scheduler.ts';
import { startAgentRuntime } from './agent-host/scheduler.ts';
import {
  ensureSocket,
  onHistoryMessage,
  onInboundMessage,
  onLidMapping,
} from './agent/channels/whatsapp.ts';
import { adoptLidMappings } from './modules/threads.ts';
import { startInstagramReconcile } from './agent/channels/instagram.ts';
import { getIntegration } from './modules/integrations.ts';
import { setBookingSecret } from './modules/meetings.ts';
import { platformNotify } from './admin/notify.ts';
import { createPaymentProvider } from './modules/payments/index.ts';
import { startPaymentJobs } from './modules/payments/jobs.ts';
import { startBillingJobs } from './modules/billing/jobs.ts';
import { signupAccessCode } from './modules/billing/signup.ts';
import { fleetDeps } from './modules/fleet/deps.ts';
import { startFleetJobs } from './modules/fleet/jobs.ts';
import { startMenuImportJobs } from './modules/menu-import/jobs.ts';
import { startWebAnalyticsJobs } from './modules/web-analytics.ts';
import { startStoreWhatsappWatch } from './store-whatsapp/watch.ts';
import { onUnhandledError } from './platform/http.ts';
import { recordBoot, unhandledErrorReporter } from './modules/system-events.ts';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vendua_app:vendua_app@localhost:5433/vendua';
// the container entrypoint migrates and then drops the owner URL, so the server never holds it
const migrationUrl =
  process.env.MIGRATION_DATABASE_URL ??
  (process.env.NODE_ENV === 'production' ? null : 'postgres://vendua:vendua@localhost:5433/vendua');
const port = Number(process.env.PORT ?? 8787);
// SESSION_SECRET signs cart session tokens and is the dev fallback for the control
// gate — deployments must set it. CONTROL_SECRET is the staff key for /control/v1.
const sessionSecret = process.env.SESSION_SECRET ?? crypto.randomUUID();
if (!process.env.SESSION_SECRET) {
  log.warn(
    'SESSION_SECRET unset — using a random per-boot secret. Sessions do not survive restarts and replicas disagree; set SESSION_SECRET in any shared environment.',
  );
}

if (process.env.NODE_ENV === 'production' && !process.env.VENDUA_ADMIN_HOST) {
  log.warn(
    "VENDUA_ADMIN_HOST unset — payment callbacks and the storefront editor preview fall back to the store's own origin; set it to the admin's domain.",
  );
}

if (process.env.VENDUA_SIGNUP_ACCESS_CODE?.trim() && !signupAccessCode()) {
  log.warn(
    'VENDUA_SIGNUP_ACCESS_CODE is under 12 characters — ignored; signup without Mercado Pago stays off.',
  );
} else if (signupAccessCode()) {
  log.warn(
    'VENDUA_SIGNUP_ACCESS_CODE set — signup with this code skips Mercado Pago; the team marks its invoices paid in the CRM.',
  );
}

// Migrate as the owner role, then serve as vendua_app (RLS on).
if (migrationUrl) {
  const migrator = createSql(migrationUrl);
  const applied = await migrate(migrator, join(import.meta.dir, '../db/migrations'));
  if (applied.length) log.child({ mod: 'migrate' }).info({ applied }, 'migrations applied');
  await migrator.end();
}

const sql = createSql(databaseUrl);
const adminHub = new AdminHub(sql);
// one provider for the API and the jobs: the fake driver keeps its state in memory
const paymentProvider = createPaymentProvider();
const notify = platformNotify(sql);
const app = createApp({
  sql,
  sessionSecret,
  controlSecret: process.env.CONTROL_SECRET,
  adminHub,
  paymentProvider,
  notify,
});
const adminHost = process.env.VENDUA_ADMIN_HOST?.trim().toLowerCase();
const adminOrigin = adminHost ? `https://${adminHost}` : null;
// Mercado Pago: token refresh + connection health, pending-payment reconciliation;
// the plan: invoices, renewals, reminders, custom-domain DNS checks
const stopPaymentJobs = startPaymentJobs(sql, {
  provider: paymentProvider,
  sessionSecret,
  notify,
  adminOrigin,
});
const stopBillingJobs = startBillingJobs(sql, {
  provider: paymentProvider,
  notify,
  adminOrigin,
  storeDomain: process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
});

// Control Plane (Phase 4): provisioner, synthetic probes, deployment verification, drift
const stopFleetJobs = startFleetJobs(fleetDeps(sql, { notify }));

// menu import ("cole o link do seu cardápio"): reads pasted stores, re-hosts their photos
const stopMenuImportJobs = startMenuImportJobs({ sql });

// privacy-first page views (ADR 0028): the daily salt and 13-month retention expire on a clock
const stopWebAnalyticsJobs = startWebAnalyticsJobs(sql);
// stores' own WhatsApp runs in the wa-gateway process (ADR 0026); Core only watches it beat
const stopStoreWhatsappWatch = startStoreWhatsappWatch(sql);

// merchant admin: new-order web push + the minute sweep ("esgotado hoje", timed pauses)
const stopPushNotifier = startPushNotifier(sql, adminHub);
const stopAdminSweeper = startAdminSweeper(sql, { notify, adminOrigin });

// Booking links sign with the same staff key the app verifies — set before the worker starts.
setBookingSecret(process.env.CONTROL_SECRET ?? sessionSecret);

// Scheduler (work loop + job loop over the durable pg queue, woken by LISTEN/NOTIFY) +
// WhatsApp socket when the baileys driver is enabled.
startScheduler(sql);
// Agent Runtime v3 (ADR 0030): idle until an agent is registered in agent-host/agents
const agentRuntime = startAgentRuntime(sql);
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
// LID↔PN pairs learned by the socket move LID-keyed leads onto the real number.
onLidMapping(async (pairs) => {
  const ids = await adoptLidMappings(sql, pairs);
  if (ids.length) {
    log.child({ mod: 'whatsapp' }).info({ count: ids.length }, 'lid leads re-keyed to phone');
  }
});
void getIntegration(sql, 'whatsapp')
  .then((i) => ensureSocket(sql, i))
  .catch((e) => log.child({ mod: 'whatsapp' }).error({ err: e }, 'socket start failed'));
// Instagram's live session sits in the ig-sidecar; this re-pushes the stored one after a sidecar restart.
const stopInstagramReconcile = startInstagramReconcile(sql);

// a 500 and a boot reach the team (ADR 0023): system.error is throttled per route
onUnhandledError(unhandledErrorReporter(sql));

// idleTimeout must clear the SSE heartbeat (20s): Bun's default 10s kills a
// quiet event stream before the first `:ka`, looping clients forever.
const server = Bun.serve({ port, fetch: app.fetch, idleTimeout: 60 });
log.info({ port }, 'listening');
void recordBoot(sql);

// Deploys send SIGTERM: stop taking requests and let those in flight finish, stop claiming,
// let the run in hand finish (bounded), then exit — a run cut off anyway is recovered by
// its lease on the next boot.
let shuttingDown = false;
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ sig }, 'shutting down — draining requests and the scheduler');
    stopAdminSweeper();
    stopPaymentJobs();
    stopBillingJobs();
    stopFleetJobs();
    stopMenuImportJobs();
    stopWebAnalyticsJobs();
    stopStoreWhatsappWatch();
    stopInstagramReconcile();
    void stopPushNotifier.then((stop) => stop()).catch(() => undefined);
    // event streams never finish on their own: requests get a few seconds, then the rest close
    const drained = Promise.race([
      server.stop(),
      new Promise((r) => setTimeout(r, 5_000)).then(() => server.stop(true)),
    ]);
    void Promise.all([drained, stopScheduler(), agentRuntime.stop()])
      .then(() => sql.end({ timeout: 5 }))
      .finally(() => process.exit(0));
  });
}
