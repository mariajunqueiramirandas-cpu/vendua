import type { CatalogProduct } from '../api.ts';
import { formatCents } from './format.ts';

// Which price a product shows — Core's numbers, one decision for every surface.

export interface PriceDisplay {
  /** plain = the price; from = "a partir de" (options set it); promo = "de … por …" */
  form: 'plain' | 'from' | 'promo';
  /** the price to show */
  cents: number;
  /** the struck "de" price (promo only — never beside a from-price) */
  struckCents: number | null;
  /** the timed promotion's days and hours (Core's copy), when the product has one */
  promoLabel: string | null;
}

export type PriceInput = Pick<CatalogProduct, 'basePriceCents'> &
  Partial<Pick<CatalogProduct, 'compareAtPriceCents' | 'fromPriceCents' | 'promoLabel'>>;

export function priceDisplay(p: PriceInput): PriceDisplay {
  const promoLabel = p.promoLabel ?? null;
  if (p.fromPriceCents != null && p.fromPriceCents > p.basePriceCents)
    return { form: 'from', cents: p.fromPriceCents, struckCents: null, promoLabel };
  if (p.compareAtPriceCents != null && p.compareAtPriceCents > p.basePriceCents)
    return {
      form: 'promo',
      cents: p.basePriceCents,
      struckCents: p.compareAtPriceCents,
      promoLabel,
    };
  return { form: 'plain', cents: p.basePriceCents, struckCents: null, promoLabel };
}

/** The price read aloud: `a partir de R$ 22,90` / `de R$ 24,00 por R$ 18,00` / `R$ 18,00`. */
export function priceWords(d: PriceDisplay, currency = 'BRL'): string {
  if (d.form === 'from') return `a partir de ${formatCents(d.cents, currency)}`;
  if (d.form === 'promo' && d.struckCents != null)
    return `de ${formatCents(d.struckCents, currency)} por ${formatCents(d.cents, currency)}`;
  return formatCents(d.cents, currency);
}
