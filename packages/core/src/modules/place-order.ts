import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { loadCartView, loadZoneRows, storeCoords } from './cart.ts';
import { getProductById } from './catalog.ts';
import { addressParts, composeAddress, validateCheckout, type CheckoutInput } from './checkout.ts';
import { couponUsage, evaluateCoupon, loadCoupon } from './coupons.ts';
import { normalizePhone } from './customer.ts';
import { effectiveFee } from './geo.ts';
import { pixPayload, type PixKeyType } from './pix.ts';
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
  const zones = await loadZoneRows(tx, tenantId, { forUpdate: true });
  // Re-validate modifier ids / kit picks against current defs — nothing retired slips through underpriced.
  const products = new Map<string, Awaited<ReturnType<typeof getProductById>>>();
  for (const item of cart.items) {
    products.set(
      item.productId,
      await getProductById(tx, tenantId, item.productId, { forUpdate: true }),
    );
  }
  const status = deriveStatus(
    settings?.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
    settings?.status_override ?? null,
    settings?.resumes_at ?? null,
    now,
  );
  const match = validateCheckout(
    status,
    settings,
    cart,
    body,
    zones,
    products,
    storeCoords(settings),
  );
  const scheduledFor = validateSchedule(
    cart.schedule,
    body.scheduledFor ?? undefined,
    body.payment.method,
  );

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
  let coupon: { id: string; code: string } | null = null;
  if (cart.coupon) {
    const row = await loadCoupon(tx, tenantId, cart.coupon.code);
    if (!row)
      throw new HttpError(422, 'COUPON_NOT_FOUND', 'coupon no longer exists', { field: 'coupon' });
    const out = evaluateCoupon(row, {
      subtotalCents: subtotal,
      deliveryFeeCents: deliveryFee,
      phone,
      usage: await couponUsage(tx, tenantId, row.id, phone),
      now,
    });
    if (!out.ok)
      throw new HttpError(422, out.reason ?? 'COUPON_NOT_FOUND', 'coupon does not apply', {
        field: 'coupon',
        ...out.details,
      });
    discount = out.discountCents;
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
  const total = subtotal + deliveryFee - discount;

  const pixProfile =
    body.payment.method === 'pix' && settings?.pix_key && settings.pix_key_type
      ? {
          key: settings.pix_key,
          keyType: settings.pix_key_type as PixKeyType,
          beneficiary: settings.pix_beneficiary ?? '',
          city: settings.pix_city ?? settings.city ?? '',
        }
      : null;
  const payment = {
    // 'sandbox' = the contract's dev provider name (capture lands with Mercado Pago, Phase 3)
    provider: 'sandbox',
    method: body.payment.method,
    status: 'pending',
    instructions:
      body.payment.method === 'pix'
        ? pixProfile
          ? `Pague ${(total / 100).toFixed(2).replace('.', ',')} no Pix copia e cola abaixo — o pedido #${number} aparece para a loja.`
          : 'Pagamento PIX combinado na entrega/retirada.'
        : 'Pagamento na entrega ou retirada.',
    pix: pixProfile
      ? {
          key: pixProfile.key,
          keyType: pixProfile.keyType,
          beneficiary: pixProfile.beneficiary,
          copyPaste: pixPayload(pixProfile, { amountCents: total, txid: `PEDIDO${number}` }),
        }
      : null,
  };

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
                        subtotal_cents, delivery_fee_cents, discount_cents, total_cents, coupon_code,
                        notes, scheduled_for)
    values (${orderId}, ${tenantId}, ${cartId}, ${number}, ${tx.json(customer)}, ${phone},
            ${tx.json(delivery as never)}, ${tx.json(payment as never)}, 'placed',
            ${subtotal}, ${deliveryFee}, ${discount}, ${total}, ${coupon?.code ?? null},
            ${body.notes?.trim() || null}, ${scheduledFor})
  `;
  for (const [sort, i] of cart.items.entries()) {
    await tx`
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
    `;
  }
  if (coupon)
    await tx`
      insert into coupon_redemptions (tenant_id, coupon_id, order_id, phone, discount_cents)
      values (${tenantId}, ${coupon.id}, ${orderId}, ${phone}, ${discount})
    `;
  await tx`
    insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
    values (${tenantId}, ${orderId}, null, 'placed', 'customer', ${tx.json({ via: 'checkout-sandbox' })})
  `;
  await tx`
    insert into outbox (tenant_id, topic, payload)
    values (${tenantId}, 'order.placed', ${tx.json({ orderId, number })})
  `;
  await tx`update carts set status = 'completed', updated_at = now() where id = ${cartId}`;
  // authoritative funnel event (15-analytics) — the cart id is the session scope
  await tx`
    insert into analytics_events (tenant_id, name, at, session_id, props)
    values (${tenantId}, 'order_placed', now(), ${cartId},
      ${tx.json({ order_id: orderId, value: total, method: body.payment.method, ...(coupon ? { coupon: coupon.code } : {}) })})
  `;
  return orderId;
}
