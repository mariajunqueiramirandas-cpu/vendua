import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { matchZone, validateItemModifiers, type CartView } from './cart.ts';
import type { ProductDetail } from './catalog.ts';
import type { DerivedStatus, StoreSettingsRow } from './store.ts';

export interface CheckoutInput {
  customer: { name: string; phone: string };
  delivery: { mode: 'pickup' | 'delivery'; neighborhood?: string; address?: string };
  payment: { method: 'pix' | 'card_on_delivery' | 'cash' };
}

export interface ZoneRowLike {
  id: string;
  name: string;
  neighborhoods: string[];
  fee_cents: number;
  min_order_cents: number;
  eta_min_minutes: number;
  eta_max_minutes: number;
}

/** pure validation; throws the typed error a client sees */
export function validateCheckout(
  status: DerivedStatus,
  settings: StoreSettingsRow | null,
  cart: CartView,
  input: CheckoutInput,
  zones: ZoneRowLike[],
  products?: Map<string, ProductDetail | null>,
): { zone: ZoneRowLike | null } {
  if (status.status === 'paused') {
    throw new HttpError(423, 'STORE_PAUSED', 'store is paused', {
      ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}),
    });
  }
  // closed stores still take orders (preorder); capability is per-mode, independent of open state
  if (input.delivery.mode === 'pickup' && !(settings?.pickup_enabled ?? true)) {
    throw new HttpError(422, 'PICKUP_UNAVAILABLE', 'pickup is not available');
  }
  if (cart.items.length === 0) throw new HttpError(422, 'EMPTY_CART', 'cart is empty');
  // re-validate against the current product — a dropped modifier id must never quietly reprice the order
  for (const item of cart.items) {
    const product = products?.get(item.productId);
    if (product) {
      const invalid = validateItemModifiers(product, item.modifierIds);
      if (invalid) throw invalid;
      continue;
    }
    if (item.productStatus !== 'active') {
      throw new HttpError(409, 'SOLD_OUT', `"${item.name}" is no longer available`, {
        productId: item.productId,
      });
    }
    if (products?.has(item.productId)) {
      // null in the map = deleted between carting and now; stored modifier ids can't be trusted
      throw new HttpError(409, 'SOLD_OUT', `"${item.name}" is no longer available`, {
        productId: item.productId,
      });
    }
    const soldOut = item.modifiers.find((m) => m.status === 'sold_out');
    if (soldOut) {
      throw new HttpError(409, 'MODIFIER_SOLD_OUT', `"${soldOut.name}" is sold out`, {
        productId: item.productId,
      });
    }
  }
  if (input.delivery.mode === 'delivery') {
    if (!(settings?.delivery_enabled ?? true)) {
      throw new HttpError(422, 'DELIVERY_UNAVAILABLE', 'delivery is not available');
    }
    const zone = matchZone(zones, input.delivery.neighborhood);
    if (!zone) throw new HttpError(422, 'OUT_OF_ZONE', 'address is outside the delivery area');
    const minOrder = Math.max(settings?.min_order_cents ?? 0, zone.min_order_cents);
    if (cart.totals.subtotalCents < minOrder) {
      throw new HttpError(422, 'ORDER_MIN_NOT_MET', `minimum order is ${minOrder} cents`, {
        minOrderCents: minOrder,
      });
    }
    return { zone };
  }
  const minOrder = settings?.min_order_cents ?? 0;
  if (cart.totals.subtotalCents < minOrder) {
    throw new HttpError(422, 'ORDER_MIN_NOT_MET', `minimum order is ${minOrder} cents`, {
      minOrderCents: minOrder,
    });
  }
  return { zone: null };
}

/** public checkout input must not be unbounded */
function bounded(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

export function validateCheckoutShape(input: unknown): asserts input is CheckoutInput {
  const i = input as CheckoutInput;
  if (!i || typeof i !== 'object')
    throw new HttpError(422, 'BAD_REQUEST', 'body must be an object');
  if (!bounded(i.customer?.name, 200) || i.customer.name.trim().length < 2) {
    throw new HttpError(422, 'INVALID_CUSTOMER', 'customer.name is required', {
      field: 'customer.name',
    });
  }
  if (!bounded(i.customer?.phone, 40) || i.customer.phone.trim().length < 8) {
    throw new HttpError(422, 'INVALID_CUSTOMER', 'customer.phone is required', {
      field: 'customer.phone',
    });
  }
  if (i.delivery?.mode !== 'pickup' && i.delivery?.mode !== 'delivery') {
    throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.mode must be pickup or delivery', {
      field: 'delivery.mode',
    });
  }
  if (i.delivery.mode === 'delivery') {
    if (i.delivery.neighborhood !== undefined && !bounded(i.delivery.neighborhood, 200)) {
      throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.neighborhood is too long', {
        field: 'delivery.neighborhood',
      });
    }
    if (!bounded(i.delivery.address, 500) || i.delivery.address.trim().length === 0) {
      throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.address is required for delivery', {
        field: 'delivery.address',
      });
    }
  }
  if (!['pix', 'card_on_delivery', 'cash'].includes(i.payment?.method)) {
    throw new HttpError(
      422,
      'INVALID_PAYMENT',
      'payment.method must be pix, card_on_delivery or cash',
      {
        field: 'payment.method',
      },
    );
  }
}
