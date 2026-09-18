import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Sql } from './platform/db.ts';
import { withTenant } from './platform/db.ts';
import {
  HttpError,
  errorJson,
  idempotency,
  mintSessionToken,
  sessionCartId,
  tenantMiddleware,
} from './platform/http.ts';
import { TenantResolver, type Tenant } from './platform/tenancy.ts';
import { getCatalog, getProduct, getProductById } from './modules/catalog.ts';
import { deriveStatus, type StoreSettingsRow } from './modules/store.ts';
import { composeNotices, type SurfacesEnvelope } from './modules/notices.ts';
import { addItem, loadCartView, matchZone } from './modules/cart.ts';
import { validateCheckout, validateCheckoutShape } from './modules/checkout.ts';
import { loadOrderView } from './modules/orders.ts';
import { LOADER_JS } from './loader.ts';

export interface AppDeps {
  sql: Sql;
  sessionSecret: string;
}

async function loadSettings(tx: Sql, tenantId: string): Promise<StoreSettingsRow | null> {
  const rows = await tx<StoreSettingsRow[]>`select * from store_settings where tenant_id = ${tenantId}`;
  return rows[0] ?? null;
}

async function loadZones(tx: Sql, tenantId: string) {
  return tx<
    {
      id: string;
      name: string;
      neighborhoods: string[];
      fee_cents: number;
      min_order_cents: number;
      eta_min_minutes: number;
      eta_max_minutes: number;
    }[]
  >`
    select id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes
    from delivery_zones where tenant_id = ${tenantId} and active order by name
  `;
}

function currentStatus(settings: StoreSettingsRow | null) {
  return deriveStatus(settings?.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
    settings?.status_override ?? null, settings?.resumes_at ?? null, new Date());
}

