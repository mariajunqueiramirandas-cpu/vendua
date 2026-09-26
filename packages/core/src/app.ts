import { createHmac, timingSafeEqual } from 'node:crypto';
import { agentSettingTx, automationAllowedTx, explainAutonomyTx } from './agent/policy.ts';
import { JOB_KINDS, type JobKind } from './agent/tool-meta.ts';
import { requestAgentTx } from './agent/dispatch.ts';
import { listRoutines } from './agent/scheduler.ts';
import { cancelWakeup, listWakeups } from './agent/wakeups.ts';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { cors } from 'hono/cors';
import type { Sql } from './platform/db.ts';
import { withTenant } from './platform/db.ts';
import {
  HttpError,
  errorJson,
  idempotency,
  mintSessionToken,
  bodyJson,
  boundedText,
  parseJsonObject,
  rateLimit,
  sessionCartId,
  str,
  requestLogger,
  tenantMiddleware,
  uuidParam,
  UUID_RE,
  verifySessionToken,
} from './platform/http.ts';
import { TenantResolver, type Tenant } from './platform/tenancy.ts';
import { getCatalog, getProduct, getProductById } from './modules/catalog.ts';
import { deriveStatus, type StoreSettingsRow } from './modules/store.ts';
import { composeNotices, type SurfacesEnvelope } from './modules/notices.ts';
import { addItem, assertCartOpen, loadCartView, matchZone } from './modules/cart.ts';
import { validateCheckout, validateCheckoutShape } from './modules/checkout.ts';
import { loadOrderView } from './modules/orders.ts';
import {
  agentGoal,
  deleteLead,
  exportLeadsCsv,
  findDuplicates,
  getLeadDetail,
  importLeads,
  insertLeadTx,
  leadInsert,
  leadPatch,
  leadSort,
  leadState,
  leadStats,
  listLeads,
  parseLeadsCsv,
  segmentStats,
  updateLead,
  type Lead,
  type LeadState,
} from './modules/leads.ts';
import {
  ACTIVITY_KINDS,
  addActivity,
  completeTask,
  createTask,
  listActivities,
  listTasks,
  type ActivityKind,
} from './modules/activities.ts';
import {
  approveMessage,
  channel,
  composeMessage,
  getThread,
  listDrafts,
  listThreads,
  rejectMessage,
  setThreadAgent,
  threadsForLead,
  ensureThread,
  isSendChannel,
  type Channel,
} from './modules/threads.ts';
import {
  DEFAULT_GUARDRAILS,
  getGuardrails,
  getIntegration,
  getPitch,
  getSettingTx,
  integrationKind,
  listIntegrations,
  listSettings,
  putSetting,
  upsertIntegration,
  validateSetting,
  type Guardrails,
  type IntegrationKind,
} from './modules/integrations.ts';
import {
  createMemoryItem,
  deleteLeadFact,
  deleteMemoryItem,
  listLeadFacts,
  listMemoryItems,
  memoryScope,
  patchMemoryItem,
  putLeadFact,
} from './modules/agent-memory.ts';
import { claimControl, controlTx } from './modules/control.ts';
import { controlSse } from './modules/control-sse.ts';
import { emitControlEvent } from './modules/control-events.ts';
import { pipelineForecast, snapshotPipelineTx } from './modules/forecast.ts';
import { channelHealth } from './modules/channel-health.ts';
import { agentMetrics } from './modules/agent-metrics.ts';
import {
  availableSlots,
  bookBusyWindows,
  bookMeeting,
  bookMeetingTx,
  bookingLink,
  cancelByLead,
  ensureMeetingEffects,
  listMeetings,
  meetingJson,
  meetingsStatus,
  nextMeetingForLead,
  parseBookInput,
  patchMeeting,
  verifyBookingToken,
  type MeetingRow,
} from './modules/meetings.ts';
import { BOOKING_PAGE } from './modules/booking-page.ts';
import * as rooms from './modules/rooms.ts';
import { capLockTx, drain, flagCappedLeads, releaseInboxTx } from './agent/runner.ts';
import { ingestInbound } from './agent/inbound.ts';
import { ingestResendEvent, svixHeaders, svixVerified } from './agent/channels/email-inbound.ts';
import { LOADER_JS } from './loader.ts';
import { log } from './platform/log.ts';

const agentLog = log.child({ mod: 'agent' });
const waLog = log.child({ mod: 'whatsapp' });

export interface AppDeps {
  sql: Sql;
  sessionSecret: string;
  /** distinct from sessionSecret so a staff key never doubles as the session signing key */
  controlSecret?: string | undefined;
  /** tests pass false — a background drain mid-assertion races expectations */
  autoDrain?: boolean | undefined;
}

