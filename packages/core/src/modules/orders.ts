import { createHmac, timingSafeEqual } from 'node:crypto';
import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError, verifySessionToken } from '../platform/http.ts';
import { mintLoyaltyRewards } from './customer.ts';
import { enqueueOrderMessageTx, isOrderEvent } from '../store-whatsapp/messages.ts';
import { enqueueOrderPrintTx } from './printing/jobs.ts';
import { recordStaffEventTx, type OrderStep } from './staff-events.ts';
import { restoreStock } from './stock.ts';

export const ORDER_STATES = [
  'placed',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const TRANSITIONS: Record<OrderState, OrderState[]> = {
  placed: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['refunded'],
  cancelled: [],
  refunded: [],
};

export const TERMINAL_STATES: ReadonlySet<string> = new Set(['delivered', 'cancelled', 'refunded']);

/** LISTEN channel for order changes — payload is the order id (see order-live.ts). */
export const ORDER_CHANNEL = 'vendua_order';

/** dine_in: taken at the PDV, eaten at the store (ADR 0035) */
export type DeliveryMode = 'pickup' | 'delivery' | 'dine_in';

/** only a delivery goes out: pickup and dine-in orders are handed over at the store */
function modeAllows(to: OrderState, mode: DeliveryMode): boolean {
  return to !== 'out_for_delivery' || mode === 'delivery';
}

export function canTransition(from: OrderState, to: OrderState, mode: DeliveryMode): boolean {
  return TRANSITIONS[from].includes(to) && modeAllows(to, mode);
}

export interface OrderRow {
  id: string;
  number: number;
  state: OrderState;
  customer: { name: string; phone: string };
  delivery: {
    mode: DeliveryMode;
    neighborhood?: string;
    address?: string;
    addressParts?: Record<string, string | null>;
    zoneName?: string | null;
    distanceKm?: number | null;
    /** distance pricing: road route, or the straight line × detour factor */
    distanceSource?: 'route' | 'estimate';
    feeCents?: number;
    etaMin?: number;
    etaMax?: number;
    promisedFrom?: string | null;
    promisedTo?: string | null;
    /** minutes the store pushed the promise back after accepting ("atrasou"), summed */
    delayMinutes?: number;
    /** dine_in: the table's label (null at the counter) and its comanda */
    table?: string | null;
    tabId?: string | null;
  };
  payment: {
    /** 'sandbox' (offline methods — no provider) | 'mercadopago' | 'fake'; branch on `online` */
    provider: string;
    method: string;
    status: string;
    /** charged through the provider (webhook-confirmed); false = the store confirms by hand */
    online?: boolean;
    instructions?: string;
    paidAt?: string | null;
    confirmedBy?: string | null;
    refundedCents?: number;
    pix?: {
      key?: string;
      keyType?: string;
      beneficiary?: string;
      copyPaste: string;
      expiresAt?: string | null;
    } | null;
    redirectUrl?: string | null;
    /** cash: the note the shopper pays with; null = exact money or not cash */
    changeForCents?: number | null;
  };
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
  payment_adjustment_cents: number;
  total_cents: number;
  coupon_code: string | null;
  notes: string | null;
  scheduled_for: string | null;
  placed_at: string;
  updated_at: string;
  /** bumps on payment changes (migration 0054) */
  rev: number;
}

export interface OrderItemView {
  productId: string | null;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  modifiers: { name: string; priceDeltaCents: number; qty: number }[];
  combo: { slotName: string; name: string; qty: number }[];
  lineTotalCents: number;
  /** the shopper's note for this line ("sem cebola"); null = none */
  note?: string | null;
}

export interface OrderView {
  id: string;
  number: number;
  state: OrderState;
  customer: OrderRow['customer'];
  delivery: OrderRow['delivery'];
  payment: OrderRow['payment'];
  items: OrderItemView[];
  notes: string | null;
  scheduledFor: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  /** the payment method's discount (<0) or surcharge (>0), migration 0067 */
  paymentAdjustmentCents: number;
  coupon: { code: string } | null;
  totalCents: number;
  placedAt: string;
  updatedAt: string;
  /** order_events + orders.rev: bumps on every transition and payment change — the live cursor */
  version: number;
  timeline: {
    at: string;
    from: string | null;
    to: string;
    actor: string;
    meta: Record<string, unknown>;
  }[];
}

export async function orderVersion(tx: Sql, tenantId: string, orderId: string): Promise<number> {
  return (
    (
      await tx<{ n: number }[]>`
      select (select count(*) from order_events e where e.tenant_id = ${tenantId} and e.order_id = o.id)::int
             + o.rev as n
      from orders o where o.tenant_id = ${tenantId} and o.id = ${orderId}
    `
    )[0]?.n ?? 0
  );
}

type OrderViewRow = OrderRow & {
  events: {
    at: string;
    from_state: string | null;
    to_state: string;
    actor: string;
    meta: Record<string, unknown>;
  }[];
  items: {
    product_id: string | null;
    slug: string;
    name: string;
    qty: number;
    unit_price_cents: number;
    modifiers: { name: string; priceDeltaCents: number; qty?: number }[];
    combo: { slotName: string; name: string; qty: number }[];
    line_total_cents: number;
    note: string | null;
  }[];
};

/** Orders with their items and timeline, one statement for any number of them; `where` filters
 *  `orders o` (the tenant is already applied). */
function orderViewRows(tx: Sql, tenantId: string, where: ReturnType<Sql>) {
  // events and items only count once the order (and its session) checks out
  return tx<OrderViewRow[]>`
    select o.id, o.number, o.state, o.customer, o.delivery, o.payment, o.subtotal_cents,
           o.delivery_fee_cents, o.discount_cents, o.payment_adjustment_cents, o.total_cents,
           o.coupon_code, o.notes, o.scheduled_for::text as scheduled_for,
           o.placed_at, o.updated_at, o.rev,
           (select coalesce(json_agg(e order by e.at, e.id), '[]')
            from (select id, at, from_state, to_state, actor, meta from order_events
                  where tenant_id = o.tenant_id and order_id = o.id) e) as events,
           (select coalesce(json_agg(i order by i.sort), '[]')
            from (select sort, product_id, slug, name, qty, unit_price_cents, modifiers, combo,
                         line_total_cents, note
                  from order_items where tenant_id = o.tenant_id and order_id = o.id) i) as items
    from orders o where o.tenant_id = ${tenantId} ${where}
  `;
}

export async function loadOrderView(
  tx: Sql,
  tenantId: string,
  orderId: string,
  /** Session-scope: only the cart that produced the order may read it. */
  cartId?: string,
): Promise<OrderView> {
  const rows = await orderViewRows(
    tx,
    tenantId,
    tx`and o.id = ${orderId} ${cartId ? tx`and o.cart_id = ${cartId}` : tx``}`,
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  return orderViewOf(order);
}

/** Several orders' views in one statement, in the order of `ids`; an id with no order is left out. */
export async function loadOrderViews(
  tx: Sql,
  tenantId: string,
  ids: readonly string[],
): Promise<OrderView[]> {
  if (ids.length === 0) return [];
  const rows = await orderViewRows(tx, tenantId, tx`and o.id = any(${ids as string[]}::uuid[])`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [orderViewOf(row)] : [];
  });
}

function orderViewOf(order: OrderViewRow): OrderView {
  const { events, items } = order;
  return {
    id: order.id,
    number: order.number,
    state: order.state,
    customer: order.customer,
    delivery: order.delivery,
    payment: { ...order.payment, changeForCents: order.payment.changeForCents ?? null },
    items: items.map((i) => ({
      productId: i.product_id,
      slug: i.slug,
      name: i.name,
      qty: i.qty,
      unitPriceCents: i.unit_price_cents,
      modifiers: i.modifiers.map((m) => ({
        name: m.name,
        priceDeltaCents: m.priceDeltaCents,
        qty: m.qty ?? 1,
      })),
      combo: i.combo.map((c) => ({ slotName: c.slotName, name: c.name, qty: c.qty })),
      lineTotalCents: i.line_total_cents,
      note: i.note ?? null,
    })),
    notes: order.notes,
    scheduledFor: order.scheduled_for,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    discountCents: order.discount_cents,
    paymentAdjustmentCents: order.payment_adjustment_cents,
    coupon: order.coupon_code ? { code: order.coupon_code } : null,
    totalCents: order.total_cents,
    placedAt: order.placed_at,
    updatedAt: order.updated_at,
    version: events.length + order.rev,
    timeline: events.map((e) => ({
      // the format a timestamptz column serialized as before (json_agg writes its own offset)
      at: new Date(e.at).toISOString(),
      from: e.from_state,
      to: e.to_state,
      actor: e.actor,
      meta: e.meta,
    })),
  };
}

// Order tracking links (the store's WhatsApp updates): `vot.<orderId>.<exp>.<sig>` reads the
// order's status and nothing else — never the cart session, which would also pay and reorder.

const TRACK_PREFIX = 'vot';
const TRACK_TTL_S = 30 * 24 * 3600;

const trackSig = (secret: string, tenantId: string, orderId: string, exp: number) =>
  createHmac('sha256', `${secret}:order-track`)
    .update(`${TRACK_PREFIX}|${tenantId}|${orderId}|${exp}`)
    .digest('base64url');

/** A status-only link credential for one order, good for 30 days after it was placed. */
export function orderTrackToken(
  secret: string,
  tenantId: string,
  orderId: string,
  placedAt: Date | string,
): string {
  const exp = Math.floor(new Date(placedAt).getTime() / 1000) + TRACK_TTL_S;
  return `${TRACK_PREFIX}.${orderId}.${exp}.${trackSig(secret, tenantId, orderId, exp)}`;
}

/** The order id a tracking token names, or null (malformed, another store's, expired). */
export function verifyOrderTrackToken(
  token: string,
  secret: string,
  tenantId: string,
  now = new Date(),
): string | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TRACK_PREFIX) return null;
  const [, orderId, expRaw, sig] = parts as [string, string, string, string];
  const exp = Number(expRaw);
  if (!/^[0-9a-f-]{36}$/.test(orderId) || !/^\d{1,12}$/.test(expRaw)) return null;
  // an order is never placed in the future: no token may outlive a fresh one
  if (exp * 1000 < now.getTime() || exp * 1000 > now.getTime() + TRACK_TTL_S * 1000) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(trackSig(secret, tenantId, orderId, exp));
  return a.length === b.length && timingSafeEqual(a, b) ? orderId : null;
}

