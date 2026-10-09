import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

// Stock (roadmap 2b). null stock = not tracked. Checkout draws the demand of every
// line — a kit draws its picked items — under row locks; cancelling gives it back,
// and a sold-out product that gets stock again wakes its waitlist.
// Adicionais (migration 0117) count by name across the store: an addon_stock row per
// modifiers.stock_key, drawn after the products (locks always go products, then addons, each
// in key order). Every change to a counted item lands a stock_movements row saying why.

export type MoveReason =
  'sale' | 'cancel' | 'delivery' | 'count' | 'adjust' | 'loss' | 'start' | 'stop';

export interface Move {
  productId?: string;
  addonKey?: string;
  reason: MoveReason;
  delta: number;
  after: number | null;
  orderId?: string | null;
  by?: string | null;
}

/** One statement for any number of moves. */
export async function logMoves(tx: Sql, tenantId: string, moves: Move[]): Promise<void> {
  if (moves.length === 0) return;
  const col = <T>(f: (m: Move) => T) => moves.map(f);
  await tx`
    insert into stock_movements (tenant_id, product_id, addon_key, reason, delta, after, order_id, actor_label)
    select ${tenantId}, v.product_id, v.addon_key, v.reason, v.delta, v.after, v.order_id, v.by
    from unnest(${col((m) => m.productId ?? null)}::uuid[], ${col((m) => m.addonKey ?? null)}::text[],
                ${col((m) => m.reason)}::text[], ${col((m) => m.delta)}::int[],
                ${col((m) => m.after)}::int[], ${col((m) => m.orderId ?? null)}::uuid[],
                ${col((m) => m.by?.slice(0, 120) ?? null)}::text[])
      as v(product_id, addon_key, reason, delta, after, order_id, by)
  `;
}

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

/** Check-and-draw inside the checkout tx; throws OUT_OF_STOCK before touching anything.
 *  Returns what it drew (tracked products only) for the order's `stock_drawn`. */
export async function drawStock(
  tx: Sql,
  tenantId: string,
  demand: Map<string, number>,
  orderId: string,
): Promise<Record<string, number>> {
  const ids = [...demand.keys()];
  if (ids.length === 0) return {};
  const stock = await lockStock(tx, tenantId, ids);
  const short = shortfall(demand, stock);
  if (short) throw short;
  const drawn = [...demand].filter(([id]) => stock.get(id)?.stock != null && demand.get(id)! > 0);
  if (drawn.length === 0) return {};
  // the rows are locked above
  const after = await tx<{ id: string; stock_quantity: number }[]>`
    update products p set stock_quantity = p.stock_quantity - v.n
    from unnest(${drawn.map(([id]) => id)}::uuid[], ${drawn.map(([, n]) => n)}::int[]) as v(id, n)
    where p.tenant_id = ${tenantId} and p.id = v.id
    returning p.id, p.stock_quantity
  `;
  await logMoves(
    tx,
    tenantId,
    after.map((r) => ({
      productId: r.id,
      reason: 'sale',
      delta: -demand.get(r.id)!,
      after: r.stock_quantity,
      orderId,
    })),
  );
  return Object.fromEntries(drawn);
}

// ── adicionais ─────────────────────────────────────────────────────────────────────────────

export interface AddonLine {
  qty: number;
  modifierIds?: readonly string[];
  /** units above 1, by modifier id */
  modifierQty?: Record<string, number>;
}

/** modifierId → option units across the lines (line qty × the option's units). */
export function modifierDemand(lines: AddonLine[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of lines)
    for (const id of l.modifierIds ?? [])
      out.set(id, (out.get(id) ?? 0) + l.qty * (l.modifierQty?.[id] ?? 1));
  return out;
}

