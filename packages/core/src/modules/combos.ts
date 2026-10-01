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
