import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { loadCartView, loadZoneRows, repriceLines, storeCoords } from './cart.ts';
import { getProductsById, type ProductDetail } from './catalog.ts';
import { addressParts, composeAddress, validateCheckout, type CheckoutInput } from './checkout.ts';
import { couponUsage, evaluateCoupon, loadCoupon } from './coupons.ts';
import { normalizePhone } from './customer.ts';
import { effectiveFee } from './geo.ts';
import { adjustmentFor, paymentAdjustmentCents } from './payment-adjustments.ts';
import { offlinePayment, onlineOffer, onlinePayment } from './payments/store-payments.ts';
import type { PaymentProvider } from './payments/provider.ts';
import { validateSchedule } from './preorder.ts';
import { drawStock, stockDemand } from './stock.ts';
import { deriveStatus, type StoreSettingsRow } from './store.ts';

/**
 * The one place an order is born (checkout invariant: at most one order per cart).
 * Everything money-shaped is recomputed here under locks from live rows: zone fee,
 * coupon discount, stock — the cart view the customer saw is only a preview.
 */
export async function placeOrderTx(
  tx: Sql,
  tenantId: string,
  cartId: string,
  body: CheckoutInput,
  now = new Date(),
  /** the install's driver; without it the stored connection alone decides (older callers) */
  provider?: PaymentProvider,
  /** the phone a proven customer token vouches for — personal coupons need it */
  opts: { provenPhone?: string | null } = {},
): Promise<string> {
  // Lock the cart row first — concurrent checkouts would both see 'open' and mint duplicates.
  await tx`select id from carts where tenant_id = ${tenantId} and id = ${cartId} for update`;
  const cart = await loadCartView(tx, tenantId, cartId, now);
  // A completed cart must not mint a second order.
  if (cart.status !== 'open') {
    throw new HttpError(409, 'CART_NOT_OPEN', 'cart already checked out', {
      cartStatus: cart.status,
    });
  }
  // Advisory lock before reading eligibility — choke point vs concurrent settings/zone/product writes.
  await tx`select pg_advisory_xact_lock(hashtext(${tenantId}))`;
  const settings =
    (
      await tx<
        StoreSettingsRow[]
      >`select * from store_settings where tenant_id = ${tenantId} for update`
    )[0] ?? null;
  // zones lock after settings, as always; the payment connection is a plain read beside it
  const [zones, offer] = await Promise.all([
    loadZoneRows(tx, tenantId, { forUpdate: true }),
    onlineOffer(tx, tenantId, provider),
  ]);
  // Re-validate modifier ids / kit picks against current defs — nothing retired slips through underpriced.
  const found = await getProductsById(
    tx,
    tenantId,
    cart.items.map((i) => i.productId),
    { forUpdate: true },
  );
  const products = new Map<string, ProductDetail | null>(
    cart.items.map((i) => [i.productId, found.get(i.productId) ?? null]),
  );
  const status = deriveStatus(
    settings?.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
    settings?.status_override ?? null,
    settings?.resumes_at ?? null,
    now,
    settings?.special_days ?? [],
  );
  const match = validateCheckout(
    status,
    settings,
    cart,
    body,
    zones,
    products,
    storeCoords(settings),
    { card: offer.online },
  );
  const scheduledFor = validateSchedule(
    cart.schedule,
    body.scheduledFor ?? undefined,
    body.payment.method,
  );
  // Throws after writing: the caller commits the repriced lines and answers this 409, so the
  // shopper's next cart read shows the new total.
  const repriced = await repriceLines(tx, tenantId, cart.items, products);
  if (repriced > 0)
    throw new HttpError(409, 'PRICES_CHANGED', 'some prices changed — review the cart', {
      changedLines: repriced,
    });

  const subtotal = cart.totals.subtotalCents;
  const deliveryFee =
    body.delivery.mode === 'delivery' && match.zone
      ? effectiveFee(
          { zone: match.zone, distanceKm: match.distanceKm, feeCents: match.feeCents },
          subtotal,
        )
      : 0;
  const phone = normalizePhone(body.customer.phone);

  // coupon: re-evaluated with the phone (per-phone limits, first order, personal rewards)
  let discount = 0;
  let itemDiscount = 0;
  let coupon: { id: string; code: string } | null = null;
  if (cart.coupon) {
    const row = await loadCoupon(tx, tenantId, cart.coupon.code);
    if (!row)
      throw new HttpError(422, 'COUPON_NOT_FOUND', 'coupon no longer exists', { field: 'coupon' });
    const out = evaluateCoupon(row, {
      subtotalCents: subtotal,
      deliveryFeeCents: deliveryFee,
      phone,
      provenPhone: opts.provenPhone ?? null,
      usage: await couponUsage(tx, tenantId, row.id, phone),
      now,
    });
    if (!out.ok)
      throw new HttpError(422, out.reason ?? 'COUPON_NOT_FOUND', 'coupon does not apply', {
        field: 'coupon',
        ...out.details,
      });
    discount = out.discountCents;
    if (row.kind !== 'free_delivery') itemDiscount = discount;
    coupon = { id: row.id, code: row.code };
  }

  await drawStock(
    tx,
    tenantId,
    stockDemand(
      cart.items.map((i) => ({ productId: i.productId, qty: i.qty, combo: i.comboSelections })),
    ),
  );

  // Numbering relies on the advisory lock above — else two checkouts read the same max.
  const number = (
    await tx<
      { n: number }[]
    >`select coalesce(max(number), 0) + 1 as n from orders where tenant_id = ${tenantId}`
  )[0]!.n;
  const orderId = crypto.randomUUID();
  // from the locked settings row, before the payment is built: Pix/MP charge the adjusted total
  const paymentAdjustment = Math.max(
    paymentAdjustmentCents(subtotal, itemDiscount, adjustmentFor(settings, body.payment.method)),
    -(subtotal + deliveryFee - discount),
  );
  const total = subtotal + deliveryFee - discount + paymentAdjustment;

  // online: Mercado Pago charges it when the shopper's page asks (POST /orders/:id/pay);
  // a store that isn't connected keeps today's static Pix from its own key
  const method = body.payment.method;
  const payment =
    offer.online && offer.provider && (method === 'pix' || method === 'card_online')
      ? onlinePayment(offer.provider, method, total)
      : offlinePayment(settings, method, total, number);

  const prep = settings?.prep_time_minutes ?? 30;
  const at = (min: number) => new Date(now.getTime() + min * 60_000).toISOString();
  const delivery =
    body.delivery.mode === 'delivery'
      ? {
          mode: 'delivery' as const,
          neighborhood: body.delivery.neighborhood?.trim() || null,
          address: composeAddress(body.delivery),
          addressParts: addressParts(body.delivery),
          ...(typeof body.delivery.lat === 'number'
            ? { lat: body.delivery.lat, lng: body.delivery.lng }
            : {}),
          zoneName: match.zone?.name ?? null,
          distanceKm: match.distanceKm,
          feeCents: deliveryFee,
          etaMin: match.zone?.eta_min_minutes ?? null,
          etaMax: match.zone?.eta_max_minutes ?? null,
          promisedFrom: scheduledFor ? null : at(match.zone?.eta_min_minutes ?? prep),
          promisedTo: scheduledFor ? null : at(match.zone?.eta_max_minutes ?? prep),
        }
      : {
          mode: 'pickup' as const,
          neighborhood: null,
          address: null,
          feeCents: 0,
          etaMin: null,
          etaMax: null,
          promisedFrom: scheduledFor ? null : at(prep),
          promisedTo: scheduledFor ? null : at(prep),
        };

  const customer = { name: body.customer.name.trim(), phone: body.customer.phone.trim() };
  await tx`
    insert into orders (id, tenant_id, cart_id, number, customer, customer_phone, delivery, payment, state,
                        subtotal_cents, delivery_fee_cents, discount_cents, payment_adjustment_cents,
                        total_cents, coupon_code, notes, scheduled_for)
    values (${orderId}, ${tenantId}, ${cartId}, ${number}, ${tx.json(customer)}, ${phone},
            ${tx.json(delivery as never)}, ${tx.json(payment as never)}, 'placed',
            ${subtotal}, ${deliveryFee}, ${discount}, ${paymentAdjustment}, ${total}, ${coupon?.code ?? null},
            ${body.notes?.trim() || null}, ${scheduledFor})
  `;
  // the rest only needs the order row; one pipelined batch instead of a round trip per statement
  await Promise.all([
    ...cart.items.map(
      (i, sort) => tx`
        insert into order_items (tenant_id, order_id, product_id, slug, name, qty, unit_price_cents,
                                 modifiers, combo, line_total_cents, sort)
        values (${tenantId}, ${orderId}, ${i.productId}, ${i.slug}, ${i.name}, ${i.qty}, ${i.unitPriceCents},
                ${tx.json(i.modifiers.map((m) => ({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents })))},
                ${tx.json(
                  i.combo.map((c) => ({
                    slotId: c.slotId,
                    slotName: c.slotName,
                    productId: c.productId,
                    name: c.name,
                    qty: c.qty,
                  })) as never,
                )},
                ${i.lineTotalCents}, ${sort})
      `,
    ),
    coupon &&
      tx`
        insert into coupon_redemptions (tenant_id, coupon_id, order_id, phone, discount_cents)
        values (${tenantId}, ${coupon.id}, ${orderId}, ${phone}, ${discount})
      `,
    tx`
      insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
      values (${tenantId}, ${orderId}, null, 'placed', 'customer', ${tx.json({ via: 'checkout-sandbox' })})
    `,
    tx`
      insert into outbox (tenant_id, topic, payload)
      values (${tenantId}, 'order.placed', ${tx.json({ orderId, number })})
    `,
    tx`update carts set status = 'completed', updated_at = now() where id = ${cartId}`,
    // authoritative funnel event (15-analytics) — the cart id is the session scope
    tx`
      insert into analytics_events (tenant_id, name, at, session_id, props)
      values (${tenantId}, 'order_placed', now(), ${cartId},
        ${tx.json({ order_id: orderId, value: total, method: body.payment.method, ...(coupon ? { coupon: coupon.code } : {}), ...(paymentAdjustment ? { payment_adjustment: paymentAdjustment } : {}) })})
    `,
    // the merchant admin's live board rings on commit
    emitAdminTx(tx, tenantId, 'order.placed', orderId),
  ]);
  return orderId;
}
