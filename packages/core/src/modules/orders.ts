import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

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
    feeCents?: number;
    etaMin?: number;
    etaMax?: number;
  };
  payment: { provider: string; method: string; status: string; instructions?: string };
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
  placed_at: string;
}

export interface OrderView {
  id: string;
  number: number;
  state: OrderState;
  customer: OrderRow['customer'];
  delivery: OrderRow['delivery'];
  payment: OrderRow['payment'];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  placedAt: string;
  timeline: {
    at: string;
    from: string | null;
    to: string;
    actor: string;
    meta: Record<string, unknown>;
  }[];
}

export async function loadOrderView(
  tx: Sql,
  tenantId: string,
  orderId: string,
  /** Session-scope: only the cart that produced the order may read it. */
  cartId?: string,
): Promise<OrderView> {
  const rows = await tx<OrderRow[]>`
    select id, number, state, customer, delivery, payment,
           subtotal_cents, delivery_fee_cents, total_cents, placed_at
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
    where tenant_id = ${tenantId} and order_id = ${orderId} order by at
  `;
  return {
    id: order.id,
    number: order.number,
    state: order.state,
    customer: order.customer,
    delivery: order.delivery,
    payment: order.payment,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    totalCents: order.total_cents,
    placedAt: order.placed_at,
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
  const rows = await tx<{ state: OrderState }[]>`
    select state from orders where tenant_id = ${tenantId} and id = ${orderId} for update
  `;
  const order = rows[0];
  if (!order) throw new HttpError(404, 'ORDER_NOT_FOUND', 'order not found');
  if (!canTransition(order.state, to)) {
    throw new HttpError(409, 'INVALID_ORDER_TRANSITION', `cannot move ${order.state} → ${to}`);
  }
  await tx`update orders set state = ${to} where id = ${orderId}`;
  await tx`
    insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
    values (${tenantId}, ${orderId}, ${order.state}, ${to}, ${actor}, ${tx.json(meta as never)})
  `;
  await tx`
    insert into outbox (tenant_id, topic, payload)
    values (${tenantId}, ${'order.' + to}, ${tx.json({ orderId, from: order.state, to })})
  `;
}