/** What a tracking link shows: where the order stands and what was ordered — no customer,
 *  address, payment, money, order notes or who moved it. */
export interface OrderStatusView {
  statusOnly: true;
  id: string;
  number: number;
  state: OrderState;
  storeName: string;
  delivery: {
    mode: DeliveryMode;
    promisedFrom: string | null;
    promisedTo: string | null;
    etaMin: number | null;
    etaMax: number | null;
    /** dine_in: the table's label (ADR 0036) */
    table?: string | null;
  };
  scheduledFor: string | null;
  placedAt: string;
  updatedAt: string;
  version: number;
  timeline: { at: string; to: string }[];
  items: {
    name: string;
    qty: number;
    modifiers: { name: string; qty: number }[];
    combo: { slotName: string; name: string; qty: number }[];
    note: string | null;
  }[];
}

/** Whitelists the fields a tracking link may read (never spread the full view into it). */
export function orderStatusOf(o: OrderView, storeName: string): OrderStatusView {
  const d = o.delivery;
  return {
    statusOnly: true,
    id: o.id,
    number: o.number,
    state: o.state,
    storeName,
    delivery: {
      mode: d.mode,
      promisedFrom: d.promisedFrom ?? null,
      promisedTo: d.promisedTo ?? null,
      etaMin: d.etaMin ?? null,
      etaMax: d.etaMax ?? null,
      ...(d.mode === 'dine_in' ? { table: d.table ?? null } : {}),
    },
    scheduledFor: o.scheduledFor,
    placedAt: new Date(o.placedAt).toISOString(),
    updatedAt: new Date(o.updatedAt).toISOString(),
    version: o.version,
    timeline: o.timeline.map((e) => ({ at: e.at, to: e.to })),
    items: o.items.map((i) => ({
      name: i.name,
      qty: i.qty,
      modifiers: i.modifiers.map((m) => ({ name: m.name, qty: m.qty })),
      combo: i.combo.map((c) => ({ slotName: c.slotName, name: c.name, qty: c.qty })),
      note: i.note ?? null,
    })),
  };
}

