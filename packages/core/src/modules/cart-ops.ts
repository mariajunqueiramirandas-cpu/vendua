import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE, mintSessionToken, str } from '../platform/http.ts';
import {
  assertCartOpen,
  assertLineQty,
  deliveryPricing,
  loadCartRow,
  loadCartView,
  loadStoreSettings,
  loadZoneRows,
  parseItemNote,
  storeCoords,
  type CartDelivery,
  type CartRow,
  type CartTotals,
  type CartView,
} from './cart.ts';
import { couponUsage, evaluateCoupon, loadCoupon, parseCode } from './coupons.ts';
import { normalizeCep, resolveDelivery, validCoords, type RouteQuote } from './geo.ts';

// The cart's mutations, shared by the checkout routes and the Vendedor's tools: each runs in the
// caller's tx (the idempotency claim's), and every one re-reads the cart under its row lock.

function itemIdOf(itemId: string): string {
  if (!UUID_RE.test(itemId)) throw new HttpError(400, 'BAD_REQUEST', 'itemId must be a uuid');
  return itemId;
}

export async function createCartTx(
  tx: Sql,
  tenantId: string,
  secret: string,
): Promise<{ cartId: string; sessionToken: string; cart: CartRow }> {
  const cartId = crypto.randomUUID();
  const sessionToken = await mintSessionToken(cartId, tenantId, secret);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionToken));
  const hash = Buffer.from(digest).toString('hex');
  await tx`insert into carts (id, tenant_id, session_hash) values (${cartId}, ${tenantId}, ${hash})`;
  // the row as inserted: the column defaults
  const cart: CartRow = {
    id: cartId,
    status: 'open',
    delivery: null,
    delivery_route: null,
    coupon_code: null,
  };
  return { cartId, sessionToken, cart };
}

/** qty 0 removes the line. An item id the cart doesn't hold changes nothing. */
export async function setLineQtyTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  itemId: string,
  qty: number,
): Promise<CartView> {
  if (!Number.isInteger(qty) || qty < 0 || qty > 99) {
    throw new HttpError(422, 'INVALID_QTY', 'qty must be an integer between 0 and 99');
  }
  const cart = await assertCartOpen(tx, tenantId, cartId);
  const id = itemIdOf(itemId);
  if (qty > 0) await assertLineQty(tx, tenantId, cartId, id, qty);
  // one batch: the write (the cart's touch rides in its statement) is executed first, so the
  // view's reads (sent by loadCartView after it) see it
  const write = (
    qty === 0
      ? tx`
          with touched as (update carts set updated_at = now() where id = ${cartId})
          delete from cart_items where tenant_id = ${tenantId} and cart_id = ${cartId} and id = ${id}`
      : tx`
          with touched as (update carts set updated_at = now() where id = ${cartId})
          update cart_items set qty = ${qty} where tenant_id = ${tenantId} and cart_id = ${cartId} and id = ${id}`
  ).execute();
  const [, view] = await Promise.all([
    write,
    loadCartView(tx, tenantId, cartId, new Date(), { have: { cart } }),
  ]);
  return view;
}

/** PATCH a line: its qty, its note, or both (`note` absent = unchanged, '' = none). A note that
 *  makes the line the same as another one (product, options, note) folds it into that line. */
export async function editLineTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  itemId: string,
  edit: { qty?: number; note?: unknown },
): Promise<CartView> {
  if (edit.note === undefined || edit.qty === 0)
    return setLineQtyTx(tx, tenantId, cartId, itemId, Number(edit.qty));
  const note = parseItemNote(edit.note);
  const qty = edit.qty;
  if (qty !== undefined && (!Number.isInteger(qty) || qty < 1 || qty > 99)) {
    throw new HttpError(422, 'INVALID_QTY', 'qty must be an integer between 0 and 99');
  }
  const cart = await assertCartOpen(tx, tenantId, cartId);
  const id = itemIdOf(itemId);
  if (qty !== undefined) await assertLineQty(tx, tenantId, cartId, id, qty);
  const line = (
    await tx<{ qty: number; twin: string | null; twin_qty: number | null }[]>`
      select l.qty, t.id as twin, t.qty as twin_qty
      from cart_items l
        left join lateral (
          select id, qty from cart_items t
          where t.tenant_id = l.tenant_id and t.cart_id = l.cart_id and t.id <> l.id
            and t.product_id = l.product_id and t.modifier_ids = l.modifier_ids
            and t.modifier_qty = l.modifier_qty and t.combo_selections = l.combo_selections
            and t.note = ${note}
          limit 1
        ) t on true
      where l.tenant_id = ${tenantId} and l.cart_id = ${cartId} and l.id = ${id}
      for update of l`
  )[0];
  if (line) {
    const units = qty ?? line.qty;
    if (line.twin) {
      if (units + line.twin_qty! > 99)
        throw new HttpError(422, 'INVALID_QTY', 'line quantity cannot exceed 99');
      await tx`
        with touched as (update carts set updated_at = now() where id = ${cartId})
        update cart_items set qty = qty + ${units}
        where tenant_id = ${tenantId} and cart_id = ${cartId} and id = ${line.twin}`;
      await tx`delete from cart_items where tenant_id = ${tenantId} and cart_id = ${cartId} and id = ${id}`;
    } else {
      await tx`
        with touched as (update carts set updated_at = now() where id = ${cartId})
        update cart_items set note = ${note}, qty = ${units}
        where tenant_id = ${tenantId} and cart_id = ${cartId} and id = ${id}`;
    }
  }
  return loadCartView(tx, tenantId, cartId, new Date(), { have: { cart } });
}

