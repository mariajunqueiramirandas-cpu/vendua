import { createApp } from './app.ts';
import { AdminHub } from './admin/live.ts';
import { startAdminSweeper, startPushNotifier } from './admin/workers.ts';
import { log } from './platform/log.ts';
import { createSql, jobsPoolMax, migrate, warmPool } from './platform/db.ts';
import { join } from 'node:path';
import { ingestInbound } from './agent/inbound.ts';
import { startScheduler, stopScheduler } from './agent/scheduler.ts';
import { startAgentRuntime } from './agent-host/scheduler.ts';
import { hostGateway } from './agent-host/models.ts';
import { configureVendedor } from './vendedor/deps.ts';
import { mediaProviders } from './vendedor/media.ts';
import { startVendedorWorker } from './vendedor/worker.ts';
import {
  ensureSocket,
  onHistoryMessage,
  onInboundMessage,
  onLidMapping,
} from './agent/channels/whatsapp.ts';
import { adoptLidMappings } from './modules/threads.ts';
import { socketMessageToInbox, startPlatformInbox } from './platform-whatsapp/inbox.ts';
import { startCrmSettle } from './platform-whatsapp/crm-settle.ts';
import { startSocketPump } from './platform-whatsapp/socket-pump.ts';
import { platformTransport } from './platform-whatsapp/transport.ts';
import { startInstagramReconcile } from './agent/channels/instagram.ts';
import { getIntegration } from './modules/integrations.ts';
import { setBookingSecret } from './modules/meetings.ts';
import { platformNotify } from './admin/notify.ts';
import { createPaymentProvider } from './modules/payments/index.ts';
import { startPaymentJobs } from './modules/payments/jobs.ts';
import { startBillingJobs } from './modules/billing/jobs.ts';
import { domainProvidersFromEnv } from './modules/domains/config.ts';
import { startDomainJobs } from './modules/domains/jobs.ts';
import { signupAccessCode } from './modules/billing/signup.ts';
import { fleetDeps } from './modules/fleet/deps.ts';
import { startFleetJobs } from './modules/fleet/jobs.ts';
import { startMenuImportJobs } from './modules/menu-import/jobs.ts';
import { startWebAnalyticsJobs } from './modules/web-analytics.ts';
import { startStoreWhatsappWatch } from './store-whatsapp/watch.ts';
import { configureOrderLinks } from './store-whatsapp/messages.ts';
import { orderTrackToken } from './modules/orders.ts';
import { onUnhandledError } from './platform/http.ts';
import { StoreReadCache } from './platform/read-cache.ts';
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
// an empty value counts as unset: an empty HMAC key or staff key is no secret at all
const sessionSecret = process.env.SESSION_SECRET || crypto.randomUUID();
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
void warmPool(sql);
// Background work (jobs, the scheduler, agents, inbound messages) gets a small pool of its own: a
// request never waits behind a job for a connection, and since a connection prepares each
// statement once, the request pool stays on statements requests have already prepared.
const jobsSql = createSql(databaseUrl, jobsPoolMax);
const adminHub = new AdminHub(sql);
// one provider for the API and the jobs: the fake driver keeps its state in memory
const paymentProvider = createPaymentProvider();
const notify = platformNotify(sql);
// storefront reads served from memory, dropped by the notify a committed write sends
const readCache = new StoreReadCache(sql);
void readCache.ready();
const app = createApp({
  sql,
  sessionSecret,
  controlSecret: process.env.CONTROL_SECRET || undefined,
  adminHub,
  paymentProvider,
  notify,
  readCache,
});
const adminHost = process.env.VENDUA_ADMIN_HOST?.trim().toLowerCase();
const adminOrigin = adminHost ? `https://${adminHost}` : null;
// Mercado Pago: token refresh + connection health, pending-payment reconciliation;
// the plan: invoices, renewals, reminders, custom-domain DNS checks
const stopPaymentJobs = startPaymentJobs(jobsSql, {
  provider: paymentProvider,
  sessionSecret,
  notify,
  adminOrigin,
});
const stopBillingJobs = startBillingJobs(jobsSql, {
  provider: paymentProvider,
  notify,
  adminOrigin,
  storeDomain: process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
});

