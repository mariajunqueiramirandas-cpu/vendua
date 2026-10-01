import { describe, expect, test } from 'bun:test';
import {
  computeTotals,
  groupDeltaCents,
  normalizeModifiers,
  pickedOptions,
  unitPriceCents,
  validateItemModifiers,
  matchZone,
} from '../src/modules/cart.ts';
import type { Modifier, ProductDetail } from '../src/modules/catalog.ts';

const picks = (...p: [number, number][]) =>
  p.map(([priceDeltaCents, qty]) => ({ priceDeltaCents, qty }));

describe('cart pricing', () => {
  test('unit price = base + modifier deltas', () => {
    expect(unitPriceCents(1000, [{ pricingRule: 'sum', picks: picks([250, 1], [100, 1]) }])).toBe(
      1350,
    );
    expect(unitPriceCents(1000, [])).toBe(1000);
  });

  test('sum: delta × qty per option', () => {
    expect(groupDeltaCents({ pricingRule: 'sum', picks: picks([250, 3], [100, 1]) })).toBe(850);
    expect(groupDeltaCents({ pricingRule: 'sum', picks: [] })).toBe(0);
  });

  test('most_expensive: the dearest pick once, qty ignored', () => {
    expect(
      groupDeltaCents({
        pricingRule: 'most_expensive',
        picks: picks([500, 1], [1200, 2], [800, 1]),
      }),
    ).toBe(1200);
    expect(groupDeltaCents({ pricingRule: 'most_expensive', picks: [] })).toBe(0);
  });

  test('average: mean over units, half rounded up', () => {
    // (1000 + 2001) / 2 = 1500.5 → 1501
    expect(groupDeltaCents({ pricingRule: 'average', picks: picks([1000, 1], [2001, 1]) })).toBe(
      1501,
    );
    // (1000×2 + 1500) / 3 = 1166.67 → 1167
    expect(groupDeltaCents({ pricingRule: 'average', picks: picks([1000, 2], [1500, 1]) })).toBe(
      1167,
    );
    // (1000 + 1001×2) / 3 = 1000.67 → 1001; one option alone is itself
    expect(groupDeltaCents({ pricingRule: 'average', picks: picks([1000, 1], [1001, 2]) })).toBe(
      1001,
    );
    expect(groupDeltaCents({ pricingRule: 'average', picks: picks([700, 3]) })).toBe(700);
    // negatives: -1.5 rounds half up to -1
    expect(groupDeltaCents({ pricingRule: 'average', picks: picks([-1, 1], [-2, 1]) })).toBe(-1);
    expect(groupDeltaCents({ pricingRule: 'average', picks: [] })).toBe(0);
  });

  test('rules apply per group and add up', () => {
    expect(
      unitPriceCents(3000, [
        { pricingRule: 'most_expensive', picks: picks([500, 1], [900, 1]) },
        { pricingRule: 'sum', picks: picks([200, 2]) },
      ]),
    ).toBe(3000 + 900 + 400);
  });

  test('totals: subtotal + delivery fee, min-order flag', () => {
    const t = computeTotals(
      [
        { qty: 2, lineTotalCents: 3000 },
        { qty: 1, lineTotalCents: 500 },
      ],
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

const mod = (id: string, name: string, priceDeltaCents: number, maxQty = 1): Modifier => ({
  id,
  name,
  priceDeltaCents,
  status: 'active',
  maxQty,
  description: null,
  imageUrl: null,
});

const product: ProductDetail = {
  id: 'p1',
  slug: 'x',
  name: 'X',
  description: null,
  basePriceCents: 1000,
  compareAtPriceCents: null,
  status: 'active',
  figureVariant: 'default',
  tags: [],
  kind: 'simple',
  imageUrl: null,
  stockQuantity: null,
  lowStockThreshold: null,
  lowStock: false,
  requiresPreorder: false,
  preorderLeadDays: 0,
  needsChoices: false,
  gallery: [],
  comboSlots: [],
  waitlistCount: 0,
  modifierGroups: [
    {
      id: 'g1',
      name: 'Tamanho',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      pricingRule: 'sum',
      modifiers: [mod('m1', 'P', 0), mod('m2', 'G', 400)],
    },
    {
      id: 'g2',
      name: 'Extras',
      required: false,
      minSelect: 0,
      maxSelect: 2,
      pricingRule: 'sum',
      modifiers: [mod('m3', 'Bacon', 600), mod('m4', 'Queijo', 300, 2)],
    },
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
    expect(validateItemModifiers({ ...product, status: 'sold_out' }, ['m1'])?.code).toBe(
      'SOLD_OUT',
    );
  });
  test('option qty: up to its maxQty, and group limits count units', () => {
    expect(validateItemModifiers(product, ['m1', 'm4'], { m4: 2 })).toBeNull();
    expect(validateItemModifiers(product, ['m1', 'm4'], { m4: 3 })?.code).toBe('MODIFIER_LIMIT');
    expect(validateItemModifiers(product, ['m1', 'm3'], { m3: 2 })?.code).toBe('MODIFIER_LIMIT');
    // Bacon + 2× Queijo = 3 units > maxSelect 2
    expect(validateItemModifiers(product, ['m1', 'm3', 'm4'], { m4: 2 })?.code).toBe(
      'MODIFIER_LIMIT',
    );
    // a qty for an id not in the line is not a free pass
    expect(validateItemModifiers(product, ['m1'], { nope: 2 })?.code).toBe('INVALID_MODIFIER');
  });
  test('min counts units too', () => {
    const p = {
      ...product,
      modifierGroups: [{ ...product.modifierGroups[1]!, required: true, minSelect: 2 }],
    };
    expect(validateItemModifiers(p, ['m4'])?.code).toBe('MODIFIER_REQUIRED');
    expect(validateItemModifiers(p, ['m4'], { m4: 2 })).toBeNull();
  });
});

describe('option selection', () => {
  test('normalize: distinct sorted ids, qty only above 1, largest qty wins', () => {
    expect(
      normalizeModifiers({
        modifierIds: ['b', 'a', 'b'],
        modifiers: [{ id: 'c', qty: 3 }, { id: 'a' }, { id: 'c', qty: 2 }],
      }),
    ).toEqual({ modifierIds: ['a', 'b', 'c'], modifierQty: { c: 3 } });
    expect(() => normalizeModifiers({ modifiers: [{ id: 'a', qty: 0 }] })).toThrow();
    expect(() => normalizeModifiers({ modifiers: [{ id: 'a', qty: 1.5 }] })).toThrow();
    expect(() => normalizeModifiers({ modifiers: [{ id: 'a', qty: 21 }] })).toThrow();
  });
  test('picked options price per group and snapshot qty', () => {
    const chosen = pickedOptions(product, ['m2', 'm4'], { m4: 2 });
    expect(unitPriceCents(product.basePriceCents, chosen.groups)).toBe(1000 + 400 + 600);
    expect(chosen.snapshot).toEqual([
      { id: 'm2', name: 'G', priceDeltaCents: 400, qty: 1 },
      { id: 'm4', name: 'Queijo', priceDeltaCents: 300, qty: 2 },
    ]);
  });
});

describe('matchZone', () => {
  const zones = [
    {
      id: 'z1',
      name: 'Centro',
      neighborhoods: ['Centro', 'Bacaxá'],
      fee_cents: 500,
      min_order_cents: 0,
      eta_min_minutes: 30,
      eta_max_minutes: 50,
    },
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