export async function removeLineTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  itemId: string,
): Promise<CartView> {
  const cart = await assertCartOpen(tx, tenantId, cartId);
  // executed before loadCartView sends its reads, so they see the delete
  const removed =
    tx`delete from cart_items where tenant_id = ${tenantId} and cart_id = ${cartId} and id = ${itemIdOf(itemId)}`.execute();
  const [, view] = await Promise.all([
    removed,
    loadCartView(tx, tenantId, cartId, new Date(), { have: { cart } }),
  ]);
  return view;
}

/** The bounded address a cart holds (POST /cart/delivery's body). */
export function parseDeliveryInput(input: unknown): CartDelivery {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new HttpError(422, 'INVALID_DELIVERY', 'mode must be pickup or delivery');
  const body = input as Record<string, unknown>;
  const { mode } = body;
  if (mode === 'dine_in') return { mode };
  if (mode !== 'pickup' && mode !== 'delivery') {
    throw new HttpError(422, 'INVALID_DELIVERY', 'mode must be pickup or delivery');
  }
  const opt = (k: string, max: number) =>
    body[k] === undefined || body[k] === null ? null : str(body[k], k, max);
  const cepRaw = opt('cep', 12);
  const cep = cepRaw ? normalizeCep(cepRaw) : null;
  if (cepRaw && !cep) throw new HttpError(422, 'INVALID_DELIVERY', 'cep must have 8 digits');
  const hasCoords = body.lat !== undefined && body.lat !== null;
  const coords = hasCoords ? validCoords(body.lat, body.lng) : null;
  if (hasCoords && !coords)
    throw new HttpError(422, 'INVALID_DELIVERY', 'lat/lng must be coordinates');
  return {
    mode,
    neighborhood: opt('neighborhood', 200),
    address: opt('address', 500),
    street: opt('street', 120),
    number: opt('number', 10),
    complement: opt('complement', 80),
    reference: opt('reference', 120),
    cep,
    lat: coords?.lat ?? null,
    lng: coords?.lng ?? null,
  };
}

/** `route`: a road leg fetched before the tx; kept only for the pin it was fetched for
 *  (loadCartView re-checks the store's end). */
export async function setDeliveryTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  delivery: CartDelivery,
  route: RouteQuote | null,
): Promise<CartView> {
  await assertCartOpen(tx, tenantId, cartId);
  const leg =
    route &&
    delivery.lat != null &&
    delivery.lng != null &&
    route.to[0] === delivery.lat &&
    route.to[1] === delivery.lng
      ? route
      : null;
  await tx`
    update carts set delivery = ${tx.json(delivery as never)},
      delivery_route = ${leg ? tx.json({ ...leg }) : null}, updated_at = now()
    where tenant_id = ${tenantId} and id = ${cartId}
  `;
  return loadCartView(tx, tenantId, cartId);
}

export type DeliveryQuote =
  | { eligible: false; reason: 'OUT_OF_ZONE' }
  | {
      eligible: true;
      zoneId: string;
      zoneName: string;
      zoneKind: string;
      feeCents: number;
      etaMin: number;
      etaMax: number;
      distanceKm: number | null;
      distanceSource: 'route' | 'estimate' | null;
      minOrderCents: number;
      freeDeliveryOverCents: number | null;
      /** with a cart: its totals delivered here and paid this way */
      totals?: CartTotals;
    };

/** Can the store deliver here, for how much (POST /quote). A cep alone prices nothing: the
 *  caller resolves it to a neighbourhood or a pin first (that lookup is a network call). */
