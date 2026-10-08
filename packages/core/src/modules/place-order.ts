import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { loadCartRow, loadCartView, loadZoneRows, repriceLines, storeCoords } from './cart.ts';
import { getProductsById, type ProductDetail } from './catalog.ts';
import { addressParts, composeAddress, validateCheckout, type CheckoutInput } from './checkout.ts';
import { couponUsage, evaluateCoupon, loadCoupon } from './coupons.ts';
import { enqueueOrderMessageTx } from '../store-whatsapp/messages.ts';
import { enqueueOrderPrintTx } from './printing/jobs.ts';
import { normalizePhone } from './customer.ts';
import { effectiveFee, routeMatches, validCoords, type RouteQuote } from './geo.ts';
import { adjustmentFor, paymentAdjustmentCents } from './payment-adjustments.ts';
import { offlinePayment, onlineOffer, onlinePayment } from './payments/store-payments.ts';
import type { PaymentProvider } from './payments/provider.ts';
import { validateSchedule } from './preorder.ts';
import { planHas } from './billing/plans.ts';
import type { QrTable } from './pdv/qr.ts';
import { recordStaffEventTx } from './staff-events.ts';
import { drawStock, stockDemand } from './stock.ts';
import { deriveStatus, type StoreSettingsRow } from './store.ts';

/** R$ 10.000: no shopper pays a delivery with more than that in cash */
export const MAX_CHANGE_CENTS = 1_000_000;
/** orders' money columns are int4: a cart of many priciest lines must stop at a 422 first */
export const MAX_ORDER_CENTS = 1_000_000_000;

