import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { emitAdminTx } from '../admin/live.ts';
import { withTenant, type Sql } from '../platform/db.ts';
import {
  HttpError,
  UUID_RE,
  bodyJson,
  rateLimit,
  sessionCartId,
  str,
  uuidParam,
  verifySessionToken,
} from '../platform/http.ts';
import { log } from '../platform/log.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { assertCartOpen, loadCartView, loadZoneRows } from './cart.ts';
import {
  createShare,
  importLines,
  orderLines,
  parseImportLines,
  readShare,
  type ImportLine,
} from './cart-share.ts';
import { getProductById } from './catalog.ts';
import { claimControl } from './control.ts';
import {
  COUPON_CODE_RE,
  couponLabel,
  couponUsage,
  evaluateCoupon,
  loadCoupon,
  normalizeCode,
  parseCode,
} from './coupons.ts';
import {
  loyaltyCard,
  mintCustomerToken,
  ordersByPhone,
  parseLoyalty,
  recordSessionFailure,
  requireCustomer,
  resolveCustomer,
  sessionFailuresExceeded,
  validPhone,
  verifyByOrder,
  verifyCustomerToken,
} from './customer.ts';
import { normalizeCep, parsePolygon, resolveZone, type CepLookup, type LatLng } from './geo.ts';
import type { OrderHub } from './order-live.ts';
import {
  ORDER_STATES,
  TERMINAL_STATES,
  canTransition,
  loadOrderView,
  transitionOrder,
  type OrderState,
  type OrderView,
} from './orders.ts';
import { normalizePixKey, type PixKeyType } from './pix.ts';
import { setStock } from './stock.ts';
import { subscribeNotifyTx } from './storefront-platform.ts';
import type { StoreSettingsRow } from './store.ts';
import { isPaymentMethod } from './payment-adjustments.ts';
import type { PaymentProvider } from './payments/provider.ts';
import { refundLeftovers, refundOrderPayments } from '../admin/routes-orders.ts';
import { cancelOpenAttempts, preparePayment } from './payments/store-payments.ts';

type TenantApp = Hono<{ Variables: { tenant: Tenant } }>;

const commerceLog = log.child({ mod: 'commerce' });

interface Deps {
  app: TenantApp;
  storefront: TenantApp;
  checkout: TenantApp;
  sql: Sql;
  sessionSecret: string;
  controlGate: (c: Context) => void;
  requireIdemKey: (c: Context) => string;
  idempotency: (
    sql: Sql,
    run: (c: Context, tx: Sql) => Promise<{ status: number; body: unknown }>,
  ) => (c: Context) => Promise<Response>;
  trustProxy: boolean;
  /** trusted proxies after the client's own XFF entry (VENDUA_PROXY_HOPS) */
  proxyHops?: number;
  cepLookup: CepLookup;
  orderHub: OrderHub;
  provider: PaymentProvider;
  /** `https://<admin host>` — Mercado Pago's notification_url base */
  publicOrigin: (c: Context) => string;
  /** fallback `<slug>.<storeDomain>` for storeOrigin (card back_url); default VENDUA_STORE_DOMAIN */
  storeDomain?: string;
}

const CUSTOMER_HEADER = 'x-vendua-customer';
// proxy idle timeouts sit at 30–60s; 20s keeps the stream warm
const STREAM_HEARTBEAT_MS = 20_000;
const STREAM_RECHECK_MS = 15_000;
const STREAM_MAX_MS = 10 * 60_000;

