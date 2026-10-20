import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

// Insumos and fichas técnicas (ADR 0046, migration 0137). An insumo is bought; a preparo is made
// here from other ingredients and yields an amount of its own unit. A ficha line says how much of
// an ingredient a product, an option, a preparo or every order (packaging) uses, optionally only
// for one order mode. Quantities are thousandths of the unit ("milli"); cost_per_k_cents is what
// 1000 units cost (a kg, a litre, a thousand units), so q milli cost q × cpk / 1e6 cents.
//
// A sale draws every counted ingredient its fichas reach, in the order's own transaction; a
// preparo nobody counts passes through to what it is made of. Nothing here refuses a sale: a
// count may go below zero, and the Insumos screen flags it. What the sale cost (the CMV) is
// snapshotted on the order and its items, from the fichas or, without one, the product's stated
// cost. Row locks go products → addon_stock → ingredients, each in key order.

export const MODES = ['delivery', 'pickup', 'dine_in'] as const;
export type Mode = (typeof MODES)[number];
export const UNITS = ['g', 'ml', 'un'] as const;
export type Unit = (typeof UNITS)[number];

export const MAX_STOCK_MILLI = 1_000_000_000_000;
export const MAX_LINE_MILLI = 1_000_000_000;
export const MAX_CPK_CENTS = 1_000_000_000;
export const MAX_LINES = 40;
/** preparos inside preparos, at most this deep */
export const MAX_DEPTH = 4;

export type MoveReason =
  'sale' | 'cancel' | 'purchase' | 'count' | 'adjust' | 'loss' | 'made' | 'used' | 'start' | 'stop';

export interface Ingredient {
  id: string;
  kind: 'insumo' | 'preparo';
  name: string;
  unit: Unit;
  stock: number | null;
  /** an insumo's average cost; a preparo's is computed from its ficha */
  cpk: number | null;
  yield: number | null;
}

export interface FichaLine {
  ingredientId: string;
  qty: number;
  mode: Mode | null;
}

/** A store's fichas, or the part of them one order reaches. */
export interface Fichas {
  ingredients: Map<string, Ingredient>;
  product: Map<string, FichaLine[]>;
  modifier: Map<string, FichaLine[]>;
  preparo: Map<string, FichaLine[]>;
  perOrder: FichaLine[];
}

type LineRow = {
  product_id: string | null;
  modifier_id: string | null;
  preparo_id: string | null;
  per_order: boolean;
  ingredient_id: string;
  qty_milli: string;
  mode: Mode | null;
};
type IngRow = {
  id: string;
  kind: 'insumo' | 'preparo';
  name: string;
  unit: Unit;
  stock_milli: string | null;
  cost_per_k_cents: string | null;
  yield_milli: string | null;
};

const num = (v: string | null) => (v == null ? null : Number(v));

const toIngredient = (r: IngRow): Ingredient => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  unit: r.unit,
  stock: num(r.stock_milli),
  cpk: num(r.cost_per_k_cents),
  yield: num(r.yield_milli),
});

function assemble(lines: LineRow[], ings: IngRow[]): Fichas {
  const f: Fichas = {
    ingredients: new Map(ings.map((r) => [r.id, toIngredient(r)])),
    product: new Map(),
    modifier: new Map(),
    preparo: new Map(),
    perOrder: [],
  };
  const push = (m: Map<string, FichaLine[]>, k: string, l: FichaLine) =>
    m.set(k, [...(m.get(k) ?? []), l]);
  for (const r of lines) {
    const l = { ingredientId: r.ingredient_id, qty: Number(r.qty_milli), mode: r.mode };
    if (r.product_id) push(f.product, r.product_id, l);
    else if (r.modifier_id) push(f.modifier, r.modifier_id, l);
    else if (r.preparo_id) push(f.preparo, r.preparo_id, l);
    else if (r.per_order) f.perOrder.push(l);
  }
  return f;
}

