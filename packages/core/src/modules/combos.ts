import type { Sql } from '../platform/db.ts';
import { HttpError, UUID_RE } from '../platform/http.ts';

// Combos / kits (roadmap 2b): a product of kind 'combo' whose customer picks items
// per slot — "escolha 4 sabores, até 2 de cada". The kit price is the combo's base
// plus each pick's delta; stock is drawn from the picked items at checkout.

export interface ComboSlotItem {
  productId: string;
  slug: string;
  name: string;
  priceDeltaCents: number;
  /** live, stock-derived: 'active' | 'sold_out' | 'archived' */
  status: string;
  stockQuantity: number | null;
  imageUrl: string | null;
}

export interface ComboSlot {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  qtyPerItem: number;
  items: ComboSlotItem[];
}

export interface ComboSelection {
  slotId: string;
  productId: string;
  qty: number;
}

export interface ComboPick extends ComboSelection {
  slotName: string;
  name: string;
  priceDeltaCents: number;
}

/** Parses + canonicalizes (merge duplicates, stable order) so equal kits merge into one cart line. */
export function parseSelections(v: unknown): ComboSelection[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 48)
    throw new HttpError(422, 'INVALID_COMBO', 'comboSelections must be an array of at most 48');
  const merged = new Map<string, ComboSelection>();
  for (const raw of v) {
    const s = raw as Record<string, unknown>;
    const slotId = typeof s?.slotId === 'string' ? s.slotId : '';
    const productId = typeof s?.productId === 'string' ? s.productId : '';
    const qty = s?.qty === undefined ? 1 : Number(s.qty);
    if (!UUID_RE.test(slotId) || !UUID_RE.test(productId))
      throw new HttpError(422, 'INVALID_COMBO', 'slotId and productId must be uuids');
    if (!Number.isInteger(qty) || qty < 1 || qty > 99)
      throw new HttpError(422, 'INVALID_COMBO', 'selection qty must be 1–99');
    const key = `${slotId}|${productId}`;
    const prev = merged.get(key);
    merged.set(key, { slotId, productId, qty: (prev?.qty ?? 0) + qty });
  }
  return [...merged.values()].sort((a, b) =>
    a.slotId === b.slotId
      ? a.productId.localeCompare(b.productId)
      : a.slotId.localeCompare(b.slotId),
  );
}

export function validateCombo(
  slots: ComboSlot[],
  selections: ComboSelection[],
): { error: HttpError | null; picks: ComboPick[] } {
  const picks: ComboPick[] = [];
  const fail = (e: HttpError) => ({ error: e, picks: [] });
  for (const sel of selections) {
    const slot = slots.find((s) => s.id === sel.slotId);
    const item = slot?.items.find((i) => i.productId === sel.productId);
    if (!slot || !item)
      return fail(new HttpError(422, 'INVALID_COMBO', 'unknown combo slot or item', { ...sel }));
    if (item.status !== 'active')
      return fail(
        new HttpError(409, 'COMBO_ITEM_SOLD_OUT', `"${item.name}" is sold out`, {
          slotId: slot.id,
          productId: item.productId,
        }),
      );
    if (sel.qty > slot.qtyPerItem)
      return fail(
        new HttpError(
          422,
          'COMBO_ITEM_LIMIT',
          `"${slot.name}" takes at most ${slot.qtyPerItem} of each`,
          {
            slotId: slot.id,
            qtyPerItem: slot.qtyPerItem,
          },
        ),
      );
    picks.push({
      ...sel,
      slotName: slot.name,
      name: item.name,
      priceDeltaCents: item.priceDeltaCents,
    });
  }
  for (const slot of slots) {
    const n = selections.filter((s) => s.slotId === slot.id).reduce((sum, s) => sum + s.qty, 0);
    if (n < slot.minSelect || n > slot.maxSelect)
      return fail(
        new HttpError(
          422,
          'COMBO_SLOT_COUNT',
          slot.minSelect === slot.maxSelect
            ? `choose ${slot.minSelect} in "${slot.name}"`
            : `choose ${slot.minSelect}–${slot.maxSelect} in "${slot.name}"`,
          { slotId: slot.id, minSelect: slot.minSelect, maxSelect: slot.maxSelect, selected: n },
        ),
      );
  }
  return { error: null, picks };
}

export const comboDelta = (picks: Pick<ComboPick, 'priceDeltaCents' | 'qty'>[]) =>
  picks.reduce((sum, p) => sum + p.priceDeltaCents * p.qty, 0);

