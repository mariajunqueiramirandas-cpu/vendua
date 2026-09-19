import { Hono } from 'hono';
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
  tenantMiddleware,
  uuidParam,
  verifySessionToken,
} from './platform/http.ts';
import { TenantResolver, type Tenant } from './platform/tenancy.ts';
import { getCatalog, getProduct, getProductById } from './modules/catalog.ts';
import { deriveStatus, type StoreSettingsRow } from './modules/store.ts';
import { composeNotices, type SurfacesEnvelope } from './modules/notices.ts';
import { addItem, assertCartOpen, loadCartView, matchZone } from './modules/cart.ts';
import { validateCheckout, validateCheckoutShape } from './modules/checkout.ts';
import { loadOrderView } from './modules/orders.ts';
import { LOADER_JS } from './loader.ts';

export interface AppDeps {
  sql: Sql;
  sessionSecret: string;
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

export function createApp({ sql, sessionSecret }: AppDeps) {
  const resolver = new TenantResolver(sql);
  const app = new Hono<{ Variables: { tenant: Tenant } }>();

  app.onError((err, c) => errorJson(err, c));
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
  checkout.use('*', rateLimit({ windowMs: 60_000, max: 240 }, { trustForwardedFor: trustProxy }));

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
      if (!/^[0-9a-f-]{36}$/i.test(productId)) {
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
          provider: 'stub',
          method: body.payment.method,
          status: 'pending',
          instructions:
            body.payment.method === 'pix'
              ? 'Pagamento PIX combinado na entrega/retirada (stub de Phase 0).'
              : 'Pagamento na entrega ou retirada (stub de Phase 0).',
        };
        await tx`
          insert into orders (id, tenant_id, cart_id, number, customer, delivery, payment, state, subtotal_cents, delivery_fee_cents, total_cents)
          values (${orderId}, ${tenant.id}, ${cartId}, ${number}, ${tx.json(body.customer)}, ${tx.json(delivery)}, ${tx.json(payment)},
                  'placed', ${cart.totals.subtotalCents}, ${deliveryFee}, ${cart.totals.subtotalCents + deliveryFee})
        `;
        await tx`
          insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
          values (${tenant.id}, ${orderId}, null, 'placed', 'customer', ${tx.json({ via: 'checkout-stub' })})
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
  app.get('/control/v1/state', async (c) => {
    if (c.req.header('x-vendua-control') !== sessionSecret) {
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    }
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

  app.route('/storefront/v1', storefront);
  app.route('/checkout/v1', checkout);

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  return app;
}