const lineCols = (tx: Sql) =>
  tx`product_id, modifier_id, preparo_id, per_order, ingredient_id, qty_milli::text, mode`;
const ingCols = (tx: Sql) =>
  tx`id, kind, name, unit, stock_milli::text, cost_per_k_cents::text, yield_milli::text`;

/** Every ficha of the store (the admin's screens). */
export async function loadAllFichas(tx: Sql, tenantId: string): Promise<Fichas> {
  const [lines, ings] = await Promise.all([
    tx<LineRow[]>`
      select ${lineCols(tx)} from recipe_lines where tenant_id = ${tenantId} order by sort, id
    `,
    tx<IngRow[]>`select ${ingCols(tx)} from ingredients where tenant_id = ${tenantId}`,
  ]);
  return assemble(lines, ings);
}

/** The fichas an order's products and options reach, preparos followed down (one statement). */
export async function loadOrderFichas(
  tx: Sql,
  tenantId: string,
  productIds: string[],
  modifierIds: string[],
): Promise<Fichas> {
  // union, not union all: a cycle repeats rows, which ends the recursion
  const rows = await tx<(LineRow & { ing: IngRow })[]>`
    with recursive l as (
      select product_id, modifier_id, preparo_id, per_order, ingredient_id, qty_milli, mode, sort, id
      from recipe_lines
      where tenant_id = ${tenantId}
        and (product_id = any(${productIds}::uuid[]) or modifier_id = any(${modifierIds}::uuid[]) or per_order)
      union
      select r.product_id, r.modifier_id, r.preparo_id, r.per_order, r.ingredient_id, r.qty_milli, r.mode, r.sort, r.id
      from recipe_lines r join l on r.preparo_id = l.ingredient_id
      where r.tenant_id = ${tenantId}
    )
    select l.product_id, l.modifier_id, l.preparo_id, l.per_order, l.ingredient_id,
           l.qty_milli::text as qty_milli, l.mode,
           json_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'unit', i.unit,
             'stock_milli', i.stock_milli::text, 'cost_per_k_cents', i.cost_per_k_cents::text,
             'yield_milli', i.yield_milli::text) as ing
    from l join ingredients i on i.id = l.ingredient_id and i.tenant_id = ${tenantId}
    order by l.sort, l.id
  `;
  const ings = new Map(rows.map((r) => [r.ing.id, r.ing]));
  return assemble(rows, [...ings.values()]);
}

const forMode = (lines: FichaLine[] | undefined, mode: Mode | null) =>
  (lines ?? []).filter((l) => l.mode == null || mode == null || l.mode === mode);

/**
 * What 1000 units of an ingredient cost, in cents (a float for preparos: rounding waits for the
 * sale's total). `missing` collects the insumos with no cost yet, which count as 0.
 */
export function costPerK(
  f: Fichas,
  id: string,
  missing?: Set<string>,
  seen: string[] = [],
): number {
  const ing = f.ingredients.get(id);
  if (!ing) return 0;
  if (ing.kind === 'insumo') {
    if (ing.cpk == null) missing?.add(id);
    return ing.cpk ?? 0;
  }
  if (seen.includes(id) || seen.length >= MAX_DEPTH || !ing.yield) return 0;
  let made = 0;
  for (const l of f.preparo.get(id) ?? [])
    made += l.qty * costPerK(f, l.ingredientId, missing, [...seen, id]);
  return made / ing.yield;
}

/** The cost of a list of ficha lines × times, in fractional cents. */
export function linesCost(f: Fichas, lines: FichaLine[], times = 1, missing?: Set<string>): number {
  let c = 0;
  for (const l of lines) c += (l.qty * times * costPerK(f, l.ingredientId, missing)) / 1e6;
  return c;
}