async function loadSettings(
  tx: Sql,
  tenantId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<StoreSettingsRow | null> {
  const lock = opts.forUpdate ? tx`for update` : tx``;
  const rows = await tx<
    StoreSettingsRow[]
  >`select * from store_settings where tenant_id = ${tenantId} ${lock}`;
  return rows[0] ?? null;
}

async function loadZones(tx: Sql, tenantId: string, opts: { forUpdate?: boolean } = {}) {
  const lock = opts.forUpdate ? tx`for update` : tx``;
  return tx<
    {
      id: string;
      name: string;
      neighborhoods: string[];
      fee_cents: number;
      min_order_cents: number;
      eta_min_minutes: number;
      eta_max_minutes: number;
      active: boolean;
    }[]
  >`
    select id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes
    from delivery_zones where tenant_id = ${tenantId} and active order by name ${lock}
  `;
}

function currentStatus(settings: StoreSettingsRow | null) {
  return deriveStatus(
    settings?.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
    settings?.status_override ?? null,
    settings?.resumes_at ?? null,
    new Date(),
  );
}

// Bounds every external probe — a dead provider must not pin the route open.
const TEST_TIMEOUT_MS = 8_000;
function timed<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${what}: sem resposta em ${TEST_TIMEOUT_MS / 1000}s`)),
        TEST_TIMEOUT_MS,
      ),
    ),
  ]);
}

/** One cheap live call against the kind's ACTIVE driver; never throws — failures are the result. */
async function testIntegration(
  sql: Sql,
  kind: IntegrationKind,
): Promise<{ status: number; body: { ok: boolean; detail: string } }> {
  const integration = await getIntegration(sql, kind);
  const probe = async (): Promise<{ ok: boolean; detail: string }> => {
    if (!integration) return { ok: false, detail: 'nenhum driver ativo para este tipo' };
    if (kind === 'llm') {
      if (integration.driver === 'mock') {
        return { ok: true, detail: 'driver mock — respostas roteirizadas' };
      }
      const { providerFor } = await import('./agent/llm.ts');
      const p = providerFor(integration);
      const r = await timed(
        p.chat({
          system: 'Responda apenas com a palavra: ok',
          messages: [{ role: 'user', content: 'teste' }],
          tools: [],
        }),
        p.name,
      );
      return { ok: true, detail: `${p.name} respondeu — ${r.tokensIn + r.tokensOut} tokens` };
    }
    if (kind === 'email') {
      if (integration.driver === 'log') {
        return { ok: true, detail: 'driver log — imprime no console' };
      }
      const key =
        (integration.secret_ref && process.env[integration.secret_ref]) ??
        process.env.RESEND_API_KEY;
      if (!key) {
        return { ok: false, detail: `env ${integration.secret_ref ?? 'RESEND_API_KEY'} ausente` };
      }
      // SDK calls can't be aborted from here, so they keep the race bound.
      const res = await timed(
        fetch('https://api.resend.com/domains', {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        }),
        'resend',
      );
      return res.ok
        ? { ok: true, detail: 'resend autenticado' }
        : { ok: false, detail: `resend respondeu ${res.status}` };
    }
    if (kind === 'whatsapp') {
      if (integration.driver === 'log') {
        return { ok: true, detail: 'driver log — imprime no console' };
      }
      const { ensureSocket, waStatus } = await import('./agent/channels/whatsapp.ts');
      const s = await timed(ensureSocket(sql, integration), 'socket baileys');
      if (!s) return { ok: false, detail: 'socket não subiu' };
      const st = waStatus();
      if (st === 'open') return { ok: true, detail: 'socket pareado' };
      if (st === 'qr') return { ok: true, detail: 'aguardando escanear o QR' };
      return { ok: false, detail: `socket ${st}` };
    }
    if (kind === 'instagram') {
      const { testInstagram } = await import('./agent/channels/instagram.ts');
      return await timed(testInstagram(integration), 'ig-sidecar');
    }
    if (kind === 'discovery') {
      if (integration.driver === 'mock') {
        return { ok: true, detail: 'driver mock — prospects enlatados' };
      }
      const { discoveryFor } = await import('./agent/channels/discovery.ts');
      const d = await discoveryFor(sql);
      const r = await timed(d.search('padaria', 'teste de conectividade'), 'tinyfish');
      return { ok: true, detail: `tinyfish respondeu — ${r.results.length} resultados` };
    }
    return { ok: false, detail: `tipo desconhecido: ${kind}` };
  };
  try {
    return { status: 200, body: await timed(probe(), kind) };
  } catch (e) {
    return { status: 200, body: { ok: false, detail: e instanceof Error ? e.message : String(e) } };
  }
}

export function createApp({ sql, sessionSecret, controlSecret, autoDrain }: AppDeps) {
  const kickDrain =
    autoDrain === false
      ? () => {}
      : () =>
          void drain(sql, 20, { orphans: false }).catch((e) =>
            agentLog.error({ err: e }, 'drain failed'),
          );
  const resolver = new TenantResolver(sql);
  const app = new Hono<{ Variables: { tenant: Tenant } }>();

  app.onError((err, c) => errorJson(err, c));
  app.use('*', requestLogger());
  // Only trust X-Forwarded-* behind the Venduá edge (tenant spoofing otherwise).
  const trustProxy = process.env.VENDUA_TRUST_PROXY === '1';
  // Same-origin only — other tenant origins would enable credentialed cross-tenant reads.
  app.use(
    '*',
    cors({
      origin: (o, c) => {
        if (!o) return undefined;
        let originHost: string;
        try {
          originHost = new URL(o).host;
        } catch {
          return null;
        }
        const reqHost =
          (trustProxy ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host') ?? '';
        return originHost === reqHost ? o : null;
      },
      allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      credentials: true,
    }),
  );

  app.get('/healthz', (c) => c.json({ ok: true }));

  // CDN serves this in prod; dev serves it here so the contract script tag is real.
  app.get('/v1/v.js', (c) => {
    c.header('content-type', 'application/javascript');
    c.header('cache-control', 'no-store');
    return c.body(LOADER_JS);
  });

  const storefront = new Hono<{ Variables: { tenant: Tenant } }>();
  storefront.use('*', tenantMiddleware(resolver, { trustForwardedHost: trustProxy }));

  storefront.get('/store', async (c) => {
    const tenant = c.get('tenant');
    const settings = await withTenant(sql, tenant.id, (tx) => loadSettings(tx, tenant.id));
    const status = currentStatus(settings);
    return c.json({
      slug: tenant.slug,
      name: tenant.name,
      tagline: settings?.tagline ?? null,
      description: settings?.description ?? null,
      whatsapp: settings?.whatsapp ?? null,
      instagram: settings?.instagram ?? null,
      city: settings?.city ?? null,
      address: settings?.address ?? null,
      status: status.status,
      ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}),
      hours: settings?.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
      prepTimeMinutes: settings?.prep_time_minutes ?? 30,
      minOrderCents: settings?.min_order_cents ?? 0,
      pickupEnabled: settings?.pickup_enabled ?? true,
      deliveryEnabled: settings?.delivery_enabled ?? true,
      currency: settings?.currency ?? 'BRL',
      vocabulary: settings?.vocabulary ?? {},
    });
  });

  storefront.get('/catalog', async (c) => {
    const tenant = c.get('tenant');
    const catalog = await withTenant(sql, tenant.id, (tx) => getCatalog(tx, tenant.id));
    return c.json({ categories: catalog });
  });

  storefront.get('/products/:slug', async (c) => {
    const tenant = c.get('tenant');
    const product = await withTenant(sql, tenant.id, (tx) =>
      getProduct(tx, tenant.id, str(c.req.param('slug'), 'slug', 200)),
    );
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
    return c.json({ product });
  });

  storefront.get('/surfaces', async (c) => {
    const tenant = c.get('tenant');
    const zoneMatched =
      c.req.query('zoneMatched') === undefined ? undefined : c.req.query('zoneMatched') === 'true';
    const settings = await withTenant(sql, tenant.id, (tx) => loadSettings(tx, tenant.id));
    const status = currentStatus(settings);
    const notices = composeNotices(tenant.slug, settings, status, {
      ...(zoneMatched !== undefined ? { zoneMatched } : {}),
    });
    const envelope: SurfacesEnvelope = {
      version: 1,
      store: {
        status: status.status,
        ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}),
      },
      notices,
    };
    return c.json(envelope);
  });

  // Public — storefronts need zones for address/zone UX.
  storefront.get('/zones', async (c) => {
    const tenant = c.get('tenant');
    const zones = await withTenant(sql, tenant.id, (tx) => loadZones(tx, tenant.id));
    return c.json({
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        neighborhoods: z.neighborhoods,
        feeCents: z.fee_cents,
        minOrderCents: z.min_order_cents,
        etaMin: z.eta_min_minutes,
        etaMax: z.eta_max_minutes,
      })),
    });
  });

  // Loader-facing cached snapshot per 05-system-surfaces.
  storefront.get('/state', async (c) => {
    const tenant = c.get('tenant');
    const settings = await withTenant(sql, tenant.id, (tx) => loadSettings(tx, tenant.id));
    const status = currentStatus(settings);
    const notices = composeNotices(tenant.slug, settings, status);
    return c.json({
      store: {
        status: status.status,
        ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}),
      },
      notices: notices.filter((n) => n.severity === 'blocking' || n.kind === 'emergency'),
    });
  });

  const checkout = new Hono<{ Variables: { tenant: Tenant } }>();
  checkout.use('*', tenantMiddleware(resolver, { trustForwardedHost: trustProxy }));
  // Unauthenticated mutation surface — bounded (edge replaces this in prod).
  // VENDUA_PROXY_HOPS = trusted proxies beyond the client's own XFF entry.
  const proxyHops = Number(process.env.VENDUA_PROXY_HOPS ?? '0');
  checkout.use(
    '*',
    rateLimit(
      { windowMs: 60_000, max: 240 },
      {
        trustForwardedFor: trustProxy,
        proxyHops: Number.isInteger(proxyHops) && proxyHops >= 0 ? proxyHops : 0,
      },
    ),
  );

  checkout.post('/session', async (c) => {
    const tenant = c.get('tenant');
    // Re-attach a Bearer token whose cart is still open; a spent one mints fresh.
    const bearer = c.req.header('authorization')?.replace(/^bearer\s+/i, '');
    if (bearer) {
      const existing = await withTenant(sql, tenant.id, async (tx) => {
        const cartId = await verifySessionToken(bearer, tenant.id, sessionSecret);
        if (!cartId) return null;
        const rows = await tx<{ status: string }[]>`
          select status from carts where tenant_id = ${tenant.id} and id = ${cartId}
        `;
        return rows[0]?.status === 'open' ? cartId : null;
      });
      if (existing) {
        const cart = await withTenant(sql, tenant.id, (tx) =>
          loadCartView(tx, tenant.id, existing),
        );
        return c.json({ sessionToken: bearer, cart });
      }
    }
    return idempotency(sql, async (c, tx) => {
      const cartId = crypto.randomUUID();
      const token = await mintSessionToken(cartId, tenant.id, sessionSecret);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      const hash = Buffer.from(digest).toString('hex');
      await tx`insert into carts (id, tenant_id, session_hash) values (${cartId}, ${tenant.id}, ${hash})`;
      const cart = await loadCartView(tx, tenant.id, cartId);
      return { status: 201, body: { sessionToken: token, cart } };
    })(c);
  });

  checkout.get('/cart', async (c) => {
    const tenant = c.get('tenant');
    const cartId = await sessionCartId(c, sessionSecret);
    const cart = await withTenant(sql, tenant.id, (tx) => loadCartView(tx, tenant.id, cartId));
    return c.json({ cart });
  });

  checkout.post('/cart/items', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async (c, tx) => {
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await bodyJson(c);
      await assertCartOpen(tx, tenant.id, cartId);
      // A malformed uuid would raise 22P02 (500, not a contract 4xx) — validate first.
      const productId = str(body.productId, 'productId', 64);
      if (!UUID_RE.test(productId)) {
        throw new HttpError(422, 'BAD_REQUEST', 'productId must be a uuid');
      }
      const qty = Number(body.qty ?? 1);
      if (Array.isArray(body.modifierIds) && body.modifierIds.length > 32) {
        throw new HttpError(422, 'BAD_REQUEST', 'modifierIds accepts at most 32 entries');
      }
      const modifierIds = Array.isArray(body.modifierIds)
        ? body.modifierIds.map((m) => str(m, 'modifierId', 64))
        : [];
      const cart = await addItem(
        tx,
        tenant.id,
        cartId,
        { productId, qty, modifierIds },
        getProductById,
      );
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.patch('/cart/items/:itemId', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async (c, tx) => {
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await bodyJson(c);
      const qty = Number(body.qty);
      if (!Number.isInteger(qty) || qty < 0 || qty > 99) {
        throw new HttpError(422, 'INVALID_QTY', 'qty must be an integer between 0 and 99');
      }
      await assertCartOpen(tx, tenant.id, cartId);
      const itemId = uuidParam(c, 'itemId');
      if (qty === 0) {
        await tx`delete from cart_items where tenant_id = ${tenant.id} and cart_id = ${cartId} and id = ${itemId}`;
      } else {
        await tx`update cart_items set qty = ${qty} where tenant_id = ${tenant.id} and cart_id = ${cartId} and id = ${itemId}`;
      }
      await tx`update carts set updated_at = now() where id = ${cartId}`;
      const cart = await loadCartView(tx, tenant.id, cartId);
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.delete('/cart/items/:itemId', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async (c, tx) => {
      const cartId = await sessionCartId(c, sessionSecret);
      await assertCartOpen(tx, tenant.id, cartId);
      await tx`delete from cart_items where tenant_id = ${tenant.id} and cart_id = ${cartId} and id = ${uuidParam(c, 'itemId')}`;
      const cart = await loadCartView(tx, tenant.id, cartId);
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.post('/cart/delivery', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async (c, tx) => {
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await bodyJson(c);
      const { mode, neighborhood, address } = body;
      if (mode !== 'pickup' && mode !== 'delivery') {
        throw new HttpError(422, 'INVALID_DELIVERY', 'mode must be pickup or delivery');
      }
      const nb =
        neighborhood === undefined || neighborhood === null
          ? null
          : str(neighborhood, 'neighborhood', 200);
      const addr = address === undefined || address === null ? null : str(address, 'address', 500);
      await assertCartOpen(tx, tenant.id, cartId);
      await tx`
        update carts set delivery = ${tx.json({ mode, neighborhood: nb, address: addr })}, updated_at = now()
        where tenant_id = ${tenant.id} and id = ${cartId}
      `;
      const cart = await loadCartView(tx, tenant.id, cartId);
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.post('/quote', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async (c, tx) => {
      const { neighborhood } = await bodyJson(c);
      const zones = await loadZones(tx, tenant.id);
      const zone = matchZone(
        zones,
        neighborhood === undefined || neighborhood === null
          ? ''
          : str(neighborhood, 'neighborhood', 200),
      );
      if (!zone) {
        return { status: 200, body: { eligible: false, reason: 'OUT_OF_ZONE' } };
      }
      return {
        status: 200,
        body: {
          eligible: true,
          zoneId: zone.id,
          feeCents: zone.fee_cents,
          etaMin: zone.eta_min_minutes,
          etaMax: zone.eta_max_minutes,
        },
      };
    })(c);
  });

  checkout.post('/checkout', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async (c, tx) => {
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await bodyJson(c);
      validateCheckoutShape(body);
      const order = await (async () => {
        // Lock the cart row first — concurrent checkouts would both see 'open' and mint duplicates.
        await tx`select id from carts where tenant_id = ${tenant.id} and id = ${cartId} for update`;
        const cart = await loadCartView(tx, tenant.id, cartId);
        // A completed cart must not mint a second order.
        if (cart.status !== 'open') {
          throw new HttpError(409, 'CART_NOT_OPEN', 'cart already checked out', {
            cartStatus: cart.status,
          });
        }
        // Advisory lock before reading eligibility — choke point vs concurrent settings/zone/product writes.
        await tx`select pg_advisory_xact_lock(hashtext(${tenant.id}))`;
        const settings = await loadSettings(tx, tenant.id, { forUpdate: true });
        const zones = await loadZones(tx, tenant.id, { forUpdate: true });
        // Re-validate modifier ids against current defs — a retired modifier can't slip through underpriced.
        const products = new Map<string, Awaited<ReturnType<typeof getProductById>>>();
        for (const item of cart.items) {
          products.set(
            item.productId,
            await getProductById(tx, tenant.id, item.productId, { forUpdate: true }),
          );
        }
        const { zone } = validateCheckout(
          currentStatus(settings),
          settings,
          cart,
          body,
          zones,
          products,
        );
        const delivery = {
          mode: body.delivery.mode,
          neighborhood: body.delivery.neighborhood ?? null,
          address: body.delivery.address ?? null,
          feeCents: zone?.fee_cents ?? 0,
          etaMin: zone?.eta_min_minutes ?? null,
          etaMax: zone?.eta_max_minutes ?? null,
        };
        const deliveryFee = body.delivery.mode === 'delivery' ? (zone?.fee_cents ?? 0) : 0;
        // Numbering relies on the advisory lock above — else two checkouts read the same max.
        const number = (
          await tx<
            { n: number }[]
          >`select coalesce(max(number), 0) + 1 as n from orders where tenant_id = ${tenant.id}`
        )[0]!.n;
        const orderId = crypto.randomUUID();
        const payment = {
          // 'sandbox' = the contract's dev provider name (pay-on-delivery stand-in).
          provider: 'sandbox',
          method: body.payment.method,
          status: 'pending',
          instructions:
            body.payment.method === 'pix'
              ? 'Pagamento PIX combinado na entrega/retirada (sandbox de Phase 0).'
              : 'Pagamento na entrega ou retirada (sandbox de Phase 0).',
        };
        await tx`
          insert into orders (id, tenant_id, cart_id, number, customer, delivery, payment, state, subtotal_cents, delivery_fee_cents, total_cents)
          values (${orderId}, ${tenant.id}, ${cartId}, ${number}, ${tx.json(body.customer)}, ${tx.json(delivery)}, ${tx.json(payment)},
                  'placed', ${cart.totals.subtotalCents}, ${deliveryFee}, ${cart.totals.subtotalCents + deliveryFee})
        `;
        await tx`
          insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
          values (${tenant.id}, ${orderId}, null, 'placed', 'customer', ${tx.json({ via: 'checkout-sandbox' })})
        `;
        await tx`
          insert into outbox (tenant_id, topic, payload)
          values (${tenant.id}, 'order.placed', ${tx.json({ orderId, number })})
        `;
        await tx`update carts set status = 'completed', updated_at = now() where id = ${cartId}`;
        return orderId;
      })();
      const view = await loadOrderView(tx, tenant.id, order, cartId);
      return { status: 201, body: { order: view } };
    })(c);
  });

  checkout.get('/orders/:id', async (c) => {
    const tenant = c.get('tenant');
    const cartId = await sessionCartId(c, sessionSecret);
    const order = await withTenant(sql, tenant.id, (tx) =>
      loadOrderView(tx, tenant.id, uuidParam(c, 'id'), cartId),
    );
    return c.json({ order });
  });

  // /control/v1: staff-gated internal surface — X-Vendua-Control key or
  // vendua_control cookie; 404 (not 401) keeps it invisible to scans.
  const CONTROL_COOKIE = 'vendua_control';
  const staffSecret = controlSecret ?? sessionSecret;
  // Derived token, never the secret itself — rotating CONTROL_SECRET invalidates every cookie.
  const controlToken = createHmac('sha256', staffSecret).update('vendua.control').digest('hex');
  const controlAuthed = (c: Context) =>
    c.req.header('x-vendua-control') === staffSecret ||
    getCookie(c, CONTROL_COOKIE) === controlToken;
  const controlGate = (c: Context) => {
    if (!controlAuthed(c)) throw new HttpError(404, 'NOT_FOUND', 'not found');
    // CSRF: cookie-authed mutations need the custom x-vendua-staff marker + same-host Origin.
    const viaHeader = c.req.header('x-vendua-control') === staffSecret;
    if (!viaHeader && c.req.method !== 'GET') {
      if (!c.req.header('x-vendua-staff')) throw new HttpError(404, 'NOT_FOUND', 'not found');
      const origin = c.req.header('origin');
      const reqHost =
        (trustProxy ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host');
      let originHost: string | null = null;
      try {
        originHost = origin ? new URL(origin).host : null;
      } catch {
        originHost = null;
      }
      if (origin && reqHost && originHost !== reqHost) {
        throw new HttpError(404, 'NOT_FOUND', 'not found');
      }
    }
  };
  const requireIdemKey = (c: Context) => {
    const key = c.req.header('idempotency-key');
    if (!key) {
      throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    }
    if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
    return key;
  };

  app.get('/control/v1/state', async (c) => {
    controlGate(c);
    const slug = str(c.req.query('tenant'), 'tenant', 200);
    const tenant = await resolver.resolveBySlug(slug);
    if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'tenant not found');
    const settings = await withTenant(sql, tenant.id, (tx) => loadSettings(tx, tenant.id));
    const status = currentStatus(settings);
    const notices = composeNotices(tenant.slug, settings, status);
    return c.json({
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      store: {
        status: status.status,
        ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}),
      },
      notices: notices.filter((n) => n.severity === 'blocking'),
    });
  });

  // Platform data, no tenant context; all mutations take Idempotency-Key.
  const loginHits = new Map<string, { count: number; resetAt: number }>();
  app.post('/control/v1/login', async (c) => {
    // Cap guesses at 10/min/IP so the endpoint isn't a weak-secret oracle.
    const ip = (() => {
      if (!trustProxy) return 'local';
      const xff = c.req
        .header('x-forwarded-for')
        ?.split(',')
        .map((s) => s.trim());
      return xff?.at(-1 - proxyHops) ?? 'unknown';
    })();
    const now = Date.now();
    // Evict expired buckets or rotating IPs grow the map forever.
    for (const [k, v] of loginHits) if (v.resetAt <= now) loginHits.delete(k);
    const bucket = loginHits.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      loginHits.set(ip, { count: 1, resetAt: now + 60_000 });
    } else if (++bucket.count > 10) {
      throw new HttpError(429, 'RATE_LIMITED', 'too many attempts — retry in a minute');
    }
    const body = (await bodyJson(c).catch(() => ({}))) as { key?: unknown };
    if (body.key !== staffSecret) throw new HttpError(404, 'NOT_FOUND', 'not found');
    setCookie(c, CONTROL_COOKIE, controlToken, {
      httpOnly: true,
      sameSite: 'Lax',
      // TLS directly, or via trusted X-Forwarded-Proto.
      secure:
        c.req.url.startsWith('https://') ||
        (trustProxy && c.req.header('x-forwarded-proto') === 'https'),
      maxAge: 60 * 60 * 12,
      path: '/control',
    });
    return c.json({ ok: true });
  });

  app.post('/control/v1/logout', (c) => {
    deleteCookie(c, CONTROL_COOKIE, { path: '/control' });
    return c.json({ ok: true });
  });

  app.get('/control/v1/session', (c) => {
    controlGate(c);
    return c.json({ ok: true });
  });

  // SSE triggers; the connect-time 'sync' covers events missed while reconnecting.
  app.get('/control/v1/events', (c) => {
    controlGate(c);
    return controlSse(c);
  });

  app.get('/control/v1/leads', async (c) => {
    controlGate(c);
    const state = c.req.query('state');
    const tag = c.req.query('tag');
    const archived = c.req.query('archived');
    const limit = c.req.query('limit');
    const q = c.req.query('q');
    const cursor = c.req.query('cursor');
    const sort = c.req.query('sort');
    const { leads, nextCursor } = await listLeads(sql, {
      ...(q ? { q } : {}),
      ...(state ? { state: leadState(state) } : {}),
      ...(tag ? { tag: str(tag, 'tag', 60) } : {}),
      ...(archived === 'only' || archived === 'all' ? { archived } : {}),
      ...(limit ? { limit: Math.min(Math.max(Number(limit) || 50, 1), 200) } : {}),
      ...(cursor ? { cursor } : {}),
      ...(sort ? { sort: leadSort(sort) } : {}),
    });
    return c.json({ leads, nextCursor });
  });

  app.post('/control/v1/leads', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    if (body.automation !== undefined && typeof body.automation !== 'boolean') {
      throw new HttpError(422, 'BAD_REQUEST', 'automation must be a boolean', {
        field: 'automation',
      });
    }
    // automation:false skips the run — the staff-managed equivalent of a CSV import.
    const res = await claimControl<{ lead: Lead; runId?: string; retired?: string[] }>(
      sql,
      requireIdemKey(c),
      async (tx) => {
        // Lead + run share one claim — a retry replays instead of duplicating.
        const created = await insertLeadTx(tx, leadInsert(body));
        if (
          created.body.lead.agentMode !== 'off' &&
          body.automation !== false &&
          (await automationAllowedTx(tx, 'outreach')).ok
        ) {
          // Send policy is read live at send time, not stamped here — a change between create and claim must take effect.
          const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
          const delay = g.firstContactDelayMin ?? DEFAULT_GUARDRAILS.firstContactDelayMin;
          const d = await requestAgentTx(tx, {
            kind: 'outreach',
            source: 'first_contact',
            leadId: created.body.lead.id,
            text: 'lead criado pela equipe — primeiro contato',
            params: { focus: 'primeiro contato — lead recém-criado pela equipe' },
            ...(delay > 0 ? { at: new Date(Date.now() + delay * 60_000) } : {}),
          });
          const runId = d.runId;
          const cap = { retired: d.retired };
          return {
            status: created.status,
            // null when the cost cap refused the run — the card's flag is the explanation.
            body: {
              ...created.body,
              ...(runId ? { runId } : {}),
              ...(cap.retired?.length ? { retired: cap.retired } : {}),
            },
          };
        }
        return created;
      },
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) {
      emitControlEvent('lead.change', res.body.lead.id);
      if (res.body.runId) emitControlEvent('run.update', res.body.runId);
      for (const r of res.body.retired ?? []) emitControlEvent('run.update', r);
    }
    if (res.body.runId) kickDrain();
    return c.json(res.body, res.status as 200);
  });

  app.get('/control/v1/leads/export', async (c) => {
    controlGate(c);
    const csv = await exportLeadsCsv(sql);
    c.header('content-type', 'text/csv; charset=utf-8');
    c.header('content-disposition', 'attachment; filename="leads.csv"');
    return c.body(csv);
  });

  app.post('/control/v1/leads/import', async (c) => {
    controlGate(c);
    // Raw text/csv body so bulk imports aren't capped at the JSON size cap.
    if (!(c.req.header('content-type') ?? '').includes('text/csv')) {
      throw new HttpError(415, 'BAD_REQUEST', 'content-type must be text/csv');
    }
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > 4_000_000) throw new HttpError(413, 'BAD_REQUEST', 'csv too large');
    const text = await c.req.text();
    if (text.length > 4_000_000) throw new HttpError(413, 'BAD_REQUEST', 'csv too large');
    const { rows, skipped } = parseLeadsCsv(text);
    const res = await importLeads(sql, rows, requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json({
      ...res.body,
      skipped: [...skipped, ...res.body.skipped],
    });
  });

  app.get('/control/v1/leads/duplicates', async (c) => {
    controlGate(c);
    return c.json({ groups: await findDuplicates(sql) });
  });

  app.get('/control/v1/stats', async (c) => {
    controlGate(c);
    const stats = await leadStats(sql);
    // Composed here so leads.ts stays free of control-settings deps.
    const forecast = await pipelineForecast(sql, stats.byState);
    return c.json({ ...stats, forecast });
  });

  // taken_on upsert makes a same-day re-shot a refresh, not a duplicate.
  app.post('/control/v1/stats/snapshot', async (c) => {
    controlGate(c);
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => ({
      status: 201,
      body: { snapshot: await snapshotPipelineTx(tx) },
    }));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('lead.change');
    return c.json(res.body, 201);
  });

  app.get('/control/v1/leads/:id', async (c) => {
    controlGate(c);
    const lead = await getLeadDetail(sql, uuidParam(c, 'id'));
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    return c.json({ lead });
  });

  app.patch('/control/v1/leads/:id', async (c) => {
    controlGate(c);
    const res = await updateLead(
      sql,
      uuidParam(c, 'id'),
      leadPatch(await bodyJson(c)),
      requireIdemKey(c),
      'staff',
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.delete('/control/v1/leads/:id', async (c) => {
    controlGate(c);
    const res = await deleteLead(sql, uuidParam(c, 'id'), requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.post('/control/v1/leads/:id/unsubscribe', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    let transitioned = false;
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const rows = await tx`
        update leads set unsubscribed_at = now(), updated_at = now()
        where id = ${id} and unsubscribed_at is null returning id
      `;
      const exists = rows[0] ?? (await tx`select id from leads where id = ${id}`)[0];
      if (!exists) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
      if (rows[0]) {
        transitioned = true;
        // Opt-out never lifts — the claim gate can never pick up queued runs, so cancel them.
        await tx`
          update agent_runs set status = 'canceled', finished_at = now(), error = 'descadastrado'
          where lead_id = ${id} and status = 'queued'
        `;
        await tx`
          insert into lead_activities (lead_id, kind, body, created_by)
          values (${id}, 'system', 'Descadastrado pela equipe', 'staff')
        `;
      }
      return { status: 200, body: { ok: true } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed && transitioned) emitControlEvent('lead.change', id);
    return c.json(res.body);
  });

  app.get('/control/v1/leads/:id/activities', async (c) => {
    controlGate(c);
    return c.json({ activities: await listActivities(sql, uuidParam(c, 'id')) });
  });

  app.post('/control/v1/leads/:id/activities', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const kind =
      typeof body.kind === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(body.kind)
        ? (body.kind as ActivityKind)
        : 'note';
    const res = await addActivity(
      sql,
      uuidParam(c, 'id'),
      { kind, body: str(body.body, 'body', 4000), createdBy: 'staff' },
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });

  app.get('/control/v1/leads/:id/threads', async (c) => {
    controlGate(c);
    return c.json({ threads: await threadsForLead(sql, uuidParam(c, 'id')) });
  });

  app.post('/control/v1/leads/:id/threads', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const leadId = uuidParam(c, 'id');
    const chan = channel(str(body.channel, 'channel', 20));
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const lead = await tx`select 1 from leads where id = ${leadId}`;
      if (!lead[0]) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
      const thread = await ensureThread(tx, leadId, chan);
      return { status: 200, body: { thread } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('thread.message', res.body.thread.id);
    return c.json(res.body, res.status as 200);
  });

  app.post('/control/v1/leads/:id/tasks', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const res = await createTask(
      sql,
      uuidParam(c, 'id'),
      {
        title: str(body.title, 'title', 300),
        dueAt: (body.dueAt as string) ?? null,
        createdBy: 'staff',
      },
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });

  app.get('/control/v1/tasks', async (c) => {
    controlGate(c);
    const done = c.req.query('done');
    const leadId = c.req.query('leadId');
    if (leadId && !UUID_RE.test(leadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'leadId must be a uuid');
    }
    return c.json({
      tasks: await listTasks(sql, {
        ...(leadId ? { leadId } : {}),
        ...(done === 'true' || done === 'false' ? { done: done === 'true' } : {}),
      }),
    });
  });

  app.patch('/control/v1/tasks/:id', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const res = await completeTask(sql, uuidParam(c, 'id'), body.done !== false, requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.get('/control/v1/threads', async (c) => {
    controlGate(c);
    const chan = c.req.query('channel');
    const q = c.req.query('q');
    return c.json({
      threads: await listThreads(sql, {
        ...(chan ? { channel: channel(chan) as Channel } : {}),
        ...(q ? { q } : {}),
      }),
    });
  });

  app.get('/control/v1/threads/:id', async (c) => {
    controlGate(c);
    const t = await getThread(sql, uuidParam(c, 'id'));
    if (!t) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
    return c.json(t);
  });

  app.post('/control/v1/threads/:id/agent', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const res = await setThreadAgent(
      sql,
      uuidParam(c, 'id'),
      body.enabled !== false,
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.post('/control/v1/threads/:id/messages', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c);
    const t = await controlTx(
      sql,
      (tx) =>
        tx<
          { lead_id: string; channel: Channel }[]
        >`select lead_id, channel from lead_threads where id = ${id}`,
    );
    if (!t[0]) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
    const wantSend = body.send === true;
    // Applied inside composeMessage's claim tx so a failed compose can't leave it.
    const subject = typeof body.subject === 'string' ? str(body.subject, 'subject', 200) : null;
    const res = await composeMessage(
      sql,
      {
        leadId: t[0].lead_id,
        channel: t[0].channel,
        body: str(body.body, 'body', 8000),
        author: 'staff',
        status: wantSend ? 'queued' : 'draft',
        ...(subject ? { subjectOverride: subject } : {}),
      },
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (wantSend) {
      // dispatchMessage no-ops unless the row is still 'queued' — safe on replay.
      const { dispatchMessage } = await import('./agent/send.ts');
      const sent = await dispatchMessage(sql, res.body.message.id);
      return c.json({ ...res.body, sent });
    }
    return c.json(res.body, res.status as 200);
  });

  app.get('/control/v1/approvals', async (c) => {
    controlGate(c);
    return c.json({ drafts: await listDrafts(sql) });
  });

  app.post('/control/v1/messages/:id/approve', async (c) => {
    controlGate(c);
    const res = await approveMessage(sql, uuidParam(c, 'id'), 'staff', requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    // A refusal's message stayed 'draft' — dispatching would hide it behind a fake success.
    if (res.status !== 200) return c.json(res.body, res.status as 422);
    // Stale draft superseded in-claim — kick drain so the regen recomposes promptly.
    if (res.body.stale) {
      kickDrain();
      return c.json(res.body);
    }
    const { dispatchMessage } = await import('./agent/send.ts');
    const sent = await dispatchMessage(sql, res.body.message.id);
    return c.json({ ...res.body, sent });
  });

  app.post('/control/v1/messages/:id/reject', async (c) => {
    controlGate(c);
    const res = await rejectMessage(sql, uuidParam(c, 'id'), requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.get('/control/v1/integrations', async (c) => {
    controlGate(c);
    return c.json({ integrations: await listIntegrations(sql) });
  });

  app.put('/control/v1/integrations/:kind', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const kind = integrationKind(c.req.param('kind'));
    const res = await upsertIntegration(
      sql,
      {
        kind,
        driver: str(body.driver, 'driver', 60),
        ...(body.enabled !== undefined ? { enabled: body.enabled === true } : {}),
        ...(body.config !== undefined ? { config: body.config as Record<string, unknown> } : {}),
        ...(body.secretRef !== undefined ? { secretRef: body.secretRef as string | null } : {}),
      },
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (kind === 'instagram') {
      // a disable/switch stops the sidecar session now; an enable pushes the stored one
      const { reconcileInstagram } = await import('./agent/channels/instagram.ts');
      void getIntegration(sql, 'instagram').then((i) => reconcileInstagram(sql, i));
    }
    if (kind === 'whatsapp') {
      // A disable/switch must close the old Baileys session now, not lazily.
      const { ensureSocket } = await import('./agent/channels/whatsapp.ts');
      void getIntegration(sql, 'whatsapp')
        .then((i) => ensureSocket(sql, i))
        .catch((e) => waLog.error({ err: e }, 'socket reconcile failed'));
    }
    return c.json(res.body);
  });

  // Exercises the ACTIVE provider for real; claimed so a retry replays instead of spending another call.
  app.post('/control/v1/integrations/:kind/test', async (c) => {
    controlGate(c);
    const kind = integrationKind(c.req.param('kind'));
    const res = await claimControl(sql, requireIdemKey(c), () => testIntegration(sql, kind));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });

  app.get('/control/v1/settings', async (c) => {
    controlGate(c);
    const rows = await listSettings(sql);
    // guardrails/pitch return effective objects (defaults merged), not the sparse override.
    return c.json({
      settings: [
        ...rows.filter((r) => r.key !== 'guardrails' && r.key !== 'pitch'),
        { key: 'guardrails', value: await getGuardrails(sql) },
        { key: 'pitch', value: await getPitch(sql) },
      ],
    });
  });

  app.put('/control/v1/settings/:key', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const key = str(c.req.param('key'), 'key', 80);
    validateSetting(key, body.value);
    const res = await putSetting(sql, key, body.value, requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    // A lowered cap strands over-cap leads (queued runs park silently) — flag them now; deduped.
    if (key === 'guardrails' && !res.replayed) await flagCappedLeads(sql);
    return c.json(res.body);
  });

  // Staff write surface for the same memory tables the agent writes via rememberTx/upsertLeadFactTx.

  app.get('/control/v1/agent/memory', async (c) => {
    controlGate(c);
    const scopeQ = c.req.query('scope');
    const segment = c.req.query('segment');
    const items = await listMemoryItems(sql, {
      ...(scopeQ !== undefined ? { scope: memoryScope(scopeQ) } : {}),
      ...(segment !== undefined ? { segment: str(segment, 'segment', 120) } : {}),
    });
    return c.json({ items });
  });

  app.post('/control/v1/agent/memory', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const res = await createMemoryItem(
      sql,
      {
        scope: memoryScope(body.scope),
        ...(body.segment !== undefined && body.segment !== null
          ? { segment: str(body.segment, 'segment', 120) }
          : {}),
        content: str(body.content, 'content', 500),
      },
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.patch('/control/v1/agent/memory/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c);
    const patch: { content?: string; pinned?: boolean } = {};
    if ('content' in body) patch.content = str(body.content, 'content', 500);
    if ('pinned' in body) {
      if (typeof body.pinned !== 'boolean') {
        throw new HttpError(422, 'BAD_REQUEST', 'pinned must be a boolean', { field: 'pinned' });
      }
      patch.pinned = body.pinned;
    }
    if (!Object.keys(patch).length) {
      throw new HttpError(422, 'BAD_REQUEST', 'no updatable fields in body');
    }
    const res = await patchMemoryItem(sql, id, patch, requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.delete('/control/v1/agent/memory/:id', async (c) => {
    controlGate(c);
    const res = await deleteMemoryItem(sql, uuidParam(c, 'id'), requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.get('/control/v1/leads/:id/facts', async (c) => {
    controlGate(c);
    return c.json({ facts: await listLeadFacts(sql, uuidParam(c, 'id')) });
  });

  app.put('/control/v1/leads/:id/facts/:key', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const res = await putLeadFact(
      sql,
      uuidParam(c, 'id'),
      str(c.req.param('key'), 'key', 60),
      {
        value: str(body.value, 'value', 500),
        ...(body.confidence !== undefined ? { confidence: body.confidence as number } : {}),
      },
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.delete('/control/v1/leads/:id/facts/:key', async (c) => {
    controlGate(c);
    const res = await deleteLeadFact(
      sql,
      uuidParam(c, 'id'),
      str(c.req.param('key'), 'key', 60),
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.get('/control/v1/meetings/status', async (c) => {
    controlGate(c);
    return c.json(await meetingsStatus(sql));
  });

  app.get('/control/v1/meetings', async (c) => {
    controlGate(c);
    const scope = c.req.query('scope');
    const leadId = c.req.query('lead_id');
    const dateQ = (name: string): Date | undefined => {
      const raw = c.req.query(name);
      if (!raw) return undefined;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new HttpError(422, 'BAD_REQUEST', `${name} must be an ISO-8601 timestamp`);
      }
      return d;
    };
    const from = dateQ('from');
    const to = dateQ('to');
    if (leadId && !UUID_RE.test(leadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'lead_id must be a uuid');
    }
    const meetings = await listMeetings(sql, {
      ...(scope === 'upcoming' || scope === 'past' || scope === 'all' ? { scope } : {}),
      ...(leadId ? { leadId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    return c.json({ meetings });
  });

  // Same token format as the agent's links — both resolve identically.
  app.get('/control/v1/meetings/link', async (c) => {
    controlGate(c);
    const leadId = str(c.req.query('lead_id'), 'lead_id', 64);
    if (!UUID_RE.test(leadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'lead_id must be a uuid');
    }
    const lead = await controlTx(
      sql,
      async (tx) => (await tx`select id from leads where id = ${leadId}`)[0],
    );
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    return c.json({ url: await bookingLink(sql, leadId, staffSecret) });
  });

  // Same pipeline as the public booking endpoint.
  app.post('/control/v1/meetings', async (c) => {
    controlGate(c);
    const key = requireIdemKey(c);
    const body = await bodyJson(c);
    // bookMeetingTx must run INSIDE the claim tx — a nested controlTx grabs a second
    // pooled conn and ~10 concurrent bookings deadlock the pool; gcal read stays outside (no network in-tx).
    const input = parseBookInput({
      leadId: str(body.leadId, 'leadId', 64),
      start: str(body.start, 'start', 64),
      bookerName: body.name ? str(body.name, 'name', 200) : null,
      bookerContact: body.contact ? str(body.contact, 'contact', 300) : null,
      source: 'staff',
      ...(typeof body.durationMin === 'number' ? { durationMin: body.durationMin } : {}),
    });
    const gcalBusy = await bookBusyWindows(input.start);
    const res = await claimControl(sql, key, async (tx) => {
      const out = await bookMeetingTx(tx, input, new Date(), gcalBusy);
      return { status: 201, body: { meeting: meetingJson(out.meeting), created: out.created } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed && res.body.created) {
      emitControlEvent('meeting.change', res.body.meeting.id);
      if (res.body.meeting.leadId) emitControlEvent('lead.change', res.body.meeting.leadId);
    }
    // Effects run on fresh claims AND replays — a crash leaves replay as the retry point;
    // re-read so the response carries the provisioned roomUrl/gcalEventId.
    await ensureMeetingEffects(sql, res.body.meeting.id);
    const fresh = await controlTx(
      sql,
      async (tx) =>
        (await tx<MeetingRow[]>`select * from meetings where id = ${res.body.meeting.id}`)[0],
    );
    return c.json({ meeting: fresh ? meetingJson(fresh) : res.body.meeting }, res.status as 201);
  });

  app.patch('/control/v1/meetings/:id', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const res = await patchMeeting(
      sql,
      uuidParam(c, 'id'),
      {
        ...(body.status !== undefined
          ? {
              status: (() => {
                const s = str(body.status, 'status', 20);
                if (!['cancelled', 'done', 'no_show'].includes(s)) {
                  throw new HttpError(422, 'BAD_REQUEST', `unknown status '${s}'`);
                }
                return s as 'cancelled' | 'done' | 'no_show';
              })(),
            }
          : {}),
        ...(body.startsAt !== undefined ? { startsAt: str(body.startsAt, 'startsAt', 64) } : {}),
        ...(body.endsAt !== undefined ? { endsAt: str(body.endsAt, 'endsAt', 64) } : {}),
      },
      requireIdemKey(c),
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body, res.status as 200);
  });

  app.get('/control/v1/agent/runs', async (c) => {
    controlGate(c);
    const kind = c.req.query('kind');
    const status = c.req.query('status');
    const leadId = c.req.query('lead_id');
    if (leadId && !UUID_RE.test(leadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'lead_id must be a uuid');
    }
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const scheduled = c.req.query('scheduled') === '1';
    // Cursors carry timestamptz::text so microseconds survive (JS Date truncates to ms); the key pins the view.
    const cursor = c.req.query('cursor');
    const TS_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?[+-](\d{2})$/;
    // Calendar sanity too — a loose regex passes values that 500 the timestamptz cast.
    const tsOk = (ts: string) => {
      const m = TS_RE.exec(ts);
      if (!m) return false;
      const [y, mo, d, h, mi, s, oh] = m.slice(1).map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const days = [
        31,
        y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
      ];
      return (
        mo >= 1 &&
        mo <= 12 &&
        d >= 1 &&
        d <= days[mo - 1]! &&
        h <= 23 &&
        mi <= 59 &&
        s <= 59 &&
        oh <= 15
      );
    };
    let cursorCond = 'true';
    if (cursor) {
      const sep = cursor.indexOf('|');
      const key = sep > 0 ? cursor.slice(0, cursor.indexOf(':')) : '';
      const ts = sep > 0 ? cursor.slice(cursor.indexOf(':') + 1, sep) : '';
      const id = sep > 0 ? cursor.slice(sep + 1) : '';
      const want = scheduled ? 'run_at' : 'created_at';
      if (key !== want || !tsOk(ts) || !UUID_RE.test(id)) {
        throw new HttpError(400, 'BAD_REQUEST', `cursor must be "${want}:<ts>|<run uuid>"`);
      }
      // Bind text + cast server-side — an inferred param goes through JS Date and loses µs.
      cursorCond = scheduled
        ? `(r.run_at > ${p(ts)}::text::timestamptz or (r.run_at = ${p(ts)}::text::timestamptz and r.id > ${p(id)}::uuid))`
        : `(r.created_at < ${p(ts)}::text::timestamptz or (r.created_at = ${p(ts)}::text::timestamptz and r.id < ${p(id)}::uuid))`;
    }
    const where = [
      kind ? `kind = ${p(kind)}` : 'true',
      status ? `status = ${p(status)}` : 'true',
      leadId ? `r.lead_id = ${p(leadId)}` : 'true',
      scheduled ? 'r.run_at is not null' : 'true',
      cursorCond,
    ];
    const order = scheduled ? 'r.run_at asc, r.id asc' : 'r.created_at desc, r.id desc';
    const rows = await controlTx(sql, (tx) =>
      tx.unsafe(
        `select r.id, r.kind, r.status, r.lead_id, r.thread_id, r.tokens_in, r.tokens_out,
                r.cost_cents, r.error, r.created_at, r.started_at, r.finished_at, r.run_at,
                r.source, r.promised,
                r.created_at::text as created_at_ts, r.run_at::text as run_at_ts,
                l.name as lead_name, t.agent_enabled as thread_agent_enabled
         from agent_runs r
         left join leads l on l.id = r.lead_id
         left join lead_threads t on t.id = r.thread_id
         where ${where.join(' and ')}
         order by ${order} limit ${p(limit)}`,
        params as never[],
      ),
    );
    const last = rows[rows.length - 1] as
      { id: string; created_at_ts: string; run_at_ts: string | null } | undefined;
    const nextCursor =
      rows.length === limit && last
        ? `${scheduled ? 'run_at' : 'created_at'}:${(scheduled ? last.run_at_ts : last.created_at_ts) ?? last.created_at_ts}|${last.id}`
        : undefined;
    return c.json({ runs: rows, ...(nextCursor ? { nextCursor } : {}) });
  });

  app.get('/control/v1/agent/runs/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const rows = await controlTx(
      sql,
      (tx) =>
        tx`select r.*, l.name as lead_name from agent_runs r left join leads l on l.id = r.lead_id where r.id = ${id}`,
    );
    if (!rows[0]) throw new HttpError(404, 'RUN_NOT_FOUND', 'run not found');
    return c.json({ run: rows[0] });
  });

  // Cooperative cancel — the worker's next journal write fails the claim fence and unwinds.
  app.post('/control/v1/agent/runs/:id/cancel', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    let transitioned = false;
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const rows = await tx<
        { thread_id: string | null; params: { channel?: unknown; draftOnly?: unknown } | null }[]
      >`
        update agent_runs set status = 'canceled', finished_at = now(), error = 'cancelado'
        where id = ${id} and status in ('queued', 'running')
        returning id, params, thread_id
      `;
      if (!rows[0]) {
        const cur = (
          await tx<{ status: string }[]>`select status from agent_runs where id = ${id}`
        )[0];
        if (!cur) throw new HttpError(404, 'RUN_NOT_FOUND', 'run not found');
        // already terminal — report it, don't error (cancel is idempotent)
        return { status: 200, body: { ok: true, status: cur.status } };
      }
      // Release consumed mail back to pending so the sweep respawns a run (event=true — cancel isn't a failure signal).
      await releaseInboxTx(tx, id, true);
      // Tombstone the forRunId items that asked for this run or they'd respawn it — scoped to what
      // the run could serve (draftOnly + effective channel + thread), so merely-associated mail survives.
      const runChan = isSendChannel(rows[0].params?.channel) ? rows[0].params.channel : '';
      const runThread = rows[0].thread_id ?? '';
      const effChan =
        runChan ||
        (runThread
          ? ((
              await tx<{ c: string }[]>`
              select channel::text as c from lead_threads where id = ${runThread}::uuid
            `
            )[0]?.c ?? '')
          : '');
      const runDraftOnly = rows[0].params?.draftOnly === true;
      await tx`
        update agent_inbox set consumed_at = now()
        where payload->>'forRunId' = ${id} and consumed_at is null
          and (coalesce(payload->'params'->>'draftOnly', 'false') = 'true') = ${runDraftOnly}
          and coalesce(
               payload->'params'->>'channel',
               (select lt.channel::text from lead_threads lt where lt.id::text = payload->>'threadId'),
               ${effChan}
             ) = ${effChan}
          and (${runThread} = '' or coalesce(payload->>'threadId', ${runThread}) = ${runThread})
      `;
      transitioned = true;
      return { status: 200, body: { ok: true, status: 'canceled' } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed && transitioned) {
      emitControlEvent('run.update', id);
    }
    return c.json(res.body);
  });

  // The one staff entry point (ADR 0016): "agent, do <kind> for these leads / the board".
  // Single-lead asks fail loudly (404/422); bulk asks report what they skipped and why.
  app.post('/control/v1/agent/requests', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const kind = str(body.kind, 'kind', 40);
    if (!(JOB_KINDS as readonly string[]).includes(kind)) {
      throw new HttpError(422, 'BAD_REQUEST', `kind must be ${JOB_KINDS.join('|')}`);
    }
    const rawIds =
      body.leadIds !== undefined ? body.leadIds : body.leadId !== undefined ? [body.leadId] : [];
    if (
      !Array.isArray(rawIds) ||
      rawIds.length > 200 ||
      rawIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) {
      throw new HttpError(422, 'BAD_REQUEST', 'leadIds must be an array of ≤200 uuids');
    }
    const threadId = body.threadId != null ? str(body.threadId, 'threadId', 64) : null;
    if (threadId && !UUID_RE.test(threadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'threadId must be a uuid');
    }
    if (threadId && rawIds.length > 1) {
      throw new HttpError(422, 'BAD_REQUEST', 'threadId takes a single lead');
    }
    // strategist reviews the whole board — a lead-bound row would eat the weekly slot
    if (kind === 'strategist' && (rawIds.length || threadId)) {
      throw new HttpError(422, 'BAD_REQUEST', 'strategist requests take no leads');
    }
    if (body.focus != null) str(body.focus, 'focus', 2000);
    const wantChannel = isSendChannel(body.channel) ? body.channel : null;
    if (body.channel != null && body.channel !== 'auto' && !wantChannel) {
      throw new HttpError(422, 'BAD_REQUEST', 'channel must be auto|whatsapp|instagram|email');
    }
    if (body.draftOnly != null && typeof body.draftOnly !== 'boolean') {
      throw new HttpError(422, 'BAD_REQUEST', 'draftOnly must be a boolean');
    }
    const goal = body.goal != null ? agentGoal(body.goal) : null;
    if (body.params != null && (typeof body.params !== 'object' || Array.isArray(body.params))) {
      throw new HttpError(422, 'BAD_REQUEST', 'params must be an object');
    }
    const params: Record<string, unknown> = {
      ...((body.params as Record<string, unknown>) ?? {}),
      ...(typeof body.focus === 'string' && body.focus.trim() ? { focus: body.focus.trim() } : {}),
      ...(wantChannel ? { channel: wantChannel } : {}),
      ...(body.draftOnly === true ? { draftOnly: true } : {}),
      ...(goal ? { goal } : {}),
    };
    // params lands verbatim in agent_runs.params and the inbox payload — bound it.
    if (JSON.stringify(params).length > 16_384)
      throw new HttpError(422, 'PARAMS_TOO_LARGE', 'run params exceed 16 KiB');
    const text =
      (goal ? `a equipe definiu a meta '${goal}'` : `a equipe pediu '${kind}'`) +
      (typeof params.focus === 'string' ? ` — ${params.focus}` : '');
    type Out = {
      runId?: string;
      runs: { leadId: string | null; runId: string; startAt: string | null }[];
      skipped: { leadId: string; code: string; reason: string }[];
    };
    const events: { retired: string[]; capFlagged: boolean } = { retired: [], capFlagged: false };
    const res = await claimControl<Out>(sql, requireIdemKey(c), async (tx) => {
      const out: Out = { runs: [], skipped: [] };
      let leadIds = [...new Set(rawIds as string[])];
      if (threadId) {
        // A thread-only ask adopts the thread's owner — null lead_id would skip the suppression gate.
        const th = (
          await tx<{ lead_id: string; agent_enabled: boolean }[]>`
            select lead_id, agent_enabled from lead_threads where id = ${threadId}
          `
        )[0];
        if (!th) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
        if (leadIds[0] && th.lead_id.toLowerCase() !== leadIds[0].toLowerCase()) {
          throw new HttpError(422, 'BAD_REQUEST', 'threadId does not belong to leadId');
        }
        if (!th.agent_enabled) throw new HttpError(422, 'THREAD_PAUSED', 'thread paused for agent');
        leadIds = [th.lead_id];
      }
      const single = leadIds.length === 1;
      if (!leadIds.length) {
        const d = await requestAgentTx(tx, {
          kind: kind as JobKind,
          source: 'staff',
          text,
          params,
        });
        events.retired.push(...d.retired);
        if (d.runId)
          out.runs.push({
            leadId: null,
            runId: d.runId,
            startAt: d.startAt?.toISOString() ?? null,
          });
      }
      // capfins first, in sorted order — request order could AB-BA another batch (capLockTx)
      for (const id of [...leadIds].sort()) await capLockTx(tx, id);
      for (const id of leadIds) {
        const lead = (
          await tx<
            {
              agent_mode: string;
              archived_at: string | null;
              unsubscribed_at: string | null;
              agent_paused_at: string | null;
            }[]
          >`
            select agent_mode, archived_at, unsubscribed_at, agent_paused_at from leads
            where id = ${id} for update
          `
        )[0];
        // mirror the claim gate's suppression — a suppressed run would park 'queued' forever
        const suppressed = !lead
          ? null
          : lead.archived_at
            ? 'lead archived'
            : lead.unsubscribed_at
              ? 'lead unsubscribed'
              : lead.agent_paused_at
                ? 'agent paused'
                : lead.agent_mode === 'off'
                  ? 'agent off'
                  : null;
        if (single && !lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
        if (single && suppressed) throw new HttpError(422, 'LEAD_SUPPRESSED', suppressed);
        if (!lead || suppressed) {
          out.skipped.push({
            leadId: id,
            code: lead ? 'LEAD_SUPPRESSED' : 'LEAD_NOT_FOUND',
            reason: suppressed ?? 'lead not found',
          });
          continue;
        }
        const d = await requestAgentTx(tx, {
          kind: kind as JobKind,
          source: 'staff',
          leadId: id,
          threadId,
          text,
          params,
        });
        events.retired.push(...d.retired);
        if (d.capFlagged) events.capFlagged = true;
        if (!d.runId) {
          // the request stays filed; the cap flag (and its [humano] task) is the explanation
          out.skipped.push({
            leadId: id,
            code: 'LEAD_COST_CAP',
            reason: 'lead over its agent cost cap',
          });
          continue;
        }
        // the goal sticks only once the lead is actually served
        if (goal)
          await tx`update leads set agent_goal = ${goal}, updated_at = now() where id = ${id}`;
        out.runs.push({ leadId: id, runId: d.runId, startAt: d.startAt?.toISOString() ?? null });
      }
      if (out.runs[0]) out.runId = out.runs[0].runId;
      // Return 422, don't throw — the committed claim keeps the cap flag and replays idempotently.
      if (single && !out.runs.length) {
        return {
          status: 422,
          body: {
            error: {
              code: 'LEAD_COST_CAP',
              message:
                'lead over its agent cost cap — raise guardrails.leadLifetimeCostCapUsd or retire the lead',
            },
          } as never,
        };
      }
      return { status: out.runs.length ? 201 : 200, body: out };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) {
      for (const r of res.body.runs ?? []) emitControlEvent('run.update', r.runId);
      for (const r of events.retired) emitControlEvent('run.update', r);
      // cap refusals wrote flag+task; goals changed the card — lead.change refreshes both
      if (events.capFlagged || res.status === 422 || (goal && res.body.runs?.length))
        emitControlEvent('lead.change');
    }
    if (res.body.runs?.length) kickDrain();
    return c.json(res.body, res.status as 201);
  });

  app.get('/control/v1/agent/metrics', async (c) => {
    controlGate(c);
    const days = c.req.query('days') ?? '7';
    if (days !== '7' && days !== '30') {
      throw new HttpError(422, 'BAD_REQUEST', 'days must be 7 or 30');
    }
    return c.json(await agentMetrics(sql, Number(days) as 7 | 30));
  });

  // the scheduler's routines: cadence, next run, last recorded outcome (ADR 0016)
  app.get('/control/v1/agent/routines', async (c) => {
    controlGate(c);
    return c.json({ routines: await listRoutines(sql) });
  });

  // the `agent` setting with defaults applied — what the runner actually reads
  app.get('/control/v1/agent/config', async (c) => {
    controlGate(c);
    return c.json(await controlTx(sql, (tx) => agentSettingTx(tx)));
  });

  app.get('/control/v1/leads/:id/autonomy', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const out = await controlTx(sql, (tx) => explainAutonomyTx(tx, id));
    if (!out) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    return c.json(out);
  });

  app.get('/control/v1/agent/wakeups', async (c) => {
    controlGate(c);
    // ADR spells the param `leadId`; `lead_id` stays accepted for callers
    // that already emit snake_case.
    const leadId = c.req.query('leadId') ?? c.req.query('lead_id') ?? null;
    if (leadId && !UUID_RE.test(leadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'leadId must be a uuid');
    }
    const status = c.req.query('status') ?? 'pending';
    if (!['pending', 'fired', 'canceled', 'all'].includes(status)) {
      throw new HttpError(400, 'BAD_REQUEST', 'status must be pending|fired|canceled|all');
    }
    const rawLimit = c.req.query('limit');
    const limit = rawLimit === undefined ? 100 : Number(rawLimit);
    if (!Number.isInteger(limit)) {
      throw new HttpError(400, 'BAD_REQUEST', 'limit must be an integer');
    }
    const wakeups = await listWakeups(sql, {
      leadId,
      status: status === 'all' ? null : (status as 'pending' | 'fired' | 'canceled'),
      limit,
    });
    return c.json({ wakeups });
  });

  app.post('/control/v1/agent/wakeups/:id/cancel', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const res = await cancelWakeup(sql, id, requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed && res.body.wakeup.leadId)
      emitControlEvent('lead.change', res.body.wakeup.leadId);
    return c.json(res.body);
  });

  app.get('/control/v1/agent/briefs', async (c) => {
    controlGate(c);
    const rows = await controlTx(
      sql,
      (tx) =>
        tx`select id, name, query, segment, city, target, enabled, last_run_at, created_at,
                  note, created_by
           from discovery_briefs order by created_at desc`,
    );
    return c.json({ briefs: rows });
  });

  app.post('/control/v1/agent/briefs', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    // A blank definition would schedule a useless daily run.
    const name = str(body.name, 'name', 120).trim();
    const query = str(body.query, 'query', 500).trim();
    if (!name) throw new HttpError(422, 'BAD_REQUEST', 'name must be non-empty', { field: 'name' });
    if (!query)
      throw new HttpError(422, 'BAD_REQUEST', 'query must be non-empty', { field: 'query' });
    const segment = body.segment == null ? null : str(body.segment, 'segment', 80);
    const city = body.city == null ? null : str(body.city, 'city', 120);
    let enabled = true;
    if (body.enabled !== undefined && body.enabled !== null) {
      if (typeof body.enabled !== 'boolean')
        throw new HttpError(422, 'BAD_REQUEST', 'enabled must be a boolean', { field: 'enabled' });
      enabled = body.enabled;
    }
    let target: number | null = null;
    if (body.target !== undefined && body.target !== null && body.target !== '') {
      const n = Number(body.target);
      if (!Number.isInteger(n) || n < 1 || n > 1000)
        throw new HttpError(422, 'BAD_REQUEST', 'target must be an integer in [1, 1000]');
      target = n;
    }
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const row = (
        await tx`
          insert into discovery_briefs (name, query, segment, city, target, enabled)
          values (${name}, ${query}, ${segment}, ${city}, ${target}, ${enabled})
          returning id, name, query, segment, city, target, enabled, last_run_at, created_at,
                    note, created_by
        `
      )[0]!;
      return { status: 201, body: { brief: row } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('run.update', res.body.brief.id);
    return c.json(res.body, res.status as 201);
  });

  app.patch('/control/v1/agent/briefs/:id', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    const body = await bodyJson(c);
    // Partial patch — absent keys untouched, explicit null clears
    // segment/city/target.
    const set: Record<string, unknown> = {};
    // Same contract as POST — a blank name/query would schedule a useless run.
    if ('name' in body) {
      const v = str(body.name, 'name', 120).trim();
      if (!v) throw new HttpError(422, 'BAD_REQUEST', 'name must be non-empty', { field: 'name' });
      set.name = v;
    }
    if ('query' in body) {
      const v = str(body.query, 'query', 500).trim();
      if (!v)
        throw new HttpError(422, 'BAD_REQUEST', 'query must be non-empty', { field: 'query' });
      set.query = v;
    }
    if ('segment' in body)
      set.segment = body.segment == null ? null : str(body.segment, 'segment', 80);
    if ('city' in body) set.city = body.city == null ? null : str(body.city, 'city', 120);
    if ('enabled' in body) {
      if (typeof body.enabled !== 'boolean')
        throw new HttpError(422, 'BAD_REQUEST', 'enabled must be a boolean', { field: 'enabled' });
      set.enabled = body.enabled;
    }
    if ('target' in body) {
      if (body.target === null) set.target = null;
      else {
        const n = Number(body.target);
        if (!Number.isInteger(n) || n < 1 || n > 1000)
          throw new HttpError(422, 'BAD_REQUEST', 'target must be an integer in [1, 1000]');
        set.target = n;
      }
    }
    if (!Object.keys(set).length)
      throw new HttpError(422, 'BAD_REQUEST', 'no updatable fields in body');
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const cur = (
        await tx<
          { enabled: boolean }[]
        >`select enabled from discovery_briefs where id = ${id} for update`
      )[0];
      if (!cur) throw new HttpError(404, 'BRIEF_NOT_FOUND', 'brief not found');
      // Refire promptly on definition change/re-enable; rearmed_at restarts
      // the dead-streak window so old zero-yield history can't instantly re-pause.
      if (
        'query' in set ||
        'segment' in set ||
        'city' in set ||
        'target' in set ||
        (set.enabled === true && !cur.enabled)
      ) {
        set.last_run_at = null;
        set.note = null;
        set.rearmed_at = new Date();
      }
      const row = (
        await tx`
          update discovery_briefs set ${tx(set)} where id = ${id}
          returning id, name, query, segment, city, target, enabled, last_run_at, created_at,
                    note, created_by
        `
      )[0]!;
      return { status: 200, body: { brief: row } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('run.update', res.body.brief.id);
    return c.json(res.body);
  });

  app.delete('/control/v1/agent/briefs/:id', async (c) => {
    controlGate(c);
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const row = (
        await tx`delete from discovery_briefs where id = ${uuidParam(c, 'id')} returning id`
      )[0];
      if (!row) throw new HttpError(404, 'BRIEF_NOT_FOUND', 'brief not found');
      return { status: 200, body: { ok: true } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('run.update', uuidParam(c, 'id'));
    return c.json(res.body);
  });

  app.get('/control/v1/agent/segments', async (c) => {
    controlGate(c);
    return c.json({ segments: await segmentStats(sql) });
  });

  app.get('/control/v1/channels/health', async (c) => {
    controlGate(c);
    return c.json({ channels: await channelHealth(sql) });
  });

  // status = live socket state so the UI doesn't guess from QR presence.
  app.get('/control/v1/wa/qr', async (c) => {
    controlGate(c);
    const rows = await controlTx(
      sql,
      (tx) =>
        tx<
          { value: { qr: string | null } | null }[]
        >`select value from control_settings where key = 'wa_qr'`,
    );
    const { waStatus, waIdentity } = await import('./agent/channels/whatsapp.ts');
    return c.json({ qr: rows[0]?.value?.qr ?? null, status: waStatus(), me: waIdentity() });
  });

  // WhatsApp "conectar com número" flow — staff sends digits, Baileys returns the code.
  app.post('/control/v1/wa/pair-code', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const phone = str(body.phone, 'phone', 40);
    // Claimed so a retry replays the issued code; failures throw for a genuinely fresh retry.
    const res = await claimControl(sql, requireIdemKey(c), async () => {
      const { pairCode } = await import('./agent/channels/whatsapp.ts');
      try {
        return { status: 200, body: { code: await pairCode(sql, phone) } };
      } catch (e) {
        throw new HttpError(422, 'BAD_REQUEST', e instanceof Error ? e.message : String(e));
      }
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('channel.health', 'whatsapp');
    return c.json(res.body, res.status as 200);
  });

  // Unpair + restart the socket so a fresh QR emits; claimed so a retried logout can't race re-pairing.
  app.post('/control/v1/wa/logout', async (c) => {
    controlGate(c);
    const res = await claimControl(sql, requireIdemKey(c), async () => {
      const { logoutWa, ensureSocket } = await import('./agent/channels/whatsapp.ts');
      const integration = await getIntegration(sql, 'whatsapp');
      const accountId = (integration?.config.accountId as string) ?? 'default';
      await logoutWa(sql, accountId);
      void ensureSocket(sql, integration).catch((e) =>
        waLog.error({ err: e }, 'post-logout restart failed'),
      );
      return { status: 200, body: { ok: true } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('channel.health', 'whatsapp');
    return c.json(res.body, res.status as 200);
  });

  // Instagram login wizard — the sidecar runs Instagram's steps; Core relays them and
  // stores the resulting credential. Claimed so a retried submit replays instead of
  // re-sending a one-time code; only responses are stored, never the password.
  app.get('/control/v1/ig/status', async (c) => {
    controlGate(c);
    const { igStatus } = await import('./agent/channels/instagram.ts');
    return c.json(igStatus());
  });

  const igClaim = (c: Context, work: () => Promise<unknown>) =>
    claimControl(sql, requireIdemKey(c), async () => ({ status: 200, body: await work() })).then(
      (res) => {
        if (res.replayed) c.header('x-idempotent-replay', 'true');
        else emitControlEvent('channel.health', 'instagram');
        return c.json(res.body as never, res.status as 200);
      },
    );

  app.post('/control/v1/ig/login/start', async (c) => {
    controlGate(c);
    const { igLoginStart } = await import('./agent/channels/instagram.ts');
    return igClaim(c, async () => ({ step: await igLoginStart(sql) }));
  });

  app.post('/control/v1/ig/login/submit', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const raw = body.input ?? {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new HttpError(422, 'BAD_REQUEST', 'input must be an object', { field: 'input' });
    }
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length > 10) {
      throw new HttpError(422, 'BAD_REQUEST', 'input has too many fields', { field: 'input' });
    }
    const input: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k.length > 60 || typeof v !== 'string' || v.length > 500) {
        throw new HttpError(422, 'BAD_REQUEST', 'input values must be strings ≤500 chars', {
          field: 'input',
        });
      }
      input[k] = v;
    }
    const { igLoginSubmit } = await import('./agent/channels/instagram.ts');
    return igClaim(c, async () => ({ step: await igLoginSubmit(sql, input) }));
  });

  app.post('/control/v1/ig/login/cookies', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const cookies = str(body.cookies, 'cookies', 64_000);
    const { igLoginCookies } = await import('./agent/channels/instagram.ts');
    return igClaim(c, async () => ({ step: await igLoginCookies(sql, cookies) }));
  });

  app.post('/control/v1/ig/login/cancel', async (c) => {
    controlGate(c);
    const { igLoginCancel } = await import('./agent/channels/instagram.ts');
    return igClaim(c, async () => {
      await igLoginCancel(sql);
      return { ok: true };
    });
  });

  app.post('/control/v1/ig/logout', async (c) => {
    controlGate(c);
    const { igLogout } = await import('./agent/channels/instagram.ts');
    return igClaim(c, async () => {
      await igLogout(sql);
      return { ok: true };
    });
  });

  // Sidecar → Core events (inbound DMs, connection state, rotated cookies), HMAC-signed
  // with the sidecar secret; a uniform 404 for anything unsigned hides the route.
  let igEventBucket = { count: 0, resetAt: 0 };
  app.post('/control/v1/ig/events', async (c) => {
    const ig = await import('./agent/channels/instagram.ts');
    const integration = await getIntegration(sql, 'instagram');
    // getIntegration only returns the enabled row — spelled out so a disabled driver
    // visibly drops even correctly signed events
    const secret =
      integration?.enabled && integration.driver === 'sidecar' ? ig.igSecretFor(integration) : null;
    const raw = await boundedText(c);
    if (
      !secret ||
      !ig.igEventSignatureOk(
        secret,
        c.req.header('x-ig-timestamp'),
        c.req.header('x-ig-signature'),
        raw,
      )
    ) {
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    }
    const nowMs = Date.now();
    if (igEventBucket.resetAt <= nowMs) igEventBucket = { count: 0, resetAt: nowMs + 60_000 };
    if (++igEventBucket.count > 600) {
      throw new HttpError(429, 'RATE_LIMITED', 'event rate exceeded — retry in a minute');
    }
    const evt = ig.parseIgEvent(parseJsonObject(raw));
    const msg = await ig.applyIgEvent(sql, evt, secret);
    if (!msg) return c.json({ ok: true });
    const res = await ingestInbound(sql, {
      channel: 'instagram',
      from: msg.username ? `@${msg.username}` : `ig:${msg.fromFbid}`,
      ...(msg.name ? { fromName: msg.name } : {}),
      body: msg.text,
      providerMessageId: msg.id,
      externalThreadId: msg.fromFbid,
      ...(msg.sentAt ? { sentAt: msg.sentAt } : {}),
    });
    return c.json(res, 'ignored' in res ? 200 : 201);
  });

  // Shared webhook secret gates inbound posts — channels can't carry the staff cookie.
  const webhookSecret =
    process.env.VENDUA_WEBHOOK_SECRET ||
    createHmac('sha256', staffSecret).update('vendua.webhook').digest('hex');
  // Constant-time compare — a leaked timing delta would make the shared
  // secret byte-by-byte guessable.
  const webhookSecretBytes = Buffer.from(webhookSecret, 'utf8');
  const webhookSecretOk = (h: string | undefined) =>
    h != null &&
    h.length === webhookSecret.length &&
    timingSafeEqual(Buffer.from(h, 'utf8'), webhookSecretBytes);
  // Cap inbound — an accepted message writes rows and launches an LLM run.
  let webhookBucket = { count: 0, resetAt: 0 };
  app.post('/control/v1/webhooks/:channel', async (c) => {
    // Shared secret or Resend svix signature (Resend can't set custom headers).
    const sharedOk = webhookSecretOk(c.req.header('x-vendua-webhook'));
    const svix = svixHeaders(c);
    // Verify svix before charging the bucket — forged headers must not spend quota.
    let raw: string | undefined;
    let svixOk = false;
    if (
      !sharedOk &&
      svix &&
      process.env.RESEND_WEBHOOK_SECRET &&
      // raw param compare — channel() would 422 and reveal the route exists
      c.req.param('channel') === 'email'
    ) {
      raw = await boundedText(c);
      svixOk = svixVerified(raw, svix, process.env.RESEND_WEBHOOK_SECRET);
    }
    if (!sharedOk && !svixOk) {
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    }
    const nowMs = Date.now();
    if (webhookBucket.resetAt <= nowMs) {
      webhookBucket = { count: 0, resetAt: nowMs + 60_000 };
    }
    if (++webhookBucket.count > 240) {
      throw new HttpError(429, 'RATE_LIMITED', 'webhook rate exceeded — retry in a minute');
    }
    // 'manual' threads are staff notes — no webhook mints inbound activity under them.
    const chan = channel(c.req.param('channel'));
    if (chan !== 'email' && chan !== 'whatsapp') {
      throw new HttpError(422, 'BAD_REQUEST', 'channel must be email|whatsapp');
    }
    if (!sharedOk) {
      const res = await ingestResendEvent(sql, raw!, svix!);
      return c.json(res, 'ignored' in res ? 200 : 201);
    }
    const body = parseJsonObject(raw ?? (await boundedText(c)));
    // At-least-once delivery — a stable id or retries mint duplicates.
    const rawMsgId = body.messageId ?? body.message_id;
    if (rawMsgId == null || String(rawMsgId).trim() === '') {
      throw new HttpError(422, 'BAD_REQUEST', 'messageId is required for webhook dedupe', {
        field: 'messageId',
      });
    }
    const res = await ingestInbound(sql, {
      channel: chan,
      from: str(body.from ?? body.sender, 'from', 200),
      ...(body.fromName || body.from_name
        ? { fromName: str(body.fromName ?? body.from_name, 'fromName', 200) }
        : {}),
      ...(body.subject ? { subject: str(body.subject, 'subject', 300) } : {}),
      body: str(body.text ?? body.body ?? body.html, 'body', 8000),
      providerMessageId: str(rawMsgId, 'messageId', 200),
    });
    return c.json(res, 'ignored' in res ? 200 : 201);
  });

  // Unauthenticated — the token IS the credential; uniform 404, rate-limited per IP.
  const bookHits = new Map<string, { count: number; resetAt: number }>();
  const bookRate = (c: Context) => {
    const ip = (() => {
      if (!trustProxy) return 'local';
      const xff = c.req
        .header('x-forwarded-for')
        ?.split(',')
        .map((s) => s.trim());
      return xff?.at(-1 - proxyHops) ?? 'unknown';
    })();
    const now = Date.now();
    for (const [k, v] of bookHits) if (v.resetAt <= now) bookHits.delete(k);
    const bucket = bookHits.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bookHits.set(ip, { count: 1, resetAt: now + 60_000 });
    } else if (++bucket.count > 60) {
      throw new HttpError(429, 'RATE_LIMITED', 'too many requests — retry in a minute');
    }
  };
  // A foreign Origin is never the page we served — same same-origin rule as controlGate.
  const bookSameOrigin = (c: Context) => {
    const origin = c.req.header('origin');
    if (!origin) return;
    const reqHost =
      (trustProxy ? c.req.header('x-forwarded-host') : undefined) ?? c.req.header('host');
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (!originHost || (reqHost && originHost !== reqHost)) {
      throw new HttpError(403, 'BAD_ORIGIN', 'cross-origin booking request');
    }
  };

  app.get('/agendar', (c) => {
    c.header('cache-control', 'no-store');
    // no-referrer — the ?t= token must not leak via Referer.
    c.header('referrer-policy', 'no-referrer');
    return c.html(BOOKING_PAGE);
  });

  app.get('/book/v1/slots', async (c) => {
    bookRate(c);
    const leadId = verifyBookingToken(str(c.req.query('t') ?? '', 't', 500), staffSecret);
    if (!leadId) throw new HttpError(404, 'NOT_FOUND', 'not found');
    const lead = await controlTx(
      sql,
      async (tx) =>
        (
          await tx<{ name: string; whatsapp: string | null; phone: string | null }[]>`
            select name, whatsapp, phone from leads where id = ${leadId} and archived_at is null
          `
        )[0],
    );
    if (!lead) throw new HttpError(404, 'NOT_FOUND', 'not found');
    const [{ cfg, slots }, existing] = await Promise.all([
      availableSlots(sql, new Date()),
      nextMeetingForLead(sql, leadId),
    ]);
    return c.json({
      leadName: lead.name,
      leadWhats: lead.whatsapp ?? lead.phone ?? null,
      // roomConfigured drives the page's copy.
      roomConfigured: Boolean(cfg.roomUrl) || rooms.dailyConfigured(),
      slotMinutes: cfg.slotMinutes,
      tz: cfg.tz,
      existing,
      slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
    });
  });

  app.post('/book/v1/book', async (c) => {
    bookRate(c);
    bookSameOrigin(c);
    const body = await bodyJson(c);
    const leadId = verifyBookingToken(str(body.t ?? '', 't', 500), staffSecret);
    if (!leadId) throw new HttpError(404, 'NOT_FOUND', 'not found');
    const out = await bookMeeting(sql, {
      leadId,
      start: str(body.start, 'start', 64),
      bookerName: body.name ? str(body.name, 'name', 200) : null,
      bookerContact: body.contact ? str(body.contact, 'contact', 300) : null,
      source: 'link',
    });
    // created=false is the idempotent replay — same meeting, no side effects.
    return c.json({ meeting: out.meeting }, out.created ? 201 : 200);
  });

  app.post('/book/v1/cancel', async (c) => {
    bookRate(c);
    bookSameOrigin(c);
    const body = await bodyJson(c);
    const leadId = verifyBookingToken(str(body.t ?? '', 't', 500), staffSecret);
    if (!leadId) throw new HttpError(404, 'NOT_FOUND', 'not found');
    // `m` pins which meeting to cancel — without it a retry with multiple
    // scheduled meetings could walk to the next one.
    const m = body.m !== undefined && body.m !== null ? str(body.m, 'm', 64) : undefined;
    if (m && !UUID_RE.test(m)) throw new HttpError(400, 'BAD_REQUEST', 'm must be a uuid');
    return c.json({ meeting: await cancelByLead(sql, leadId, m) });
  });

  // Prod serves the built app; dev hits vite :5195 (proxies /control/v1 here).
  const CONTROL_DIST = join(import.meta.dir, '../../../apps/control/dist');
  const SPA_MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
  };
  app.get('/control', (c) => c.redirect('/control/'));
  app.get('/control/*', async (c) => {
    const path = new URL(c.req.url).pathname;
    // Unmatched /control/v1/* GETs must not fall through to the SPA shell.
    if (path.startsWith('/control/v1')) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    }
    if (!existsSync(CONTROL_DIST)) {
      return c.html(
        '<!doctype html><title>venduá control</title><p style="font-family:monospace">control app not built — <code>cd apps/control && bun run dev</code> (vite :5195) or <code>bun run build</code> for prod.</p>',
      );
    }
    const rel = normalize(path.slice('/control'.length)).replace(/^[/\\]+/, '');
    let file = join(CONTROL_DIST, rel);
    if (!file.startsWith(CONTROL_DIST)) {
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    }
    if (!rel || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(CONTROL_DIST, 'index.html');
    }
    const ext = extname(file);
    c.header('content-type', SPA_MIME[ext] ?? 'application/octet-stream');
    // Only assets/ is content-hashed by vite — root files (sw.js, manifest,
    // icons) must revalidate or PWA updates never roll out.
    c.header(
      'cache-control',
      ext === '.html'
        ? 'no-store'
        : rel.startsWith('assets/')
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
    );
    return c.body(await Bun.file(file).arrayBuffer());
  });

  app.route('/storefront/v1', storefront);
  app.route('/checkout/v1', checkout);

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  return app;
}
