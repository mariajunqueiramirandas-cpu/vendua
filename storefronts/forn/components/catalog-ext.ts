import type { CatalogCategory, CatalogProduct } from '@vendua/kernel';

// aliases so call sites read as forn-domain names
export type FornProduct = CatalogProduct;
export type FornCategory = CatalogCategory;

export function asFornCategories(cats: CatalogCategory[]): FornCategory[] {
  return cats;
}
