import { createHmac, timingSafeEqual } from 'node:crypto';
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
import { claimControl, controlTx } from './modules/control.ts';
import { controlSse } from './modules/control-sse.ts';
import { emitControlEvent } from './modules/control-events.ts';
import { pipelineForecast, snapshotPipelineTx } from './modules/forecast.ts';
import { channelHealth } from './modules/channel-health.ts';
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
import { drain, insertRun } from './agent/runner.ts';
import { ingestInbound } from './agent/inbound.ts';
import { ingestResendEvent, svixHeaders, svixVerified } from './agent/channels/email-inbound.ts';
import { LOADER_JS } from './loader.ts';
import { log } from './platform/log.ts';

const agentLog = log.child({ mod: 'agent' });
const waLog = log.child({ mod: 'whatsapp' });

export interface AppDeps {
  sql: Sql;
  sessionSecret: string;
  /** Staff credential for /control/v1 — distinct from sessionSecret so a
   *  shared staff key never doubles as the shopper-session signing key.
   *  Falls back to sessionSecret in dev when unset. */
  controlSecret?: string | undefined;
  /** Endpoint enqueues kick a fire-and-forget queue drain by default. Tests
   *  pass false — a background claim mid-assertion races the expectation. */
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

// Every external probe in testIntegration runs inside this bound — a dead
// provider must not pin the route (or its claim transaction) open.
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

/** One cheap live call against the kind's ACTIVE driver. Never throws —
 *  failures are the diagnostic result. */
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
      // AbortSignal cancels the request itself — the race only abandons the
      // await. SDK calls (llm, tinyfish, baileys) can't be aborted from
      // here, so they keep the race bound.
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
      : () => void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
  const resolver = new TenantResolver(sql);
  const app = new Hono<{ Variables: { tenant: Tenant } }>();

  app.onError((err, c) => errorJson(err, c));
  app.use('*', requestLogger());
  // VENDUA_TRUST_PROXY=1 marks a deployment behind the Venduá edge — only then
  // do X-Forwarded-* headers carry routing truth (tenant spoofing otherwise).
  const trustProxy = process.env.VENDUA_TRUST_PROXY === '1';
  // CORS is not a blanket allow: the browser origin must be the request's own
  // host (same-origin calls, incl. the vite dev proxy). Other registered
  // tenant origins are deliberately NOT allowed — credentialed cross-tenant
  // browser reads would follow from them (Review finding).
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

  // The last-resort loader. In production this is served from the CDN; in dev
  // Core serves it so the contract-required script tag is real.
  app.get('/v1/v.js', (c) => {
    c.header('content-type', 'application/javascript');
    c.header('cache-control', 'no-store');
    return c.body(LOADER_JS);
  });

  // ------------------------- /storefront/v1 (public, host-scoped) ----------
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

  // Public delivery-zone catalog — storefronts need it for address/zone UX
  // (Phase 0 finding: no client could list covered neighborhoods).
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

  // Tiny loader-facing endpoint — cached snapshot shape per 05-system-surfaces.
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

