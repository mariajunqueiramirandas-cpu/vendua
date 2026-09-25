import type { Sql } from '../platform/db.ts';

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  status: 'active' | 'sold_out' | 'archived';
  figureVariant: 'default' | 'alt';
  tags: string[];
}

export interface CategoryWithProducts {
  id: string;
  slug: string;
  name: string;
  sort: number;
  products: ProductSummary[];
}

export interface Modifier {
  id: string;
  name: string;
  priceDeltaCents: number;
  status: 'active' | 'sold_out';
}

export interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface ProductDetail extends ProductSummary {
  modifierGroups: ModifierGroup[];
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  sort: number;
}

interface ProductRow {
  id: string;
  category_id: string;
  slug: string;
  name: string;
  description: string | null;
  base_price_cents: number;
  status: ProductSummary['status'];
  figure_variant: ProductSummary['figureVariant'];
  tags: string[];
}

function toSummary(row: ProductRow): ProductSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    basePriceCents: row.base_price_cents,
    status: row.status,
    figureVariant: row.figure_variant,
    tags: row.tags ?? [],
  };
}

export async function getCatalog(tx: Sql, tenantId: string): Promise<CategoryWithProducts[]> {
  const categories = await tx<CategoryRow[]>`
    select id, slug, name, sort from categories
    where tenant_id = ${tenantId} order by sort, name
  `;
  const products = await tx<ProductRow[]>`
    select id, category_id, slug, name, description, base_price_cents, status, figure_variant, tags
    from products
    where tenant_id = ${tenantId} and status != 'archived'
    order by name
  `;
  return categories.map((cat) => ({
    id: cat.id,
    slug: cat.slug,
    name: cat.name,
    sort: cat.sort,
    products: products.filter((p) => p.category_id === cat.id).map(toSummary),
  }));
}

export async function getProduct(
  tx: Sql,
  tenantId: string,
  slug: string,
): Promise<ProductDetail | null> {
  const rows = await tx<ProductRow[]>`
    select id, category_id, slug, name, description, base_price_cents, status, figure_variant, tags
    from products where tenant_id = ${tenantId} and slug = ${slug} and status != 'archived'
    limit 1
  `;
  return attachModifierGroups(tx, tenantId, rows);
}

export async function getProductById(
  tx: Sql,
  tenantId: string,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ProductDetail | null> {
  const lock = opts.forUpdate ? tx`for update` : tx``;
  const rows = await tx<ProductRow[]>`
    select id, category_id, slug, name, description, base_price_cents, status, figure_variant, tags
    from products where tenant_id = ${tenantId} and id = ${id} and status != 'archived'
    limit 1 ${lock}
  `;
  return attachModifierGroups(tx, tenantId, rows, opts);
}

async function attachModifierGroups(
  tx: Sql,
  tenantId: string,
  rows: ProductRow[],
  opts: { forUpdate?: boolean } = {},
): Promise<ProductDetail | null> {
  const product = rows[0];
  if (!product) return null;
  const lock = opts.forUpdate ? tx`for update` : tx``;
  const groups = await tx<
    {
      id: string;
      name: string;
      required: boolean;
      min_select: number;
      max_select: number;
      sort: number;
    }[]
  >`
    select id, name, required, min_select, max_select, sort from modifier_groups
    where tenant_id = ${tenantId} and product_id = ${product.id} order by sort, name ${lock}
  `;
  const modifiers = await tx<
    {
      id: string;
      group_id: string;
      name: string;
      price_delta_cents: number;
      status: 'active' | 'sold_out';
      sort: number;
    }[]
  >`
    select m.id, m.group_id, m.name, m.price_delta_cents, m.status, m.sort
    from modifiers m join modifier_groups g on g.id = m.group_id
    where m.tenant_id = ${tenantId} and g.product_id = ${product.id}
    order by m.sort, m.name ${lock}
  `;
  return {
    ...toSummary(product),
    modifierGroups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      required: g.required,
      minSelect: g.min_select,
      maxSelect: g.max_select,
      modifiers: modifiers
        .filter((m) => m.group_id === g.id)
        .map((m) => ({
          id: m.id,
          name: m.name,
          priceDeltaCents: m.price_delta_cents,
          status: m.status,
        })),
    })),
  };
}
