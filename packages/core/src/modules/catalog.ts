import type { Sql } from '../platform/db.ts';
import type { ComboSlot } from './combos.ts';

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  /** stock-derived: an active product with stockQuantity 0 reads 'sold_out' */
  status: 'active' | 'sold_out' | 'archived';
  figureVariant: 'default' | 'alt';
  tags: string[];
  kind: 'simple' | 'combo';
  /** first gallery image; null = none (figureVariant fallback) */
  imageUrl: string | null;
  /** null = stock not tracked */
  stockQuantity: number | null;
  lowStockThreshold: number | null;
  /** Core's call: tracked, >0 and at/below the threshold */
  lowStock: boolean;
  requiresPreorder: boolean;
  preorderLeadDays: number;
  /** a combo, or a product with modifier groups: the card must open the product page */
  needsChoices: boolean;
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

export interface MediaItem {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface ProductDetail extends ProductSummary {
  modifierGroups: ModifierGroup[];
  gallery: MediaItem[];
  /** kind 'combo' only; [] otherwise */
  comboSlots: ComboSlot[];
  /** people waiting for a restock (sold-out products; social proof) */
  waitlistCount: number;
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
  kind: ProductSummary['kind'];
  image_url: string | null;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
  requires_preorder: boolean;
  preorder_lead_days: number;
  needs_choices: boolean;
}

/** Live availability — stock 0 is sold out without anyone flipping a status. */
export const liveStatus = (status: string, stock: number | null) =>
  status === 'active' && stock === 0 ? 'sold_out' : status;

function toSummary(row: ProductRow): ProductSummary {
  const stock = row.stock_quantity;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    basePriceCents: row.base_price_cents,
    status: liveStatus(row.status, stock) as ProductSummary['status'],
    figureVariant: row.figure_variant,
    tags: row.tags ?? [],
    kind: row.kind ?? 'simple',
    imageUrl: row.image_url,
    stockQuantity: stock,
    lowStockThreshold: row.low_stock_threshold,
    lowStock:
      stock != null &&
      stock > 0 &&
      row.low_stock_threshold != null &&
      stock <= row.low_stock_threshold,
    requiresPreorder: row.requires_preorder,
    preorderLeadDays: row.preorder_lead_days,
    needsChoices: row.needs_choices,
  };
}

const productColumns = (tx: Sql) => tx`
  p.id, p.category_id, p.slug, p.name, p.description, p.base_price_cents, p.status, p.figure_variant,
  p.tags, p.kind, p.stock_quantity, p.low_stock_threshold, p.requires_preorder, p.preorder_lead_days,
  (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as image_url,
  (p.kind = 'combo' or exists (select 1 from modifier_groups g where g.product_id = p.id)) as needs_choices
`;

export async function getCatalog(tx: Sql, tenantId: string): Promise<CategoryWithProducts[]> {
  const categories = await tx<CategoryRow[]>`
    select id, slug, name, sort from categories
    where tenant_id = ${tenantId} order by sort, name
  `;
  const products = await tx<ProductRow[]>`
    select ${productColumns(tx)}
    from products p
    where p.tenant_id = ${tenantId} and p.status != 'archived'
    order by p.name
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
    select ${productColumns(tx)}
    from products p where p.tenant_id = ${tenantId} and p.slug = ${slug} and p.status != 'archived'
    limit 1
  `;
  return attachDetail(tx, tenantId, rows);
}

export async function getProductById(
  tx: Sql,
  tenantId: string,
  id: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ProductDetail | null> {
  const lock = opts.forUpdate ? tx`for update of p` : tx``;
  const rows = await tx<ProductRow[]>`
    select ${productColumns(tx)}
    from products p where p.tenant_id = ${tenantId} and p.id = ${id} and p.status != 'archived'
    limit 1 ${lock}
  `;
  return attachDetail(tx, tenantId, rows, opts);
}

async function attachDetail(
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
  const gallery = await tx<MediaItem[]>`
    select url, alt, width, height from product_media
    where tenant_id = ${tenantId} and product_id = ${product.id} order by sort, id
  `;
  const summary = toSummary(product);
  const waitlistCount =
    summary.status === 'sold_out'
      ? (
          await tx<{ n: number }[]>`
            select count(*)::int as n from notify_requests
            where tenant_id = ${tenantId} and subject = 'product' and product_id = ${product.id}
              and notified_at is null
          `
        )[0]!.n
      : 0;
  return {
    ...summary,
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
    gallery: [...gallery],
    comboSlots: product.kind === 'combo' ? await loadComboSlots(tx, tenantId, product.id) : [],
    waitlistCount,
  };
}

export async function loadComboSlots(
  tx: Sql,
  tenantId: string,
  productId: string,
): Promise<ComboSlot[]> {
  const slots = await tx<
    { id: string; name: string; min_select: number; max_select: number; qty_per_item: number }[]
  >`
    select id, name, min_select, max_select, qty_per_item from combo_slots
    where tenant_id = ${tenantId} and product_id = ${productId} order by sort, name
  `;
  if (slots.length === 0) return [];
  const items = await tx<
    {
      slot_id: string;
      product_id: string;
      slug: string;
      name: string;
      price_delta_cents: number;
      status: string;
      stock_quantity: number | null;
      image_url: string | null;
    }[]
  >`
    select i.slot_id, p.id as product_id, p.slug, p.name, i.price_delta_cents, p.status, p.stock_quantity,
      (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as image_url
    from combo_slot_items i join combo_slots s on s.id = i.slot_id join products p on p.id = i.product_id
    where i.tenant_id = ${tenantId} and s.product_id = ${productId} and p.status != 'archived'
    order by i.sort, p.name
  `;
  return slots.map((s) => ({
    id: s.id,
    name: s.name,
    minSelect: s.min_select,
    maxSelect: s.max_select,
    qtyPerItem: s.qty_per_item,
    items: items
      .filter((i) => i.slot_id === s.id)
      .map((i) => ({
        productId: i.product_id,
        slug: i.slug,
        name: i.name,
        priceDeltaCents: i.price_delta_cents,
        status: liveStatus(i.status, i.stock_quantity),
        stockQuantity: i.stock_quantity,
        imageUrl: i.image_url,
      })),
  }));
}
