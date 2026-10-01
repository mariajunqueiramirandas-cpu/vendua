import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import {
  liveStatus,
  scheduleOpen,
  type AvailabilitySchedule,
  type ModifierGroup,
  type ScheduledComboSlotItem,
  type ProductDetail,
} from './catalog.ts';
import { comboDelta, parseSelections, validateCombo, type ComboSelection } from './combos.ts';
import { couponLabel, couponUsage, evaluateCoupon, loadCoupon } from './coupons.ts';
import { effectiveFee, foldName, resolveZone, validCoords, type ZoneLike } from './geo.ts';
import { adjustmentFor, paymentAdjustmentCents } from './payment-adjustments.ts';
import { scheduleView, type ScheduleView } from './preorder.ts';
import { assertStock, stockDemand } from './stock.ts';
import type { StoreSettingsRow } from './store.ts';

/**
 * Server-side carts (non-negotiable — docs/architecture/01-core.md): all
 * pricing computed here from live rows; the Kernel only renders.
 */

export interface CartItemIn {
  productId: string;
  qty: number;
  modifierIds?: string[];
  comboSelections?: ComboSelection[];
}

interface ItemRow {
  id: string;
  product_id: string;
  qty: number;
  modifier_ids: string[];
  /** Price accepted at add time — checkout refreshes it to the live price (repriceLines). */
  unit_price_cents: number;
  /** [{id, name, priceDeltaCents}] frozen at add time; status stays live. */
  modifier_snapshot: { id: string; name: string; priceDeltaCents: number }[];
  combo_selections: ComboSelection[];
  combo_snapshot: {
    slotId: string;
    slotName: string;
    productId: string;
    name: string;
    qty: number;
    priceDeltaCents: number;
  }[];
  name: string;
  slug: string;
  product_status: string;
  stock_quantity: number | null;
  requires_preorder: boolean;
  preorder_lead_days: number;
  image_url: string | null;
  availability_schedule: AvailabilitySchedule | null;
}

export interface ComboLine {
  slotId: string;
  slotName: string;
  productId: string;
  name: string;
  qty: number;
  priceDeltaCents: number;
  /** live availability of the picked item */
  status: string;
  /** the picked item's tracked stock (null = not tracked) — storefronts cap the kit's qty */
  stockQuantity: number | null;
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
  /** kit picks (kind 'combo'); [] otherwise */
  combo: ComboLine[];
  comboSelections: ComboSelection[];
  lineTotalCents: number;
  imageUrl: string | null;
  stockQuantity: number | null;
  requiresPreorder: boolean;
  preorderLeadDays: number;
}

export interface AppliedCoupon {
  code: string;
  label: string;
  kind: 'percent' | 'fixed' | 'free_delivery';
  /** false = kept on the cart but not discounting now; `reason` says why */
  applies: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface CartTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  discountCents: number;
  /** the chosen payment method's discount (<0) or surcharge (>0); 0 without one */
  paymentAdjustmentCents: number;
  totalCents: number;
  itemCount: number;
  minOrderCents: number;
  /** cents short of the minimum order (Core owns money math) */
  remainingMinOrderCents: number;
  belowMinOrder: boolean;
  /** the matched zone's free-delivery threshold, when it has one */
  freeDeliveryThresholdCents: number | null;
  /** cents short of free delivery; 0 once reached; null without a threshold */
  freeDeliveryRemainingCents: number | null;
}

