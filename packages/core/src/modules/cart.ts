import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { ModifierGroup, ProductDetail } from './catalog.ts';
import type { StoreSettingsRow } from './store.ts';

/**
 * Server-side carts (non-negotiable — docs/architecture/01-core.md): all
 * pricing computed here from live rows; the Kernel only renders.
 */

export interface CartItemIn {
  productId: string;
  qty: number;
  modifierIds?: string[];
}

interface ItemRow {
  id: string;
  product_id: string;
  qty: number;
  modifier_ids: string[];
  /** Price accepted at add time — never repriced from live catalog rows. */
  unit_price_cents: number;
  /** [{id, name, priceDeltaCents}] frozen at add time; status stays live. */
  modifier_snapshot: { id: string; name: string; priceDeltaCents: number }[];
  name: string;
  slug: string;
  product_status: string;
}

export interface PricedItem {
  id: string;
  productId: string;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  /** live product status — badge lines that went unavailable since carting */
  productStatus: string;
  modifiers: { id: string; name: string; priceDeltaCents: number; status: string }[];
  /** modifier ids as submitted; checkout revalidates against the live product */
  modifierIds: string[];
  lineTotalCents: number;
}

export interface CartTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  itemCount: number;
  minOrderCents: number;
  /** cents short of the minimum order (Core owns money math) */
  remainingMinOrderCents: number;
  belowMinOrder: boolean;
}

export interface CartView {
  id: string;
  status: 'open' | 'completed' | 'abandoned';
  items: PricedItem[];
  totals: CartTotals;
  delivery: {
    mode: 'pickup' | 'delivery';
    neighborhood?: string;
    address?: string;
    zoneId?: string | null;
  } | null;
}

export function unitPriceCents(basePriceCents: number, deltas: number[]): number {
  return basePriceCents + deltas.reduce((sum, d) => sum + d, 0);
}

export function computeTotals(
  items: { qty: number; lineTotalCents: number }[],
  deliveryFeeCents: number,
  minOrderCents: number,
): CartTotals {
  const subtotal = items.reduce((s, i) => s + i.lineTotalCents, 0);
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  return {
    subtotalCents: subtotal,
    deliveryFeeCents,
    totalCents: subtotal + deliveryFeeCents,
    itemCount,
    minOrderCents,
    remainingMinOrderCents: Math.max(0, minOrderCents - subtotal),
    belowMinOrder: itemCount > 0 && subtotal < minOrderCents,
  };
}

export function validateItemModifiers(
  product: Pick<ProductDetail, 'status' | 'modifierGroups'>,
  modifierIds: string[],
): HttpError | null {
  if (product.status !== 'active') return new HttpError(409, 'SOLD_OUT', 'product is sold out');

  const byId = new Map(
    product.modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m] as const)),
  );
  for (const id of modifierIds) {
    const modifier = byId.get(id);
    if (!modifier) {
      return new HttpError(422, 'INVALID_MODIFIER', `unknown modifier ${id}`);
    }
    if (modifier.status === 'sold_out') {
      return new HttpError(409, 'MODIFIER_SOLD_OUT', `"${modifier.name}" is sold out`);
    }
  }
  for (const group of product.modifierGroups) {
    const selected = modifierIds.filter((id) => group.modifiers.some((m) => m.id === id)).length;
    if (group.required && selected < Math.max(1, group.minSelect)) {
      return new HttpError(
        422,
        'MODIFIER_REQUIRED',
        `choose at least ${Math.max(1, group.minSelect)} in "${group.name}"`,
      );
    }
    if (selected > group.maxSelect) {
      return new HttpError(
        422,
        'MODIFIER_LIMIT',
        `"${group.name}" accepts at most ${group.maxSelect}`,
      );
    }
  }
  return null;
}

async function loadPricedItems(tx: Sql, tenantId: string, cartId: string): Promise<PricedItem[]> {
  const items = await tx<ItemRow[]>`
    select ci.id, ci.product_id, ci.qty, ci.modifier_ids, ci.unit_price_cents,
           ci.modifier_snapshot, p.name, p.slug, p.status as product_status
    from cart_items ci join products p on p.id = ci.product_id
    where ci.tenant_id = ${tenantId} and ci.cart_id = ${cartId}
    order by ci.created_at
  `;
  if (items.length === 0) return [];
  // live read is only for status — names/prices come from the add-time
  // snapshot, never repriced
  const modifierIds = items.flatMap((i) => i.modifier_ids);
  const mods = modifierIds.length
    ? await tx<{ id: string; status: string }[]>`
        select id, status from modifiers
        where tenant_id = ${tenantId} and id = any(${modifierIds}::uuid[])
      `
    : [];
  const liveStatus = new Map(mods.map((m) => [m.id, m.status]));
  return items.map((item) => {
    return {
      id: item.id,
      productId: item.product_id,
      slug: item.slug,
      name: item.name,
      qty: item.qty,
      unitPriceCents: item.unit_price_cents,
      productStatus: item.product_status,
      modifierIds: item.modifier_ids,
      modifiers: item.modifier_snapshot.map((m) => ({
        id: m.id,
        name: m.name,
        priceDeltaCents: m.priceDeltaCents,
        status: liveStatus.get(m.id) ?? 'archived',
      })),
      lineTotalCents: item.unit_price_cents * item.qty,
    };
  });
}

