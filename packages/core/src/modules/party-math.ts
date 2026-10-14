// Festa calculada (docs/features/festa-calculada.md §4.1): guests → pieces per group → sales per
// product. Integers only; every quantity rounds up, so a party never runs short.

export interface PartyGroupRule {
  id: string;
  name: string;
  /** thousandths of a piece per guest */
  perGuestMilli: number;
}

export interface PartyPick {
  productId: string;
  /** pieces in one sale (100 for a cento) */
  unitsPerSale: number;
}

export interface PartyLinePlan {
  productId: string;
  groupId: string;
  /** sales of the product (what the cart line holds) */
  qty: number;
  /** pieces those sales hold */
  units: number;
  /** pieces this product was asked to cover */
  wanted: number;
}

/** a line's quantity cap (cart_items_qty_range): a party line past it is refused */
export const PARTY_LINE_QTY_MAX = 99;

/** guests in thousandths of an adult: a child counts `childFactorBps` / 10000 */
export function guestsMilli(adults: number, children: number, childFactorBps: number): number {
  return adults * 1000 + Math.floor((children * childFactorBps) / 10);
}

/** pieces of a group for that many guests, rounded up */
export function groupUnits(guestsM: number, perGuestMilli: number): number {
  return Math.ceil((guestsM * perGuestMilli) / 1_000_000);
}

/**
 * A group's pieces split evenly across the picked products (the remainder to the first ones),
 * each rounded up to whole sales.
 */
export function splitGroup(groupId: string, units: number, picks: PartyPick[]): PartyLinePlan[] {
  if (!picks.length || units <= 0) return [];
  const each = Math.floor(units / picks.length);
  const extra = units % picks.length;
  return picks
    .map((p, i) => {
      const wanted = each + (i < extra ? 1 : 0);
      const qty = Math.ceil(wanted / p.unitsPerSale);
      return { productId: p.productId, groupId, qty, units: qty * p.unitsPerSale, wanted };
    })
    .filter((l) => l.qty > 0);
}

/** "200 de 600 salgados · 2 × 100": this product's share of its group, and the sales it takes */
export function lineReason(
  groupName: string,
  groupTotal: number,
  line: Pick<PartyLinePlan, 'qty' | 'wanted'>,
  unitsPerSale: number,
): string {
  const sale = unitsPerSale === 1 ? `${line.qty}` : `${line.qty} × ${unitsPerSale}`;
  const share = line.wanted === groupTotal ? `${groupTotal}` : `${line.wanted} de ${groupTotal}`;
  return `${share} ${groupName.toLocaleLowerCase('pt-BR')} · ${sale}`;
}