export async function loadOrderStatusView(
  tx: Sql,
  tenantId: string,
  orderId: string,
): Promise<OrderStatusView> {
  const [view, store] = await Promise.all([
    loadOrderView(tx, tenantId, orderId),
    tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`,
  ]);
  return orderStatusOf(view, store[0]?.name ?? '');
}

/** The checkout's order reads: the cart session that placed it reads it all; a tracking link,
 *  only that order's status. */
export type StorefrontOrderAccess = { cartId: string } | { statusOnly: true };

export async function storefrontOrderAccess(
  authorization: string | undefined,
  tenantId: string,
  orderId: string,
  secret: string,
): Promise<StorefrontOrderAccess> {
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (token.startsWith(`${TRACK_PREFIX}.`)) {
    // one answer for a bad, expired or other order's link
    if (verifyOrderTrackToken(token, secret, tenantId) !== orderId)
      throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
    return { statusOnly: true };
  }
  const cartId = token ? await verifySessionToken(token, tenantId, secret) : null;
  if (!cartId) throw new HttpError(401, 'SESSION_REQUIRED', 'a valid session token is required');
  return { cartId };
}

export function readStorefrontOrder(
  tx: Sql,
  tenantId: string,
  orderId: string,
  access: StorefrontOrderAccess,
): Promise<OrderView | OrderStatusView> {
  return 'cartId' in access
    ? loadOrderView(tx, tenantId, orderId, access.cartId)
    : loadOrderStatusView(tx, tenantId, orderId);
}

/** The order's staff card (ADR 0023) moves on — at most once per order and step. */
export async function recordOrderStep(
  tx: Sql,
  tenantId: string,
  order: { id: string; number: number },
  to: OrderStep,
  actor: string | null,
): Promise<void> {
  const store = (await tx<{ name: string }[]>`select name from tenants where id = ${tenantId}`)[0];
  await recordStaffEventTx(
    tx,
    'order.updated',
    { orderId: order.id, number: order.number, storeName: store?.name ?? '', to, actor },
    { tenantId, dedupeKey: `order:${order.id}:${to}` },
  );
}

/** the steps the staff card shows; the kitchen's intermediate ones would only be noise */
const STAFF_STEPS: ReadonlySet<OrderState> = new Set(['delivered', 'cancelled', 'refunded']);

/** Applies a transition inside the tenant tx — order update + event + outbox commit atomically. */
export async function transitionOrder(
  tx: Sql,
  tenantId: string,
  orderId: string,
  to: OrderState,
  actor: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  // the lock also reads whether the store has the WhatsApp sender or an auto printer: the hooks
  // below re-check everything in a savepoint of their own, the flags only skip a store with neither
  const rows = await tx<
    {
      state: OrderState;
      mode: DeliveryMode;
      customer_phone: string | null;
      number: number;
      online: boolean;
      total_cents: number;
      whatsapp: boolean;
      printers: boolean;
    }[]
  >`
    select state, delivery ->> 'mode' as mode, customer_phone, number,
      coalesce((payment ->> 'online')::boolean, false) as online, total_cents,
      exists (select 1 from store_whatsapp w where w.tenant_id = ${tenantId} and w.wanted) as whatsapp,
      exists (select 1 from printers p where p.tenant_id = ${tenantId} and p.auto and p.present) as printers
    from orders where tenant_id = ${tenantId} and id = ${orderId} for update
  `;
  const order = rows[0];
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  if (!canTransition(order.state, to, order.mode)) {
    const why = `cannot move ${order.state} → ${to}`;
    // 409: the order moved on (a stale screen); 422: this order can never take that step
    throw modeAllows(to, order.mode)
      ? new HttpError(409, 'INVALID_ORDER_TRANSITION', why)
      : new HttpError(422, 'INVALID_ORDER_TRANSITION', `${why} on a ${order.mode} order`);
  }
  // one batch, executed in this order; the notifies are delivered on commit — live waiters
  // (order-live.ts) and the admin wake then, never on a rolled-back change
  await Promise.all([
    tx`update orders set state = ${to}, updated_at = now() where id = ${orderId}`.execute(),
    tx`
      insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
      values (${tenantId}, ${orderId}, ${order.state}, ${to}, ${actor}, ${tx.json(meta as never)})
    `.execute(),
    tx`
      insert into outbox (tenant_id, topic, payload)
      values (${tenantId}, ${'order.' + to}, ${tx.json({ orderId, from: order.state, to })})
    `.execute(),
    tx`select pg_notify(${ORDER_CHANNEL}, ${orderId})`.execute(),
    emitAdminTx(tx, tenantId, 'order.changed', orderId),
  ]);
  if (to === 'cancelled') {
    await restoreStock(tx, tenantId, orderId);
    // a counter sale's money leaves the drawer with it, while its caixa is still open (held, so
    // it can't close in between and lose the void from what it counted)
    const [caixa] = await tx<{ id: string }[]>`
      select id from cash_sessions where tenant_id = ${tenantId} and closed_at is null for share
    `;
    if (caixa)
      await tx`
        update pdv_payments set voided_at = now(), voided_by = ${String(meta.by ?? actor).slice(0, 80)},
          void_reason = 'pedido cancelado'
        where tenant_id = ${tenantId} and order_id = ${orderId} and voided_at is null
          and session_id = ${caixa.id}
      `;
  }
  if (to === 'delivered') await mintLoyaltyRewards(tx, tenantId, order.customer_phone);
  if (STAFF_STEPS.has(to))
    await recordOrderStep(
      tx,
      tenantId,
      { id: orderId, number: order.number },
      to as OrderStep,
      actor,
    );
  // the shopper hears it from the store's own WhatsApp (ADR 0026), when the store turned it on.
  // Money refunded online is told when it lands (syncOrderPayment); a refund the store made
  // itself is the whole order, told here.
  if (to === 'refunded') {
    if (order.whatsapp && !order.online)
      await enqueueOrderMessageTx(tx, tenantId, orderId, 'refunded', {
        occurrence: String(order.total_cents),
        refund: { cents: order.total_cents, full: true, online: false },
      });
  } else if (isOrderEvent(to) && order.whatsapp)
    await enqueueOrderMessageTx(tx, tenantId, orderId, to);
  // the kitchen ticket, on the step the store prints at (ADR 0027)
  if (to === 'confirmed' && order.printers)
    await enqueueOrderPrintTx(tx, tenantId, orderId, 'confirmed');
}