/** Adds to `out` the counted ingredients these lines draw: an uncounted preparo passes through. */
export function explode(
  f: Fichas,
  lines: FichaLine[],
  times: number,
  out: Map<string, number>,
  seen: string[] = [],
): void {
  for (const l of lines) {
    const ing = f.ingredients.get(l.ingredientId);
    if (!ing) continue;
    const q = l.qty * times;
    if (ing.stock != null || ing.kind === 'insumo') {
      if (ing.stock != null) out.set(ing.id, (out.get(ing.id) ?? 0) + q);
      continue;
    }
    if (seen.includes(ing.id) || seen.length >= MAX_DEPTH || !ing.yield) continue;
    explode(f, f.preparo.get(ing.id) ?? [], q / ing.yield, out, [...seen, ing.id]);
  }
}

/** A product's ficha cost per order mode (base = every mode's lines only). */
export function productFichaCost(f: Fichas, productId: string, missing?: Set<string>) {
  const lines = f.product.get(productId);
  if (!lines?.length) return null;
  const base = linesCost(
    f,
    lines.filter((l) => l.mode == null),
    1,
    missing,
  );
  const byMode = Object.fromEntries(
    MODES.map((m) => [m, Math.round(linesCost(f, forMode(lines, m), 1, missing))]),
  ) as Record<Mode, number>;
  return { baseCents: Math.round(base), byMode, maxCents: Math.max(...Object.values(byMode)) };
}

// ── the sale ──────────────────────────────────────────────────────────────────────────────

export interface SaleLine {
  productId: string;
  qty: number;
  modifierIds?: readonly string[];
  /** units above 1, by modifier id */
  modifierQty?: Record<string, number>;
  /** a kit's picks */
  combo?: readonly { productId: string; qty: number }[];
}

export interface SaleCost {
  /** {ingredientId: milli} drawn, for `orders.ingredients_drawn` */
  drawn: Record<string, number>;
  /** each line's cost in cents, in the lines' order; null = no ficha and no stated cost */
  lineCosts: (number | null)[];
  /** the lines' known costs plus the order's packaging; null when nothing is known */
  costCents: number | null;
}

/**
 * Costs an order and draws its counted ingredients, inside the order's transaction (after
 * drawStock and drawAddonStock). Never throws for a shortfall.
 */