/** The demand by addon key, counted adicionais only, with their stock (locked when asked). */
async function addonDemandOf(
  tx: Sql,
  tenantId: string,
  byModifier: Map<string, number>,
  lock: boolean,
) {
  const ids = [...byModifier.keys()];
  if (ids.length === 0) return { demand: new Map<string, number>(), stock: new Map() };
  const mods = await tx<{ id: string; stock_key: string }[]>`
    select id, stock_key from modifiers where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
  `;
  const byKey = new Map<string, number>();
  for (const m of mods)
    byKey.set(m.stock_key, (byKey.get(m.stock_key) ?? 0) + byModifier.get(m.id)!);
  const keys = [...byKey.keys()];
  const rows = keys.length
    ? await tx<{ key: string; name: string; stock_quantity: number }[]>`
        select key, name, stock_quantity from addon_stock
        where tenant_id = ${tenantId} and key = any(${keys}::text[])
        order by key collate "C" ${lock ? tx`for update` : tx``}
      `
    : [];
  const stock = new Map(rows.map((r) => [r.key, { name: r.name, stock: r.stock_quantity }]));
  const demand = new Map([...byKey].filter(([k]) => stock.has(k)));
  return { demand, stock };
}

function addonShortfall(
  demand: Map<string, number>,
  stock: Map<string, { name: string; stock: number }>,
): HttpError | null {
  for (const [key, need] of demand) {
    const s = stock.get(key)!;
    if (need > s.stock)
      return new HttpError(
        409,
        'MODIFIER_SOLD_OUT',
        s.stock === 0 ? `"${s.name}" is sold out` : `only ${s.stock} of "${s.name}" left`,
        { addon: s.name, available: s.stock },
      );
  }
  return null;
}

/** Best-effort early check (add/patch), like assertStock. */
export async function assertAddonStock(
  tx: Sql,
  tenantId: string,
  byModifier: Map<string, number>,
): Promise<void> {
  const { demand, stock } = await addonDemandOf(tx, tenantId, byModifier, false);
  const short = addonShortfall(demand, stock);
  if (short) throw short;
}

/** Check-and-draw in the order's tx, after drawStock. Returns {key: units} for
 *  `orders.addon_stock_drawn`. */
export async function drawAddonStock(
  tx: Sql,
  tenantId: string,
  byModifier: Map<string, number>,
  orderId: string,
): Promise<Record<string, number>> {
  const { demand, stock } = await addonDemandOf(tx, tenantId, byModifier, true);
  const short = addonShortfall(demand, stock);
  if (short) throw short;
  const drawn = [...demand].filter(([, n]) => n > 0);
  if (drawn.length === 0) return {};
  const after = await tx<{ key: string; stock_quantity: number }[]>`
    update addon_stock a set stock_quantity = a.stock_quantity - v.n, updated_at = now()
    from unnest(${drawn.map(([k]) => k)}::text[], ${drawn.map(([, n]) => n)}::int[]) as v(key, n)
    where a.tenant_id = ${tenantId} and a.key = v.key
    returning a.key, a.stock_quantity
  `;
  await logMoves(
    tx,
    tenantId,
    after.map((r) => ({
      addonKey: r.key,
      reason: 'sale',
      delta: -demand.get(r.key)!,
      after: r.stock_quantity,
      orderId,
    })),
  );
  return Object.fromEntries(drawn);
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
  move: { reason?: MoveReason; by?: string | null } = {},
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
  if (stock !== cur.stock_quantity)
    await logMoves(tx, tenantId, [
      {
        productId,
        ...countMove(cur.stock_quantity, stock, move.reason),
        by: move.by ?? null,
      },
    ]);
  const nowIn = status === 'active' && stock !== 0;
  if (!(wasOut && nowIn)) return { restocked: false, waiting: 0 };
  return { restocked: true, waiting: await wakeWaitlist(tx, tenantId, productId) };
}

/** A change of the counted number: started, stopped, or the reason given (a count by default). */
function countMove(before: number | null, after: number | null, reason: MoveReason = 'count') {
  if (before == null) return { reason: 'start' as const, delta: after ?? 0, after };
  if (after == null) return { reason: 'stop' as const, delta: 0, after: null };
  return { reason, delta: after - before, after };
}