/**
 * The least a kit's picks can add ("a partir de", display only): validateCombo's rules over the
 * available items — each slot minSelect..maxSelect units, at most qtyPerItem of one item — taking
 * the best count, since a negative delta can make more picks cheaper. null when a slot can't be
 * filled.
 */
export function comboFloorCents(
  slots: readonly Pick<ComboSlot, 'minSelect' | 'maxSelect' | 'qtyPerItem' | 'items'>[],
): number | null {
  let total = 0;
  for (const slot of slots) {
    const units: number[] = [];
    for (const item of slot.items
      .filter((i) => i.status === 'active')
      .sort((a, b) => a.priceDeltaCents - b.priceDeltaCents))
      for (let q = 0; q < slot.qtyPerItem && units.length < slot.maxSelect; q++)
        units.push(item.priceDeltaCents);
    if (units.length < slot.minSelect) return null;
    let best = slot.minSelect <= 0 ? 0 : Infinity;
    let sum = 0;
    for (let k = 1; k <= units.length; k++) {
      sum += units[k - 1]!;
      if (k >= slot.minSelect) best = Math.min(best, sum);
    }
    total += best;
  }
  return total;
}

export interface KitStep {
  id: string | null;
  name: string;
  minSelect: number;
  maxSelect: number;
  qtyPerItem: number;
  items: { productId: string; priceDeltaCents: number }[];
}

/**
 * Writes a kit's steps in place. Bags, shared carts and "pedir de novo" hold slotIds, so a step
 * keeps its id when the client sends it back or, when it sends none, when it sits at the same
 * position under the same name. Items key on (slot, product), which is what a selection names.
 */
export async function saveKitStepsTx(
  tx: Sql,
  tenantId: string,
  productId: string,
  steps: KitStep[],
) {
  const existing = await tx<{ id: string; name: string; sort: number }[]>`
    select id, name, sort from combo_slots where tenant_id = ${tenantId} and product_id = ${productId}
  `;
  const claimed = new Set<string>();
  const ids: (string | null)[] = steps.map((s) => {
    if (!s.id || claimed.has(s.id) || !existing.some((e) => e.id === s.id)) return null;
    claimed.add(s.id);
    return s.id;
  });
  for (const [sort, s] of steps.entries()) {
    if (s.id) continue;
    const same = existing.find((e) => e.sort === sort && e.name === s.name && !claimed.has(e.id));
    if (same) claimed.add((ids[sort] = same.id));
  }
  await tx`
    delete from combo_slots where tenant_id = ${tenantId} and product_id = ${productId}
      and not (id = any(${[...claimed]}::uuid[]))
  `;
  for (const [sort, s] of steps.entries()) {
    const kept = ids[sort];
    if (kept)
      await tx`
        update combo_slots set name = ${s.name}, min_select = ${s.minSelect}, max_select = ${s.maxSelect},
          qty_per_item = ${s.qtyPerItem}, sort = ${sort}
        where tenant_id = ${tenantId} and id = ${kept}
      `;
    const slotId =
      kept ??
      (
        await tx<{ id: string }[]>`
          insert into combo_slots (tenant_id, product_id, name, min_select, max_select, qty_per_item, sort)
          values (${tenantId}, ${productId}, ${s.name}, ${s.minSelect}, ${s.maxSelect}, ${s.qtyPerItem}, ${sort})
          returning id
        `
      )[0]!.id;
    // a product listed twice keeps its first price
    const items = s.items.filter(
      (i, k) => s.items.findIndex((j) => j.productId === i.productId) === k,
    );
    const pids = items.map((i) => i.productId);
    await tx`
      delete from combo_slot_items where tenant_id = ${tenantId} and slot_id = ${slotId}
        and not (product_id = any(${pids}::uuid[]))
    `;
    await tx`
      insert into combo_slot_items (tenant_id, slot_id, product_id, price_delta_cents, sort)
      select ${tenantId}, ${slotId}, v.product_id, v.delta, v.sort
      from unnest(${pids}::uuid[], ${items.map((i) => i.priceDeltaCents)}::int[],
                  ${items.map((_, i) => i)}::int[]) as v(product_id, delta, sort)
      on conflict (slot_id, product_id) do update
        set price_delta_cents = excluded.price_delta_cents, sort = excluded.sort
    `;
  }
}
