import type { CatalogProduct } from '../api.ts';

// A product card's state: sold out, all of it in the bag, low stock, quick add. Core's
// fields and threshold; the only client input is the stock the cart leaves.

/** The most units one cart line takes (Core's cap). */
export const MAX_LINE_QTY = 99;

export interface CardState {
  /** anything but `active` (Core never serves archived) */
  soldOut: boolean;
  /** when a product sold out by its schedule comes back (Core's copy) */
  scheduleLabel: string | null;
  /** tracked stock minus what the cart holds; null = not tracked */
  stockLeft: number | null;
  /** every unit left is already in the bag */
  allInBag: boolean;
  /** Core's low-stock rule, on the stock left after the bag */
  lowStock: boolean;
  /** the card may add one unit as-is (no page needed) */
  canQuickAdd: boolean;
  /** the most units an add may ask for now */
  maxQty: number;
  /** the one badge to show, by priority: sold-out > all-in-bag > low-stock > preorder */
  badge: 'sold-out' | 'all-in-bag' | 'low-stock' | 'preorder' | null;
}

export type CardInput = Pick<CatalogProduct, 'status'> &
  Partial<
    Pick<
      CatalogProduct,
      | 'availabilityLabel'
      | 'lowStock'
      | 'lowStockThreshold'
      | 'needsChoices'
      | 'kind'
      | 'requiresPreorder'
    >
  >;

export function cardState(p: CardInput, stockLeft: number | null): CardState {
  const soldOut = p.status !== 'active';
  const left = typeof stockLeft === 'number' ? Math.max(0, stockLeft) : null;
  const allInBag = !soldOut && left === 0;
  const lowStock =
    !soldOut &&
    left != null &&
    left > 0 &&
    (p.lowStock === true || (p.lowStockThreshold != null && left <= p.lowStockThreshold));
  const canQuickAdd =
    !soldOut && !allInBag && p.needsChoices === false && p.kind !== 'combo' && !p.requiresPreorder;
  return {
    soldOut,
    scheduleLabel: soldOut ? (p.availabilityLabel ?? null) : null,
    stockLeft: left,
    allInBag,
    lowStock,
    canQuickAdd,
    maxQty: Math.min(MAX_LINE_QTY, left ?? MAX_LINE_QTY),
    badge: soldOut
      ? 'sold-out'
      : allInBag
        ? 'all-in-bag'
        : lowStock
          ? 'low-stock'
          : p.requiresPreorder
            ? 'preorder'
            : null,
  };
}
