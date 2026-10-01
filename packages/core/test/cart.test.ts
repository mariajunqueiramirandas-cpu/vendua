import { describe, expect, test } from 'bun:test';
import {
  computeTotals,
  fromPriceCents,
  groupDeltaCents,
  normalizeModifiers,
  pickedOptions,
  unitPriceCents,
  validateItemModifiers,
  matchZone,
} from '../src/modules/cart.ts';
import { nextChangeAt, type Modifier, type ProductDetail } from '../src/modules/catalog.ts';

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
  fromPriceCents: null,
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

describe('"a partir de" — the cheapest configured unit', () => {
  const opt = (priceDeltaCents: number, maxQty = 1, status: 'active' | 'sold_out' = 'active') => ({
    priceDeltaCents,
    maxQty,
    status,
  });
  const group = (
    minSelect: number,
    maxSelect: number,
    modifiers: ReturnType<typeof opt>[],
    pricingRule: 'sum' | 'average' | 'most_expensive' = 'sum',
  ) => ({
    required: minSelect > 0,
    minSelect,
    maxSelect,
    pricingRule,
    modifiers: modifiers as unknown as Modifier[],
  });

  test('a required quantity list: its minimum in the cheapest units', () => {
    // mini pastéis: R$ 0 plus at least one of R$ 25,90 / R$ 22,90, up to 10
    expect(fromPriceCents(0, [group(1, 10, [opt(2590, 10), opt(2290, 10)])])).toBe(2290);
    // three units, the cheapest can be taken twice
    expect(fromPriceCents(500, [group(3, 3, [opt(300, 2), opt(100, 2), opt(200)])])).toBe(
      500 + 100 * 2 + 200,
    );
  });
  test('dearest and average rules price the cheapest picks their way', () => {
    // two distinct flavours, the dearest of them counts
    expect(
      fromPriceCents(4000, [group(2, 2, [opt(0), opt(1000), opt(400)], 'most_expensive')]),
    ).toBe(4400);
    // the average of the two cheapest, half up as Core rounds
    expect(fromPriceCents(4000, [group(2, 2, [opt(101), opt(1000), opt(400)], 'average')])).toBe(
      4000 + 251,
    );
  });
  test('sold out options are skipped; a list that cannot be filled has no price', () => {
    expect(fromPriceCents(0, [group(1, 1, [opt(500, 1, 'sold_out'), opt(800)])])).toBe(800);
    expect(fromPriceCents(0, [group(2, 2, [opt(500), opt(800, 1, 'sold_out')])])).toBeNull();
  });
  test('an optional list adds nothing, unless it offers a discount — under any rule', () => {
    expect(fromPriceCents(3000, [group(0, 3, [opt(500), opt(200)])])).toBe(3000);
    expect(fromPriceCents(3000, [group(0, 2, [opt(-300), opt(200)])])).toBe(2700);
    expect(
      fromPriceCents(3000, [
        group(1, 2, [opt(1000), opt(1500)], 'most_expensive'),
        group(0, 1, [opt(-500)], 'most_expensive'),
      ]),
    ).toBe(3500);
    // an averaged list: one more cheap unit can pull the average down
    expect(fromPriceCents(0, [group(1, 3, [opt(1000), opt(-200), opt(600)], 'average')])).toBe(
      -200,
    );
  });
  test('never above a price the shopper can configure (every pick checked)', () => {
    const groups = [
      group(1, 3, [opt(700, 2), opt(300), opt(-100)], 'average'),
      group(0, 2, [opt(400), opt(-50)], 'most_expensive'),
      group(2, 2, [opt(250, 2), opt(90)], 'sum'),
    ];
    const from = fromPriceCents(1000, groups)!;
    // every way to fill each group within its units, priced the way Core prices a line
    const ways = (g: (typeof groups)[number]) => {
      const out: { priceDeltaCents: number; qty: number }[][] = [[]];
      for (const m of g.modifiers as unknown as ReturnType<typeof opt>[]) {
        const next: typeof out = [];
        for (const w of out)
          for (let q = 0; q <= m.maxQty; q++)
            next.push(q ? [...w, { priceDeltaCents: m.priceDeltaCents, qty: q }] : w);
        out.splice(0, out.length, ...next);
      }
      const need = g.required ? Math.max(1, g.minSelect) : g.minSelect;
      return out.filter((w) => {
        const u = w.reduce((n, p) => n + p.qty, 0);
        return u >= need && u <= g.maxSelect;
      });
    };
    let cheapest = Infinity;
    for (const a of ways(groups[0]!))
      for (const b of ways(groups[1]!))
        for (const c of ways(groups[2]!))
          cheapest = Math.min(
            cheapest,
            unitPriceCents(1000, [
              { pricingRule: 'average', picks: a },
              { pricingRule: 'most_expensive', picks: b },
              { pricingRule: 'sum', picks: c },
            ]),
          );
    expect(from).toBe(cheapest);
  });
});

describe('when the catalog next changes', () => {
  // 2026-10-01 (a thursday) 17:59:30 in São Paulo (UTC−3)
  const now = new Date('2026-10-01T20:59:30Z');
  const tz = 'America/Sao_Paulo';
  test('the next window edge, from this minute', () => {
    expect(nextChangeAt([[{ days: [4], from: '18:00', to: '20:00' }]], now, tz)).toEqual(
      new Date('2026-10-01T21:00:00Z'),
    );
    // a day-only window turns at midnight; the nearer of two schedules wins
    expect(
      nextChangeAt([[{ days: [5] }], [{ days: [4], from: '10:00', to: '11:00' }]], now, tz),
    ).toEqual(new Date('2026-10-02T03:00:00Z'));
  });
  test('an edge already passed this week comes round next week; none at all is null', () => {
    expect(nextChangeAt([[{ days: [4], from: '09:00', to: '10:00' }]], now, tz)).toEqual(
      new Date('2026-10-08T12:00:00Z'),
    );
    expect(nextChangeAt([undefined, []], now, tz)).toBeNull();
  });
  test('across a daylight-saving change, the wall-clock moment', () => {
    // saturday noon in New York (EDT); sunday 09:00 falls after the switch to EST
    const sat = new Date('2026-10-31T16:00:00Z');
    expect(
      nextChangeAt([[{ days: [0], from: '09:00', to: '10:00' }]], sat, 'America/New_York'),
    ).toEqual(new Date('2026-11-01T14:00:00Z'));
  });
  test('a malformed stored window is skipped, never thrown on', () => {
    const bad = [{}, { days: 'x' }, { days: [9] }, { days: [4], from: '20:00', to: '18:00' }];
    expect(nextChangeAt([bad as never], now, tz)).toBeNull();
  });
});
