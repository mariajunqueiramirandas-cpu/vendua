import { describe, expect, test } from 'bun:test';
import { computeTotals, unitPriceCents, validateItemModifiers, matchZone } from '../src/modules/cart.ts';
import type { ProductDetail } from '../src/modules/catalog.ts';

describe('cart pricing', () => {
  test('unit price = base + modifier deltas', () => {
    expect(unitPriceCents(1000, [250, 100])).toBe(1350);
    expect(unitPriceCents(1000, [])).toBe(1000);
  });

  test('totals: subtotal + delivery fee, min-order flag', () => {
    const t = computeTotals(
      [{ qty: 2, lineTotalCents: 3000 }, { qty: 1, lineTotalCents: 500 }],
      700,
      3000,
    );
    expect(t.subtotalCents).toBe(3500);
    expect(t.deliveryFeeCents).toBe(700);
    expect(t.totalCents).toBe(4200);
    expect(t.itemCount).toBe(3);
    expect(t.belowMinOrder).toBe(false);
  });

  test('below min order', () => {
    const t = computeTotals([{ qty: 1, lineTotalCents: 500 }], 0, 1000);
    expect(t.belowMinOrder).toBe(true);
  });

  test('empty cart is never below-min', () => {
    const t = computeTotals([], 0, 1000);
    expect(t.belowMinOrder).toBe(false);
  });
});

const product: ProductDetail = {
  id: 'p1', slug: 'x', name: 'X', description: null, basePriceCents: 1000,
  status: 'active', figureVariant: 'default', tags: [],
  modifierGroups: [
    { id: 'g1', name: 'Tamanho', required: true, minSelect: 1, maxSelect: 1, modifiers: [
      { id: 'm1', name: 'P', priceDeltaCents: 0, status: 'active' },
      { id: 'm2', name: 'G', priceDeltaCents: 400, status: 'active' },
    ]},
    { id: 'g2', name: 'Extras', required: false, minSelect: 0, maxSelect: 2, modifiers: [
      { id: 'm3', name: 'Bacon', priceDeltaCents: 600, status: 'active' },
    ]},
  ],
};

describe('validateItemModifiers', () => {
  test('valid selection passes', () => {
    expect(validateItemModifiers(product, ['m1', 'm3'])).toBeNull();
  });
  test('missing required group → MODIFIER_REQUIRED', () => {
    expect(validateItemModifiers(product, ['m3'])?.code).toBe('MODIFIER_REQUIRED');
    expect(validateItemModifiers(product, [])?.code).toBe('MODIFIER_REQUIRED');
  });
  test('over max → MODIFIER_LIMIT', () => {
    expect(validateItemModifiers(product, ['m1', 'm2'])?.code).toBe('MODIFIER_LIMIT');
  });
  test('unknown id → INVALID_MODIFIER', () => {
    expect(validateItemModifiers(product, ['m1', 'nope'])?.code).toBe('INVALID_MODIFIER');
  });
  test('sold out product → SOLD_OUT', () => {
    expect(validateItemModifiers({ ...product, status: 'sold_out' }, ['m1'])?.code).toBe('SOLD_OUT');
  });
});

describe('matchZone', () => {
  const zones = [
    { id: 'z1', name: 'Centro', neighborhoods: ['Centro', 'Bacaxá'], fee_cents: 500, min_order_cents: 0, eta_min_minutes: 30, eta_max_minutes: 50 },
  ];
  test('case-insensitive match', () => {
    expect(matchZone(zones, 'bacaxá')?.id).toBe('z1');
  });
  test('no match → null', () => {
    expect(matchZone(zones, 'Ipanema')).toBeNull();
  });
  test('undefined → null', () => {
    expect(matchZone(zones, undefined)).toBeNull();
  });
});
