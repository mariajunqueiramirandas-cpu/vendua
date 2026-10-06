import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

// Stock (roadmap 2b). null stock = not tracked. Checkout draws the demand of every
// line — a kit draws its picked items — under row locks; cancelling gives it back,
// and a sold-out product that gets stock again wakes its waitlist.

export interface DemandLine {
  productId: string;
  qty: number;
  combo?: { productId: string; qty: number }[];
}

/** productId → units needed across the cart (direct lines + kit picks × kit qty). */
export function stockDemand(lines: DemandLine[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, n: number) => out.set(id, (out.get(id) ?? 0) + n);
  for (const l of lines) {
    add(l.productId, l.qty);
    for (const p of l.combo ?? []) add(p.productId, p.qty * l.qty);
  }
  return out;
}

export function shortfall(
  demand: Map<string, number>,
  stock: Map<string, { name: string; stock: number | null }>,
): HttpError | null {
  for (const [id, need] of demand) {
    const s = stock.get(id);
    if (!s || s.stock == null) continue;
    if (need > s.stock)
      return new HttpError(
        409,
        'OUT_OF_STOCK',
        s.stock === 0 ? `"${s.name}" is sold out` : `only ${s.stock} of "${s.name}" left`,
        { productId: id, available: s.stock },
      );
  }
  return null;
}

async function lockStock(tx: Sql, tenantId: string, ids: string[]) {
  const rows = await tx<{ id: string; name: string; stock_quantity: number | null }[]>`
    select id, name, stock_quantity from products
    where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
    order by id
    for update
  `;
  return new Map(rows.map((r) => [r.id, { name: r.name, stock: r.stock_quantity }]));
}

/** Check-and-draw inside the checkout tx; throws OUT_OF_STOCK before touching anything. */
export async function drawStock(tx: Sql, tenantId: string, demand: Map<string, number>) {
  const ids = [...demand.keys()];
  if (ids.length === 0) return;
  const stock = await lockStock(tx, tenantId, ids);
  const short = shortfall(demand, stock);
  if (short) throw short;
  // the rows are locked above; the updates go out as one batch
  await Promise.all(
    [...demand]
      .filter(([id]) => stock.get(id)?.stock != null)
      .map(
        ([id, need]) => tx`
          update products set stock_quantity = stock_quantity - ${need}
          where tenant_id = ${tenantId} and id = ${id}
        `,
      ),
  );
}

/** Best-effort early check (add/patch) so the customer hears about it before checkout.
 *  `known`: products the caller already read in this tx; only the rest are read here. */
export async function assertStock(
  tx: Sql,
  tenantId: string,
  demand: Map<string, number>,
  known: Map<string, { name: string; stock: number | null }> = new Map(),
) {
  const ids = [...demand.keys()].filter((id) => !known.has(id));
  const rows = ids.length
    ? await tx<{ id: string; name: string; stock_quantity: number | null }[]>`
        select id, name, stock_quantity from products where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
      `
    : [];
  const stock = new Map(known);
  for (const r of rows) stock.set(r.id, { name: r.name, stock: r.stock_quantity });
  const short = shortfall(demand, stock);
  if (short) throw short;
}

/** Sets stock; going from 0/sold-out to >0 queues the waitlist wake-up (outbox). */
export async function setStock(
  tx: Sql,
  tenantId: string,
  productId: string,
  next: { stockQuantity?: number | null; lowStockThreshold?: number | null; status?: string },
): Promise<{ restocked: boolean; waiting: number }> {
  const cur = (
    await tx<{ status: string; stock_quantity: number | null }[]>`
      select status, stock_quantity from products where tenant_id = ${tenantId} and id = ${productId} for update
    `
  )[0];
  if (!cur) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
  const wasOut = cur.status === 'sold_out' || cur.stock_quantity === 0;
  const stock = next.stockQuantity === undefined ? cur.stock_quantity : next.stockQuantity;
  const status = next.status ?? cur.status;
  await tx`
    update products set
      stock_quantity = ${stock},
      status = ${status},
      low_stock_threshold = ${next.lowStockThreshold === undefined ? tx`low_stock_threshold` : next.lowStockThreshold}
    where tenant_id = ${tenantId} and id = ${productId}
  `;
  const nowIn = status === 'active' && stock !== 0;
  if (!(wasOut && nowIn)) return { restocked: false, waiting: 0 };
  return { restocked: true, waiting: await wakeWaitlist(tx, tenantId, productId) };
}

export const MAX_STOCK = 1_000_000;

/**
 * Adds (or takes) units relative to what's there now, so a sale drawn while the merchant was
 * tapping isn't overwritten. Floors at 0. null = not found or not tracked: left alone.
 */
export async function adjustStock(
  tx: Sql,
  tenantId: string,
  productId: string,
  add: number,
): Promise<{ before: number; after: number; waiting: number } | null> {
  const cur = (
    await tx<{ stock_quantity: number | null }[]>`
      select stock_quantity from products where tenant_id = ${tenantId} and id = ${productId} for update
    `
  )[0];
  if (cur?.stock_quantity == null) return null;
  const after = Math.min(MAX_STOCK, Math.max(0, cur.stock_quantity + add));
  const r = await setStock(tx, tenantId, productId, { stockQuantity: after });
  return { before: cur.stock_quantity, after, waiting: r.waiting };
}

/** Marks the product's pending subscriptions notified and hands the contacts to the outbox. */
export async function wakeWaitlist(tx: Sql, tenantId: string, productId: string): Promise<number> {
  const woken = await tx<{ contact: string }[]>`
    update notify_requests set notified_at = now()
    where tenant_id = ${tenantId} and subject = 'product' and product_id = ${productId} and notified_at is null
    returning contact
  `;
  if (woken.length > 0)
    await tx`
      insert into outbox (tenant_id, topic, payload)
      values (${tenantId}, 'waitlist.restocked', ${tx.json({ productId, contacts: woken.map((w) => w.contact) })})
    `;
  return woken.length;
}

/** Returns an order's drawn stock (cancellation). Untracked products stay untracked. */
export async function restoreStock(tx: Sql, tenantId: string, orderId: string): Promise<void> {
  const lines = await tx<
    { product_id: string | null; qty: number; combo: { productId: string; qty: number }[] }[]
  >`
    select product_id, qty, combo from order_items where tenant_id = ${tenantId} and order_id = ${orderId}
  `;
  const demand = stockDemand(
    lines
      .filter((l) => l.product_id)
      .map((l) => ({ productId: l.product_id!, qty: l.qty, combo: l.combo })),
  );
  // id order, like checkout and the Estoque batch, so concurrent row locks never deadlock
  for (const [id, n] of [...demand].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const before = (
      await tx<{ stock_quantity: number; status: string }[]>`
        update products set stock_quantity = stock_quantity + ${n}
        where tenant_id = ${tenantId} and id = ${id} and stock_quantity is not null
        returning stock_quantity - ${n} as stock_quantity, status
      `
    )[0];
    if (before?.stock_quantity === 0 && before.status === 'active')
      await wakeWaitlist(tx, tenantId, id);
  }
}
