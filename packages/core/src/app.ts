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
  getGuardrails,
  getIntegration,
  getPitch,
  integrationKind,
  listIntegrations,
  listSettings,
  putSetting,
  upsertIntegration,
  validateSetting,
  type IntegrationKind,
} from './modules/integrations.ts';
import { claimControl, controlTx } from './modules/control.ts';
import { drain, insertRun } from './agent/runner.ts';
import { ingestInbound } from './agent/inbound.ts';
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

export function createApp({ sql, sessionSecret, controlSecret }: AppDeps) {
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
    // Lead + its triage run share ONE claim: a retried POST replays the
    // stored body (lead + runId) instead of creating a second lead.
    const res = await claimControl<{ lead: Lead; runId?: string }>(
      sql,
      requireIdemKey(c),
      async (tx) => {
        const created = await insertLeadTx(tx, leadInsert(await bodyJson(c)));
        if (created.body.lead.agentMode !== 'off') {
          const runId = await insertRun(tx, {
            kind: 'triage',
            leadId: created.body.lead.id,
          });
          return { status: created.status, body: { ...created.body, runId } };
        }
        return created;
      },
    );
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    if (res.body.runId) void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
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
    return c.json(await leadStats(sql));
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
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      const rows = await tx`
        update leads set unsubscribed_at = now(), updated_at = now()
        where id = ${id} and unsubscribed_at is null returning id
      `;
      const exists = rows[0] ?? (await tx`select id from leads where id = ${id}`)[0];
      if (!exists) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
      if (rows[0]) {
        await tx`
          insert into lead_activities (lead_id, kind, body, created_by)
          values (${id}, 'system', 'Descadastrado pela equipe', 'staff')
        `;
      }
      return { status: 200, body: { ok: true } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(res.body);
  });

  app.post('/control/v1/leads/:id/run', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const kind = str(body.kind, 'kind', 40);
    if (!['triage', 'reply', 'outreach', 'discovery'].includes(kind)) {
      throw new HttpError(422, 'BAD_REQUEST', 'kind must be triage|reply|outreach|discovery');
    }
    const leadId = uuidParam(c, 'id');
    const threadId = body.threadId ? str(body.threadId, 'threadId', 64) : null;
    if (threadId && !UUID_RE.test(threadId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'threadId must be a uuid');
    }
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      if (threadId) {
        const th = (
          await tx<{ lead_id: string }[]>`
            select lead_id from lead_threads where id = ${threadId}
          `
        )[0];
        if (!th) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
        if (th.lead_id.toLowerCase() !== leadId.toLowerCase()) {
          throw new HttpError(422, 'BAD_REQUEST', 'threadId does not belong to leadId');
        }
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
    void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
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

  // ---- agent runs --------------------------------------------------------------
  app.get('/control/v1/agent/runs', async (c) => {
    controlGate(c);
    const kind = c.req.query('kind');
    const status = c.req.query('status');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50) || 50, 1), 200);
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where = [kind ? `kind = ${p(kind)}` : 'true', status ? `status = ${p(status)}` : 'true'];
    const rows = await controlTx(sql, (tx) =>
      tx.unsafe(
        `select r.id, r.kind, r.status, r.lead_id, r.thread_id, r.tokens_in, r.tokens_out,
                r.cost_cents, r.error, r.created_at, r.started_at, r.finished_at,
                l.name as lead_name
         from agent_runs r left join leads l on l.id = r.lead_id
         where ${where.join(' and ')}
         order by r.created_at desc limit ${p(limit)}`,
        params as never[],
      ),
    );
    return c.json({ runs: rows });
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

  app.post('/control/v1/agent/runs', async (c) => {
    controlGate(c);
    const body = await bodyJson(c);
    const kind = str(body.kind, 'kind', 40);
    if (!['triage', 'reply', 'outreach', 'discovery'].includes(kind)) {
      throw new HttpError(422, 'BAD_REQUEST', 'kind must be triage|reply|outreach|discovery');
    }
    const leadId = body.leadId ? str(body.leadId, 'leadId', 64) : null;
    const threadId = body.threadId ? str(body.threadId, 'threadId', 64) : null;
    for (const [field, v] of [
      ['leadId', leadId],
      ['threadId', threadId],
    ] as const) {
      if (v && !UUID_RE.test(v)) throw new HttpError(400, 'BAD_REQUEST', `${field} must be a uuid`);
    }
    const res = await claimControl(sql, requireIdemKey(c), async (tx) => {
      // leadId and threadId aren't independent: a reply run bound to a thread
      // must belong to that thread's lead, or thread content could be
      // answered to the wrong lead's channel.
      if (leadId && threadId) {
        const th = (
          await tx<{ lead_id: string }[]>`
            select lead_id from lead_threads where id = ${threadId}
          `
        )[0];
        if (!th) throw new HttpError(404, 'THREAD_NOT_FOUND', 'thread not found');
        if (th.lead_id.toLowerCase() !== leadId.toLowerCase()) {
          throw new HttpError(422, 'BAD_REQUEST', 'threadId does not belong to leadId');
        }
      }
      return {
        status: 201,
        body: {
          runId: await insertRun(tx, {
            kind: kind as 'triage' | 'reply' | 'outreach' | 'discovery',
            leadId,
            threadId,
            params: (body.params as Record<string, unknown>) ?? {},
          }),
        },
      };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    void drain(sql).catch((e) => agentLog.error({ err: e }, 'drain failed'));
    return c.json(res.body, res.status as 201);
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
    const { waStatus } = await import('./agent/channels/whatsapp.ts');
    return c.json({ qr: rows[0]?.value?.qr ?? null, status: waStatus() });
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
    return c.json(res.body, res.status as 200);
  });

  // ---- channel webhooks ---------------------------------------------------------
  // A shared webhook secret (VENDUA_WEBHOOK_SECRET, derived from the staff key
  // when unset) gates inbound posts — channels can't carry our staff cookie.
  const webhookSecret =
    process.env.VENDUA_WEBHOOK_SECRET ??
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
    if (!webhookSecretOk(c.req.header('x-vendua-webhook'))) {
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
    const body = await bodyJson(c);
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
    return c.json(res, 201);
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
    c.header('cache-control', ext === '.html' ? 'no-store' : 'public, max-age=31536000, immutable');
    return c.body(await Bun.file(file).arrayBuffer());
  });

  app.route('/storefront/v1', storefront);
  app.route('/checkout/v1', checkout);

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  return app;
}