// own domains (ADR 0038): DNS checks, certificates, repair and lapse, .com.br registrations
const stopDomainJobs = startDomainJobs(jobsSql, {
  providers: domainProvidersFromEnv(),
  notify,
  storeDomain: process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
});

// Control Plane (Phase 4): provisioner, synthetic probes, deployment verification, drift
const stopFleetJobs = startFleetJobs(fleetDeps(jobsSql, { notify }));

// menu import ("cole o link do seu cardápio"): reads pasted stores, re-hosts their photos
const stopMenuImportJobs = startMenuImportJobs({ sql: jobsSql });

// privacy-first page views (ADR 0028): the daily salt and 13-month retention expire on a clock
const stopWebAnalyticsJobs = startWebAnalyticsJobs(jobsSql);
// stores' own WhatsApp runs in the wa-gateway process (ADR 0026); Core only watches it beat
const stopStoreWhatsappWatch = startStoreWhatsappWatch(jobsSql);
// each order message ends with the order's status-only link, signed like the cart sessions
configureOrderLinks({
  storeDomain: process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
  token: (tenantId, orderId, placedAt) =>
    orderTrackToken(sessionSecret, tenantId, orderId, placedAt),
});

// merchant admin: new-order web push + the minute sweep ("esgotado hoje", timed pauses)
const stopPushNotifier = startPushNotifier(jobsSql, adminHub);
const stopAdminSweeper = startAdminSweeper(jobsSql, { notify, adminOrigin });

// Booking links sign with the same staff key the app verifies — set before the worker starts.
setBookingSecret(process.env.CONTROL_SECRET || sessionSecret);

// Scheduler (work loop + job loop over the durable pg queue, woken by LISTEN/NOTIFY) +
// WhatsApp socket when the baileys driver is enabled.
startScheduler(jobsSql);
// Agent Runtime v3 (ADR 0030) with the Vendedor (ADR 0031): its tools reach checkout and
// payments through these deps; its worker ingests the stores' conversations
configureVendedor({
  sql,
  provider: paymentProvider,
  sessionSecret,
  storeDomain: process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
  publicOrigin: adminOrigin,
});
const agentGateway = hostGateway(jobsSql);
configureVendedor({ gateway: agentGateway });
const agentRuntime = startAgentRuntime(jobsSql, { gateway: agentGateway });
const stopVendedor = startVendedorWorker(jobsSql, {
  gateway: agentGateway,
  media: mediaProviders(jobsSql),
});
// ingestInbound caps a body at 8000 chars: a longer WhatsApp message is cut, not dropped
const waBody = (text: string) => (text.length > 8000 ? text.slice(0, 8000) : text);
onInboundMessage(async (jid, text, providerId, pushName, altJid, media) => {
  // a merchant phone is Duá's (docs/features/dua-no-whatsapp.md), everyone else the CRM's
  const m = {
    jid,
    text,
    providerId,
    ...(pushName ? { pushName } : {}),
    ...(altJid ? { altJid } : {}),
    ...(media ? { media } : {}),
  };
  if (await socketMessageToInbox(jobsSql, m)) return;
  await ingestInbound(jobsSql, {
    channel: 'whatsapp',
    from: jid,
    ...(pushName ? { fromName: pushName } : {}),
    ...(altJid ? { fromAlias: altJid } : {}),
    body: waBody(text),
    providerMessageId: providerId,
  });
});
// Pairing-time history lands as context only (never queues a reply); fromMe echoes staff's phone replies.
onHistoryMessage(async (m) => {
  await ingestInbound(jobsSql, {
    channel: 'whatsapp',
    from: m.jid,
    direction: m.fromMe ? 'out' : 'in',
    ...(m.pushName ? { fromName: m.pushName } : {}),
    ...(m.altJid ? { fromAlias: m.altJid } : {}),
    ...(m.sentAt ? { sentAt: m.sentAt } : {}),
    body: waBody(m.text),
    providerMessageId: m.providerId,
    historical: true,
  });
});
// LID↔PN pairs learned by the socket move LID-keyed leads onto the real number.
onLidMapping(async (pairs) => {
  const ids = await adoptLidMappings(jobsSql, pairs);
  if (ids.length) {
    log.child({ mod: 'whatsapp' }).info({ count: ids.length }, 'lid leads re-keyed to phone');
  }
});
// Venduá's number: Core's socket until the cutover, then a platform session on the wa-gateway
// (WA_PLATFORM_TRANSPORT). Either way its inbox is routed here, and Duá's replies go out its outbox.
const waTransport = platformTransport();
if (waTransport === 'socket')
  void getIntegration(jobsSql, 'whatsapp')
    .then((i) => ensureSocket(jobsSql, i))
    .catch((e) => log.child({ mod: 'whatsapp' }).error({ err: e }, 'socket start failed'));