  // ------------------------- /checkout/v1 (session-scoped) -----------------
  const checkout = new Hono<{ Variables: { tenant: Tenant } }>();
  checkout.use('*', tenantMiddleware(resolver, { trustForwardedHost: trustProxy }));
  // Public, unauthenticated mutation surface — bounded so a script can't grow
  // carts/idempotency tables unboundedly (edge replaces this in prod).
  // VENDUA_PROXY_HOPS = trusted proxies between client and Core beyond the
  // one that appended the client's own XFF entry (Dokploy: nginx → 1).
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
    // Re-attach: a Bearer token whose cart is still open returns that session
    // unchanged; a completed/abandoned cart mints a fresh one (self-healing —
    // otherwise a spent token strands the storefront on CART_NOT_FOUND).
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
      // fall through to mint
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
      // Identifier + array bounds: malformed productIds would raise 22P02 in
      // the uuid comparison (INTERNAL instead of a contract 4xx), and the
      // modifier list is bounded so oversized arrays can't burn validation.
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
        // Lock the cart row before reading it — two concurrent checkouts
        // would otherwise both observe 'open' and mint duplicate orders
        // (Review finding). The loser rechecks status under the lock.
        await tx`select id from carts where tenant_id = ${tenant.id} and id = ${cartId} for update`;
        const cart = await loadCartView(tx, tenant.id, cartId);
        // A completed cart must not mint a second order — the forn spike
        // demonstrated a real duplicate otherwise.
        if (cart.status !== 'open') {
          throw new HttpError(409, 'CART_NOT_OPEN', 'cart already checked out', {
            cartStatus: cart.status,
          });
        }
        // Tenant-scoped advisory lock taken BEFORE reading eligibility: the
        // documented choke point for every control-plane write that changes
        // settings/zones/products/modifiers (REVIEW.md). Row locks below then
        // pin the actual rows read, so even a non-cooperating writer can't
        // slip a change between our read and commit under READ COMMITTED.
        await tx`select pg_advisory_xact_lock(hashtext(${tenant.id}))`;
        const settings = await loadSettings(tx, tenant.id, { forUpdate: true });
        const zones = await loadZones(tx, tenant.id, { forUpdate: true });
        // Re-validate every line's stored modifier ids against the CURRENT
        // product definition — a deleted/retired modifier can't quietly drop
        // out of the price and slip through as an underpriced order.
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
        // Order numbering runs under the tenant advisory lock acquired at
        // the top of this transaction — without it two concurrent checkouts
        // read the same max and the unique constraint eats a valid order.
        const number = (
          await tx<
            { n: number }[]
          >`select coalesce(max(number), 0) + 1 as n from orders where tenant_id = ${tenant.id}`
        )[0]!.n;
        const orderId = crypto.randomUUID();
        const payment = {
          // 'sandbox' is the contract's dev provider name — the Phase-0
          // pay-on-delivery stand-in stays until real orchestration lands.
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

  // ------------------------- /control/v1 (internal/dev) --------------------
  // Internal surface — shared-secret gated even in dev (public otherwise:
  // it answers for arbitrary tenant slugs). Prod binds it to mTLS/private
  // network on top of this.
  //
  // The gate: the X-Vendua-Control header is the canonical credential — its
  // value is CONTROL_SECRET, a staff key distinct from the shopper-session
  // signing secret (staff access must never enable session forgery). The
  // `vendua_control` cookie — minted by POST /control/v1/board — is a staff
  // convenience so the board page can call this API from the browser.
  // 404 (not 401) keeps the surface invisible to scans.
  const CONTROL_COOKIE = 'vendua_control';
  const staffSecret = controlSecret ?? sessionSecret;
  // The cookie carries a derived token — never either secret itself: a leaked
  // staff cookie opens the board without exposing a signing key, and rotating
  // CONTROL_SECRET invalidates every cookie at once.
  const controlToken = createHmac('sha256', staffSecret).update('vendua.control').digest('hex');
  const controlAuthed = (c: Context) =>
    c.req.header('x-vendua-control') === staffSecret ||
    getCookie(c, CONTROL_COOKIE) === controlToken;
  const controlGate = (c: Context) => {
    if (!controlAuthed(c)) throw new HttpError(404, 'NOT_FOUND', 'not found');
    // CSRF: a cookie-authenticated mutation must carry the custom
    // `x-vendua-staff` marker — browsers can't add a custom header cross-site
    // without a CORS preflight this API never answers — AND an Origin that
    // matches the request host when one is present (the marker alone is a
    // presence check a compromised same-site sibling could also send).
    // SameSite=Lax already strips the cookie on cross-site POSTs.
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

  // Venduá CRM — Venduá's own intake pipeline + agentic control surface.
  // Platform data, no tenant context; the gate above is the only boundary.
  // All mutations take Idempotency-Key (claimControl — durable claims).

  // Fixed-window per-IP login limiter — same shape as the checkout one.
  const loginHits = new Map<string, { count: number; resetAt: number }>();
  app.post('/control/v1/login', async (c) => {
    // Login guesses a shared secret — cap attempts at 10/min/IP so a
    // reachable deployment isn't an oracle for a weak CONTROL_SECRET.
    const ip = (() => {
      if (!trustProxy) return 'local';
      const xff = c.req
        .header('x-forwarded-for')
        ?.split(',')
        .map((s) => s.trim());
      return xff?.at(-1 - proxyHops) ?? 'unknown';
    })();
    const now = Date.now();
    // Evict expired buckets — without this, rotating client addresses (each
    // a new map key) grow the map until the process exhausts memory.
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
      // Secure whenever the request is TLS — directly, or behind a
      // terminating proxy when VENDUA_TRUST_PROXY marks X-Forwarded-*
      // trustworthy.
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

  // Boot probe for the SPA — 404 when unauthed keeps the surface invisible.
  app.get('/control/v1/session', (c) => {
    controlGate(c);
    return c.json({ ok: true });
  });

  // Thin triggers over SSE — the board refetches on each frame; the
  // connect-time `sync` covers events missed while reconnecting.
  app.get('/control/v1/events', (c) => {
    controlGate(c);
    return controlSse(c);
  });

  // ---- leads --------------------------------------------------------------
  app.get('/control/v1/leads', async (c) => {
    controlGate(c);
    const state = c.req.query('state');
    const tag = c.req.query('tag');
    const archived = c.req.query('archived');
    const limit = c.req.query('limit');
    const q = c.req.query('q');
    const cursor = c.req.query('cursor');
    const { leads, nextCursor } = await listLeads(sql, {
      ...(q ? { q } : {}),
      ...(state ? { state: leadState(state) } : {}),
      ...(tag ? { tag: str(tag, 'tag', 60) } : {}),
      ...(archived === 'only' || archived === 'all' ? { archived } : {}),
      ...(limit ? { limit: Math.min(Math.max(Number(limit) || 50, 1), 200) } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return c.json({ leads, nextCursor });
  });

  app.post('/control/v1/leads', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    for (const field of ['automation', 'triage'] as const) {
      if (body[field] !== undefined && typeof body[field] !== 'boolean') {
        throw new HttpError(422, 'BAD_REQUEST', `${field} must be a boolean`, { field });
      }
    }
    // Automation is opt-out per request: `triage:false` skips only the
    // triage run; `automation:false` skips every run — the staff-managed
    // equivalent of a CSV-imported lead, which never queues agent work.
    const res = await claimControl<{ lead: Lead; runId?: string; contactRunId?: string }>(
      sql,
      requireIdemKey(c),
      async (tx) => {
        // Lead + its runs share ONE claim: a retried POST replays the
        // stored body (lead + runIds) instead of creating a second lead.
        const created = await insertLeadTx(tx, leadInsert(body));
        if (created.body.lead.agentMode !== 'off' && body.automation !== false) {
          const runId =
            body.triage === false
              ? undefined
              : await insertRun(tx, {
                  kind: 'triage',
                  leadId: created.body.lead.id,
                });
          // guardrails.firstContactDelayMin: a hand-created card gets the
          // agent's first touch scheduled on its own — the run waits out
          // the delay in 'queued' (cancelable in Runs), and the send itself
          // still obeys agent_mode + firstContactDraftOnly.
          const g = await getSettingTx<Partial<Guardrails>>(tx, 'guardrails', {});
          const delay = g.firstContactDelayMin ?? DEFAULT_GUARDRAILS.firstContactDelayMin;
          const contactRunId =
            delay > 0
              ? await insertRun(tx, {
                  kind: 'outreach',
                  leadId: created.body.lead.id,
                  runAt: new Date(Date.now() + delay * 60_000),
                  params: {
                    auto: 'first-contact',
                    focus: 'primeiro contato — lead recém-criado pela equipe',
                  },
                })
              : undefined;
          return {
            status: created.status,
            body: {
              ...created.body,
              ...(runId ? { runId } : {}),
              ...(contactRunId ? { contactRunId } : {}),
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
      if (res.body.contactRunId) emitControlEvent('run.update', res.body.contactRunId);
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
    // Raw text/csv body — not the JSON cap — so bulk imports aren't capped
    // at 32KB.
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
    // The forecast slice reuses this request's byState read — composed here
    // (not inside leadStats) so leads.ts stays free of control-settings deps.
    const forecast = await pipelineForecast(sql, stats.byState);
    return c.json({ ...stats, forecast });
  });

  // Staff-forced pipeline snapshot — the worker also takes one daily. The
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
        // Opt-out never lifts — queued runs for this lead are dead weight
        // the claim gate can never pick up, so cancel them now.
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

  app.post('/control/v1/leads/:id/run', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const kind = str(body.kind, 'kind', 40);
    // strategist stays out of the lead-scoped list — a suppressed lead would
    // park the queued run and sweepStrategist would read its created_at as a
    // filled cadence slot, skipping the real weekly review for 7 days
    if (!['triage', 'reply', 'outreach', 'discovery'].includes(kind)) {
      throw new HttpError(422, 'BAD_REQUEST', 'kind must be triage|reply|outreach|discovery');
    }
    const leadId = uuidParam(c, 'id');
    const threadId = body.threadId ? str(body.threadId, 'threadId', 64) : null;
    if (threadId && !UUID_RE.test(threadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'threadId must be a uuid');
    }
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      // Mirror the claim gate's suppression predicate: a run queued for a
      // suppressed lead/thread can never claim — it would park 'queued'
      // forever. Reject with the reason like dispatch reports it. The row
      // lock serializes with a concurrent unsubscribe — otherwise this tx
      // could still insert a zombie run after the opt-out's cancel pass.
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
          where id = ${leadId}
          for update
        `
      )[0];
      if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
      const suppressed = lead.archived_at
        ? 'lead archived'
        : lead.unsubscribed_at
          ? 'lead unsubscribed'
          : lead.agent_paused_at
            ? 'agent paused'
            : lead.agent_mode === 'off'
              ? 'agent off'
              : null;
      if (suppressed) throw new HttpError(422, 'LEAD_SUPPRESSED', suppressed);
      if (threadId) {
        const th = (
          await tx<{ lead_id: string; agent_enabled: boolean }[]>`
            select lead_id, agent_enabled from lead_threads where id = ${threadId}
          `
        )[0];
        if (!th) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
        if (th.lead_id.toLowerCase() !== leadId.toLowerCase()) {
          throw new HttpError(422, 'BAD_REQUEST', 'threadId does not belong to leadId');
        }
        if (!th.agent_enabled) throw new HttpError(422, 'THREAD_PAUSED', 'thread paused for agent');
      }
      return {
        status: 201,
        body: {
          runId: await insertRun(tx, {
            kind: kind as 'triage' | 'reply' | 'outreach' | 'discovery',
            leadId,
            ...(threadId ? { threadId } : {}),
            params: (body.params as Record<string, unknown>) ?? {},
          }),
        },
      };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('run.update', res.body.runId);
    kickDrain();
    return c.json(res.body, res.status as 201);
  });

  // ---- activities / tasks ---------------------------------------------------
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

  // ---- inbox / threads / messages -------------------------------------------
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
    // An explicit subject overrides the thread's — applied inside
    // composeMessage's claim tx so a failed compose can't leave it behind.
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

  // ---- approvals queue --------------------------------------------------------
  app.get('/control/v1/approvals', async (c) => {
    controlGate(c);
    return c.json({ drafts: await listDrafts(sql) });
  });

  app.post('/control/v1/messages/:id/approve', async (c) => {
    controlGate(c);
    const res = await approveMessage(sql, uuidParam(c, 'id'), 'staff', requireIdemKey(c));
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    // A stale draft is superseded inside the claim — nothing ships from the
    // expired copy. Kick the drain so the regen run recomposes it promptly.
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

  // ---- integrations / settings ------------------------------------------------
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
    if (kind === 'whatsapp') {
      // Reconcile the live socket now — a disable/switch must close the old
      // Baileys session immediately, not whenever the next outbound or
      // disconnect happens to trigger it.
      const { ensureSocket } = await import('./agent/channels/whatsapp.ts');
      void getIntegration(sql, 'whatsapp')
        .then((i) => ensureSocket(sql, i))
        .catch((e) => waLog.error({ err: e }, 'socket reconcile failed'));
    }
    return c.json(res.body);
  });

  // Live driver check — exercises the ACTIVE provider for a kind for real
  // (one cheap call), so Config can answer "is this actually working?"
  // instead of only echoing config back. Claimed like every other control
  // mutation — a retried POST replays the recorded result instead of
  // spending another provider call.
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
    // guardrails/pitch return the EFFECTIVE objects (defaults merged into the
    // stored row) — what the agent actually runs on, not the sparse override.
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
    return c.json(res.body);
  });

  // ---- meetings ---------------------------------------------------------------
  // CRM-native booking: staff list/patch/manual-book, plus the booking-link
  // mint the LeadDetail "copiar link" button uses.

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

  // Minted per lead — the agent and the UI share the same token format, so a
  // link copied here and one sent by the agent resolve identically.
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

  // Staff-side booking — same pipeline the public endpoint runs (grid check,
  // buffer, gcal busy, room, confirm email).
  app.post('/control/v1/meetings', async (c) => {
    controlGate(c);
    const key = requireIdemKey(c);
    const body = await bodyJson(c);
    // The claim wraps bookMeeting's insert step — a retried POST replays the
    // stored meeting instead of re-validating against a now-taken slot.
    // Single-connection claim: bookMeetingTx runs INSIDE the claim tx — a
    // nested controlTx would grab a second pooled conn per request and ~10
    // concurrent staff bookings would deadlock the (size-10) pool. The gcal
    // busy read happens before the claim — no network call inside the tx.
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
    // Post-commit effects run on fresh claims AND replays: room/gcal/email
    // happen after commit, so a crash between them leaves the replay (or the
    // first request that died right here) as the retry point. Fills only
    // what's missing — safe to re-run. Re-read after effects so the response
    // carries the provisioned roomUrl/gcalEventId, not the claim's snapshot.
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

  // ---- agent runs --------------------------------------------------------------
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
    // Keyset pagination over (run_at, id) — scheduled mode only, so the queue
    // can enumerate every delayed run regardless of queue size.
    const cursor = c.req.query('cursor');
    let cursorCond = 'true';
    if (scheduled && cursor) {
      const parts = cursor.split('|');
      const [ra, id] = parts;
      const at = ra ? new Date(ra) : null;
      if (
        parts.length !== 2 ||
        !ra ||
        !id ||
        !UUID_RE.test(id) ||
        !at ||
        Number.isNaN(at.getTime()) ||
        at.toISOString() !== ra
      ) {
        throw new HttpError(400, 'BAD_REQUEST', 'cursor must be "<run_at>|<run uuid>"');
      }
      cursorCond = `(r.run_at > ${p(ra)}::timestamptz or (r.run_at = ${p(ra)}::timestamptz and r.id > ${p(id)}::uuid))`;
    }
    const where = [
      kind ? `kind = ${p(kind)}` : 'true',
      status ? `status = ${p(status)}` : 'true',
      leadId ? `r.lead_id = ${p(leadId)}` : 'true',
      // scheduled=1 → only delayed runs, soonest first.
      scheduled ? 'r.run_at is not null' : 'true',
      cursorCond,
    ];
    const order = scheduled ? 'r.run_at asc, r.id asc' : 'r.created_at desc';
    const rows = await controlTx(sql, (tx) =>
      tx.unsafe(
        `select r.id, r.kind, r.status, r.lead_id, r.thread_id, r.tokens_in, r.tokens_out,
                r.cost_cents, r.error, r.created_at, r.started_at, r.finished_at, r.run_at,
                l.name as lead_name, t.agent_enabled as thread_agent_enabled
         from agent_runs r
         left join leads l on l.id = r.lead_id
         left join lead_threads t on t.id = r.thread_id
         where ${where.join(' and ')}
         order by ${order} limit ${p(limit)}`,
        params as never[],
      ),
    );
    const last = rows[rows.length - 1] as { run_at?: string | Date; id: string } | undefined;
    const nextCursor =
      scheduled && rows.length === limit && last
        ? `${new Date(last.run_at as string | Date).toISOString()}|${last.id}`
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

  // Cooperative cancel: flip queued/running → canceled; the worker's next
  // journal write stops matching its claim fence and unwinds at the boundary.
  app.post('/control/v1/agent/runs/:id/cancel', async (c) => {
    controlGate(c);
    const id = uuidParam(c, 'id');
    let transitioned = false;
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const rows = await tx`
        update agent_runs set status = 'canceled', finished_at = now(), error = 'cancelado'
        where id = ${id} and status in ('queued', 'running')
        returning id
      `;
      if (!rows[0]) {
        const cur = (
          await tx<{ status: string }[]>`select status from agent_runs where id = ${id}`
        )[0];
        if (!cur) throw new HttpError(404, 'RUN_NOT_FOUND', 'run not found');
        // already terminal — report it, don't error (cancel is idempotent)
        return { status: 200, body: { ok: true, status: cur.status } };
      }
      transitioned = true;
      return { status: 200, body: { ok: true, status: 'canceled' } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed && transitioned) {
      emitControlEvent('run.update', id);
    }
    return c.json(res.body);
  });

  app.post('/control/v1/agent/runs', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const kind = str(body.kind, 'kind', 40);
    if (!['triage', 'reply', 'outreach', 'discovery', 'strategist'].includes(kind)) {
      throw new HttpError(
        422,
        'BAD_REQUEST',
        'kind must be triage|reply|outreach|discovery|strategist',
      );
    }
    const leadId = body.leadId ? str(body.leadId, 'leadId', 64) : null;
    const threadId = body.threadId ? str(body.threadId, 'threadId', 64) : null;
    for (const [field, v] of [
      ['leadId', leadId],
      ['threadId', threadId],
    ] as const) {
      if (v && !UUID_RE.test(v)) throw new HttpError(400, 'BAD_REQUEST', `${field} must be a uuid`);
    }
    // strategist reviews the board, not a lead — binding it to one would also
    // let a suppressed lead park the queued row and eat the weekly cadence
    // slot (sweepStrategist keys on created_at)
    if (kind === 'strategist' && (leadId || threadId)) {
      throw new HttpError(422, 'BAD_REQUEST', 'strategist runs take no leadId/threadId');
    }
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      // leadId and threadId aren't independent: a reply run bound to a thread
      // must belong to that thread's lead, or thread content could be
      // answered to the wrong lead's channel. A thread-only call adopts the
      // thread's owner — claimRun gates on lead_id, so inserting null would
      // skip suppression entirely.
      let effLeadId = leadId;
      if (threadId) {
        const th = (
          await tx<{ lead_id: string; agent_enabled: boolean }[]>`
            select lead_id, agent_enabled from lead_threads where id = ${threadId}
          `
        )[0];
        if (!th) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
        if (leadId && th.lead_id.toLowerCase() !== leadId.toLowerCase()) {
          throw new HttpError(422, 'BAD_REQUEST', 'threadId does not belong to leadId');
        }
        if (!th.agent_enabled) throw new HttpError(422, 'THREAD_PAUSED', 'thread paused for agent');
        effLeadId = th.lead_id;
      }
      // Same suppression mirror as the lead-scoped enqueue: a run queued
      // under a suppressed lead can never claim — report instead of parking.
      // The row lock serializes with a concurrent unsubscribe.
      if (effLeadId) {
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
            where id = ${effLeadId}
            for update
          `
        )[0];
        if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
        const suppressed = lead.archived_at
          ? 'lead archived'
          : lead.unsubscribed_at
            ? 'lead unsubscribed'
            : lead.agent_paused_at
              ? 'agent paused'
              : lead.agent_mode === 'off'
                ? 'agent off'
                : null;
        if (suppressed) throw new HttpError(422, 'LEAD_SUPPRESSED', suppressed);
      }
      return {
        status: 201,
        body: {
          runId: await insertRun(tx, {
            kind: kind as 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist',
            leadId: effLeadId,
            threadId,
            params: (body.params as Record<string, unknown>) ?? {},
          }),
        },
      };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed) emitControlEvent('run.update', res.body.runId);
    kickDrain();
    return c.json(res.body, res.status as 201);
  });

  // ---- dispatch + briefs + segment stats -------------------------------------

  // Manual batch dispatch — staff picks the leads and the goal; each eligible
  // lead gets its agent_goal set and an outreach run queued. Ineligible leads
  // come back named with the reason instead of silently skipped.
  app.post('/control/v1/agent/dispatch', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const ids = body.leadIds;
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 200 ||
      ids.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) {
      throw new HttpError(422, 'BAD_REQUEST', 'leadIds must be an array of ≤200 uuids');
    }
    const goal = agentGoal(body.goal);
    // Optional staff channel override — 'auto' or absent lets the agent pick;
    // 'whatsapp'/'email' pins every send in the dispatched runs to it. The
    // resolver still blocks when that channel is unreachable for a lead.
    const wantChannel =
      body.channel === 'whatsapp' || body.channel === 'email' ? body.channel : null;
    if (body.channel != null && body.channel !== 'auto' && !wantChannel) {
      throw new HttpError(422, 'BAD_REQUEST', 'channel must be auto|whatsapp|email');
    }
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      let enqueued = 0;
      const skipped: { id: string; reason: string }[] = [];
      for (const id of ids as string[]) {
        const lead = (
          await tx<
            {
              archived_at: string | null;
              unsubscribed_at: string | null;
              agent_mode: string;
              agent_paused_at: string | null;
            }[]
          >`
            select archived_at, unsubscribed_at, agent_mode, agent_paused_at from leads
            where id = ${id} for update
          `
        )[0];
        if (!lead) {
          skipped.push({ id, reason: 'lead not found' });
          continue;
        }
        const reason = lead.archived_at
          ? 'lead archived'
          : lead.unsubscribed_at
            ? 'lead unsubscribed'
            : lead.agent_paused_at
              ? 'agent paused'
              : lead.agent_mode === 'off'
                ? 'agent off'
                : null;
        if (reason) {
          skipped.push({ id, reason });
          continue;
        }
        const running = (
          await tx`
            select 1 from agent_runs
            where lead_id = ${id} and kind = 'outreach' and status in ('queued', 'running')
            limit 1
          `
        )[0];
        if (running) {
          skipped.push({ id, reason: 'outreach already queued' });
          continue;
        }
        await tx`update leads set agent_goal = ${goal}, updated_at = now() where id = ${id}`;
        await insertRun(tx, {
          kind: 'outreach',
          leadId: id,
          params: { goal, ...(wantChannel ? { channel: wantChannel } : {}) },
        });
        enqueued++;
      }
      return { status: 200, body: { enqueued, skipped } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (!res.replayed && res.body.enqueued) {
      emitControlEvent('lead.change');
      emitControlEvent('run.update');
    }
    if (res.body.enqueued) kickDrain();
    return c.json(res.body);
  });

  // Discovery briefs — the daily-autopilot side of lead gathering: each
  // enabled brief fires one discovery run every ~23h (see sweepBriefs).
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
    // A blank definition would schedule a useless daily run — require real
    // text for the two fields the sweep feeds to discovery.
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
      // A changed definition — or a paused brief switched back on — should
      // refire promptly, not ride out the previous run's 23h cadence. The
      // note (auto-pause reason or the strategist's rationale) is stale from
      // that moment — clear it with the cadence stamp. rearmed_at restarts
      // the dead-streak window so the pre-revival zero-yield history can't
      // instantly re-pause the brief before its new run is judged.
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

  // Segment performance — the learning-loop read surface: which segments
  // reply, which convert, what they cost.
  app.get('/control/v1/agent/segments', async (c) => {
    controlGate(c);
    return c.json({ segments: await segmentStats(sql) });
  });

  // Channel health — 30d rollup of sends/failures/guardrail-blocks/bounces
  // per channel, surfaced on the Settings provider cards.
  app.get('/control/v1/channels/health', async (c) => {
    controlGate(c);
    return c.json({ channels: await channelHealth(sql) });
  });

  // WhatsApp pairing state for the Settings screen (Baileys QR handshake).
  // `status` is the live socket state — 'off'/'connecting'/'qr'/'open' —
  // so the UI can say "desligado" instead of guessing from QR presence.
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

  // Pairing-code alternative to scanning the QR — WhatsApp's
  // "conectar com número" flow. Staff sends their phone digits, we ask
  // Baileys for the 8-char code.
  app.post('/control/v1/wa/pair-code', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const phone = str(body.phone, 'phone', 40);
    // Claimed: a retry must replay the issued code, not ask Baileys twice.
    // Failures throw inside the tx so the claim rolls back and a retry is
    // a genuinely fresh attempt.
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

  // Unpair the WhatsApp session (linked-device logout + auth-state wipe) so
  // a different number can pair. Restarts the socket afterwards so a fresh
  // QR is emitted right away. Claimed — a retried logout can't race the
  // replacement pairing.
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

  // ---- channel webhooks ---------------------------------------------------------
  // A shared webhook secret (VENDUA_WEBHOOK_SECRET, derived from the staff key
  // when unset) gates inbound posts — channels can't carry our staff cookie.
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
  // Cap inbound volume — an accepted message writes CRM rows and launches an
  // LLM run, so a guessed/leaked secret must not buy unbounded spend.
  let webhookBucket = { count: 0, resetAt: 0 };
  app.post('/control/v1/webhooks/:channel', async (c) => {
    // Two ways in: the shared x-vendua-webhook secret (manual relays, tests)
    // or Resend's svix signature — real inbound email, since Resend can't
    // set custom headers and signs the payload instead.
    const sharedOk = webhookSecretOk(c.req.header('x-vendua-webhook'));
    const svix = svixHeaders(c);
    // The svix signature covers the raw body, so verify before charging the
    // rate bucket — forged headers must not spend the inbound quota.
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
    // Only real providers hit this endpoint — 'manual' threads exist so staff
    // can type inbound notes, and no webhook should mint inbound activity
    // under that channel.
    const chan = channel(c.req.param('channel'));
    if (chan !== 'email' && chan !== 'whatsapp') {
      throw new HttpError(422, 'BAD_REQUEST', 'channel must be email|whatsapp');
    }
    if (!sharedOk) {
      const res = await ingestResendEvent(sql, raw!, svix!);
      return c.json(res, 'ignored' in res ? 200 : 201);
    }
    const body = parseJsonObject(raw ?? (await boundedText(c)));
    // Providers deliver at-least-once: without a stable message id a retry
    // would mint a second conversation and a second reply run. Require it.
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

  // ---- public booking surface --------------------------------------------------
  // UNAUTHENTICATED — the token IS the credential (HMAC lead id + exp).
  // Invalid/expired tokens get a uniform 404: no oracle on whether a lead
  // exists. Rate-limited per IP like /control/v1/login.
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
  // The booking token is a bearer credential in the body — CORS doesn't
  // apply, but a browser request carrying a *foreign* Origin is never the
  // page we served: enforce the same same-origin rule controlGate uses.
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
    // The ?t= token is the credential — don't let it ride Referer headers out
    // to the fonts/CDN origins the page loads.
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
      // roomConfigured drives the page's copy — true when either the static
      // URL is set or the Daily provider will mint a room at book time.
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

  // ---- control SPA ---------------------------------------------------------------
  // Prod: Core serves the built React app from apps/control/dist.
  // Dev: the vite server on :5195 proxies /control/v1 here — hit it instead.
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