/** Cart must exist and be open; a completed cart is 409, not 404. */
export async function assertCartOpen(tx: Sql, tenantId: string, cartId: string): Promise<void> {
  // FOR UPDATE serializes mutations with checkout — a mutation lands
  // before or re-reads the completed status and 409s
  const rows = await tx<{ status: string }[]>`
    select status from carts where tenant_id = ${tenantId} and id = ${cartId} for update
  `;
  const cart = rows[0];
  if (!cart) throw new HttpError(404, 'CART_NOT_FOUND', 'cart not found');
  if (cart.status !== 'open') {
    throw new HttpError(409, 'CART_NOT_OPEN', 'cart is not open', { cartStatus: cart.status });
  }
}

interface ZoneRow {
  id: string;
  name: string;
  neighborhoods: string[];
  fee_cents: number;
  min_order_cents: number;
  eta_min_minutes: number;
  eta_max_minutes: number;
}

export function matchZone(zones: ZoneRow[], neighborhood: string | undefined): ZoneRow | null {
  if (!neighborhood) return null;
  const needle = neighborhood.trim().toLowerCase();
  return zones.find((z) => z.neighborhoods.some((n) => n.toLowerCase() === needle)) ?? null;
}

export async function loadCartView(tx: Sql, tenantId: string, cartId: string): Promise<CartView> {
  const carts = await tx<
    { id: string; status: CartView['status']; delivery: CartView['delivery'] }[]
  >`
    select id, status, delivery from carts where tenant_id = ${tenantId} and id = ${cartId}
  `;
  const cart = carts[0];
  if (!cart) throw new HttpError(404, 'CART_NOT_FOUND', 'cart not found');
  const items = await loadPricedItems(tx, tenantId, cartId);
  const settings = (
    await tx<StoreSettingsRow[]>`select * from store_settings where tenant_id = ${tenantId}`
  )[0];
  const zones = await tx<ZoneRow[]>`
    select id, name, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes
    from delivery_zones where tenant_id = ${tenantId} and active
  `;

  let deliveryFee = 0;
  let effectiveMinOrder = settings?.min_order_cents ?? 0;
  let zone: ZoneRow | null = null;
  if (cart.delivery?.mode === 'delivery') {
    zone = matchZone(zones, cart.delivery.neighborhood);
    if (zone) {
      deliveryFee = zone.fee_cents;
      effectiveMinOrder = Math.max(effectiveMinOrder, zone.min_order_cents);
    }
  }
  return {
    id: cart.id,
    status: cart.status,
    items,
    totals: computeTotals(items, deliveryFee, effectiveMinOrder),
    // a zero fee can mean a free zone — branch on zoneId, not the amount
    delivery: cart.delivery ? { ...cart.delivery, zoneId: zone?.id ?? null } : null,
  };
}

export async function addItem(
  tx: Sql,
  tenantId: string,
  cartId: string,
  input: CartItemIn,
  getProductById: (tx: Sql, tenantId: string, id: string) => Promise<ProductDetail | null>,
): Promise<CartView> {
  if (!Number.isInteger(input.qty) || input.qty <= 0 || input.qty > 99) {
    throw new HttpError(422, 'INVALID_QTY', 'qty must be an integer between 1 and 99');
  }
  const product = await getProductById(tx, tenantId, input.productId);
  if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
  // dedupe + sort: a repeated id would double-charge; order-independence
  // merges reordered selections into one line
  const modifierIds = [...new Set(input.modifierIds ?? [])].sort();
  const invalid = validateItemModifiers(product, modifierIds);
  if (invalid) throw invalid;

  // freeze the accepted price — later catalog edits never reprice a line
  // or checkout total
  const allModifiers = product.modifierGroups.flatMap((g) => g.modifiers);
  const chosen = modifierIds.map((id) => allModifiers.find((m) => m.id === id)!);
  const snapshot = chosen.map((m) => ({
    id: m.id,
    name: m.name,
    priceDeltaCents: m.priceDeltaCents,
  }));
  const unit = unitPriceCents(
    product.basePriceCents,
    chosen.map((m) => m.priceDeltaCents),
  );

  // same product + modifier set merges into one line; merged qty capped by
  // CHECK (qty <= 99) → INVALID_QTY like PATCH
  try {
    await tx`
      insert into cart_items (tenant_id, cart_id, product_id, qty, modifier_ids, unit_price_cents, modifier_snapshot)
      values (${tenantId}, ${cartId}, ${input.productId}, ${input.qty}, ${tx.json(modifierIds)}, ${unit}, ${tx.json(snapshot)})
      on conflict (cart_id, product_id, modifier_ids)
      do update set qty = cart_items.qty + excluded.qty
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23514') {
      throw new HttpError(422, 'INVALID_QTY', 'line quantity cannot exceed 99');
    }
    throw err;
  }
  await tx`update carts set updated_at = now() where id = ${cartId}`;
  return loadCartView(tx, tenantId, cartId);
}