const platformInbox = startPlatformInbox({
  sql: jobsSql,
  jobsSql,
  media: mediaProviders(jobsSql),
  gateway: agentGateway,
  origin: adminOrigin,
});
const socketPump = waTransport === 'socket' ? startSocketPump(jobsSql) : null;
// CRM sends finish (lead state, cadence) when their outbox row settles; in socket mode too, for
// rows queued before a rollback that the socket pump then sends
const stopCrmSettle = startCrmSettle(jobsSql);
// Instagram's live session sits in the ig-sidecar; this re-pushes the stored one after a sidecar restart.
const stopInstagramReconcile = startInstagramReconcile(jobsSql);

// a 500 and a boot reach the team (ADR 0023): system.error is throttled per route
onUnhandledError(unhandledErrorReporter(sql));

// idleTimeout must clear the SSE heartbeat (20s): Bun's default 10s kills a
// quiet event stream before the first `:ka`, looping clients forever.
// Hono compiles its router on the first request it matches (~15 ms with Core's routes): spend it
// here rather than on a shopper's first request
await app.request('http://localhost/healthz');
// Routes cap their own bodies (32 KB by default, media 2 MB), but only once read: a chunked upload
// with no length would be buffered whole first, up to Bun's 128 MB default. 4 MiB covers every
// route's cap with room.
const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 60,
  maxRequestBodySize: 4 * 1024 * 1024,
});
log.info({ port }, 'listening');
// One active store's storefront reads, in the background: their code compiles and their statements
// are prepared on the connection the next request gets, so the first shopper after a deploy finds
// that path warm. Read-only, best effort.
void (async () => {
  // any active store: the code paths and statements are the same for all of them
  const [store] = await sql<{ host: string }[]>`
    select coalesce(
      (select d.host from domains d where d.tenant_id = t.id order by d.is_primary desc limit 1),
      t.slug || '.' || ${process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br'}
    ) as host
    from tenants t where t.status = 'active' limit 1
  `;
  if (!store) return;
  const get = async (path: string) =>
    (
      await app.request(`http://${store.host}/storefront/v1${path}`, {
        headers: { host: store.host },
      })
    )
      .json()
      .catch(() => null) as Promise<{ categories?: { products?: { slug?: string }[] }[] } | null>;
  await get('/store');
  await get('/surfaces?design=1');
  const slug = (await get('/catalog'))?.categories?.[0]?.products?.[0]?.slug;
  if (slug) await get(`/products/${encodeURIComponent(slug)}`);
})().catch(() => undefined);
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
    stopDomainJobs();
    stopFleetJobs();
    stopMenuImportJobs();
    stopWebAnalyticsJobs();
    stopStoreWhatsappWatch();
    stopInstagramReconcile();
    void platformInbox.stop();
    void socketPump?.stop();
    void stopCrmSettle();
    readCache.stop();
    void stopPushNotifier.then((stop) => stop()).catch(() => undefined);
    // event streams never finish on their own: requests get a few seconds, then the rest close
    const drained = Promise.race([
      server.stop(),
      new Promise((r) => setTimeout(r, 5_000)).then(() => server.stop(true)),
    ]);
    void Promise.all([drained, stopScheduler(), agentRuntime.stop(), stopVendedor()])
      .then(() => Promise.all([sql.end({ timeout: 5 }), jobsSql.end({ timeout: 5 })]))
      .finally(() => process.exit(0));
  });
}
