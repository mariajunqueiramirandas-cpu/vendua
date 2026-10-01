import type { CatalogCategory, CatalogProduct } from '../api.ts';
import { foldText } from './format.ts';

// The menu as a shopper browses it: search, empty categories dropped, sold out last.

/** Accent- and case-blind: the product's name or description, or its category's name. */
export function matchProduct(
  product: Pick<CatalogProduct, 'name'> & Partial<Pick<CatalogProduct, 'description'>>,
  categoryName: string,
  query: string,
): boolean {
  const q = foldText(query.trim());
  if (!q) return true;
  return (
    foldText(categoryName).includes(q) ||
    foldText(product.name).includes(q) ||
    foldText(product.description ?? '').includes(q)
  );
}

/** A category-name hit keeps all its products; categories left empty are dropped; within a
 *  category sold-out products follow the available ones (otherwise Core's order). */
export function arrangeMenu(
  categories: readonly CatalogCategory[],
  opts: { query?: string } = {},
): CatalogCategory[] {
  const query = opts.query ?? '';
  return categories
    .map((c) => ({
      ...c,
      products: c.products
        .filter((p) => matchProduct(p, c.name, query))
        .map((p, i) => ({ p, i }))
        .sort(
          (a, b) => Number(a.p.status !== 'active') - Number(b.p.status !== 'active') || a.i - b.i,
        )
        .map(({ p }) => p),
    }))
    .filter((c) => c.products.length > 0);
}