export async function drawInsumos(
  tx: Sql,
  tenantId: string,
  sale: { mode: Mode; lines: SaleLine[] },
  orderId: string,
): Promise<SaleCost> {
  const productIds = [
    ...new Set(
      sale.lines.flatMap((l) => [l.productId, ...(l.combo ?? []).map((c) => c.productId)]),
    ),
  ];
  const modifierIds = [...new Set(sale.lines.flatMap((l) => l.modifierIds ?? []))];
  const [f, stated] = await Promise.all([
    loadOrderFichas(tx, tenantId, productIds, modifierIds),
    tx<{ id: string; kind: string; cost_cents: number | null }[]>`
      select id, kind, cost_cents from products
      where tenant_id = ${tenantId} and id = any(${productIds}::uuid[])
    `,
  ]);
  const products = new Map(stated.map((p) => [p.id, p]));
  const mode = sale.mode;

  // one unit of a product, in fractional cents: its ficha, else its stated cost
  const unitCost = (id: string): number | null => {
    const lines = f.product.get(id);
    if (lines?.length) return linesCost(f, forMode(lines, mode));
    return products.get(id)?.cost_cents ?? null;
  };
  const demand = new Map<string, number>();
  const lineCosts = sale.lines.map((l) => {
    const p = products.get(l.productId);
    const own = f.product.get(l.productId);
    let unit: number | null;
    if (p?.kind !== 'combo') unit = unitCost(l.productId);
    // a kit's stated cost covers its picks; with a ficha (a box) or no cost, the picks add theirs
    else if (!own?.length && p.cost_cents != null) unit = p.cost_cents;
    else if (!own?.length && !l.combo?.length) unit = null;
    else {
      unit = own?.length ? linesCost(f, forMode(own, mode)) : 0;
      for (const c of l.combo ?? []) {
        const pick = unitCost(c.productId);
        unit = unit == null || pick == null ? null : unit + pick * c.qty;
      }
    }
    let options = 0;
    for (const id of l.modifierIds ?? []) {
      const units = l.modifierQty?.[id] ?? 1;
      const ml = forMode(f.modifier.get(id), mode);
      options += linesCost(f, ml, units);
      explode(f, ml, units * l.qty, demand);
    }
    explode(f, forMode(own, mode), l.qty, demand);
    for (const c of l.combo ?? [])
      explode(f, forMode(f.product.get(c.productId), mode), c.qty * l.qty, demand);
    // an option's ficha alone isn't the line's cost: unknown stays unknown
    if (unit == null) return null;
    return Math.round((unit + options) * l.qty);
  });
  const packaging = forMode(f.perOrder, mode);
  explode(f, packaging, 1, demand);
  const known = lineCosts.filter((c): c is number => c != null);
  const costCents =
    known.length || packaging.length
      ? known.reduce((a, b) => a + b, 0) + Math.round(linesCost(f, packaging))
      : null;

  const draws = [...demand]
    .map(([id, q]) => [id, Math.round(q)] as const)
    .filter(([, q]) => q > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!draws.length) return { drawn: {}, lineCosts, costCents };
  await tx`
    select 1 from ingredients
    where tenant_id = ${tenantId} and id = any(${draws.map(([id]) => id)}::uuid[])
    order by id for update
  `;
  const after = await tx<{ id: string; stock_milli: string }[]>`
    update ingredients i set stock_milli = greatest(i.stock_milli - v.n, ${-MAX_STOCK_MILLI}), updated_at = now()
    from unnest(${draws.map(([id]) => id)}::uuid[], ${draws.map(([, n]) => n)}::bigint[]) as v(id, n)
    where i.tenant_id = ${tenantId} and i.id = v.id and i.stock_milli is not null
    returning i.id, i.stock_milli::text
  `;
  const n = new Map(draws);
  await logMoves(
    tx,
    tenantId,
    after.map((r) => ({
      ingredientId: r.id,
      reason: 'sale',
      delta: -n.get(r.id)!,
      after: Number(r.stock_milli),
      costCents: -Math.round((n.get(r.id)! * costPerK(f, r.id)) / 1e6),
      orderId,
    })),
  );
  return {
    drawn: Object.fromEntries(after.map((r) => [r.id, n.get(r.id)!])),
    lineCosts,
    costCents,
  };
}

/** A cancel gives back exactly what the sale drew; an ingredient no longer counted stays so. */
export async function restoreInsumos(tx: Sql, tenantId: string, orderId: string): Promise<void> {
  const [order] = await tx<{ ingredients_drawn: Record<string, number> | null }[]>`
    select ingredients_drawn from orders where tenant_id = ${tenantId} and id = ${orderId}
  `;
  const drawn = Object.entries(order?.ingredients_drawn ?? {})
    .filter(([, q]) => Number.isInteger(q) && q > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!drawn.length) return;
  await tx`
    select 1 from ingredients
    where tenant_id = ${tenantId} and id = any(${drawn.map(([id]) => id)}::uuid[])
    order by id for update
  `;
  const back = await tx<{ id: string; stock_milli: string }[]>`
    update ingredients i set stock_milli = least(i.stock_milli + v.n, ${MAX_STOCK_MILLI}), updated_at = now()
    from unnest(${drawn.map(([id]) => id)}::uuid[], ${drawn.map(([, n]) => n)}::bigint[]) as v(id, n)
    where i.tenant_id = ${tenantId} and i.id = v.id and i.stock_milli is not null
    returning i.id, i.stock_milli::text
  `;
  if (!back.length) return;
  const f = await loadIngredientFichas(
    tx,
    tenantId,
    back.map((r) => r.id),
  );
  const n = new Map(drawn);
  await logMoves(
    tx,
    tenantId,
    back.map((r) => ({
      ingredientId: r.id,
      reason: 'cancel',
      delta: n.get(r.id)!,
      after: Number(r.stock_milli),
      costCents: Math.round((n.get(r.id)! * costPerK(f, r.id)) / 1e6),
      orderId,
    })),
  );
}

