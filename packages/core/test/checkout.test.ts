import { describe, expect, test } from 'bun:test';
import { validateCheckout, type CheckoutInput } from '../src/modules/checkout.ts';
import { canTransition } from '../src/modules/orders.ts';
import type { CartView } from '../src/modules/cart.ts';
import type { ProductDetail } from '../src/modules/catalog.ts';
import type { StoreSettingsRow } from '../src/modules/store.ts';

const open = { status: 'open' as const };
const paused = { status: 'paused' as const, resumesAt: '2026-09-18T21:00:00Z' };
const closed = { status: 'closed' as const, resumesAt: '2026-09-19T12:00:00Z' };

const settings = {
  tenant_id: 't',
  tagline: null,
  description: null,
  whatsapp: null,
  instagram: null,
  city: null,
  address: null,
  hours: { timezone: 'America/Sao_Paulo', windows: [] },
  status_override: null,
  resumes_at: null,
  prep_time_minutes: 30,
  min_order_cents: 1000,
  pickup_enabled: true,
  delivery_enabled: true,
  promo: null,
  currency: 'BRL',
  vocabulary: {},
} satisfies StoreSettingsRow;

const pickup: CheckoutInput = {
  customer: { name: 'Ana', phone: '22999990000' },
  delivery: { mode: 'pickup' },
  payment: { method: 'pix' },
};

const delivery: CheckoutInput = {
  customer: { name: 'Ana', phone: '22999990000' },
  delivery: { mode: 'delivery', neighborhood: 'Centro', address: 'Rua X, 1' },
  payment: { method: 'cash' },
};

const zones = [
  {
    id: 'z1',
    name: 'Centro',
    neighborhoods: ['Centro'],
    fee_cents: 500,
    min_order_cents: 1500,
    eta_min_minutes: 30,
    eta_max_minutes: 50,
  },
];

function cart(subtotalCents: number): CartView {
  return {
    id: 'c',
    status: 'open',
    items: [
      {
        id: 'i',
        productId: 'p',
        slug: 's',
        name: 'N',
        qty: 1,
        unitPriceCents: subtotalCents,
        productStatus: 'active',
        modifierIds: [],
        modifierQty: {},
        modifiers: [],
        combo: [],
        comboSelections: [],
        imageUrl: null,
        stockQuantity: null,
        requiresPreorder: false,
        preorderLeadDays: 0,
        lineTotalCents: subtotalCents,
      },
    ],
    totals: {
      subtotalCents,
      deliveryFeeCents: 0,
      totalCents: subtotalCents,
      itemCount: 1,
      minOrderCents: 1000,
      remainingMinOrderCents: Math.max(0, 1000 - subtotalCents),
      belowMinOrder: subtotalCents < 1000,
      discountCents: 0,
      paymentAdjustmentCents: 0,
      freeDeliveryThresholdCents: null,
      freeDeliveryRemainingCents: null,
    },
    delivery: null,
    coupon: null,
    schedule: { required: false, leadDays: 0, dates: [], paymentMethods: ['pix'] },
  };
}

function encomendas(subtotalCents: number): CartView {
  const c = cart(subtotalCents);
  return {
    ...c,
    items: c.items.map((i) => ({ ...i, requiresPreorder: true, preorderLeadDays: 1 })),
    schedule: { ...c.schedule, required: true, leadDays: 1 },
  };
}

const code = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code;
  }
};