export async function quoteDeliveryTx(
  tx: Sql,
  tenantId: string,
  where: { neighborhood?: string | null; lat?: number | null; lng?: number | null },
  opts: { cartId?: string | null; route?: RouteQuote | null; paymentMethod?: string | null } = {},
): Promise<DeliveryQuote> {
  const neighborhood =
    where.neighborhood == null ? '' : str(where.neighborhood, 'neighborhood', 200);
  const hasCoords = where.lat !== undefined && where.lat !== null;
  const coords = hasCoords ? validCoords(where.lat, where.lng) : null;
  if (hasCoords && !coords)
    throw new HttpError(422, 'INVALID_DELIVERY', 'lat/lng must be coordinates');
  const cartId = opts.cartId ?? null;
  const [zones, settings, cart] = await Promise.all([
    loadZoneRows(tx, tenantId),
    loadStoreSettings(tx, tenantId),
    cartId ? loadCartRow(tx, tenantId, cartId) : undefined,
  ]);
  // one leg prices the whole answer: the fresh one, else the one the cart holds for this pin
  const stored = cart?.delivery_route ?? null;
  const leg = opts.route ?? stored;
  const match = resolveDelivery(
    zones,
    { neighborhood, coords },
    storeCoords(settings),
    deliveryPricing(settings, leg),
  );
  // Relatórios' zone conversion: who asked for delivery where (server-side, like order_placed);
  // a quote without a cart session still answers, it just isn't counted
  const counted = cartId
    ? tx`
        insert into analytics_events (tenant_id, name, at, session_id, props)
        values (${tenantId}, 'delivery_quoted', now(), ${cartId}, ${tx.json({
          zone: match?.zone.name ?? null,
          neighborhood: neighborhood.trim().slice(0, 80) || null,
          eligible: !!match,
        })})
      `.execute()
    : null;
  if (!match) {
    await counted;
    return { eligible: false, reason: 'OUT_OF_ZONE' };
  }
  // the cart's totals go out with the event's insert, priced on the rows read above
  const [, totals] = await Promise.all([
    counted,
    cartId && cart
      ? loadCartView(tx, tenantId, cartId, new Date(), {
          paymentMethod: opts.paymentMethod ?? null,
          delivery: {
            mode: 'delivery',
            neighborhood,
            lat: coords?.lat ?? null,
            lng: coords?.lng ?? null,
          },
          route: leg,
          have: { cart, settings, zones },
        }).then((v) => v.totals)
      : null,
  ]);
  return {
    eligible: true,
    zoneId: match.zone.id,
    zoneName: match.zone.name,
    zoneKind: match.zone.kind,
    feeCents: match.feeCents,
    etaMin: match.zone.eta_min_minutes,
    etaMax: match.zone.eta_max_minutes,
    distanceKm: match.distanceKm,
    distanceSource: match.distanceSource ?? null,
    minOrderCents: Math.max(settings?.min_order_cents ?? 0, match.zone.min_order_cents),
    freeDeliveryOverCents: match.zone.free_delivery_over_cents,
    ...(totals ? { totals } : {}),
  };
}

/** `phone`: the shopper's, when known; `provenPhone`: the one a proven token vouches for
 *  (personal coupons need it). "Add R$ X more" stays on the cart; other refusals 422. */
export async function applyCouponTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  code: string,
  phone: string | null = null,
  provenPhone: string | null = null,
): Promise<CartView> {
  const normalized = parseCode(code);
  await assertCartOpen(tx, tenantId, cartId);
  const row = await loadCoupon(tx, tenantId, normalized);
  if (!row) throw new HttpError(422, 'COUPON_NOT_FOUND', 'coupon not found', { field: 'code' });
  const cart = await loadCartView(tx, tenantId, cartId);
  const out = evaluateCoupon(row, {
    subtotalCents: cart.totals.subtotalCents,
    deliveryFeeCents: cart.totals.deliveryFeeCents,
    phone,
    provenPhone,
    usage: await couponUsage(tx, tenantId, row.id, phone),
    now: new Date(),
  });
  if (!out.ok && out.reason !== 'COUPON_MIN_SUBTOTAL')
    throw new HttpError(422, out.reason!, 'coupon does not apply', {
      field: 'code',
      ...out.details,
    });
  await tx`update carts set coupon_code = ${row.code}, updated_at = now() where id = ${cartId}`;
  return loadCartView(tx, tenantId, cartId);
}

export async function clearCouponTx(tx: Sql, tenantId: string, cartId: string): Promise<CartView> {
  await assertCartOpen(tx, tenantId, cartId);
  await tx`update carts set coupon_code = null, updated_at = now() where id = ${cartId}`;
  return loadCartView(tx, tenantId, cartId);
}
