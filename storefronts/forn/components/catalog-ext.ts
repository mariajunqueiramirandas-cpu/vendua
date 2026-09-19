import type { CatalogCategory, CatalogProduct } from '@vendua/kernel';

/**
 * `slug`, `figureVariant` and `tags` are now first-class on the kernel types
 * (spike observation absorbed into the base). These aliases stay so call
 * sites read as forn-domain names.
 */
export type FornProduct = CatalogProduct;
export type FornCategory = CatalogCategory;

export function asFornCategories(cats: CatalogCategory[]): FornCategory[] {
  return cats;
}