export function createApp({ sql, sessionSecret }: AppDeps) {
  const resolver = new TenantResolver(sql);
  const app = new Hono<{ Variables: { tenant: Tenant } }>();

  app.onError((err, c) => errorJson(err, c));
  // Dev convenience: storefront vite dev servers on localhost:* call us cross-origin.
  app.use('*', cors({ origin: (o) => o || '*', allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'], credentials: true }));

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
  storefront.use('*', tenantMiddleware(resolver));

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
    });
  });

  storefront.get('/catalog', async (c) => {
    const tenant = c.get('tenant');
    const catalog = await withTenant(sql, tenant.id, (tx) => getCatalog(tx, tenant.id));
    return c.json({ categories: catalog });
  });

  storefront.get('/products/:slug', async (c) => {
    const tenant = c.get('tenant');
    const product = await withTenant(sql, tenant.id, (tx) => getProduct(tx, tenant.id, c.req.param('slug')));
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
      store: { status: status.status, ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}) },
      notices,
    };
    return c.json(envelope);
  });

  // Tiny loader-facing endpoint — cached snapshot shape per 05-system-surfaces.
  storefront.get('/state', async (c) => {
    const tenant = c.get('tenant');
    const settings = await withTenant(sql, tenant.id, (tx) => loadSettings(tx, tenant.id));
    const status = currentStatus(settings);
    const notices = composeNotices(tenant.slug, settings, status);
    return c.json({
      store: { status: status.status, ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}) },
      notices: notices.filter((n) => n.severity === 'blocking' || n.kind === 'emergency'),
    });
  });

  // ------------------------- /checkout/v1 (session-scoped) -----------------
  const checkout = new Hono<{ Variables: { tenant: Tenant } }>();
  checkout.use('*', tenantMiddleware(resolver));

  checkout.post('/session', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async () => {
      const { cartId, token } = await withTenant(sql, tenant.id, async (tx) => {
        const cartId = crypto.randomUUID();
        const token = await mintSessionToken(cartId, sessionSecret);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
        const hash = Buffer.from(digest).toString('hex');
        await tx`insert into carts (id, tenant_id, session_hash) values (${cartId}, ${tenant.id}, ${hash})`;
        return { cartId, token };
      });
      const cart = await withTenant(sql, tenant.id, (tx) => loadCartView(tx, tenant.id, cartId));
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
    return idempotency(sql, async () => {
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await c.req.json();
      const cart = await withTenant(sql, tenant.id, async (tx) => {
        const open = await tx`select id from carts where tenant_id = ${tenant.id} and id = ${cartId} and status = 'open'`;
        if (!open[0]) throw new HttpError(404, 'CART_NOT_FOUND', 'cart not found or already completed');
        const productId = String(body.productId ?? '');
        const qty = Number(body.qty ?? 1);
        const modifierIds = Array.isArray(body.modifierIds) ? body.modifierIds.map(String) : [];
        return addItem(tx, tenant.id, cartId, { productId, qty, modifierIds }, getProductById);
      });
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.patch('/cart/items/:itemId', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async () => {
      const cartId = await sessionCartId(c, sessionSecret);
      const { qty } = await c.req.json();
      if (!Number.isInteger(qty) || qty < 0 || qty > 99) {
        throw new HttpError(422, 'INVALID_QTY', 'qty must be an integer between 0 and 99');
      }
      const cart = await withTenant(sql, tenant.id, async (tx) => {
        if (qty === 0) {
          await tx`delete from cart_items where tenant_id = ${tenant.id} and cart_id = ${cartId} and id = ${c.req.param('itemId')}`;
        } else {
          await tx`update cart_items set qty = ${qty} where tenant_id = ${tenant.id} and cart_id = ${cartId} and id = ${c.req.param('itemId')}`;
        }
        await tx`update carts set updated_at = now() where id = ${cartId}`;
        return loadCartView(tx, tenant.id, cartId);
      });
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.delete('/cart/items/:itemId', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async () => {
      const cartId = await sessionCartId(c, sessionSecret);
      const cart = await withTenant(sql, tenant.id, async (tx) => {
        await tx`delete from cart_items where tenant_id = ${tenant.id} and cart_id = ${cartId} and id = ${c.req.param('itemId')}`;
        return loadCartView(tx, tenant.id, cartId);
      });
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.post('/cart/delivery', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async () => {
      const cartId = await sessionCartId(c, sessionSecret);
      const { mode, neighborhood, address } = await c.req.json();
      if (mode !== 'pickup' && mode !== 'delivery') {
        throw new HttpError(422, 'INVALID_DELIVERY', 'mode must be pickup or delivery');
      }
      const cart = await withTenant(sql, tenant.id, async (tx) => {
        await tx`
          update carts set delivery = ${tx.json({ mode, neighborhood: neighborhood ?? null, address: address ?? null })}, updated_at = now()
          where tenant_id = ${tenant.id} and id = ${cartId} and status = 'open'
        `;
        return loadCartView(tx, tenant.id, cartId);
      });
      return { status: 200, body: { cart } };
    })(c);
  });

  checkout.post('/quote', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async () => {
      const { neighborhood } = await c.req.json();
      const zones = await withTenant(sql, tenant.id, (tx) => loadZones(tx, tenant.id));
      const zone = matchZone(zones, neighborhood);
      if (!zone) {
        return { status: 200, body: { eligible: false, reason: 'OUT_OF_ZONE' } };
      }
      return {
        status: 200,
        body: { eligible: true, zoneId: zone.id, feeCents: zone.fee_cents, etaMin: zone.eta_min_minutes, etaMax: zone.eta_max_minutes },
      };
    })(c);
  });

  checkout.post('/checkout', async (c) => {
    const tenant = c.get('tenant');
    return idempotency(sql, async () => {
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await c.req.json();
      validateCheckoutShape(body);
      const order = await withTenant(sql, tenant.id, async (tx) => {
        const cart = await loadCartView(tx, tenant.id, cartId);
        const settings = await loadSettings(tx, tenant.id);
        const zones = await loadZones(tx, tenant.id);
        const { zone } = validateCheckout(currentStatus(settings), settings, cart, body, zones);
        const delivery = {
          mode: body.delivery.mode,
          neighborhood: body.delivery.neighborhood ?? null,
          address: body.delivery.address ?? null,
          feeCents: zone?.fee_cents ?? 0,
          etaMin: zone?.eta_min_minutes ?? null,
          etaMax: zone?.eta_max_minutes ?? null,
        };
        const deliveryFee = body.delivery.mode === 'delivery' ? (zone?.fee_cents ?? 0) : 0;
        const number = (
          await tx<{ n: number }[]>`select coalesce(max(number), 0) + 1 as n from orders where tenant_id = ${tenant.id}`
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
      });
      const view = await withTenant(sql, tenant.id, (tx) => loadOrderView(tx, tenant.id, order));
      return { status: 201, body: { order: view } };
    })(c);
  });

  checkout.get('/orders/:id', async (c) => {
    const tenant = c.get('tenant');
    await sessionCartId(c, sessionSecret);
    const order = await withTenant(sql, tenant.id, (tx) => loadOrderView(tx, tenant.id, c.req.param('id')));
    return c.json({ order });
  });

  // ------------------------- /control/v1 (internal/dev) --------------------
  // Phase 0: open in dev. Prod binds this surface to mTLS/private network.
  app.get('/control/v1/state', async (c) => {
    const slug = c.req.query('tenant');
    if (!slug) throw new HttpError(400, 'BAD_REQUEST', 'tenant query param required');
    const tenant = await resolver.resolveBySlug(slug);
    if (!tenant) throw new HttpError(404, 'TENANT_NOT_FOUND', 'tenant not found');
    const settings = await withTenant(sql, tenant.id, (tx) => loadSettings(tx, tenant.id));
    const status = currentStatus(settings);
    const notices = composeNotices(tenant.slug, settings, status);
    return c.json({
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      store: { status: status.status, ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}) },
      notices: notices.filter((n) => n.severity === 'blocking'),
    });
  });

  app.route('/storefront/v1', storefront);
  app.route('/checkout/v1', checkout);

  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404));
  return app;
}