describe('validateCheckout', () => {
  test('paused store → STORE_PAUSED', () => {
    expect(code(() => validateCheckout(paused, settings, cart(2000), pickup, zones))).toBe(
      'STORE_PAUSED',
    );
  });
  test('closed store → STORE_CLOSED for a regular cart', () => {
    expect(code(() => validateCheckout(closed, settings, cart(2000), pickup, zones))).toBe(
      'STORE_CLOSED',
    );
  });
  test('closed store → proceeds when every line is an encomenda', () => {
    expect(validateCheckout(closed, settings, encomendas(2000), pickup, zones).zone).toBeNull();
  });
  test('closed store → STORE_CLOSED when encomendas share the cart with a regular item', () => {
    const mixed = encomendas(2000);
    mixed.items = [...mixed.items, { ...cart(500).items[0]!, id: 'j', productId: 'q' }];
    expect(code(() => validateCheckout(closed, settings, mixed, pickup, zones))).toBe(
      'STORE_CLOSED',
    );
  });
  test('closed store → STORE_CLOSED when the locked product is no longer an encomenda', () => {
    const now = new Map([['p', { requiresPreorder: false } as ProductDetail]]);
    expect(
      code(() => validateCheckout(closed, settings, encomendas(2000), pickup, zones, now, null)),
    ).toBe('STORE_CLOSED');
  });
  test('closed store with encomendas off → STORE_CLOSED even for encomendas', () => {
    const s = { ...settings, preorders_while_closed: false };
    let err: { code?: string; details?: Record<string, unknown> } = {};
    try {
      validateCheckout(closed, s, encomendas(2000), pickup, zones);
    } catch (e) {
      err = e as typeof err;
    }
    expect(err.code).toBe('STORE_CLOSED');
    expect(err.details).toEqual({ resumesAt: closed.resumesAt, preordersOnly: false });
  });
  test('pickup when disabled → PICKUP_UNAVAILABLE', () => {
    const s = { ...settings, pickup_enabled: false };
    expect(code(() => validateCheckout(open, s, cart(2000), pickup, zones))).toBe(
      'PICKUP_UNAVAILABLE',
    );
  });
  test('closed + pickup disabled → delivery encomenda still allowed', () => {
    const s = { ...settings, pickup_enabled: false };
    expect(validateCheckout(closed, s, encomendas(1600), delivery, zones).zone?.id).toBe('z1');
  });
  test('empty cart → EMPTY_CART', () => {
    const empty = { ...cart(0), items: [] };
    expect(code(() => validateCheckout(open, settings, empty, pickup, zones))).toBe('EMPTY_CART');
  });
  test('pickup below min order → ORDER_MIN_NOT_MET', () => {
    expect(code(() => validateCheckout(open, settings, cart(500), pickup, zones))).toBe(
      'ORDER_MIN_NOT_MET',
    );
  });
  test('delivery outside zones → OUT_OF_ZONE', () => {
    const out = {
      ...delivery,
      delivery: { mode: 'delivery' as const, neighborhood: 'Ipanema', address: 'x' },
    };
    expect(code(() => validateCheckout(open, settings, cart(5000), out, zones))).toBe(
      'OUT_OF_ZONE',
    );
  });
  test('polygon zones: inside resolves, outside every zone → OUT_OF_ZONE', () => {
    const polyZones = [
      ...zones,
      {
        id: 'p1',
        name: 'Mapa',
        kind: 'polygon' as const,
        neighborhoods: [],
        polygon: [
          [-22.94, -42.52],
          [-22.94, -42.5],
          [-22.92, -42.5],
          [-22.92, -42.52],
        ] as [number, number][],
        fee_cents: 400,
        min_order_cents: 0,
        eta_min_minutes: 20,
        eta_max_minutes: 40,
      },
    ];
    const at = (lat: number, lng: number) => ({
      ...delivery,
      delivery: { mode: 'delivery' as const, neighborhood: 'Ipanema', address: 'x', lat, lng },
    });
    const hit = validateCheckout(open, settings, cart(5000), at(-22.93, -42.51), polyZones);
    expect(hit.zone?.id).toBe('p1');
    expect(hit.feeCents).toBe(400);
    expect(
      code(() => validateCheckout(open, settings, cart(5000), at(-22.9, -42.51), polyZones)),
    ).toBe('OUT_OF_ZONE');
  });
  test('delivery when disabled → DELIVERY_UNAVAILABLE', () => {
    const s = { ...settings, delivery_enabled: false };
    expect(code(() => validateCheckout(open, s, cart(5000), delivery, zones))).toBe(
      'DELIVERY_UNAVAILABLE',
    );
  });
  test('delivery uses max(store, zone) min order', () => {
    expect(code(() => validateCheckout(open, settings, cart(1200), delivery, zones))).toBe(
      'ORDER_MIN_NOT_MET',
    );
    expect(validateCheckout(open, settings, cart(1600), delivery, zones).zone?.id).toBe('z1');
  });
});

describe('order state machine', () => {
  test('happy path placed → delivered', () => {
    expect(canTransition('placed', 'confirmed', 'delivery')).toBe(true);
    expect(canTransition('confirmed', 'preparing', 'delivery')).toBe(true);
    expect(canTransition('ready', 'out_for_delivery', 'delivery')).toBe(true);
    expect(canTransition('out_for_delivery', 'delivered', 'delivery')).toBe(true);
    expect(canTransition('ready', 'delivered', 'pickup')).toBe(true);
  });
  test('illegal transitions rejected', () => {
    expect(canTransition('placed', 'delivered', 'delivery')).toBe(false);
    expect(canTransition('delivered', 'preparing', 'delivery')).toBe(false);
    expect(canTransition('cancelled', 'confirmed', 'pickup')).toBe(false);
    expect(canTransition('ready', 'out_for_delivery', 'pickup')).toBe(false);
  });
  test('refund only after delivery', () => {
    expect(canTransition('delivered', 'refunded', 'pickup')).toBe(true);
    expect(canTransition('placed', 'refunded', 'delivery')).toBe(false);
  });
});
