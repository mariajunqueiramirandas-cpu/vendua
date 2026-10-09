import type { CatalogCategory, CatalogProduct } from '../api.ts';
import { DIETARY_FILTERS, DIETARY_LABEL } from './dietary.ts';
import { foldText } from './format.ts';

// The menu as a shopper browses it: search, diet filters, empty categories dropped, sold out
// last.

/** Accent- and case-blind: the product's name or description, or its category's name. Kernel
 *  1.21: or a diet it states ("vegano", "sem glúten"); with `dietary`, only products stating
 *  every one of those tags. */
export function matchProduct(
  product: Pick<CatalogProduct, 'name'> & Partial<Pick<CatalogProduct, 'description' | 'dietary'>>,
  categoryName: string,
  query: string,
  dietary: readonly string[] = [],
): boolean {
  const tags = product.dietary ?? [];
  if (!dietary.every((t) => tags.includes(t))) return false;
  const q = foldText(query.trim());
  if (!q) return true;
  return (
    foldText(categoryName).includes(q) ||
    foldText(product.name).includes(q) ||
    foldText(product.description ?? '').includes(q) ||
    tags.some((t) => DIETARY_FILTERS.includes(t) && foldText(DIETARY_LABEL[t] ?? '').includes(q))
  );
}

/** A category-name hit keeps all its products; categories left empty are dropped; within a
 *  category sold-out products follow the available ones (otherwise Core's order). Kernel 1.21:
 *  `dietary` keeps only products stating every one of those tags (`DIETARY_FILTERS`). */
export function arrangeMenu(
  categories: readonly CatalogCategory[],
  opts: { query?: string; dietary?: readonly string[] } = {},
): CatalogCategory[] {
  const query = opts.query ?? '';
  const dietary = opts.dietary ?? [];
  return categories
    .map((c) => ({
      ...c,
      products: c.products
        .filter((p) => matchProduct(p, c.name, query, dietary))
        .map((p, i) => ({ p, i }))
        .sort(
          (a, b) => Number(a.p.status !== 'active') - Number(b.p.status !== 'active') || a.i - b.i,
        )
        .map(({ p }) => p),
    }))
    .filter((c) => c.products.length > 0);
}