export interface CartDelivery {
  mode: 'pickup' | 'delivery';
  neighborhood?: string | null;
  address?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  reference?: string | null;
  cep?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface CartView {
  id: string;
  status: 'open' | 'completed' | 'abandoned';
  items: PricedItem[];
  totals: CartTotals;
  delivery:
    | (CartDelivery & {
        zoneId?: string | null;
        zoneName?: string | null;
        distanceKm?: number | null;
        etaMin?: number | null;
        etaMax?: number | null;
      })
    | null;
  coupon: AppliedCoupon | null;
  /** encomenda calendar — dates Core accepts for `scheduledFor` */
  schedule: ScheduleView;
}

export function unitPriceCents(basePriceCents: number, deltas: number[]): number {
  return basePriceCents + deltas.reduce((sum, d) => sum + d, 0);
}

export function computeTotals(
  items: { qty: number; lineTotalCents: number }[],
  deliveryFeeCents: number,
  minOrderCents: number,
  discountCents = 0,
  freeDeliveryThresholdCents: number | null = null,
  paymentAdjustmentCents = 0,
): CartTotals {
  const subtotal = items.reduce((s, i) => s + i.lineTotalCents, 0);
  const itemCount = items.reduce((s, i) => s + i.qty, 0);
  const discount = Math.max(0, Math.min(discountCents, subtotal + deliveryFeeCents));
  const adjustment = Math.max(paymentAdjustmentCents, -(subtotal + deliveryFeeCents - discount));
  return {
    subtotalCents: subtotal,
    deliveryFeeCents,
    discountCents: discount,
    paymentAdjustmentCents: adjustment,
    totalCents: subtotal + deliveryFeeCents - discount + adjustment,
    itemCount,
    minOrderCents,
    remainingMinOrderCents: Math.max(0, minOrderCents - subtotal),
    belowMinOrder: itemCount > 0 && subtotal < minOrderCents,
    freeDeliveryThresholdCents,
    freeDeliveryRemainingCents:
      freeDeliveryThresholdCents == null
        ? null
        : Math.max(0, freeDeliveryThresholdCents - subtotal),
  };
}

export function validateItemModifiers(
  product: Pick<ProductDetail, 'status' | 'modifierGroups' | 'availabilityLabel'>,
  modifierIds: string[],
): HttpError | null {
  if (product.status !== 'active')
    return product.availabilityLabel
      ? new HttpError(409, 'SOLD_OUT', 'product is outside its availability schedule', {
          reason: 'schedule',
          availabilityLabel: product.availabilityLabel,
        })
      : new HttpError(409, 'SOLD_OUT', 'product is sold out');

  const byId = new Map(
    product.modifierGroups.flatMap((g: ModifierGroup) =>
      g.modifiers.map((m) => [m.id, m] as const),
    ),
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

/** Modifiers + kit composition against the live product — shared by add and checkout. */
export function validateLine(
  product: Pick<
    ProductDetail,
    'status' | 'modifierGroups' | 'kind' | 'comboSlots' | 'availabilityLabel'
  >,
  modifierIds: string[],
  selections: ComboSelection[],
): HttpError | null {
  const invalid = validateItemModifiers(product, modifierIds);
  if (invalid) return invalid;
  if (product.kind !== 'combo') {
    return selections.length > 0
      ? new HttpError(422, 'INVALID_COMBO', 'only kits take comboSelections')
      : null;
  }
  for (const sel of selections) {
    const item = product.comboSlots
      .find((s) => s.id === sel.slotId)
      ?.items.find((i) => i.productId === sel.productId) as ScheduledComboSlotItem | undefined;
    if (item?.availabilityLabel)
      return new HttpError(409, 'SOLD_OUT', `"${item.name}" is outside its availability schedule`, {
        reason: 'schedule',
        slotId: sel.slotId,
        productId: item.productId,
        availabilityLabel: item.availabilityLabel,
      });
  }
  return validateCombo(product.comboSlots, selections).error;
}

function loadItemRows(tx: Sql, tenantId: string, cartId: string) {
  return tx<ItemRow[]>`
    select ci.id, ci.product_id, ci.qty, ci.modifier_ids, ci.unit_price_cents,
           ci.modifier_snapshot, ci.combo_selections, ci.combo_snapshot,
           p.name, p.slug, p.status as product_status, p.stock_quantity,
           p.requires_preorder, p.preorder_lead_days, p.availability_schedule,
           (select m.url from product_media m where m.product_id = p.id order by m.sort, m.id limit 1) as image_url
    from cart_items ci join products p on p.id = ci.product_id
    where ci.tenant_id = ${tenantId} and ci.cart_id = ${cartId}
    order by ci.created_at
  `;
}

async function priceItems(
  tx: Sql,
  tenantId: string,
  items: readonly ItemRow[],
  tz: string,
): Promise<PricedItem[]> {
  if (items.length === 0) return [];
  // live read is only for status — names/prices come from the add-time
  // snapshot; checkout reprices stale lines (repriceLines) before placing
  const modifierIds = items.flatMap((i) => i.modifier_ids);
  const pickIds = items.flatMap((i) => i.combo_snapshot.map((c) => c.productId));
  const [mods, picks] = await Promise.all([
    modifierIds.length
      ? tx<{ id: string; status: string }[]>`
          select id, status from modifiers
          where tenant_id = ${tenantId} and id = any(${modifierIds}::uuid[])
        `
      : [],
    pickIds.length
      ? tx<
          {
            id: string;
            status: string;
            stock_quantity: number | null;
            availability_schedule: AvailabilitySchedule | null;
          }[]
        >`
          select id, status, stock_quantity, availability_schedule from products
          where tenant_id = ${tenantId} and id = any(${pickIds}::uuid[])
        `
      : [],
  ]);
  const liveMod = new Map(mods.map((m) => [m.id, m.status]));
  const now = new Date();
  const status = (i: ItemRow) => {
    const s = liveStatus(i.product_status, i.stock_quantity);
    return s === 'active' && !scheduleOpen(i.availability_schedule, now, tz) ? 'sold_out' : s;
  };
  const pickStock = new Map(picks.map((p) => [p.id, p.stock_quantity]));
  const livePick = new Map(
    picks.map((p) => {
      const st = liveStatus(p.status, p.stock_quantity);
      return [
        p.id,
        st === 'active' && !scheduleOpen(p.availability_schedule, now, tz) ? 'sold_out' : st,
      ];
    }),
  );
  return items.map((item) => ({
    id: item.id,
    productId: item.product_id,
    slug: item.slug,
    name: item.name,
    qty: item.qty,
    unitPriceCents: item.unit_price_cents,
    productStatus: status(item),
    modifierIds: item.modifier_ids,
    modifiers: item.modifier_snapshot.map((m) => ({
      id: m.id,
      name: m.name,
      priceDeltaCents: m.priceDeltaCents,
      status: liveMod.get(m.id) ?? 'archived',
    })),
    combo: item.combo_snapshot.map((c) => ({
      ...c,
      status: livePick.get(c.productId) ?? 'archived',
      stockQuantity: pickStock.get(c.productId) ?? null,
    })),
    comboSelections: item.combo_selections,
    lineTotalCents: item.unit_price_cents * item.qty,
    imageUrl: item.image_url,
    stockQuantity: item.stock_quantity,
    requiresPreorder: item.requires_preorder,
    preorderLeadDays: item.preorder_lead_days,
  }));
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

export interface ZoneRow extends ZoneLike {
  kind: 'neighborhood' | 'radius' | 'polygon';
  max_distance_km: string | null;
  fee_per_km_cents: number;
  free_delivery_over_cents: number | null;
}

export async function loadZoneRows(
  tx: Sql,
  tenantId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<ZoneRow[]> {
  const lock = opts.forUpdate ? tx`for update` : tx``;
  return tx<ZoneRow[]>`
    select id, name, kind, neighborhoods, fee_cents, min_order_cents, eta_min_minutes, eta_max_minutes,
           max_distance_km, fee_per_km_cents, free_delivery_over_cents, polygon
    from delivery_zones where tenant_id = ${tenantId} and active order by name ${lock}
  `;
}

/** Neighborhood-name match (accent/case-insensitive); kept for callers without coordinates. */
export function matchZone<Z extends { neighborhoods: string[]; kind?: string }>(
  zones: Z[],
  neighborhood: string | undefined,
): Z | null {
  if (!neighborhood) return null;
  const needle = foldName(neighborhood);
  return (
    zones.find((z) => z.kind !== 'radius' && z.neighborhoods.some((n) => foldName(n) === needle)) ??
    null
  );
}

export function storeCoords(settings: StoreSettingsRow | null | undefined) {
  return settings ? validCoords(settings.latitude ?? null, settings.longitude ?? null) : null;
}

export async function loadCartView(
  tx: Sql,
  tenantId: string,
  cartId: string,
  now = new Date(),
  /** previews: totals for this payment method / this delivery address (the quote) */
  opts: { paymentMethod?: string | null; delivery?: CartDelivery } = {},
): Promise<CartView> {
  // independent reads go out together — postgres.js pipelines them on the tx's connection
  const [carts, rows, settingsRows, zones] = await Promise.all([
    tx<
      {
        id: string;
        status: CartView['status'];
        delivery: CartDelivery | null;
        coupon_code: string | null;
      }[]
    >`
      select id, status, delivery, coupon_code from carts where tenant_id = ${tenantId} and id = ${cartId}
    `,
    loadItemRows(tx, tenantId, cartId),
    tx<StoreSettingsRow[]>`select * from store_settings where tenant_id = ${tenantId}`,
    loadZoneRows(tx, tenantId),
  ]);
  const cart = carts[0];
  if (!cart) throw new HttpError(404, 'CART_NOT_FOUND', 'cart not found');
  const settings = settingsRows[0];
  if (opts.delivery) cart.delivery = opts.delivery;
  const [items, couponRow] = await Promise.all([
    priceItems(tx, tenantId, rows, settings?.hours?.timezone || 'America/Sao_Paulo'),
    cart.coupon_code ? loadCoupon(tx, tenantId, cart.coupon_code) : null,
  ]);
  const subtotal = items.reduce((s, i) => s + i.lineTotalCents, 0);

  let deliveryFee = 0;
  let effectiveMinOrder = settings?.min_order_cents ?? 0;
  let match: ReturnType<typeof resolveZone<ZoneRow>> = null;
  if (cart.delivery?.mode === 'delivery') {
    match = resolveZone(
      zones,
      {
        neighborhood: cart.delivery.neighborhood,
        coords: validCoords(cart.delivery.lat, cart.delivery.lng),
      },
      storeCoords(settings),
    );
    if (match) {
      deliveryFee = effectiveFee(match, subtotal);
      effectiveMinOrder = Math.max(effectiveMinOrder, match.zone.min_order_cents);
    }
  }

  let coupon: AppliedCoupon | null = null;
  let discount = 0;
  let itemDiscount = 0;
  if (cart.coupon_code) {
    const row = couponRow;
    if (!row) {
      coupon = {
        code: cart.coupon_code,
        label: cart.coupon_code,
        kind: 'fixed',
        applies: false,
        reason: 'COUPON_NOT_FOUND',
      };
    } else {
      const out = evaluateCoupon(row, {
        subtotalCents: subtotal,
        deliveryFeeCents: deliveryFee,
        usage: await couponUsage(tx, tenantId, row.id),
        now,
      });
      discount = out.discountCents;
      if (row.kind !== 'free_delivery') itemDiscount = discount;
      coupon = {
        code: row.code,
        label: couponLabel(row),
        kind: row.kind,
        applies: out.ok,
        ...(out.reason ? { reason: out.reason } : {}),
        ...(out.details ? { details: out.details } : {}),
      };
    }
  }

  return {
    id: cart.id,
    status: cart.status,
    items,
    totals: computeTotals(
      items,
      deliveryFee,
      effectiveMinOrder,
      discount,
      match?.zone.free_delivery_over_cents ?? null,
      paymentAdjustmentCents(subtotal, itemDiscount, adjustmentFor(settings, opts.paymentMethod)),
    ),
    // a zero fee can mean a free zone — branch on zoneId, not the amount
    delivery: cart.delivery
      ? {
          ...cart.delivery,
          zoneId: match?.zone.id ?? null,
          zoneName: match?.zone.name ?? null,
          distanceKm: match?.distanceKm ?? null,
          etaMin: match?.zone.eta_min_minutes ?? null,
          etaMax: match?.zone.eta_max_minutes ?? null,
        }
      : null,
    coupon,
    schedule: scheduleView(
      items,
      {
        hours: settings?.hours ?? { timezone: 'America/Sao_Paulo', windows: [] },
        preorder_payment_methods: settings?.preorder_payment_methods ?? null,
        preorder_max_days: settings?.preorder_max_days ?? null,
      },
      now,
    ),
  };
}

export async function addItem(
  tx: Sql,
  tenantId: string,
  cartId: string,
  input: CartItemIn,
  getProductById: (tx: Sql, tenantId: string, id: string) => Promise<ProductDetail | null>,
): Promise<CartView> {
  await insertLine(tx, tenantId, cartId, input, getProductById);
  return loadCartView(tx, tenantId, cartId);
}

/** Validates, freezes the price and merges into the cart; throws the client's typed error. */
export async function insertLine(
  tx: Sql,
  tenantId: string,
  cartId: string,
  input: CartItemIn,
  getProductById: (tx: Sql, tenantId: string, id: string) => Promise<ProductDetail | null>,
): Promise<void> {
  if (!Number.isInteger(input.qty) || input.qty <= 0 || input.qty > 99) {
    throw new HttpError(422, 'INVALID_QTY', 'qty must be an integer between 1 and 99');
  }
  const product = await getProductById(tx, tenantId, input.productId);
  if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'product not found');
  // dedupe + sort: a repeated id would double-charge; order-independence
  // merges reordered selections into one line
  const modifierIds = [...new Set(input.modifierIds ?? [])].sort();
  const selections = parseSelections(input.comboSelections ?? []);
  const invalid = validateLine(product, modifierIds, selections);
  if (invalid) throw invalid;
  const picks = product.kind === 'combo' ? validateCombo(product.comboSlots, selections).picks : [];

  // stock: what's already carted plus this addition must fit
  const existing = await tx<
    { product_id: string; qty: number; combo_selections: ComboSelection[] }[]
  >`select product_id, qty, combo_selections from cart_items where tenant_id = ${tenantId} and cart_id = ${cartId}`;
  await assertStock(
    tx,
    tenantId,
    stockDemand([
      ...existing.map((e) => ({ productId: e.product_id, qty: e.qty, combo: e.combo_selections })),
      { productId: product.id, qty: input.qty, combo: selections },
    ]),
  );

  // freeze the accepted price for the cart view; checkout re-checks it
  // against the live catalog (repriceLines)
  const allModifiers = product.modifierGroups.flatMap((g) => g.modifiers);
  const chosen = modifierIds.map((id) => allModifiers.find((m) => m.id === id)!);
  const snapshot = chosen.map((m) => ({
    id: m.id,
    name: m.name,
    priceDeltaCents: m.priceDeltaCents,
  }));
  const unit =
    unitPriceCents(
      product.basePriceCents,
      chosen.map((m) => m.priceDeltaCents),
    ) + comboDelta(picks);

  // same product + modifier set + kit composition merges into one line; merged
  // qty capped by CHECK (qty <= 99) → INVALID_QTY like PATCH
  try {
    await tx`
      insert into cart_items (tenant_id, cart_id, product_id, qty, modifier_ids, unit_price_cents, modifier_snapshot, combo_selections, combo_snapshot)
      values (${tenantId}, ${cartId}, ${input.productId}, ${input.qty}, ${tx.json(modifierIds)}, ${unit}, ${tx.json(snapshot)},
              ${tx.json(selections as never)}, ${tx.json(picks as never)})
      on conflict (cart_id, product_id, modifier_ids, combo_selections)
      do update set qty = cart_items.qty + excluded.qty
    `;
  } catch (err) {
    if ((err as { code?: string }).code === '23514') {
      throw new HttpError(422, 'INVALID_QTY', 'line quantity cannot exceed 99');
    }
    throw err;
  }
  await tx`update carts set updated_at = now() where id = ${cartId}`;
}

/**
 * Checkout's price check: a line keeps its add-time price while the shopper browses, but an
 * order is never placed at a stale one (a typo fixed since, a promo that ended). Lines whose
 * live price differs are rewritten to it; returns how many changed. Lines already validated
 * against `products` (validateCheckout) — a product missing here is left to that check.
 */
export async function repriceLines(
  tx: Sql,
  tenantId: string,
  items: PricedItem[],
  products: Map<string, ProductDetail | null>,
): Promise<number> {
  let changed = 0;
  for (const item of items) {
    const product = products.get(item.productId);
    if (!product) continue;
    const all = product.modifierGroups.flatMap((g) => g.modifiers);
    const chosen = item.modifierIds.flatMap((id) => all.filter((m) => m.id === id));
    const picks =
      product.kind === 'combo' ? validateCombo(product.comboSlots, item.comboSelections).picks : [];
    const unit =
      unitPriceCents(
        product.basePriceCents,
        chosen.map((m) => m.priceDeltaCents),
      ) + comboDelta(picks);
    if (unit === item.unitPriceCents) continue;
    changed++;
    await tx`
      update cart_items set unit_price_cents = ${unit},
        modifier_snapshot = ${tx.json(chosen.map((m) => ({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents })))},
        combo_snapshot = ${tx.json(picks as never)}
      where tenant_id = ${tenantId} and id = ${item.id}
    `;
  }
  return changed;
}

/** Stock check for a qty change on one line (PATCH). */
export async function assertLineQty(
  tx: Sql,
  tenantId: string,
  cartId: string,
  itemId: string,
  qty: number,
): Promise<void> {
  const lines = await tx<
    { id: string; product_id: string; qty: number; combo_selections: ComboSelection[] }[]
  >`select id, product_id, qty, combo_selections from cart_items where tenant_id = ${tenantId} and cart_id = ${cartId}`;
  await assertStock(
    tx,
    tenantId,
    stockDemand(
      lines.map((l) => ({
        productId: l.product_id,
        qty: l.id === itemId ? qty : l.qty,
        combo: l.combo_selections,
      })),
    ),
  );
}