/** Just these ingredients and what their preparos are made of, for costing a movement. */
export async function loadIngredientFichas(tx: Sql, tenantId: string, ids: string[]) {
  const rows = await tx<(LineRow & { ing: IngRow })[]>`
    with recursive l as (
      select product_id, modifier_id, preparo_id, per_order, ingredient_id, qty_milli, mode
      from recipe_lines where tenant_id = ${tenantId} and preparo_id = any(${ids}::uuid[])
      union
      select r.product_id, r.modifier_id, r.preparo_id, r.per_order, r.ingredient_id, r.qty_milli, r.mode
      from recipe_lines r join l on r.preparo_id = l.ingredient_id
      where r.tenant_id = ${tenantId}
    )
    select l.product_id, l.modifier_id, l.preparo_id, l.per_order, l.ingredient_id,
           l.qty_milli::text as qty_milli, l.mode,
           json_build_object('id', i.id, 'kind', i.kind, 'name', i.name, 'unit', i.unit,
             'stock_milli', i.stock_milli::text, 'cost_per_k_cents', i.cost_per_k_cents::text,
             'yield_milli', i.yield_milli::text) as ing
    from l join ingredients i on i.id = l.ingredient_id and i.tenant_id = ${tenantId}
  `;
  const own = await tx<IngRow[]>`
    select ${ingCols(tx)} from ingredients where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
  `;
  const ings = new Map([
    ...rows.map((r) => [r.ing.id, r.ing] as const),
    ...own.map((r) => [r.id, r] as const),
  ]);
  return assemble(rows, [...ings.values()]);
}

// ── the merchant's side ───────────────────────────────────────────────────────────────────

export interface Move {
  ingredientId: string;
  reason: MoveReason;
  delta: number;
  after: number | null;
  costCents?: number | null;
  orderId?: string | null;
  by?: string | null;
  note?: string | null;
}

const clampCents = (c: number | null | undefined) =>
  c == null ? null : Math.max(-2_000_000_000, Math.min(2_000_000_000, c));

/** One statement for any number of moves. */
export async function logMoves(tx: Sql, tenantId: string, moves: Move[]): Promise<void> {
  if (!moves.length) return;
  const col = <T>(fn: (m: Move) => T) => moves.map(fn);
  await tx`
    insert into ingredient_movements (tenant_id, ingredient_id, reason, delta_milli, after_milli, cost_cents,
                                      order_id, actor_label, note)
    select ${tenantId}, v.ingredient_id, v.reason, v.delta, v.after, v.cost, v.order_id, v.by, v.note
    from unnest(${col((m) => m.ingredientId)}::uuid[], ${col((m) => m.reason)}::text[],
                ${col((m) => m.delta)}::bigint[], ${col((m) => m.after)}::bigint[],
                ${col((m) => clampCents(m.costCents))}::int[], ${col((m) => m.orderId ?? null)}::uuid[],
                ${col((m) => m.by?.slice(0, 120) ?? null)}::text[], ${col((m) => m.note?.slice(0, 120) ?? null)}::text[])
      as v(ingredient_id, reason, delta, after, cost, order_id, by, note)
  `;
}

async function lockIngredient(tx: Sql, tenantId: string, id: string) {
  const [r] = await tx<IngRow[]>`
    select ${ingCols(tx)} from ingredients where tenant_id = ${tenantId} and id = ${id} for update
  `;
  if (!r) throw new HttpError(404, 'INGREDIENT_NOT_FOUND', 'insumo not found');
  return toIngredient(r);
}

