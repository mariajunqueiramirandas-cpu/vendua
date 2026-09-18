import type { CatalogCategory, CatalogProduct } from '@vendua/kernel';

/**
 * The Core catalog payload already carries `slug`, `figureVariant` and `tags`
 * — the Phase-0 kernel types don't expose them yet (see OBSERVATIONS.md).
 * Narrowed locally; never widened beyond what the API returns.
 */
export interface FornProduct extends CatalogProduct {
  figureVariant?: 'default' | 'alt';
  tags?: string[];
}

export interface FornCategory extends CatalogCategory {
  slug?: string;
  products: FornProduct[];
}

export function asFornCategories(cats: CatalogCategory[]): FornCategory[] {
  return cats as FornCategory[];
}
