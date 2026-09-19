import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import type { ModifierGroup, ProductDetail } from './catalog.ts';
import type { StoreSettingsRow } from './store.ts';

/**
 * cart module — server-side carts, the non-negotiable from
 * docs/architecture/01-core.md#server-side-cart--non-negotiable. All pricing
 * is computed here from live rows; the Kernel only renders what Core returns.
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
  name: string;
  slug: string;
  base_price_cents: number;
  product_status: string;
}

export interface PricedItem {
  id: string;
  productId: string;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  /** Live product status — storefronts badge lines that went unavailable
   *  between carting and checkout; checkout revalidates against it. */
  productStatus: string;
  modifiers: { id: string; name: string; priceDeltaCents: number; status: string }[];
  lineTotalCents: number;
}

export interface CartTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  itemCount: number;
  minOrderCents: number;
  belowMinOrder: boolean;
}

export interface CartView {
  id: string;
  status: 'open' | 'completed' | 'abandoned';
  items: PricedItem[];
  totals: CartTotals;
  delivery: { mode: 'pickup' | 'delivery'; neighborhood?: string; zoneId?: string } | null;
}

/** Sum of base price + selected modifier deltas. Pure — unit-tested. */
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
    belowMinOrder: itemCount > 0 && subtotal < minOrderCents,
  };
}

/**
 * Validates a proposed item against the product's modifier rules. Pure —
 * unit-tested. Returns an HttpError code or null when valid.
 */
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
    select ci.id, ci.product_id, ci.qty, ci.modifier_ids, p.name, p.slug,
           p.base_price_cents, p.status as product_status
    from cart_items ci join products p on p.id = ci.product_id
    where ci.tenant_id = ${tenantId} and ci.cart_id = ${cartId}
    order by ci.created_at
  `;
  if (items.length === 0) return [];
  const modifierIds = items.flatMap((i) => i.modifier_ids);
  const mods = modifierIds.length
    ? await tx<{ id: string; name: string; price_delta_cents: number; status: string }[]>`
        select id, name, price_delta_cents, status from modifiers
        where tenant_id = ${tenantId} and id = any(${modifierIds}::uuid[])
      `
    : [];
  const byId = new Map(mods.map((m) => [m.id, m]));
  return items.map((item) => {
    const chosen = item.modifier_ids
      .map((id) => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => m != null);
    const unit = unitPriceCents(
      item.base_price_cents,
      chosen.map((m) => m.price_delta_cents),
    );
    return {
      id: item.id,
      productId: item.product_id,
      slug: item.slug,
      name: item.name,
      qty: item.qty,
      unitPriceCents: unit,
      productStatus: item.product_status,
      modifiers: chosen.map((m) => ({
        id: m.id,
        name: m.name,
        priceDeltaCents: m.price_delta_cents,
        status: m.status,
      })),
      lineTotalCents: unit * item.qty,
    };
  });
}

/**
 * Guards a mutation: the cart must exist and still be open. A completed cart
 * is a 409 (not 404) — the resource exists, it just isn't mutable.
 */
export async function assertCartOpen(tx: Sql, tenantId: string, cartId: string): Promise<void> {
  const rows = await tx<{ status: string }[]>`
    select status from carts where tenant_id = ${tenantId} and id = ${cartId}
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
  if (cart.delivery?.mode === 'delivery') {
    const zone = matchZone(zones, cart.delivery.neighborhood);
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
    delivery: cart.delivery,
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
  // Dedupe + sort: a repeated id would charge the modifier twice, and
  // order-independence makes reordered selections merge into the same line.
  const modifierIds = [...new Set(input.modifierIds ?? [])].sort();
  const invalid = validateItemModifiers(product, modifierIds);
  if (invalid) throw invalid;

  // Same product + same modifier set merges into one line. The merged qty is
  // capped by cart_items' CHECK (qty <= 99) — a check_violation surfaces as
  // INVALID_QTY, identical to the PATCH endpoint's contract.
  try {
    await tx`
      insert into cart_items (tenant_id, cart_id, product_id, qty, modifier_ids)
      values (${tenantId}, ${cartId}, ${input.productId}, ${input.qty}, ${tx.json(modifierIds)})
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