export const MAX_STOCK = 1_000_000;

/** Addon keys in the order Postgres's `collate "C"` sorts them (UTF-8 bytes), the lock order. */
export const byBytes = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/** What a merchant's relative change is: a −/+ tap, a delivery, or a loss. */
export const ADJUST_REASONS = ['adjust', 'delivery', 'loss'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/**
 * Adds (or takes) units relative to what's there now, so a sale drawn while the merchant was
 * tapping isn't overwritten. Floors at 0. null = not found or not tracked: left alone.
 */
export async function adjustStock(
  tx: Sql,
  tenantId: string,
  productId: string,
  add: number,
  move: { reason?: AdjustReason; by?: string | null } = {},
): Promise<{ before: number; after: number; waiting: number } | null> {
  const cur = (
    await tx<{ stock_quantity: number | null }[]>`
      select stock_quantity from products where tenant_id = ${tenantId} and id = ${productId} for update
    `
  )[0];
  if (cur?.stock_quantity == null) return null;
  const after = Math.min(MAX_STOCK, Math.max(0, cur.stock_quantity + add));
  const r = await setStock(
    tx,
    tenantId,
    productId,
    { stockQuantity: after },
    { reason: move.reason ?? 'adjust', by: move.by ?? null },
  );
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

/** Returns an order's drawn stock (cancellation): exactly what checkout drew, so a product
 *  tracked only after the sale isn't credited units it never gave. Untracked stays untracked. */
export async function restoreStock(tx: Sql, tenantId: string, orderId: string): Promise<void> {
  const [order] = await tx<
    {
      stock_drawn: Record<string, number> | null;
      addon_stock_drawn: Record<string, number> | null;
    }[]
  >`
    select stock_drawn, addon_stock_drawn from orders where tenant_id = ${tenantId} and id = ${orderId}
  `;
  let demand: Map<string, number>;
  if (order?.stock_drawn) {
    demand = new Map(Object.entries(order.stock_drawn));
  } else {
    // an order placed before stock_drawn existed: its lines are the best record
    const lines = await tx<
      { product_id: string | null; qty: number; combo: { productId: string; qty: number }[] }[]
    >`
      select product_id, qty, combo from order_items where tenant_id = ${tenantId} and order_id = ${orderId}
    `;
    demand = stockDemand(
      lines
        .filter((l) => l.product_id)
        .map((l) => ({ productId: l.product_id!, qty: l.qty, combo: l.combo })),
    );
  }
  const moves: Move[] = [];
  // id order, like checkout and the Estoque batch, so concurrent row locks never deadlock
  for (const [id, n] of [...demand].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const row = (
      await tx<{ stock_quantity: number; status: string }[]>`
        update products set stock_quantity = stock_quantity + ${n}
        where tenant_id = ${tenantId} and id = ${id} and stock_quantity is not null
        returning stock_quantity, status
      `
    )[0];
    if (!row) continue;
    moves.push({ productId: id, reason: 'cancel', delta: n, after: row.stock_quantity, orderId });
    if (row.stock_quantity - n === 0 && row.status === 'active')
      await wakeWaitlist(tx, tenantId, id);
  }
  // then the adicionais, in key order; one no longer counted stays uncounted
  const addons = Object.entries(order?.addon_stock_drawn ?? {}).sort(([a], [b]) => byBytes(a, b));
  for (const [key, n] of addons) {
    const row = (
      await tx<{ stock_quantity: number }[]>`
        update addon_stock set stock_quantity = least(stock_quantity + ${n}, ${MAX_STOCK}), updated_at = now()
        where tenant_id = ${tenantId} and key = ${key}
        returning stock_quantity
      `
    )[0];
    if (row)
      moves.push({ addonKey: key, reason: 'cancel', delta: n, after: row.stock_quantity, orderId });
  }
  await logMoves(tx, tenantId, moves);
}

// ── adicionais: the merchant's side ─────────────────────────────────────────────────────────

/** Starts counting an adicional, sets its count, or (stockQuantity null) stops counting it. */
export async function setAddonStock(
  tx: Sql,
  tenantId: string,
  key: string,
  next: {
    stockQuantity?: number | null;
    lowStockThreshold?: number | null;
    costCents?: number | null;
  },
  by: string | null,
): Promise<'ok' | 'not_counted' | 'not_found'> {
  let cur = (
    await tx<{ stock_quantity: number }[]>`
      select stock_quantity from addon_stock where tenant_id = ${tenantId} and key = ${key} for update
    `
  )[0];
  if (next.stockQuantity === null) {
    if (!cur) return 'ok';
    await tx`delete from addon_stock where tenant_id = ${tenantId} and key = ${key}`;
    await logMoves(tx, tenantId, [{ addonKey: key, ...countMove(cur.stock_quantity, null), by }]);
    return 'ok';
  }
  if (!cur) {
    if (next.stockQuantity === undefined) return 'not_counted';
    // the display name: the spelling most of the store's options use
    const name = (
      await tx<{ name: string }[]>`
        select name from modifiers where tenant_id = ${tenantId} and stock_key = ${key}
        group by name order by count(*) desc, name limit 1
      `
    )[0]?.name;
    if (!name) return 'not_found';
    const started = await tx`
      insert into addon_stock (tenant_id, key, name, stock_quantity, low_stock_threshold, cost_cents)
      values (${tenantId}, ${key}, ${name.slice(0, 80)}, ${next.stockQuantity},
              ${next.lowStockThreshold ?? null}, ${next.costCents ?? null})
      on conflict (tenant_id, key) do nothing
      returning 1
    `;
    if (started.length) {
      await logMoves(tx, tenantId, [{ addonKey: key, ...countMove(null, next.stockQuantity), by }]);
      return 'ok';
    }
    // another request started counting it meanwhile: this one is a count on top
    cur = (
      await tx<{ stock_quantity: number }[]>`
        select stock_quantity from addon_stock where tenant_id = ${tenantId} and key = ${key} for update
      `
    )[0]!;
  }
  await tx`
    update addon_stock set
      stock_quantity = ${next.stockQuantity ?? cur.stock_quantity},
      low_stock_threshold = ${next.lowStockThreshold === undefined ? tx`low_stock_threshold` : next.lowStockThreshold},
      cost_cents = ${next.costCents === undefined ? tx`cost_cents` : next.costCents},
      updated_at = now()
    where tenant_id = ${tenantId} and key = ${key}
  `;
  if (next.stockQuantity !== undefined && next.stockQuantity !== cur.stock_quantity)
    await logMoves(tx, tenantId, [
      { addonKey: key, ...countMove(cur.stock_quantity, next.stockQuantity), by },
    ]);
  return 'ok';
}

/** Relative change to a counted adicional, floored at 0; null = not counted (left alone). */
export async function adjustAddonStock(
  tx: Sql,
  tenantId: string,
  key: string,
  add: number,
  move: { reason?: AdjustReason; by?: string | null } = {},
): Promise<{ before: number; after: number } | null> {
  const cur = (
    await tx<{ stock_quantity: number }[]>`
      select stock_quantity from addon_stock where tenant_id = ${tenantId} and key = ${key} for update
    `
  )[0];
  if (!cur) return null;
  const row = {
    before: cur.stock_quantity,
    after: Math.min(MAX_STOCK, Math.max(0, cur.stock_quantity + add)),
  };
  await tx`
    update addon_stock set stock_quantity = ${row.after}, updated_at = now()
    where tenant_id = ${tenantId} and key = ${key}
  `;
  if (row.after !== row.before)
    await logMoves(tx, tenantId, [
      {
        addonKey: key,
        reason: move.reason ?? 'adjust',
        delta: row.after - row.before,
        after: row.after,
        by: move.by ?? null,
      },
    ]);
  return row;
}
