import { HttpError } from '../platform/http.ts';

// The admin's pricing calculator (precificação): what a product costs to make, what comes off
// each sale (card or app fee, tax) and the margin the merchant wants → the price that gets there,
// and the margin the current price really leaves. Percentages are basis points (1% = 100).

export interface Pricing {
  lines: { label: string; cents: number }[];
  feeBp: number;
  taxBp: number;
  marginBp: number;
}

export type PricingDefaults = Pick<Pricing, 'feeBp' | 'taxBp' | 'marginBp'>;

export const MAX_COST_CENTS = 10_000_000;
const MAX_LINES = 12;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const bad = (message: string, field: string) =>
  new HttpError(422, 'BAD_REQUEST', message, { field: `pricing.${field}` });

function bp(v: unknown, field: string): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 9900)
    throw bad(`${field} must be 0–9900 (basis points)`, field);
  return v as number;
}

export function parsePricing(v: unknown): Pricing {
  if (!isObj(v)) throw bad('pricing must be an object', 'lines');
  if (!Array.isArray(v.lines) || v.lines.length > MAX_LINES)
    throw bad(`lines: at most ${MAX_LINES}`, 'lines');
  const lines = v.lines.map((l: unknown, i: number) => {
    if (!isObj(l)) throw bad('each line is {label, cents}', `lines[${i}]`);
    const label = typeof l.label === 'string' ? l.label.trim() : '';
    if (label.length < 1 || label.length > 40) throw bad('label: 1–40 chars', `lines[${i}].label`);
    if (
      !Number.isInteger(l.cents) ||
      (l.cents as number) < 0 ||
      (l.cents as number) > MAX_COST_CENTS
    )
      throw bad(`cents: 0–${MAX_COST_CENTS}`, `lines[${i}].cents`);
    return { label, cents: l.cents as number };
  });
  const out = {
    lines,
    feeBp: bp(v.feeBp, 'feeBp'),
    taxBp: bp(v.taxBp, 'taxBp'),
    marginBp: bp(v.marginBp, 'marginBp'),
  };
  if (out.feeBp + out.taxBp + out.marginBp >= 10_000)
    throw bad('fee, tax and margin must add up to less than 100%', 'marginBp');
  if (costOf(out) > MAX_COST_CENTS) throw bad(`the cost adds up past ${MAX_COST_CENTS}`, 'lines');
  return out;
}

export const costOf = (p: Pick<Pricing, 'lines'>) => p.lines.reduce((n, l) => n + l.cents, 0);

/** The price that leaves `marginBp` after cost, fee and tax. */
export function suggestedPriceCents(cost: number, p: PricingDefaults): number {
  return Math.ceil((cost * 10_000) / (10_000 - p.feeBp - p.taxBp - p.marginBp));
}

/** What a sale at `price` really leaves, as a share of the price; null at price 0. */
export function marginBpAt(
  price: number,
  cost: number,
  p: Pick<Pricing, 'feeBp' | 'taxBp'> | null,
) {
  if (price <= 0) return null;
  const off = p ? Math.round((price * (p.feeBp + p.taxBp)) / 10_000) : 0;
  return Math.round(((price - cost - off) * 10_000) / price);
}
