import { emitAdminTx } from '../../admin/live.ts';
import type { Sql } from '../../platform/db.ts';
import { transitionOrder, type OrderState } from '../orders.ts';
import { enqueueOrderPrintTx } from '../printing/jobs.ts';
import { recordStaffEventTx } from '../staff-events.ts';
import { drawStock, stockDemand } from '../stock.ts';
import type { PdvMethod, PricedPdvLine } from './pricing.ts';

/**
 * Checkout's lock: order numbers are max + 1 under it, and it is taken before any product row
 * (placeOrderTx's order), so a sale and a checkout never wait on each other in a cycle.
 */
export async function lockOrderNumbers(tx: Sql, tenantId: string) {
  await tx`select pg_advisory_xact_lock(hashtext(${tenantId}))`;
}

export interface PdvOrderIn {
  lines: PricedPdvLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  mode: 'pickup' | 'dine_in' | 'delivery';
  /** mode 'delivery': the order's delivery jsonb (deliveryJson) */
  delivery?: Record<string, unknown> & { feeCents: number };
  table: string | null;
  tabId: string | null;
  customer: { name: string; phone: string | null };
  notes: string | null;
  payment: Record<string, unknown>;
  /** the staff member's name, for the timeline */
  by: string;
  serveNow: boolean;
  prepMinutes: number;
}

const WALK: OrderState[] = ['preparing', 'ready', 'delivered'];

/**
 * A counter sale or a comanda's round: born `placed` and accepted in the same transaction, so
 * Pedidos, the kitchen and the printers take it like any accepted order. The caller holds
 * lockOrderNumbers and priced the lines under the product locks.
 */
export async function insertPdvOrderTx(
  tx: Sql,
  tenantId: string,
  o: PdvOrderIn,
): Promise<{ id: string; number: number }> {
  await drawStock(
    tx,
    tenantId,
    stockDemand(o.lines.map((l) => ({ productId: l.productId, qty: l.qty, combo: l.price.picks }))),
  );
  const number = (
    await tx<{ n: number }[]>`
      select coalesce(max(number), 0) + 1 as n from orders where tenant_id = ${tenantId}
    `
  )[0]!.n;
  const id = crypto.randomUUID();
  const promised = o.serveNow ? null : new Date(Date.now() + o.prepMinutes * 60_000).toISOString();
  const delivery = o.delivery ?? {
    mode: o.mode,
    neighborhood: null,
    address: null,
    feeCents: 0,
    etaMin: null,
    etaMax: null,
    promisedFrom: promised,
    promisedTo: promised,
    ...(o.mode === 'dine_in' ? { table: o.table, tabId: o.tabId } : {}),
  };
  await tx`
    insert into orders (id, tenant_id, cart_id, number, customer, customer_phone, delivery, payment, state,
                        subtotal_cents, delivery_fee_cents, discount_cents, payment_adjustment_cents,
                        total_cents, coupon_code, notes, scheduled_for, source, tab_id)
    values (${id}, ${tenantId}, null, ${number},
            ${tx.json({ name: o.customer.name, phone: o.customer.phone ?? '' })}, ${o.customer.phone},
            ${tx.json(delivery as never)}, ${tx.json(o.payment as never)}, 'placed',
            ${o.subtotalCents}, ${o.delivery?.feeCents ?? 0}, ${o.discountCents}, 0, ${o.totalCents}, null, ${o.notes}, null,
            'pdv', ${o.tabId})
  `;
  const [store] = await Promise.all([
    tx<{ name: string; printers: boolean }[]>`
      select name,
        exists (select 1 from printers where tenant_id = ${tenantId} and auto and present) as printers
      from tenants where id = ${tenantId}
    `.then((rows) => rows[0]),
    ...o.lines.map(
      (l, sort) => tx`
        insert into order_items (tenant_id, order_id, product_id, slug, name, qty, unit_price_cents,
                                 modifiers, combo, line_total_cents, sort, note)
        values (${tenantId}, ${id}, ${l.productId}, ${l.slug}, ${l.name}, ${l.qty}, ${l.unitPriceCents},
                ${tx.json(l.price.snapshot.map((m) => ({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents, qty: m.qty ?? 1 })))},
                ${tx.json(
                  l.price.picks.map((c) => ({
                    slotId: c.slotId,
                    slotName: c.slotName,
                    productId: c.productId,
                    name: c.name,
                    qty: c.qty,
                  })) as never,
                )},
                ${l.lineTotalCents}, ${sort}, ${l.note})
      `,
    ),
    tx`
      insert into order_events (tenant_id, order_id, from_state, to_state, actor, meta)
      values (${tenantId}, ${id}, null, 'placed', 'merchant', ${tx.json({ via: 'pdv', by: o.by })})
    `,
    tx`
      insert into outbox (tenant_id, topic, payload)
      values (${tenantId}, 'order.placed', ${tx.json({ orderId: id, number })})
    `,
    // order.changed, not order.placed: nobody has to accept it, so no chime and no push
    emitAdminTx(tx, tenantId, 'order.changed', id),
  ]);
  await recordStaffEventTx(
    tx,
    'order.placed',
    {
      orderId: id,
      number,
      storeName: store?.name ?? '',
      totalCents: o.totalCents,
      method: String(o.payment.method ?? ''),
      fulfillment: o.mode,
      items: o.lines.reduce((n, l) => n + l.qty, 0),
      scheduledFor: null,
    },
    { tenantId },
  );
  if (store?.printers !== false) await enqueueOrderPrintTx(tx, tenantId, id, 'placed');
  const meta = { by: o.by, via: 'pdv' };
  await transitionOrder(tx, tenantId, id, 'confirmed', 'merchant', meta);
  if (o.serveNow)
    for (const to of WALK) await transitionOrder(tx, tenantId, id, to, 'merchant', meta);
  return { id, number };
}

/** One method, or 'mixed' with the breakdown in `pdv`. */
export function paidPayment(
  payments: { method: PdvMethod; amountCents: number }[],
  by: string,
  now = new Date(),
) {
  const methods = [...new Set(payments.map((p) => p.method))];
  const sums = methods.map((method) => ({
    method,
    cents: payments.filter((p) => p.method === method).reduce((n, p) => n + p.amountCents, 0),
  }));
  return {
    provider: 'pdv',
    method: methods.length === 1 ? methods[0]! : 'mixed',
    status: 'paid',
    online: false,
    paidAt: now.toISOString(),
    confirmedBy: by,
    pdv: sums,
  };
}

export const TAB_PAYMENT = { provider: 'pdv', method: 'tab', status: 'pending', online: false };

/** Walks an order to delivered from wherever it stands; a terminal one is left alone. */
export async function deliverTx(tx: Sql, tenantId: string, orderId: string, by: string) {
  const [row] = await tx<{ state: OrderState }[]>`
    select state from orders where tenant_id = ${tenantId} and id = ${orderId}
  `;
  const path: OrderState[] = ['confirmed', 'preparing', 'ready', 'delivered'];
  const at = row ? path.indexOf(row.state) : -1;
  const from = row?.state === 'placed' ? 0 : at < 0 ? path.length : at + 1;
  for (const to of path.slice(from))
    await transitionOrder(tx, tenantId, orderId, to, 'merchant', { by, via: 'pdv' });
}
