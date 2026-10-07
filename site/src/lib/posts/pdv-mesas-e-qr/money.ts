// The PDV's money rules, copied from Core so the widgets compute what the store would:
// packages/core/src/modules/pdv/pricing.ts (serviceCents, splitShares, MAX_PAYMENTS),
// packages/core/src/modules/pdv/ledger.ts (billOf: service on consumo minus desconto) and
// apps/admin/src/features/pdv/PaySheet.tsx (BILLS, the quick cash amounts). Integer cents only.

const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** "R$ 1.234,56" (with a plain space, so the text wraps and greps like the rest of the site) */
export const brl = (cents: number) => fmt.format(cents / 100).replace(/ /g, ' ');

export const MAX_PAYMENTS = 10;
export const MAX_WAYS = 20;
export const MIN_WAYS = 2;
export const MAX_SERVICE_BPS = 2000;
export const MAX_PENDING_AT_TABLE = 5;

/** the notes the cash keypad offers, above the amount to pay */
export const BILLS = [500, 1000, 2000, 5000, 10000, 20000];

export function serviceCents(bps: number, base: number): number {
  return base <= 0 || bps <= 0 ? 0 : Math.round((base * bps) / 10_000);
}

/** `ways` shares of `cents`, the first ones carrying the leftover cents */
export function splitShares(cents: number, ways: number): number[] {
  if (cents <= 0) return Array.from({ length: ways }, () => 0);
  const base = Math.floor(cents / ways);
  const extra = cents - base * ways;
  return Array.from({ length: ways }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "23,5" / "R$ 23,50" / "1.200" → cents; null when it isn't an amount */
export function parseCents(raw: string): number | null {
  const s = raw.replace(/R\$|\s/g, '').replace(/\./g, '');
  const m = /^(\d{1,6})(?:,(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const reais = Number(m[1]);
  const cents = Number((m[2] ?? '').padEnd(2, '0'));
  return reais * 100 + cents;
}

/** "R$ 23,50" → "23,50", for an input that shows the R$ beside it */
export const plain = (cents: number) => brl(cents).replace('R$', '').trim();