/** Starts counting, sets a count, or (null) stops counting. */
export async function setIngredientStock(
  tx: Sql,
  tenantId: string,
  id: string,
  stock: number | null,
  by: string | null,
): Promise<void> {
  const cur = await lockIngredient(tx, tenantId, id);
  if (cur.stock === stock) return;
  await tx`
    update ingredients set stock_milli = ${stock}, updated_at = now()
    where tenant_id = ${tenantId} and id = ${id}
  `;
  const f = await loadIngredientFichas(tx, tenantId, [id]);
  const value = (q: number) => Math.round((q * costPerK(f, id)) / 1e6);
  const move: Move =
    cur.stock == null
      ? { ingredientId: id, reason: 'start', delta: stock!, after: stock, by }
      : stock == null
        ? { ingredientId: id, reason: 'stop', delta: 0, after: null, by }
        : {
            ingredientId: id,
            reason: 'count',
            delta: stock - cur.stock,
            after: stock,
            costCents: value(stock - cur.stock),
            by,
          };
  await logMoves(tx, tenantId, [move]);
}

export const ADJUST_REASONS = ['adjust', 'loss'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** Relative changes (the − / + taps, a loss), in id order; uncounted ones are left alone. */
export async function adjustIngredients(
  tx: Sql,
  tenantId: string,
  changes: { id: string; add: number; reason: AdjustReason }[],
  by: string | null,
): Promise<Record<string, number>> {
  const sorted = changes.filter((c) => c.add !== 0).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!sorted.length) return {};
  const ids = sorted.map((c) => c.id);
  await tx`
    select 1 from ingredients where tenant_id = ${tenantId} and id = any(${ids}::uuid[])
    order by id for update
  `;
  const rows = await tx<{ id: string; stock_milli: string }[]>`
    update ingredients i
    set stock_milli = least(greatest(i.stock_milli + v.n, ${-MAX_STOCK_MILLI}), ${MAX_STOCK_MILLI}),
        updated_at = now()
    from unnest(${ids}::uuid[], ${sorted.map((c) => c.add)}::bigint[]) as v(id, n)
    where i.tenant_id = ${tenantId} and i.id = v.id and i.stock_milli is not null
    returning i.id, i.stock_milli::text
  `;
  if (!rows.length) return {};
  const f = await loadIngredientFichas(
    tx,
    tenantId,
    rows.map((r) => r.id),
  );
  const by_ = new Map(sorted.map((c) => [c.id, c]));
  await logMoves(
    tx,
    tenantId,
    rows.map((r) => {
      const c = by_.get(r.id)!;
      return {
        ingredientId: r.id,
        reason: c.reason,
        delta: c.add,
        after: Number(r.stock_milli),
        costCents: Math.round((c.add * costPerK(f, r.id)) / 1e6),
        by,
      };
    }),
  );
  return Object.fromEntries(rows.map((r) => [r.id, Number(r.stock_milli)]));
}

/** The weighted average after buying `qty` for `paid`: a count at or below zero starts over. */
export function averageCost(
  stock: number | null,
  cpk: number | null,
  qty: number,
  paid: number,
): number {
  const bought = (paid * 1e6) / qty;
  if (stock == null || stock <= 0 || cpk == null) return Math.round(bought);
  return Math.round((stock * cpk + paid * 1e6) / (stock + qty));
}

/** What arrived and what it cost: the average cost moves, a counted insumo's count goes up. */
export async function purchaseIngredients(
  tx: Sql,
  tenantId: string,
  items: { id: string; qty: number; costCents: number }[],
  note: string | null,
  by: string | null,
): Promise<void> {
  const moves: Move[] = [];
  for (const it of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const cur = await lockIngredient(tx, tenantId, it.id);
    if (cur.kind !== 'insumo')
      throw new HttpError(422, 'PREPARO_NOT_BOUGHT', `"${cur.name}" is made here, not bought`, {
        ingredientId: it.id,
      });
    const cpk = averageCost(cur.stock, cur.cpk, it.qty, it.costCents);
    if (cpk > MAX_CPK_CENTS)
      throw new HttpError(422, 'BAD_REQUEST', `the cost of "${cur.name}" is too high`, {
        field: 'costCents',
      });
    const stock = cur.stock == null ? null : Math.min(MAX_STOCK_MILLI, cur.stock + it.qty);
    await tx`
      update ingredients set cost_per_k_cents = ${cpk}, stock_milli = ${stock}, updated_at = now()
      where tenant_id = ${tenantId} and id = ${it.id}
    `;
    moves.push({
      ingredientId: it.id,
      reason: 'purchase',
      delta: it.qty,
      after: stock,
      costCents: it.costCents,
      by,
      note,
    });
  }
  await logMoves(tx, tenantId, moves);
}

