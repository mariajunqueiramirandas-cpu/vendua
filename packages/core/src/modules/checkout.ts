import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { matchZone, type CartView } from './cart.ts';
import type { DerivedStatus, StoreSettingsRow } from './store.ts';

/**
 * checkout module — Phase 0 stub. Real payment orchestration (Mercado Pago
 * OAuth + PIX + webhooks) is Phase 2 (docs/architecture/13-payments.md); what
 * exists here is the full validation path and the order-creation seam, so
 * storefronts and the Kernel exercise the real contract now.
 */

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

/**
 * Pure validation — unit-tested. Throws the typed error a client sees.
 */
export function validateCheckout(
  status: DerivedStatus,
  settings: StoreSettingsRow | null,
  cart: CartView,
  input: CheckoutInput,
  zones: ZoneRowLike[],
): { zone: ZoneRowLike | null } {
  if (status.status === 'paused') {
    throw new HttpError(423, 'STORE_PAUSED', 'store is paused', {
      ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}),
    });
  }
  // Closed stores still take orders (preorder for the next window —
  // documented closed-vs-paused semantics). Fulfillment capability is
  // validated per requested mode, independent of open state.
  if (input.delivery.mode === 'pickup' && !(settings?.pickup_enabled ?? true)) {
    throw new HttpError(422, 'PICKUP_UNAVAILABLE', 'pickup is not available');
  }
  if (cart.items.length === 0) throw new HttpError(422, 'EMPTY_CART', 'cart is empty');
  // Re-validate availability at checkout time — a product or modifier can go
  // sold_out between carting and payment (Review finding).
  for (const item of cart.items) {
    if (item.productStatus !== 'active') {
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
    if (!settings?.delivery_enabled) {
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

export function validateCheckoutShape(input: unknown): asserts input is CheckoutInput {
  const i = input as CheckoutInput;
  if (!i || typeof i !== 'object')
    throw new HttpError(422, 'BAD_REQUEST', 'body must be an object');
  if (typeof i.customer?.name !== 'string' || i.customer.name.trim().length < 2) {
    throw new HttpError(422, 'INVALID_CUSTOMER', 'customer.name is required', {
      field: 'customer.name',
    });
  }
  if (typeof i.customer?.phone !== 'string' || i.customer.phone.trim().length < 8) {
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
    if (typeof i.delivery.address !== 'string' || i.delivery.address.trim().length === 0) {
      throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.address is required for delivery', {
        field: 'delivery.address',
      });
    }
  }
  if (!['pix', 'card_on_delivery', 'cash'].includes(i.payment?.method)) {
    throw new HttpError(422, 'INVALID_PAYMENT', 'payment.method must be pix, card_on_delivery or cash', {
      field: 'payment.method',
    });
  }
}
