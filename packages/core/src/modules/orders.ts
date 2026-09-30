import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { mintLoyaltyRewards } from './customer.ts';
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

export function canTransition(from: OrderState, to: OrderState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface OrderRow {
  id: string;
  number: number;
  state: OrderState;
  customer: { name: string; phone: string };
  delivery: {
    mode: 'pickup' | 'delivery';
    neighborhood?: string;
    address?: string;
    addressParts?: Record<string, string | null>;
    zoneName?: string | null;
    distanceKm?: number | null;
    feeCents?: number;
    etaMin?: number;
    etaMax?: number;
    promisedFrom?: string | null;
    promisedTo?: string | null;
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
  };
  subtotal_cents: number;
  delivery_fee_cents: number;
  discount_cents: number;
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
  modifiers: { name: string; priceDeltaCents: number }[];
  combo: { slotName: string; name: string; qty: number }[];
  lineTotalCents: number;
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

export async function loadOrderView(
  tx: Sql,
  tenantId: string,
  orderId: string,
  /** Session-scope: only the cart that produced the order may read it. */
  cartId?: string,
): Promise<OrderView> {
  const rows = await tx<OrderRow[]>`
    select id, number, state, customer, delivery, payment, subtotal_cents, delivery_fee_cents,
           discount_cents, total_cents, coupon_code, notes, scheduled_for::text as scheduled_for,
           placed_at, updated_at, rev
    from orders where tenant_id = ${tenantId} and id = ${orderId}
    ${cartId ? tx`and cart_id = ${cartId}` : tx``}
  `;
  const order = rows[0];
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  const events = await tx<
    {
      at: string;
      from_state: string | null;
      to_state: string;
      actor: string;
      meta: Record<string, unknown>;
    }[]
  >`
    select at, from_state, to_state, actor, meta from order_events
    where tenant_id = ${tenantId} and order_id = ${orderId} order by at, id
  `;
  const items = await tx<
    {
      product_id: string | null;
      slug: string;
      name: string;
      qty: number;
      unit_price_cents: number;
      modifiers: { name: string; priceDeltaCents: number }[];
      combo: { slotName: string; name: string; qty: number }[];
      line_total_cents: number;
    }[]
  >`
    select product_id, slug, name, qty, unit_price_cents, modifiers, combo, line_total_cents
    from order_items where tenant_id = ${tenantId} and order_id = ${orderId} order by sort
  `;
  return {
    id: order.id,
    number: order.number,
    state: order.state,
    customer: order.customer,
    delivery: order.delivery,
    payment: order.payment,
    items: items.map((i) => ({
      productId: i.product_id,
      slug: i.slug,
      name: i.name,
      qty: i.qty,
      unitPriceCents: i.unit_price_cents,
      modifiers: i.modifiers.map((m) => ({ name: m.name, priceDeltaCents: m.priceDeltaCents })),
      combo: i.combo.map((c) => ({ slotName: c.slotName, name: c.name, qty: c.qty })),
      lineTotalCents: i.line_total_cents,
    })),
    notes: order.notes,
    scheduledFor: order.scheduled_for,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    discountCents: order.discount_cents,
    coupon: order.coupon_code ? { code: order.coupon_code } : null,
    totalCents: order.total_cents,
    placedAt: order.placed_at,
    updatedAt: order.updated_at,
    version: events.length + order.rev,
    timeline: events.map((e) => ({
      at: e.at,
      from: e.from_state,
      to: e.to_state,
      actor: e.actor,
      meta: e.meta,
    })),
  };
}

/** Applies a transition inside the tenant tx — order update + event + outbox commit atomically. */
export async function transitionOrder(
  tx: Sql,
  tenantId: string,
  orderId: string,
  to: OrderState,
  actor: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const rows = await tx<{ state: OrderState; customer_phone: string | null }[]>`
    select state, customer_phone from orders where tenant_id = ${tenantId} and id = ${orderId} for update
  `;
  const order = rows[0];
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  if (!canTransition(order.state, to)) {
    throw new HttpError(409, 'INVALID_ORDER_TRANSITION', `cannot move ${order.state} → ${to}`);
  }
  await tx`update orders set state = ${to}, updated_at = now() where id = ${orderId}`;
  await tx`
    insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
    values (${tenantId}, ${orderId}, ${order.state}, ${to}, ${actor}, ${tx.json(meta as never)})
  `;
  await tx`
    insert into outbox (tenant_id, topic, payload)
    values (${tenantId}, ${'order.' + to}, ${tx.json({ orderId, from: order.state, to })})
  `;
  if (to === 'cancelled') await restoreStock(tx, tenantId, orderId);
  if (to === 'delivered') await mintLoyaltyRewards(tx, tenantId, order.customer_phone);
  // delivered on commit — live waiters (order-live.ts) wake then, never on a rolled-back change
  await tx`select pg_notify(${ORDER_CHANNEL}, ${orderId})`;
  await emitAdminTx(tx, tenantId, 'order.changed', orderId);
}
