import type { CatalogProduct } from '../api.ts';

// Kernel 1.21 — what a product states about allergens and diets (Core's `dietary`, migration
// 0082's tags). The merchant states them; the Kernel only words them and filters by them.

/** Core's tags in words, in the order badges show them. Unknown tags have no words: skip them. */
export const DIETARY_LABEL: Readonly<Record<string, string>> = {
  vegano: 'Vegano',
  vegetariano: 'Vegetariano',
  sem_gluten: 'Sem glúten',
  sem_lactose: 'Sem lactose',
  apimentado: 'Apimentado',
  contem_gluten: 'Contém glúten',
  contem_lactose: 'Contém lactose',
  contem_ovo: 'Contém ovo',
  contem_amendoim: 'Contém amendoim',
  contem_castanhas: 'Contém castanhas',
  contem_frutos_do_mar: 'Contém frutos do mar',
};

/** The tags a shopper can narrow the menu to: what a product is. Never the absence of an
 *  allergen warning — a product without "contém amendoim" isn't declared free of it. */
export const DIETARY_FILTERS: readonly string[] = [
  'vegano',
  'vegetariano',
  'sem_gluten',
  'sem_lactose',
];

export interface DietaryBadge {
  tag: string;
  label: string;
  /** diet = a choice (vegano, sem glúten); allergen = a warning (contém …); spicy */
  kind: 'diet' | 'allergen' | 'spicy';
}

/** A product's known tags as badges, diets first, then the spicy flag, then allergens. */
export function dietaryBadges(product: Pick<CatalogProduct, 'dietary'>): DietaryBadge[] {
  const tags = new Set(Array.isArray(product.dietary) ? product.dietary : []);
  return Object.keys(DIETARY_LABEL)
    .filter((tag) => tags.has(tag))
    .map((tag) => ({
      tag,
      label: DIETARY_LABEL[tag]!,
      kind: tag.startsWith('contem_') ? 'allergen' : tag === 'apimentado' ? 'spicy' : 'diet',
    }));
}