/** Phase 2 commerce surfaces (roadmap 2a–2c): public reads, checkout mutations, staff admin. */
export function mountCommerce(d: Deps) {
  const { app, storefront, checkout, sql, sessionSecret, controlGate, requireIdemKey } = d;
  const limiter = (max: number) =>
    rateLimit(
      { windowMs: 60_000, max },
      { trustForwardedFor: d.trustProxy, proxyHops: d.proxyHops ?? 0 },
    );

  // ── storefront (public reads) ──────────────────────────────────────────────

  storefront.use('/cep/*', limiter(30));
  storefront.get('/cep/:cep', async (c) => {
    const tenant = c.get('tenant');
    const cep = normalizeCep(c.req.param('cep'));
    if (!cep) throw new HttpError(400, 'INVALID_CEP', 'cep must have 8 digits');
    let found;
    try {
      found = await d.cepLookup(cep);
    } catch (err) {
      commerceLog.warn({ err, cep }, 'cep lookup failed');
      throw new HttpError(503, 'CEP_UNAVAILABLE', 'cep lookup is unavailable — type the address');
    }
    if (!found) throw new HttpError(404, 'CEP_NOT_FOUND', 'unknown cep');
    // the zone answer rides along so the form can show the fee as soon as the CEP lands
    const zone = await withTenant(sql, tenant.id, async (tx) => {
      const zones = await loadZoneRows(tx, tenant.id);
      return resolveZone(zones, { neighborhood: found.neighborhood }, null);
    });
    c.header('cache-control', 'public, max-age=86400');
    return c.json({
      address: found,
      zone: zone
        ? {
            eligible: true,
            zoneId: zone.zone.id,
            zoneName: zone.zone.name,
            feeCents: zone.feeCents,
            etaMin: zone.zone.eta_min_minutes,
            etaMax: zone.zone.eta_max_minutes,
          }
        : { eligible: false, reason: 'OUT_OF_ZONE' },
    });
  });

  // waitlist (roadmap 2c) — same subscriptions as notify-me; answers how many wait
  storefront.use('/waitlist', limiter(30));
  storefront.post(
    '/waitlist',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const body = await bodyJson(c);
      await subscribeNotifyTx(tx, tenant.id, { ...body, subject: 'product' });
      const waiting = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from notify_requests
          where tenant_id = ${tenant.id} and subject = 'product' and product_id = ${body.productId as string}
            and notified_at is null
        `
      )[0]!.n;
      return { status: 201, body: { subscribed: true, waiting } };
    }),
  );

  // ── checkout: coupons ──────────────────────────────────────────────────────

  const optionalCart = async (c: Context) => {
    const tenant = c.get('tenant') as Tenant;
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token ? verifySessionToken(token, tenant.id, sessionSecret) : null;
  };
  const customerOf = (c: Context, tx: Sql) => {
    const tenant = c.get('tenant') as Tenant;
    const t = c.req.header(CUSTOMER_HEADER);
    return resolveCustomer(
      tx,
      tenant.id,
      t ? verifyCustomerToken(sessionSecret, tenant.id, t) : null,
    );
  };

  checkout.post(
    '/coupons/validate',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const code = parseCode((await bodyJson(c)).code);
      const cartId = await optionalCart(c);
      const customer = await customerOf(c, tx);
      const phone = customer?.phone ?? null;
      const row = await loadCoupon(tx, tenant.id, code);
      if (!row) return { status: 200, body: { valid: false, code, reason: 'COUPON_NOT_FOUND' } };
      const cart = cartId ? await loadCartView(tx, tenant.id, cartId) : null;
      const out = evaluateCoupon(row, {
        subtotalCents: cart?.totals.subtotalCents ?? 0,
        deliveryFeeCents: cart?.totals.deliveryFeeCents ?? 0,
        phone,
        provenPhone: customer?.proven ? phone : null,
        usage: await couponUsage(tx, tenant.id, row.id, phone),
        now: new Date(),
      });
      return {
        status: 200,
        body: {
          valid: out.ok,
          code: row.code,
          label: couponLabel(row),
          kind: row.kind,
          discountCents: out.discountCents,
          ...(out.reason ? { reason: out.reason } : {}),
          ...(out.details ? { details: out.details } : {}),
        },
      };
    }),
  );

  checkout.post(
    '/cart/coupon',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, sessionSecret);
      const code = parseCode((await bodyJson(c)).code);
      await assertCartOpen(tx, tenant.id, cartId);
      const row = await loadCoupon(tx, tenant.id, code);
      if (!row) throw new HttpError(422, 'COUPON_NOT_FOUND', 'coupon not found', { field: 'code' });
      const cart = await loadCartView(tx, tenant.id, cartId);
      const customer = await customerOf(c, tx);
      const phone = customer?.phone ?? null;
      const out = evaluateCoupon(row, {
        subtotalCents: cart.totals.subtotalCents,
        deliveryFeeCents: cart.totals.deliveryFeeCents,
        phone,
        provenPhone: customer?.proven ? phone : null,
        usage: await couponUsage(tx, tenant.id, row.id, phone),
        now: new Date(),
      });
      // "add R$ X more" is kept on the cart (it starts applying as the bag grows); the rest refuse
      if (!out.ok && out.reason !== 'COUPON_MIN_SUBTOTAL')
        throw new HttpError(422, out.reason!, 'coupon does not apply', {
          field: 'code',
          ...out.details,
        });
      await tx`update carts set coupon_code = ${row.code}, updated_at = now() where id = ${cartId}`;
      return { status: 200, body: { cart: await loadCartView(tx, tenant.id, cartId) } };
    }),
  );

  checkout.delete(
    '/cart/coupon',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, sessionSecret);
      await assertCartOpen(tx, tenant.id, cartId);
      await tx`update carts set coupon_code = null, updated_at = now() where id = ${cartId}`;
      return { status: 200, body: { cart: await loadCartView(tx, tenant.id, cartId) } };
    }),
  );

  // ── checkout: import / share / reorder ─────────────────────────────────────

  checkout.post(
    '/cart/import',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await bodyJson(c, 64 * 1024);
      await assertCartOpen(tx, tenant.id, cartId);
      let lines: ImportLine[];
      if (body.shareCode !== undefined) {
        lines = await readShare(tx, tenant.id, str(body.shareCode, 'shareCode', 16));
      } else {
        lines = parseImportLines(body.items);
      }
      const report = await importLines(tx, tenant.id, cartId, lines);
      return { status: 200, body: { cart: await loadCartView(tx, tenant.id, cartId), report } };
    }),
  );

  checkout.post(
    '/cart/share',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, sessionSecret);
      return { status: 201, body: await createShare(tx, tenant.id, cartId) };
    }),
  );

  // "pedir de novo" — the order must be provably the caller's: its own session token, or a
  // customer token for the order's phone (a not-yet-proven one reaches only its anchor order)
  checkout.post(
    '/cart/reorder',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const cartId = await sessionCartId(c, sessionSecret);
      const body = await bodyJson(c);
      const orderId = str(body.orderId, 'orderId', 64);
      if (!UUID_RE.test(orderId)) throw new HttpError(400, 'BAD_REQUEST', 'orderId must be a uuid');
      const order = (
        await tx<{ cart_id: string; customer_phone: string | null }[]>`
          select cart_id, customer_phone from orders where tenant_id = ${tenant.id} and id = ${orderId}
        `
      )[0];
      const viaToken =
        typeof body.orderToken === 'string' && body.orderToken.length < 200
          ? await verifySessionToken(body.orderToken, tenant.id, sessionSecret)
          : null;
      const customer = await customerOf(c, tx);
      const owns =
        order &&
        ((viaToken !== null && viaToken === order.cart_id) ||
          (customer !== null &&
            customer.phone === order.customer_phone &&
            (customer.proven || customer.anchorOrderId === orderId)));
      if (!owns) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
      await assertCartOpen(tx, tenant.id, cartId);
      const report = await importLines(
        tx,
        tenant.id,
        cartId,
        await orderLines(tx, tenant.id, orderId),
      );
      return { status: 200, body: { cart: await loadCartView(tx, tenant.id, cartId), report } };
    }),
  );

  // ── live order: SSE ────────────────────────────────────────────────────────

  // One `order` event per new version (id = version): the current order on
  // connect, then each change as pg_notify lands. Closes at a terminal state or
  // after STREAM_MAX_MS (the Kernel reconnects). A 15s re-read covers a NOTIFY
  // lost while LISTEN reconnects; `Last-Event-ID` skips a version already seen.
  checkout.get('/orders/:id/events', async (c) => {
    const tenant = c.get('tenant');
    const cartId = await sessionCartId(c, sessionSecret);
    const orderId = uuidParam(c, 'id');
    const read = () =>
      withTenant(sql, tenant.id, (tx) => loadOrderView(tx, tenant.id, orderId, cartId));
    // 404 before the stream opens — a stream is only for an order this session owns
    const first = await read();
    const lastId = Number(c.req.header('last-event-id'));
    const res = streamSSE(c, async (stream) => {
      let sent = Number.isInteger(lastId) && lastId > 0 ? lastId : 0;
      let finish!: () => void;
      let closed = false;
      const done = new Promise<void>((resolve) => {
        finish = () => {
          if (closed) return;
          closed = true;
          resolve();
        };
      });
      stream.onAbort(finish);
      const push = async (o: OrderView) => {
        if (o.version > sent) {
          sent = o.version;
          await stream.writeSSE({ event: 'order', id: String(o.version), data: JSON.stringify(o) });
        }
        if (TERMINAL_STATES.has(o.state)) finish();
      };
      // serialized: two wake-ups never race a stale read past a fresh one
      let chain = Promise.resolve();
      const refresh = () => {
        chain = chain.then(async () => {
          if (closed) return;
          try {
            await push(await read());
          } catch (err) {
            commerceLog.warn({ err, orderId }, 'order stream read failed');
            finish();
          }
        });
      };
      const unsubscribe = await d.orderHub.subscribe(orderId, refresh);
      const beat = setInterval(() => void stream.write(':ka\n\n'), STREAM_HEARTBEAT_MS);
      const recheck = setInterval(refresh, STREAM_RECHECK_MS);
      const lifetime = setTimeout(finish, STREAM_MAX_MS);
      // re-read after subscribing: a change between `first` and now isn't lost
      await push(first);
      refresh();
      await done;
      unsubscribe();
      clearInterval(beat);
      clearInterval(recheck);
      clearTimeout(lifetime);
    });
    c.header('cache-control', 'no-cache, no-transform');
    c.header('x-accel-buffering', 'no');
    return c.newResponse(res.body);
  });

  // ── online payment (Mercado Pago) ──────────────────────────────────────────

  // The order page asks how to pay: the live Pix QR, the hosted card checkout, or nothing left
  // to do. Also the card return's first stop — it syncs with the provider before the webhook.
  // per IP: shoppers behind one NAT (a shared wifi) pay at the same time
  checkout.use('/orders/:id/pay', limiter(60));
  // Mercado Pago runs before the recorded tx (never inside one): preparePayment is safe to
  // repeat (it reuses the live attempt or retries its reserved one), and a key that already has
  // an answer skips straight to the replay.
  checkout.post('/orders/:id/pay', async (c) => {
    const tenant = c.get('tenant') as Tenant;
    const cartId = await sessionCartId(c, sessionSecret);
    const orderId = uuidParam(c, 'id');
    const key = requireIdemKey(c);
    const answered = await withTenant(
      sql,
      tenant.id,
      (tx) => tx`
        select 1 from idempotency_keys
        where tenant_id = ${tenant.id} and key = ${key} and response is not null
      `,
    );
    const next = answered.length
      ? null
      : await preparePayment(
          { sql, provider: d.provider, sessionSecret },
          tenant,
          orderId,
          cartId,
          {
            publicOrigin: d.publicOrigin(c),
            storeDomain: d.storeDomain ?? process.env.VENDUA_STORE_DOMAIN ?? 'vendua.com.br',
            ...(process.env.MP_PAYER_EMAIL ? { payerEmail: process.env.MP_PAYER_EMAIL } : {}),
          },
        );
    return d.idempotency(sql, async (_c, tx) => ({
      status: 200,
      body: {
        order: await loadOrderView(tx, tenant.id, orderId, cartId),
        next: next ?? { kind: 'none' },
      },
    }))(c);
  });

  // ── customer (sem senha, sem cadastro) ─────────────────────────────────────

  checkout.use('/customer/session', limiter(10));
  checkout.post(
    '/customer/session',
    d.idempotency(sql, async (c, tx) => {
      const tenant = c.get('tenant') as Tenant;
      const body = await bodyJson(c);
      const phone = validPhone(body.phone);
      const number = Number(body.orderNumber);
      if (!phone)
        throw new HttpError(422, 'INVALID_CUSTOMER', 'phone must have DDD + number', {
          field: 'phone',
        });
      if (!Number.isInteger(number) || number < 1 || number > 99_999_999)
        throw new HttpError(422, 'INVALID_CUSTOMER', 'orderNumber must be a positive integer', {
          field: 'orderNumber',
        });
      // order numbers are sequential: a phone gets a few guesses a day, then 429
      if (await sessionFailuresExceeded(tx, tenant.id, phone))
        throw new HttpError(429, 'RATE_LIMITED', 'too many requests — retry later');
      const anchor = await verifyByOrder(tx, tenant.id, phone, number);
      // one answer for "no such order" and "not this phone" — no enumeration signal
      if (!anchor) {
        // own tx: the throw below rolls this one back (the phone's advisory lock is still held)
        await withTenant(sql, tenant.id, (t2) => recordSessionFailure(t2, tenant.id, phone));
        throw new HttpError(
          404,
          'CUSTOMER_NOT_VERIFIED',
          'no order with that number for this phone',
        );
      }
      const t = mintCustomerToken(sessionSecret, tenant.id, phone, anchor);
      return { status: 201, body: { customerToken: t.token, expiresAt: t.expiresAt, phone } };
    }),
  );

  checkout.get('/customer/orders', async (c) => {
    const tenant = c.get('tenant');
    const { phone, orders } = await withTenant(sql, tenant.id, async (tx) => {
      const who = await requireCustomer(
        tx,
        sessionSecret,
        tenant.id,
        c.req.header(CUSTOMER_HEADER),
        c.req.query('phone'),
      );
      return {
        phone: who.phone,
        orders: await ordersByPhone(
          tx,
          tenant.id,
          who.phone,
          30,
          who.proven ? undefined : who.anchorOrderId,
        ),
      };
    });
    c.header('cache-control', 'no-store');
    return c.json({ phone, orders });
  });

  checkout.get('/customer/loyalty', async (c) => {
    const tenant = c.get('tenant');
    const { phone, card } = await withTenant(sql, tenant.id, async (tx) => {
      const who = await requireCustomer(
        tx,
        sessionSecret,
        tenant.id,
        c.req.header(CUSTOMER_HEADER),
        c.req.query('phone'),
      );
      const settings = (
        await tx<StoreSettingsRow[]>`select * from store_settings where tenant_id = ${tenant.id}`
      )[0];
      return {
        phone: who.phone,
        // reward codes are redeemable coupons: only once the phone is proven
        card: await loyaltyCard(tx, tenant.id, who.phone, settings ?? null, new Date(), {
          withRewards: who.proven,
        }),
      };
    });
    c.header('cache-control', 'no-store');
    return c.json({ phone, loyalty: card });
  });

  // ── staff: commerce admin (the data Phase 3's merchant admin will edit) ─────

  const tenantBySlug = async (slug: string) => {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug))
      throw new HttpError(404, 'TENANT_NOT_FOUND', 'no such storefront');
    const row = (
      await sql<{ id: string; slug: string }[]>`select id, slug from tenants where slug = ${slug}`
    )[0];
    if (!row) throw new HttpError(404, 'TENANT_NOT_FOUND', 'no such storefront');
    return row;
  };
  const claimTenant = <T>(
    c: Context,
    tenantId: string,
    work: (tx: Sql) => Promise<{ status: number; body: T }>,
  ) =>
    claimControl(sql, requireIdemKey(c), async (tx) => {
      await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
      return work(tx);
    });
  const reply = <T>(c: Context, r: { status: number; body: T; replayed: boolean }) => {
    if (r.replayed) c.header('x-idempotent-replay', 'true');
    return c.json(r.body as object, r.status as 200);
  };
  const base = '/control/v1/storefronts/:slug/commerce';

  const int = (v: unknown, name: string, min: number, max: number): number => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max)
      throw new HttpError(400, 'BAD_REQUEST', `${name} must be an integer ${min}–${max}`);
    return v;
  };
  const optInt = (v: unknown, name: string, min: number, max: number) =>
    v === undefined ? undefined : v === null ? null : int(v, name, min, max);
  const productIdOf = async (tx: Sql, tenantId: string, ref: unknown): Promise<string> => {
    const r = str(ref, 'product', 200);
    const row = (
      await tx<{ id: string }[]>`
        select id from products where tenant_id = ${tenantId}
          and (${UUID_RE.test(r) ? tx`id = ${r}` : tx`slug = ${r}`})
      `
    )[0];
    if (!row) throw new HttpError(404, 'PRODUCT_NOT_FOUND', `no product ${r}`);
    return row.id;
  };

  app.patch(`${base}/products/:product`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c);
    const stockQuantity = optInt(body.stockQuantity, 'stockQuantity', 0, 1_000_000);
    const lowStockThreshold = optInt(body.lowStockThreshold, 'lowStockThreshold', 0, 1_000_000);
    const leadDays = optInt(body.preorderLeadDays, 'preorderLeadDays', 0, 60);
    const status = body.status;
    if (status !== undefined && !['active', 'sold_out', 'archived'].includes(status as string))
      throw new HttpError(400, 'BAD_REQUEST', 'status must be active, sold_out or archived');
    if (body.requiresPreorder !== undefined && typeof body.requiresPreorder !== 'boolean')
      throw new HttpError(400, 'BAD_REQUEST', 'requiresPreorder must be a boolean');
    const res = await claimTenant(c, t.id, async (tx) => {
      const id = await productIdOf(tx, t.id, c.req.param('product'));
      const stock = await setStock(tx, t.id, id, {
        ...(stockQuantity !== undefined ? { stockQuantity } : {}),
        ...(lowStockThreshold !== undefined ? { lowStockThreshold } : {}),
        ...(status !== undefined ? { status: status as string } : {}),
      });
      if (body.requiresPreorder !== undefined || leadDays !== undefined)
        await tx`
          update products set
            requires_preorder = ${body.requiresPreorder === undefined ? tx`requires_preorder` : (body.requiresPreorder as boolean)},
            preorder_lead_days = ${leadDays == null ? tx`preorder_lead_days` : leadDays}
          where tenant_id = ${t.id} and id = ${id}
        `;
      await emitAdminTx(tx, t.id, 'catalog', id);
      return {
        status: 200,
        body: {
          product: await getProductByIdAny(tx, t.id, id),
          restocked: stock.restocked,
          waitlistWoken: stock.waiting,
        },
      };
    });
    return reply(c, res);
  });

  app.put(`${base}/products/:product/media`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c);
    if (!Array.isArray(body.media) || body.media.length > 12)
      throw new HttpError(400, 'BAD_REQUEST', 'media must be an array of at most 12');
    const media = (body.media as Record<string, unknown>[]).map((m, i) => {
      const url = str(m?.url, `media[${i}].url`, 1000);
      if (!/^(https:\/\/|\/)/.test(url))
        throw new HttpError(400, 'BAD_REQUEST', 'media urls must be https:// or root-relative');
      return {
        url,
        alt: m.alt === undefined || m.alt === null ? null : str(m.alt, 'alt', 200),
        width: optInt(m.width, 'width', 1, 10_000) ?? null,
        height: optInt(m.height, 'height', 1, 10_000) ?? null,
      };
    });
    const res = await claimTenant(c, t.id, async (tx) => {
      const id = await productIdOf(tx, t.id, c.req.param('product'));
      await tx`delete from product_media where tenant_id = ${t.id} and product_id = ${id}`;
      for (const [sort, m] of media.entries())
        await tx`
          insert into product_media (tenant_id, product_id, url, alt, width, height, sort)
          values (${t.id}, ${id}, ${m.url}, ${m.alt}, ${m.width}, ${m.height}, ${sort})
        `;
      await emitAdminTx(tx, t.id, 'catalog', id);
      return { status: 200, body: { product: await getProductByIdAny(tx, t.id, id) } };
    });
    return reply(c, res);
  });

  app.put(`${base}/products/:product/combo`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c);
    if (!Array.isArray(body.slots) || body.slots.length > 8)
      throw new HttpError(400, 'BAD_REQUEST', 'slots must be an array of at most 8');
    const slots = (body.slots as Record<string, unknown>[]).map((s, i) => {
      const minSelect = int(s?.minSelect ?? 1, `slots[${i}].minSelect`, 0, 99);
      const maxSelect = int(s?.maxSelect ?? minSelect, `slots[${i}].maxSelect`, 1, 99);
      if (minSelect > maxSelect)
        throw new HttpError(400, 'BAD_REQUEST', `slots[${i}]: minSelect > maxSelect`);
      if (!Array.isArray(s.items) || s.items.length === 0 || s.items.length > 40)
        throw new HttpError(400, 'BAD_REQUEST', `slots[${i}].items must have 1–40 entries`);
      return {
        name: str(s.name, `slots[${i}].name`, 80),
        minSelect,
        maxSelect,
        qtyPerItem: int(s.qtyPerItem ?? 1, `slots[${i}].qtyPerItem`, 1, 99),
        items: (s.items as Record<string, unknown>[]).map((it) => ({
          ref: it?.productId ?? it?.slug,
          priceDeltaCents: int(it?.priceDeltaCents ?? 0, 'priceDeltaCents', -100_000, 100_000),
        })),
      };
    });
    const res = await claimTenant(c, t.id, async (tx) => {
      const id = await productIdOf(tx, t.id, c.req.param('product'));
      await tx`delete from combo_slots where tenant_id = ${t.id} and product_id = ${id}`;
      for (const [sort, s] of slots.entries()) {
        const slotId = (
          await tx<{ id: string }[]>`
            insert into combo_slots (tenant_id, product_id, name, min_select, max_select, qty_per_item, sort)
            values (${t.id}, ${id}, ${s.name}, ${s.minSelect}, ${s.maxSelect}, ${s.qtyPerItem}, ${sort})
            returning id
          `
        )[0]!.id;
        for (const [isort, it] of s.items.entries()) {
          const itemId = await productIdOf(tx, t.id, it.ref);
          if (itemId === id) throw new HttpError(400, 'BAD_REQUEST', 'a kit cannot contain itself');
          await tx`
            insert into combo_slot_items (tenant_id, slot_id, product_id, price_delta_cents, sort)
            values (${t.id}, ${slotId}, ${itemId}, ${it.priceDeltaCents}, ${isort})
            on conflict (slot_id, product_id) do nothing
          `;
        }
      }
      await tx`update products set kind = ${slots.length ? 'combo' : 'simple'} where tenant_id = ${t.id} and id = ${id}`;
      await emitAdminTx(tx, t.id, 'catalog', id);
      return { status: 200, body: { product: await getProductByIdAny(tx, t.id, id) } };
    });
    return reply(c, res);
  });

  app.get(`${base}/coupons`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const coupons = await withTenant(
      sql,
      t.id,
      (tx) => tx`
        select c.*, (select count(*)::int from coupon_redemptions r join orders o on o.id = r.order_id
                      where r.coupon_id = c.id and o.state <> 'cancelled') as redemptions
        from coupons c where c.tenant_id = ${t.id} order by c.created_at desc limit 200
      `,
    );
    return c.json({ coupons });
  });

  app.post(`${base}/coupons`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c);
    const code = normalizeCode(str(body.code, 'code', 32));
    if (!COUPON_CODE_RE.test(code))
      throw new HttpError(400, 'BAD_REQUEST', 'code must be 3–32 of A–Z, 0–9, _ or -');
    const kind = body.kind;
    if (kind !== 'percent' && kind !== 'fixed' && kind !== 'free_delivery')
      throw new HttpError(400, 'BAD_REQUEST', 'kind must be percent, fixed or free_delivery');
    const value =
      kind === 'free_delivery'
        ? 0
        : int(body.value, 'value', 1, kind === 'percent' ? 100 : 10_000_000);
    const date = (v: unknown, name: string) => {
      if (v === undefined || v === null) return null;
      const d = new Date(str(v, name, 40));
      if (Number.isNaN(d.getTime()))
        throw new HttpError(400, 'BAD_REQUEST', `${name} must be a date`);
      return d;
    };
    const phone = body.phone === undefined || body.phone === null ? null : validPhone(body.phone);
    if (body.phone && !phone)
      throw new HttpError(400, 'BAD_REQUEST', 'phone must have DDD + number');
    const res = await claimTenant(c, t.id, async (tx) => {
      try {
        const row = (
          await tx`
            insert into coupons (tenant_id, code, kind, value, label, min_subtotal_cents, max_discount_cents,
                                 starts_at, ends_at, max_redemptions, per_phone_limit, first_order_only, phone, source)
            values (${t.id}, ${code}, ${kind}, ${value},
                    ${body.label === undefined || body.label === null ? null : str(body.label, 'label', 120)},
                    ${optInt(body.minSubtotalCents, 'minSubtotalCents', 0, 10_000_000) ?? 0},
                    ${optInt(body.maxDiscountCents, 'maxDiscountCents', 1, 10_000_000) ?? null},
                    ${date(body.startsAt, 'startsAt')}, ${date(body.endsAt, 'endsAt')},
                    ${optInt(body.maxRedemptions, 'maxRedemptions', 1, 1_000_000) ?? null},
                    ${optInt(body.perPhoneLimit, 'perPhoneLimit', 1, 1000) ?? null},
                    ${body.firstOrderOnly === true}, ${phone}, 'staff')
            returning *
          `
        )[0];
        await emitAdminTx(tx, t.id, 'marketing');
        return { status: 201, body: { coupon: row } };
      } catch (err) {
        if ((err as { code?: string }).code === '23505')
          throw new HttpError(409, 'COUPON_EXISTS', `coupon ${code} already exists`);
        throw err;
      }
    });
    return reply(c, res);
  });

  app.patch(`${base}/coupons/:code`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const code = normalizeCode(c.req.param('code'));
    const body = await bodyJson(c);
    if (body.active !== undefined && typeof body.active !== 'boolean')
      throw new HttpError(400, 'BAD_REQUEST', 'active must be a boolean');
    const res = await claimTenant(c, t.id, async (tx) => {
      const row = (
        await tx`
          update coupons set active = ${body.active === undefined ? tx`active` : (body.active as boolean)},
            ends_at = ${body.endsAt === undefined ? tx`ends_at` : body.endsAt === null ? null : new Date(str(body.endsAt, 'endsAt', 40))}
          where tenant_id = ${t.id} and code = ${code} returning *
        `
      )[0];
      if (!row) throw new HttpError(404, 'COUPON_NOT_FOUND', 'coupon not found');
      await emitAdminTx(tx, t.id, 'marketing');
      return { status: 200, body: { coupon: row } };
    });
    return reply(c, res);
  });

  app.patch(`${base}/settings`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const body = await bodyJson(c);
    const res = await claimTenant(c, t.id, async (tx) => {
      if (body.pix !== undefined) {
        if (body.pix === null) {
          await tx`update store_settings set pix_key = null, pix_key_type = null, pix_beneficiary = null, pix_city = null where tenant_id = ${t.id}`;
        } else {
          const p = body.pix as Record<string, unknown>;
          const type = p.keyType as PixKeyType;
          if (!['cpf', 'cnpj', 'email', 'phone', 'random'].includes(type))
            throw new HttpError(
              400,
              'INVALID_PIX',
              'keyType must be cpf, cnpj, email, phone or random',
            );
          const key = normalizePixKey(str(p.key, 'pix.key', 100), type);
          if (!key) throw new HttpError(400, 'INVALID_PIX', `pix.key is not a valid ${type} key`);
          const beneficiary = str(p.beneficiary, 'pix.beneficiary', 25).trim();
          if (beneficiary.length < 2)
            throw new HttpError(400, 'INVALID_PIX', 'pix.beneficiary is required');
          const city = str(p.city ?? '', 'pix.city', 15).trim() || null;
          await tx`
            update store_settings set pix_key = ${key}, pix_key_type = ${type},
              pix_beneficiary = ${beneficiary}, pix_city = ${city}
            where tenant_id = ${t.id}
          `;
        }
      }
      if (body.loyalty !== undefined) {
        const program = body.loyalty === null ? null : parseLoyalty(body.loyalty);
        if (body.loyalty !== null && !program)
          throw new HttpError(400, 'BAD_REQUEST', 'loyalty needs stampsRequired 2–50 and a reward');
        await tx`update store_settings set loyalty = ${program ? tx.json(program as never) : null} where tenant_id = ${t.id}`;
      }
      if (body.location !== undefined) {
        const l = body.location as { latitude?: unknown; longitude?: unknown } | null;
        const lat = l === null ? null : Number(l.latitude);
        const lng = l === null ? null : Number(l.longitude);
        if (
          l !== null &&
          (!Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            Math.abs(lat!) > 90 ||
            Math.abs(lng!) > 180)
        )
          throw new HttpError(400, 'BAD_REQUEST', 'location needs latitude/longitude');
        await tx`update store_settings set latitude = ${lat}, longitude = ${lng} where tenant_id = ${t.id}`;
      }
      if (body.preorder !== undefined) {
        const p = body.preorder as { paymentMethods?: unknown; maxDays?: unknown };
        const methods = p.paymentMethods ?? ['pix'];
        if (
          !Array.isArray(methods) ||
          methods.length === 0 ||
          !methods.every((m) => isPaymentMethod(m))
        )
          throw new HttpError(
            400,
            'BAD_REQUEST',
            'preorder.paymentMethods must list payment methods',
          );
        await tx`
          update store_settings set preorder_payment_methods = ${tx.json(methods as string[])},
            preorder_max_days = ${int(p.maxDays ?? 30, 'preorder.maxDays', 1, 120)}
          where tenant_id = ${t.id}
        `;
      }
      const s = (
        await tx`
          select pix_key, pix_key_type, pix_beneficiary, pix_city, loyalty, latitude, longitude,
                 preorder_payment_methods, preorder_max_days
          from store_settings where tenant_id = ${t.id}
        `
      )[0];
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: { settings: s } };
    });
    return reply(c, res);
  });

  const zoneFields = (b: Record<string, unknown>, partial: boolean) => {
    const out: Record<string, unknown> = {};
    const want = (k: string) => !partial || b[k] !== undefined;
    if (want('name')) out.name = str(b.name, 'name', 80);
    if (b.kind !== undefined) {
      if (b.kind !== 'neighborhood' && b.kind !== 'radius' && b.kind !== 'polygon')
        throw new HttpError(400, 'BAD_REQUEST', 'kind must be neighborhood, radius or polygon');
      out.kind = b.kind;
    }
    // a new zone without a kind is a neighborhood zone (the column default)
    const kind = out.kind ?? (partial ? undefined : 'neighborhood');
    if (b.polygon !== undefined && b.polygon !== null) {
      const r = parsePolygon(b.polygon);
      if ('error' in r) throw new HttpError(400, 'BAD_REQUEST', r.error);
      if (kind !== undefined && kind !== 'polygon')
        throw new HttpError(400, 'BAD_REQUEST', 'only polygon zones take a polygon');
      out.polygon = r.polygon;
    } else if (kind !== undefined && kind !== 'polygon') out.polygon = null;
    if (b.neighborhoods !== undefined) {
      if (!Array.isArray(b.neighborhoods) || b.neighborhoods.length > 200)
        throw new HttpError(400, 'BAD_REQUEST', 'neighborhoods must be an array');
      out.neighborhoods = b.neighborhoods.map((n) => str(n, 'neighborhood', 120).trim());
    }
    if (b.maxDistanceKm !== undefined) {
      const km = b.maxDistanceKm === null ? null : Number(b.maxDistanceKm);
      if (km !== null && !(km > 0 && km <= 500))
        throw new HttpError(400, 'BAD_REQUEST', 'maxDistanceKm must be 0–500');
      out.max_distance_km = km;
    }
    const ints: [string, string, number, number][] = [
      ['feeCents', 'fee_cents', 0, 1_000_000],
      ['feePerKmCents', 'fee_per_km_cents', 0, 100_000],
      ['minOrderCents', 'min_order_cents', 0, 10_000_000],
      ['etaMin', 'eta_min_minutes', 0, 1440],
      ['etaMax', 'eta_max_minutes', 0, 1440],
    ];
    for (const [k, col, min, max] of ints)
      if (b[k] !== undefined) out[col] = int(b[k], k, min, max);
    if (b.freeDeliveryOverCents !== undefined)
      out.free_delivery_over_cents = optInt(
        b.freeDeliveryOverCents,
        'freeDeliveryOverCents',
        1,
        10_000_000,
      );
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean')
        throw new HttpError(400, 'BAD_REQUEST', 'active must be a boolean');
      out.active = b.active;
    }
    if (out.kind === 'radius' && !partial && out.max_distance_km == null)
      throw new HttpError(400, 'BAD_REQUEST', 'radius zones need maxDistanceKm');
    if (out.kind === 'polygon' && !partial && !out.polygon)
      throw new HttpError(400, 'BAD_REQUEST', 'polygon zones need a polygon');
    return out;
  };
  const zoneColumns = (tx: Sql, f: Record<string, unknown>) => ({
    ...f,
    ...(f.neighborhoods ? { neighborhoods: tx.json(f.neighborhoods as string[]) } : {}),
    ...(f.polygon ? { polygon: tx.json(f.polygon as LatLng[]) } : {}),
  });

  app.post(`${base}/zones`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const fields = zoneFields(await bodyJson(c), false);
    const res = await claimTenant(c, t.id, async (tx) => {
      const row = (
        await tx`
          insert into delivery_zones ${tx(zoneColumns(tx, { tenant_id: t.id, ...fields }) as never)}
          returning *
        `
      )[0];
      await emitAdminTx(tx, t.id, 'store');
      return { status: 201, body: { zone: row } };
    });
    return reply(c, res);
  });

  app.patch(`${base}/zones/:zoneId`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const zoneId = uuidParam(c, 'zoneId');
    const fields = zoneFields(await bodyJson(c), true);
    if (Object.keys(fields).length === 0)
      throw new HttpError(400, 'BAD_REQUEST', 'nothing to update');
    const res = await claimTenant(c, t.id, async (tx) => {
      const row = (
        await tx`
          update delivery_zones set ${tx(zoneColumns(tx, fields) as never)} where tenant_id = ${t.id} and id = ${zoneId} returning *
        `.catch((err: unknown) => {
          if (
            (err as { constraint_name?: string }).constraint_name === 'delivery_zones_polygon_check'
          )
            throw new HttpError(400, 'BAD_REQUEST', 'polygon zones need a polygon, and only they');
          throw err;
        })
      )[0];
      if (!row) throw new HttpError(404, 'ZONE_NOT_FOUND', 'zone not found');
      await emitAdminTx(tx, t.id, 'store');
      return { status: 200, body: { zone: row } };
    });
    return reply(c, res);
  });

  app.get(`${base}/orders`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const state = c.req.query('state');
    if (state !== undefined && !(ORDER_STATES as readonly string[]).includes(state))
      throw new HttpError(400, 'BAD_REQUEST', 'unknown state');
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 30) || 30));
    const orders = await withTenant(sql, t.id, async (tx) => {
      const ids = await tx<{ id: string }[]>`
        select id from orders where tenant_id = ${t.id} ${state ? tx`and state = ${state}` : tx``}
        order by placed_at desc limit ${limit}
      `;
      const out = [];
      for (const { id } of ids) out.push(await loadOrderView(tx, t.id, id));
      return out;
    });
    return c.json({ orders });
  });

  app.post(`${base}/orders/:orderId/transition`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const orderId = uuidParam(c, 'orderId');
    const body = await bodyJson(c);
    const to = body.to as OrderState;
    if (!(ORDER_STATES as readonly string[]).includes(to))
      throw new HttpError(400, 'BAD_REQUEST', 'to must be an order state');
    const note = body.note === undefined ? undefined : str(body.note, 'note', 280);
    // like the admin: refund (or stop unpaid attempts) before the recorded tx, outside any tx
    const pre = await withTenant(
      sql,
      t.id,
      async (tx) =>
        (
          await tx<{ state: OrderState; online: boolean | null; status: string | null }[]>`
            select state, (payment ->> 'online')::boolean as online, payment ->> 'status' as status
            from orders where tenant_id = ${t.id} and id = ${orderId}
          `
        )[0],
    );
    if (pre?.online && canTransition(pre.state, to)) {
      const pay = { sql, provider: d.provider, sessionSecret };
      if (
        (to === 'cancelled' || to === 'refunded') &&
        (pre.status === 'paid' || pre.status === 'partially_refunded')
      )
        await refundOrderPayments(pay, t.id, orderId, {
          amountCents: null,
          reason: note ?? `pedido ${to === 'cancelled' ? 'cancelado' : 'estornado'}`,
          requestedBy: null,
          key: `control:${requireIdemKey(c)}`,
          requireApproved: true,
        });
      else if (to === 'cancelled') await cancelOpenAttempts(pay, t.id, orderId);
    }
    const res = await claimTenant(c, t.id, async (tx) => {
      await transitionOrder(tx, t.id, orderId, to, 'staff', note ? { note } : {});
      return { status: 200, body: { order: await loadOrderView(tx, t.id, orderId) } };
    });
    if (res.status === 200 && (to === 'cancelled' || to === 'refunded'))
      await refundLeftovers({ sql, provider: d.provider, sessionSecret }, t.id, orderId);
    return reply(c, res);
  });

  app.get(`${base}/waitlist`, async (c) => {
    controlGate(c);
    const t = await tenantBySlug(c.req.param('slug'));
    const rows = await withTenant(
      sql,
      t.id,
      (tx) => tx`
        select p.id as "productId", p.slug, p.name, count(*)::int as waiting
        from notify_requests n join products p on p.id = n.product_id
        where n.tenant_id = ${t.id} and n.subject = 'product' and n.notified_at is null
        group by p.id order by waiting desc
      `,
    );
    return c.json({ waitlist: rows });
  });
}

/** Staff reads see archived products too. */
async function getProductByIdAny(tx: Sql, tenantId: string, id: string) {
  return (
    (await getProductById(tx, tenantId, id)) ??
    (
      await tx`select id, slug, name, status from products where tenant_id = ${tenantId} and id = ${id}`
    )[0]
  );
}
