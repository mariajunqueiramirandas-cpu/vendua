import { HttpError } from '../platform/http.ts';
import { validateLine, type CartView } from './cart.ts';
import type { ProductDetail } from './catalog.ts';
import { normalizeCep, resolveZone, validCoords, type Coords, type ZoneLike } from './geo.ts';
import type { DerivedStatus, StoreSettingsRow } from './store.ts';

export interface CheckoutInput {
  customer: { name: string; phone: string };
  delivery: {
    mode: 'pickup' | 'delivery';
    neighborhood?: string;
    /** freeform line — still accepted; structured fields below win when present */
    address?: string;
    street?: string;
    number?: string;
    complement?: string;
    reference?: string;
    cep?: string;
    lat?: number;
    lng?: number;
  };
  /** card_online: Mercado Pago's hosted checkout — offered only while the store is connected */
  payment: { method: 'pix' | 'card_online' | 'card_on_delivery' | 'cash' };
  /** "Alguma observação?" */
  notes?: string;
  /** encomenda date, YYYY-MM-DD in the store's timezone */
  scheduledFor?: string;
}

export type ZoneRowLike = ZoneLike;

export interface AddressParts {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  reference: string | null;
  cep: string | null;
}

/** One display line for couriers and receipts, from the structured parts. */
export function composeAddress(d: CheckoutInput['delivery']): string | null {
  const street = d.street?.trim();
  if (street) {
    const head = [street, d.number?.trim()].filter(Boolean).join(', ');
    return [head, d.complement?.trim()].filter(Boolean).join(' — ');
  }
  return d.address?.trim() || null;
}

export function addressParts(d: CheckoutInput['delivery']): AddressParts {
  const t = (s: string | undefined) => s?.trim() || null;
  return {
    street: t(d.street),
    number: t(d.number),
    complement: t(d.complement),
    neighborhood: t(d.neighborhood),
    reference: t(d.reference),
    cep: d.cep ? normalizeCep(d.cep) : null,
  };
}

/** pure validation; throws the typed error a client sees */
export function validateCheckout<Z extends ZoneLike>(
  status: DerivedStatus,
  settings: StoreSettingsRow | null,
  cart: CartView,
  input: CheckoutInput,
  zones: Z[],
  products?: Map<string, ProductDetail | null>,
  store: Coords | null = null,
  /** the store's Mercado Pago connection can take a card right now */
  online: { card: boolean } = { card: false },
): { zone: Z | null; distanceKm: number | null; feeCents: number } {
  if (status.status === 'paused') {
    throw new HttpError(423, 'STORE_PAUSED', 'store is paused', {
      ...(status.resumesAt ? { resumesAt: status.resumesAt } : {}),
    });
  }
  // closed stores still take orders (preorder); capability is per-mode, independent of open state
  if (input.delivery.mode === 'pickup' && !(settings?.pickup_enabled ?? true)) {
    throw new HttpError(422, 'PICKUP_UNAVAILABLE', 'pickup is not available');
  }
  // the merchant turns methods off in the admin; absent setting = the three offline ones (pre-0052 rows)
  const methods = settings?.payment_methods;
  const offered =
    input.payment.method === 'card_online'
      ? online.card && !!methods?.includes('card_online')
      : !methods || methods.includes(input.payment.method);
  if (!offered) {
    throw new HttpError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'this payment method is not accepted', {
      field: 'payment.method',
    });
  }
  if (cart.items.length === 0) throw new HttpError(422, 'EMPTY_CART', 'cart is empty');
  // re-validate against the current product — a dropped modifier id must never quietly reprice the order
  for (const item of cart.items) {
    const product = products?.get(item.productId);
    if (product) {
      const invalid = validateLine(product, item.modifierIds, item.comboSelections ?? []);
      if (invalid) {
        invalid.details = { ...invalid.details, productId: item.productId };
        throw invalid;
      }
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
    const match = resolveZone(
      zones,
      {
        neighborhood: input.delivery.neighborhood,
        coords: validCoords(input.delivery.lat, input.delivery.lng),
      },
      store,
    );
    if (!match) throw new HttpError(422, 'OUT_OF_ZONE', 'address is outside the delivery area');
    const minOrder = Math.max(settings?.min_order_cents ?? 0, match.zone.min_order_cents);
    if (cart.totals.subtotalCents < minOrder) {
      throw new HttpError(422, 'ORDER_MIN_NOT_MET', `minimum order is ${minOrder} cents`, {
        minOrderCents: minOrder,
      });
    }
    return { zone: match.zone, distanceKm: match.distanceKm, feeCents: match.feeCents };
  }
  const minOrder = settings?.min_order_cents ?? 0;
  if (cart.totals.subtotalCents < minOrder) {
    throw new HttpError(422, 'ORDER_MIN_NOT_MET', `minimum order is ${minOrder} cents`, {
      minOrderCents: minOrder,
    });
  }
  return { zone: null, distanceKm: null, feeCents: 0 };
}

/** public checkout input must not be unbounded */
function bounded(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max;
}

function optional(v: unknown, max: number, field: string, code = 'INVALID_DELIVERY') {
  if (v !== undefined && v !== null && !bounded(v, max))
    throw new HttpError(422, code, `${field} is too long`, { field });
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
    const d = i.delivery;
    optional(d.neighborhood, 200, 'delivery.neighborhood');
    optional(d.address, 500, 'delivery.address');
    optional(d.street, 120, 'delivery.street');
    optional(d.number, 10, 'delivery.number');
    optional(d.complement, 80, 'delivery.complement');
    optional(d.reference, 120, 'delivery.reference');
    if (d.cep !== undefined && d.cep !== null && (!bounded(d.cep, 12) || !normalizeCep(d.cep)))
      throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.cep must have 8 digits', {
        field: 'delivery.cep',
      });
    if ((d.lat !== undefined || d.lng !== undefined) && !validCoords(d.lat, d.lng))
      throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.lat/lng must be coordinates', {
        field: 'delivery.lat',
      });
    const structured = typeof d.street === 'string' && d.street.trim().length > 0;
    if (structured && !(typeof d.number === 'string' && d.number.trim().length > 0))
      throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.number is required', {
        field: 'delivery.number',
      });
    if (!structured && !(typeof d.address === 'string' && d.address.trim().length > 0)) {
      throw new HttpError(422, 'INVALID_DELIVERY', 'delivery.address is required for delivery', {
        field: 'delivery.address',
      });
    }
  }
  if (!['pix', 'card_online', 'card_on_delivery', 'cash'].includes(i.payment?.method)) {
    throw new HttpError(
      422,
      'INVALID_PAYMENT',
      'payment.method must be pix, card_online, card_on_delivery or cash',
      {
        field: 'payment.method',
      },
    );
  }
  optional(i.notes, 500, 'notes', 'INVALID_NOTES');
  if (
    i.scheduledFor !== undefined &&
    i.scheduledFor !== null &&
    !(typeof i.scheduledFor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(i.scheduledFor))
  )
    throw new HttpError(422, 'INVALID_SCHEDULE', 'scheduledFor must be YYYY-MM-DD', {
      field: 'scheduledFor',
    });
}