/** QR orders a table may have waiting for the staff at once (ADR 0036) */
export const MAX_PENDING_AT_TABLE = 5;

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
  opts: {
    provenPhone?: string | null;
    /** distance pricing: a road leg fetched for this pin before the tx (when the cart has none) */
    route?: RouteQuote | null;
    /** where the order came from (orders.source, the placed event's `via`) */
    source?: string;
    /** the Vendedor conversation that sold it */
    threadId?: string | null;
    /** dine_in: the QR's table, its open comanda already locked (tableForToken) */
    table?: QrTable | null;
  } = {},
): Promise<string> {
  // One pipelined batch. postgres.js sends a query when it is first executed, so the locks are
  // executed here in their order, ahead of every query the helpers below send: the cart row first
  // (concurrent checkouts would both see 'open' and mint duplicates), then the advisory lock
  // before reading eligibility (choke point vs concurrent settings/zone/product writes), then
  // settings, then zones; the payment connection and the cart view's lines are plain reads after
  // them. The view prices from the locked rows themselves.
  const lockCart = loadCartRow(tx, tenantId, cartId, { forUpdate: true });
  const choke = tx`select pg_advisory_xact_lock(hashtext(${tenantId}))`.execute();
  const lockSettings = tx<StoreSettingsRow[]>`
    select * from store_settings where tenant_id = ${tenantId} for update
  `.then((rows) => rows[0] ?? null);
  const lockZones = loadZoneRows(tx, tenantId, { forUpdate: true });
  const [locked, , settings, zones, offer, cart] = await Promise.all([
    lockCart,
    choke,
    lockSettings,
    lockZones,
    onlineOffer(tx, tenantId, provider),
    loadCartView(tx, tenantId, cartId, now, {
      have: { cart: lockCart, settings: lockSettings, zones: lockZones },
    }),
  ]);
  // A completed cart must not mint a second order.
  if (cart.status !== 'open') {
    throw new HttpError(409, 'CART_NOT_OPEN', 'cart already checked out', {
      cartStatus: cart.status,
    });
  }
  // Re-validate modifier ids / kit picks against current defs — nothing retired slips through
  // underpriced. The order number rides along: numbering relies on the advisory lock above (else
  // two checkouts read the same max), and only this function inserts orders.
  const [found, number] = await Promise.all([
    getProductsById(
      tx,
      tenantId,
      cart.items.map((i) => i.productId),
      { forUpdate: true, tz: settings?.hours?.timezone || 'America/Sao_Paulo' },
    ),
    tx<{ n: number }[]>`
      select coalesce(max(number), 0) + 1 as n from orders where tenant_id = ${tenantId}
    `.then((rows) => rows[0]!.n),
  ]);
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
  // checkout charges what the cart showed: for the pin the cart holds, the leg stored with it
  // (none = the estimate it was priced on); a fresh leg only for a pin the cart never saw
  const storeAt = storeCoords(settings);
  const pin = validCoords(body.delivery.lat, body.delivery.lng);
  const held = validCoords(cart.delivery?.lat, cart.delivery?.lng);
  const stored = locked?.delivery_route ?? null;
  const route =
    pin && held && pin.lat === held.lat && pin.lng === held.lng
      ? storeAt && routeMatches(stored, storeAt, pin)
        ? stored
        : null
      : (opts.route ?? null);
  const match = validateCheckout(
    status,
    settings,
    cart,
    body,
    zones,
    products,
    storeAt,
    { card: offer.online },
    route,
  );
  const atTable = body.delivery.mode === 'dine_in';
  const table = atTable ? (opts.table ?? null) : null;
  if (atTable) {
    if (!table) throw new HttpError(404, 'TABLE_NOT_FOUND', 'this table QR is not valid anymore');
    if (!(settings?.pdv_qr_orders ?? true) || !(await planHas(tx, tenantId, 'pdv')))
      throw new HttpError(
        423,
        'TABLE_ORDERS_OFF',
        'this store is not taking orders from its tables',
      );
    if (body.payment.method === 'pix' && !(offer.online && offer.provider))
      throw new HttpError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'pix at a table is paid online', {
        field: 'payment.method',
      });
  }
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
  const phone = (body.customer.phone && normalizePhone(body.customer.phone)) || null;

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
    // a free delivery on a trip that costs nothing: no redemption to spend the reward on
    if (out.discountCents > 0) {
      if (!phone)
        throw new HttpError(422, 'INVALID_CUSTOMER', 'a coupon needs the phone number', {
          field: 'customer.phone',
        });
      discount = out.discountCents;
      if (row.kind !== 'free_delivery') itemDiscount = discount;
      coupon = { id: row.id, code: row.code };
    }
  }

  // from the locked settings row, before the payment is built: Pix/MP charge the adjusted total
  const paymentAdjustment = Math.max(
    paymentAdjustmentCents(subtotal, itemDiscount, adjustmentFor(settings, body.payment.method)),
    -(subtotal + deliveryFee - discount),
  );
  const total = subtotal + deliveryFee - discount + paymentAdjustment;
  if (subtotal > MAX_ORDER_CENTS || total > MAX_ORDER_CENTS)
    throw new HttpError(422, 'ORDER_TOO_LARGE', 'this order is larger than a store can take', {
      maxCents: MAX_ORDER_CENTS,
    });
  // a fee, coupon or payment adjustment that moved since the shopper's screen: nothing is written
  // yet, so the caller's committed refusal carries no side effect
  if (body.expectedTotalCents != null && body.expectedTotalCents !== total)
    throw new HttpError(409, 'PRICES_CHANGED', 'the total changed — review the order', {
      totalCents: total,
      expectedTotalCents: body.expectedTotalCents,
    });

  const stockDrawn = await drawStock(
    tx,
    tenantId,
    stockDemand(
      cart.items.map((i) => ({ productId: i.productId, qty: i.qty, combo: i.comboSelections })),
    ),
  );

  const orderId = crypto.randomUUID();
  const changeFor = body.payment.changeForCents ?? null;
  if (changeFor !== null) {
    if (
      body.payment.method !== 'cash' ||
      !Number.isInteger(changeFor) ||
      changeFor < total ||
      changeFor > MAX_CHANGE_CENTS
    )
      throw new HttpError(
        422,
        'INVALID_CHANGE',
        body.payment.method !== 'cash'
          ? 'change is only for cash payments'
          : `change must be for at least the total and at most ${MAX_CHANGE_CENTS} cents`,
        { field: 'payment.changeForCents', minCents: total, maxCents: MAX_CHANGE_CENTS },
      );
  }

  // online: Mercado Pago charges it when the shopper's page asks (POST /orders/:id/pay);
  // a store that isn't connected keeps today's static Pix from its own key
  const method = body.payment.method;
  const payment = {
    ...(method === 'tab'
      ? { provider: 'pdv', method: 'tab', status: 'pending', online: false }
      : offer.online && offer.provider && (method === 'pix' || method === 'card_online')
        ? onlinePayment(offer.provider, method, total)
        : offlinePayment(settings, method, total, number)),
    ...(changeFor !== null ? { changeForCents: changeFor } : {}),
  };
  const source = atTable ? 'table_qr' : (opts.source ?? 'storefront');

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
          ...(match.distanceSource ? { distanceSource: match.distanceSource } : {}),
          feeCents: deliveryFee,
          etaMin: match.zone?.eta_min_minutes ?? null,
          etaMax: match.zone?.eta_max_minutes ?? null,
          promisedFrom: scheduledFor ? null : at(match.zone?.eta_min_minutes ?? prep),
          promisedTo: scheduledFor ? null : at(match.zone?.eta_max_minutes ?? prep),
        }
      : atTable
        ? {
            mode: 'dine_in' as const,
            neighborhood: null,
            address: null,
            feeCents: 0,
            etaMin: null,
            etaMax: null,
            promisedFrom: at(prep),
            promisedTo: at(prep),
            table: table!.label,
            tabId: null as string | null,
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

  const customer = {
    name: body.customer.name.trim().slice(0, atTable ? 80 : 200),
    phone: body.customer.phone?.trim() ?? '',
  };
  // the table's comanda: the open one, or one opened by this first order (a waiter opening the
  // same table at the same moment wins the index, and the order joins theirs)
  let tabId: string | null = null;
  if (table) {
    tabId = table.tabId;
    // a waiter may open (or close) the table's comanda at the same moment: the index lets one
    // opening through; a comanda found that way is locked, and a closed one means open anew
    for (let tries = 0; !tabId && tries < 3; tries++) {
      const [opened] = await tx<{ id: string }[]>`
        insert into pdv_tabs (tenant_id, table_id, label, service_bps, service_fee, opened_by)
        values (${tenantId}, ${table.id}, ${table.label}, ${table.serviceBps}, ${table.serviceBps > 0},
                'QR da mesa')
        on conflict (tenant_id, table_id) where status = 'open' and table_id is not null do nothing
        returning id
      `;
      tabId =
        opened?.id ??
        (
          await tx<{ id: string; status: string }[]>`
            select id, status from pdv_tabs
            where tenant_id = ${tenantId} and table_id = ${table.id} and status = 'open'
            for update
          `
        ).find((r) => r.status === 'open')?.id ??
        null;
    }
    if (!tabId) throw new HttpError(409, 'TABLE_BUSY', 'the table changed — try again');
    // a prank stops at the staff, who accept every QR order; this keeps the queue short
    const waiting = (
      await tx<{ n: number }[]>`
        select count(*)::int as n from orders
        where tenant_id = ${tenantId} and tab_id = ${tabId} and source = 'table_qr'
          and state = 'placed'
      `
    )[0]!.n;
    if (waiting >= MAX_PENDING_AT_TABLE)
      throw new HttpError(
        429,
        'TABLE_ORDERS_PENDING',
        'this table has orders waiting for the staff',
        {
          pending: waiting,
        },
      );
    (delivery as { tabId?: string | null }).tabId = tabId;
  }
  await tx`
    insert into orders (id, tenant_id, cart_id, number, customer, customer_phone, delivery, payment, state,
                        subtotal_cents, delivery_fee_cents, discount_cents, payment_adjustment_cents,
                        total_cents, coupon_code, notes, scheduled_for, source, thread_id, tab_id,
                        stock_drawn)
    values (${orderId}, ${tenantId}, ${cartId}, ${number}, ${tx.json(customer)}, ${phone},
            ${tx.json(delivery as never)}, ${tx.json(payment as never)}, 'placed',
            ${subtotal}, ${deliveryFee}, ${discount}, ${paymentAdjustment}, ${total}, ${coupon?.code ?? null},
            ${body.notes?.trim() || null}, ${scheduledFor}, ${source}, ${opts.threadId ?? null}, ${tabId},
            ${tx.json(stockDrawn)})
  `;
  // the rest only needs the order row; one pipelined batch instead of a round trip per statement
  const [store] = await Promise.all([
    // the staff events' store name, whether this is its first order (counts the row above), and
    // whether the store has the WhatsApp sender or an auto printer the hooks below look for
    tx<{ name: string; orders: number; whatsapp: boolean; printers: boolean }[]>`
      select name,
        (select count(*) from (select 1 from orders where tenant_id = ${tenantId} limit 2) o)::int as orders,
        exists (select 1 from store_whatsapp where tenant_id = ${tenantId} and wanted) as whatsapp,
        exists (select 1 from printers where tenant_id = ${tenantId} and auto and present) as printers
      from tenants where id = ${tenantId}
    `.then((rows) => rows[0]),
    ...cart.items.map(
      (i, sort) => tx`
        insert into order_items (tenant_id, order_id, product_id, slug, name, qty, unit_price_cents,
                                 modifiers, combo, line_total_cents, sort, note)
        values (${tenantId}, ${orderId}, ${i.productId}, ${i.slug}, ${i.name}, ${i.qty}, ${i.unitPriceCents},
                ${tx.json(i.modifiers.map((m) => ({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents, qty: m.qty })))},
                ${tx.json(
                  i.combo.map((c) => ({
                    slotId: c.slotId,
                    slotName: c.slotName,
                    productId: c.productId,
                    name: c.name,
                    qty: c.qty,
                  })) as never,
                )},
                ${i.lineTotalCents}, ${sort}, ${i.note ?? null})
      `,
    ),
    coupon &&
      tx`
        insert into coupon_redemptions (tenant_id, coupon_id, order_id, phone, discount_cents)
        values (${tenantId}, ${coupon.id}, ${orderId}, ${phone}, ${discount})
      `,
    tx`
      insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
      values (${tenantId}, ${orderId}, null, 'placed', 'customer', ${tx.json({ via: source })})
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
    // a QR order lands on its table's comanda (ADR 0036)
    tabId && emitAdminTx(tx, tenantId, 'pdv', tabId),
  ]);

  // staff events (ADR 0023) after the batch: each one is a savepoint, which must not interleave
  // with other statements of this tx
  const storeName = store?.name ?? '';
  await recordStaffEventTx(
    tx,
    'order.placed',
    {
      orderId,
      number,
      storeName,
      totalCents: total,
      method,
      fulfillment: delivery.mode,
      items: cart.items.reduce((n, i) => n + i.qty, 0),
      scheduledFor,
    },
    { tenantId },
  );
  if (store?.orders === 1) {
    await recordStaffEventTx(
      tx,
      'store.first_order',
      { orderId, number, storeName, totalCents: total, method },
      { tenantId, dedupeKey: `first_order:${tenantId}` },
    );
    await recordStaffEventTx(
      tx,
      'store.onboarding',
      { step: 'first_order' },
      { tenantId, dedupeKey: `onboarding:${tenantId}:first_order` },
    );
  }
  // each hook re-checks everything in a savepoint of its own; the flags only skip a store that
  // has neither, which is what their first read would have found
  if (store?.whatsapp !== false) await enqueueOrderMessageTx(tx, tenantId, orderId, 'placed');
  if (store?.printers !== false) await enqueueOrderPrintTx(tx, tenantId, orderId, 'placed');
  return orderId;
}