/** A batch of a counted preparo was made: it goes up, what it is made of comes down. */
export async function makePreparo(
  tx: Sql,
  tenantId: string,
  id: string,
  made: number,
  by: string | null,
): Promise<void> {
  const f = await loadIngredientFichas(tx, tenantId, [id]);
  const p = f.ingredients.get(id);
  if (!p) throw new HttpError(404, 'INGREDIENT_NOT_FOUND', 'insumo not found');
  if (p.kind !== 'preparo' || !p.yield)
    throw new HttpError(422, 'NOT_A_PREPARO', `"${p.name}" is bought, not made here`);
  if (p.stock == null)
    throw new HttpError(409, 'PREPARO_NOT_COUNTED', `start counting "${p.name}" first`);
  const used = new Map<string, number>();
  explode(f, f.preparo.get(id) ?? [], made / p.yield, used, [id]);
  used.delete(id);
  const draws = [...used].map(([k, q]) => [k, Math.round(q)] as const).filter(([, q]) => q > 0);
  const all = [...new Set([id, ...draws.map(([k]) => k)])].sort();
  await tx`
    select 1 from ingredients where tenant_id = ${tenantId} and id = any(${all}::uuid[])
    order by id for update
  `;
  const deltas = new Map<string, number>([...draws.map(([k, q]) => [k, -q] as const)]);
  deltas.set(id, made);
  const rows = await tx<{ id: string; stock_milli: string }[]>`
    update ingredients i
    set stock_milli = least(greatest(i.stock_milli + v.n, ${-MAX_STOCK_MILLI}), ${MAX_STOCK_MILLI}),
        updated_at = now()
    from unnest(${[...deltas.keys()]}::uuid[], ${[...deltas.values()]}::bigint[]) as v(id, n)
    where i.tenant_id = ${tenantId} and i.id = v.id and i.stock_milli is not null
    returning i.id, i.stock_milli::text
  `;
  await logMoves(
    tx,
    tenantId,
    rows.map((r) => {
      const d = deltas.get(r.id)!;
      return {
        ingredientId: r.id,
        reason: r.id === id ? 'made' : 'used',
        delta: d,
        after: Number(r.stock_milli),
        costCents: Math.round((d * costPerK(f, r.id)) / 1e6),
        by,
      };
    }),
  );
}

/** Whether `preparoId`'s ficha, as it would be with `lines`, reaches back to itself. */
export function makesCycle(f: Fichas, preparoId: string, lines: FichaLine[]): boolean {
  const reach = (id: string, depth: number): boolean => {
    if (id === preparoId) return true;
    if (depth > 32) return true;
    return (f.preparo.get(id) ?? []).some((l) => reach(l.ingredientId, depth + 1));
  };
  return lines.some((l) => reach(l.ingredientId, 0));
}

/** How deep a preparo's ficha goes with `lines` (1 = only insumos). */
export function depthOf(f: Fichas, lines: FichaLine[]): number {
  const d = (id: string, seen: string[]): number => {
    const ing = f.ingredients.get(id);
    if (!ing || ing.kind === 'insumo' || seen.includes(id) || seen.length > 32) return 0;
    return (
      1 + Math.max(0, ...(f.preparo.get(id) ?? []).map((l) => d(l.ingredientId, [...seen, id])))
    );
  };
  return 1 + Math.max(0, ...lines.map((l) => d(l.ingredientId, [])));
}
