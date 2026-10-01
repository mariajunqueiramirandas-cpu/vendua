import { describe, expect, test } from 'bun:test';
import { crc16, normalizePixKey, pixPayload } from '../src/modules/pix.ts';
import {
  effectiveFee,
  foldName,
  haversineKm,
  parsePolygon,
  pointInPolygon,
  polygonArea,
  resolveZone,
  zoneMinFeeCents,
  type LatLng,
  type ZoneLike,
} from '../src/modules/geo.ts';
import { bookableDates, scheduleView, validateSchedule } from '../src/modules/preorder.ts';
import { evaluateCoupon, type CouponRow } from '../src/modules/coupons.ts';
import { parseSelections, validateCombo, type ComboSlot } from '../src/modules/combos.ts';
import { shortfall, stockDemand } from '../src/modules/stock.ts';
import {
  mintCustomerToken,
  normalizePhone,
  parseLoyalty,
  verifyCustomerToken,
} from '../src/modules/customer.ts';
import { composeAddress } from '../src/modules/checkout.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('pix BR Code', () => {
  test('CRC16-CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  test('payload is TLV with amount, txid and a valid trailing CRC', () => {
    const p = pixPayload(
      {
        key: 'loja@exemplo.com',
        keyType: 'email',
        beneficiary: 'Doçaria São João',
        city: 'Saquarema',
      },
      { amountCents: 4590, txid: 'PEDIDO-12' },
    );
    expect(p.startsWith('000201010212')).toBe(true);
    expect(p).toContain('0014br.gov.bcb.pix0116loja@exemplo.com');
    expect(p).toContain('540545.90');
    expect(p).toContain('5916DOCARIA SAO JOAO');
    expect(p).toContain('62120508PEDIDO12');
    expect(p.slice(-4)).toBe(crc16(p.slice(0, -4)));
  });
  test('static payload omits amount and uses *** txid', () => {
    const p = pixPayload({ key: '+5522999990000', keyType: 'phone', beneficiary: 'X Y', city: '' });
    expect(p).not.toContain('5405');
    expect(p).toContain('62070503***');
  });
  test('key normalization', () => {
    expect(normalizePixKey('123.456.789-09', 'cpf')).toBe('12345678909');
    expect(normalizePixKey('(22) 99999-0000', 'phone')).toBe('+5522999990000');
    expect(normalizePixKey('Loja@X.com', 'email')).toBe('loja@x.com');
    expect(normalizePixKey('12', 'cnpj')).toBeNull();
  });
});

describe('geo zones', () => {
  const zones: ZoneLike[] = [
    {
      id: 'n',
      name: 'Centro',
      kind: 'neighborhood',
      neighborhoods: ['Bacaxá'],
      fee_cents: 500,
      min_order_cents: 0,
      eta_min_minutes: 30,
      eta_max_minutes: 50,
    },
    {
      id: 'r5',
      name: '5km',
      kind: 'radius',
      neighborhoods: [],
      fee_cents: 300,
      min_order_cents: 0,
      eta_min_minutes: 30,
      eta_max_minutes: 60,
      max_distance_km: '5',
      fee_per_km_cents: 50,
    },
    {
      id: 'r10',
      name: '10km',
      kind: 'radius',
      neighborhoods: [],
      fee_cents: 800,
      min_order_cents: 0,
      eta_min_minutes: 40,
      eta_max_minutes: 80,
      max_distance_km: 10,
      free_delivery_over_cents: 10000,
    },
  ];
  const store = { lat: -22.93, lng: -42.51 };
  test('haversine is sane', () => {
    expect(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111.19, 1);
  });
  test('bairro matches fold accents and case; beats distance', () => {
    expect(foldName('  BACAXÁ ')).toBe('bacaxa');
    expect(resolveZone(zones, { neighborhood: 'bacaxa', coords: store }, store)?.zone.id).toBe('n');
  });
  test('smallest radius that covers the distance, per-km fee rounds up', () => {
    const m = resolveZone(zones, { coords: { lat: -22.93, lng: -42.48 } }, store)!;
    expect(m.zone.id).toBe('r5');
    expect(m.feeCents).toBe(300 + 4 * 50);
    const far = resolveZone(zones, { coords: { lat: -22.93, lng: -42.43 } }, store)!;
    expect(far.zone.id).toBe('r10');
    expect(effectiveFee(far, 9999)).toBe(800);
    expect(effectiveFee(far, 10000)).toBe(0);
    expect(resolveZone(zones, { coords: { lat: -22, lng: -42 } }, store)).toBeNull();
    expect(resolveZone(zones, { coords: { lat: -22.93, lng: -42.48 } }, null)).toBeNull();
  });
  test("a zone's least fee is what its nearest address is quoted", () => {
    const [n, r5, r10] = zones as [ZoneLike, ZoneLike, ZoneLike];
    expect(zoneMinFeeCents(n)).toBe(500);
    expect(zoneMinFeeCents(r10)).toBe(800);
    expect(zoneMinFeeCents(r5)).toBe(300 + 50);
    const near = resolveZone(zones, { coords: { lat: -22.93, lng: -42.5099 } }, store)!;
    expect(near.zone.id).toBe('r5');
    expect(near.feeCents).toBe(zoneMinFeeCents(r5));
  });
});

describe('geo polygons', () => {
  // a 0.02° square around (-22.93, -42.51) and an L-shaped (concave) ring
  const square: LatLng[] = [
    [-22.94, -42.52],
    [-22.94, -42.5],
    [-22.92, -42.5],
    [-22.92, -42.52],
  ];
  const ell: LatLng[] = [
    [0, 0],
    [0, 2],
    [1, 2],
    [1, 1],
    [2, 1],
    [2, 0],
  ];
  const zone = (id: string, over: Partial<ZoneLike>): ZoneLike => ({
    id,
    name: id,
    neighborhoods: [],
    fee_cents: 100,
    min_order_cents: 0,
    eta_min_minutes: 30,
    eta_max_minutes: 60,
    ...over,
  });

  test('ray casting: inside, outside, on an edge or vertex', () => {
    expect(pointInPolygon({ lat: -22.93, lng: -42.51 }, square)).toBe(true);
    expect(pointInPolygon({ lat: -22.95, lng: -42.51 }, square)).toBe(false);
    expect(pointInPolygon({ lat: -22.93, lng: -42.49 }, square)).toBe(false);
    expect(pointInPolygon({ lat: -22.94, lng: -42.51 }, square)).toBe(true);
    expect(pointInPolygon({ lat: -22.93, lng: -42.5 }, square)).toBe(true);
    expect(pointInPolygon({ lat: -22.92, lng: -42.52 }, square)).toBe(true);
  });

  test('concave ring: the notch is outside', () => {
    expect(pointInPolygon({ lat: 0.5, lng: 0.5 }, ell)).toBe(true);
    expect(pointInPolygon({ lat: 0.5, lng: 1.5 }, ell)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 0.5 }, ell)).toBe(true);
    expect(pointInPolygon({ lat: 1.5, lng: 1.5 }, ell)).toBe(false);
    // ray from inside the notch crosses two edges, from outside the bbox none
    expect(pointInPolygon({ lat: 1.5, lng: 3 }, ell)).toBe(false);
  });

  test('area ranks rings; winding does not matter', () => {
    expect(polygonArea(ell)).toBeCloseTo(3, 2);
    expect(polygonArea([...ell].reverse())).toBeCloseTo(3, 2);
    expect(polygonArea(square)).toBeLessThan(polygonArea(ell));
  });

  test('parsePolygon: bounds, closed rings, garbage', () => {
    expect(parsePolygon(square)).toEqual({ polygon: square });
    expect(parsePolygon([...square, square[0]])).toEqual({ polygon: square });
    const bad = (v: unknown) => 'error' in parsePolygon(v);
    expect(bad(null)).toBe(true);
    expect(bad('[[0,0],[0,1],[1,1]]')).toBe(true);
    expect(bad(square.slice(0, 2))).toBe(true);
    expect(bad([...square.slice(0, 2), square[0], square[0]])).toBe(true);
    expect(
      bad([
        [0, 0],
        [0, 1],
        ['1', 1],
      ]),
    ).toBe(true);
    expect(
      bad([
        [0, 0],
        [0, 1],
        [1, NaN],
      ]),
    ).toBe(true);
    expect(
      bad([
        [0, 0],
        [0, 1],
        [91, 1],
      ]),
    ).toBe(true);
    expect(
      bad([
        [0, 0],
        [0, 1],
        [1, 181],
      ]),
    ).toBe(true);
    expect(
      bad([
        [0, 0],
        [0, 1],
        [1, 1, 1],
      ]),
    ).toBe(true);
    expect(
      bad([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toBe(true);
    const ring = (n: number): LatLng[] =>
      Array.from({ length: n }, (_, i) => [
        Math.sin((2 * Math.PI * i) / n),
        Math.cos((2 * Math.PI * i) / n),
      ]);
    expect(bad(ring(200))).toBe(false);
    expect(bad(ring(201))).toBe(true);
  });

  test('resolveZone: neighborhood, then smallest containing polygon, then radius', () => {
    const store = { lat: -22.93, lng: -42.51 };
    const big: LatLng[] = [
      [-23, -42.6],
      [-23, -42.4],
      [-22.8, -42.4],
      [-22.8, -42.6],
    ];
    const zones: ZoneLike[] = [
      zone('n', { kind: 'neighborhood', neighborhoods: ['Bacaxá'], fee_cents: 500 }),
      zone('r', { kind: 'radius', max_distance_km: 50, fee_cents: 900 }),
      zone('pb', { kind: 'polygon', polygon: big, fee_cents: 700 }),
      zone('ps', { kind: 'polygon', polygon: square, fee_cents: 300, neighborhoods: ['Centro'] }),
    ];
    const inSquare = { lat: -22.93, lng: -42.51 };
    expect(resolveZone(zones, { neighborhood: 'bacaxa', coords: inSquare }, store)?.zone.id).toBe(
      'n',
    );
    const m = resolveZone(zones, { coords: inSquare }, store)!;
    expect(m.zone.id).toBe('ps');
    expect(m.feeCents).toBe(300);
    expect(m.distanceKm).toBeNull();
    // a polygon zone never matches by neighborhood name
    expect(resolveZone(zones, { neighborhood: 'Centro' }, store)).toBeNull();
    expect(resolveZone(zones, { coords: { lat: -22.85, lng: -42.45 } }, store)?.zone.id).toBe('pb');
    // polygons need no store location; the radius does
    expect(resolveZone(zones, { coords: inSquare }, null)?.zone.id).toBe('ps');
    expect(resolveZone(zones, { coords: { lat: -22.7, lng: -42.51 } }, store)?.zone.id).toBe('r');
    expect(resolveZone(zones, { coords: { lat: -22.7, lng: -42.51 } }, null)).toBeNull();
    expect(resolveZone(zones, { neighborhood: 'Outro' }, store)).toBeNull();
  });

  test('resolveZone: equal areas tie on the lowest id', () => {
    const zones = [
      zone('b', { kind: 'polygon', polygon: square }),
      zone('a', { kind: 'polygon', polygon: square }),
    ];
    expect(resolveZone(zones, { coords: { lat: -22.93, lng: -42.51 } }, null)?.zone.id).toBe('a');
  });
});

describe('preorder calendar', () => {
  // Thu 2026-09-24 10:00 in São Paulo
  const now = new Date('2026-09-24T13:00:00Z');
  const hours = {
    timezone: 'America/Sao_Paulo',
    windows: [{ days: [2, 3, 4, 5, 6], open: '09:00', close: '18:00' }],
  };
  test('lead days + open weekdays only (Sun/Mon closed)', () => {
    expect(bookableDates(hours, 2, 7, now)).toEqual([
      '2026-09-26',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
    ]);
  });
  test('late-night UTC still uses the store-local date', () => {
    expect(
      bookableDates({ ...hours, windows: [] }, 0, 0, new Date('2026-09-25T02:30:00Z')),
    ).toEqual(['2026-09-24']);
  });
  test('schedule gate', () => {
    const v = scheduleView(
      [{ requiresPreorder: true, preorderLeadDays: 2 }],
      { hours, preorder_max_days: 7 },
      now,
    );
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as { code: string }).code;
      }
      return null;
    };
    expect(code(() => validateSchedule(v, undefined, 'pix'))).toBe('SCHEDULE_REQUIRED');
    expect(code(() => validateSchedule(v, '2026-09-25', 'pix'))).toBe('INVALID_SCHEDULE');
    expect(code(() => validateSchedule(v, '2026-09-26', 'cash'))).toBe('PAYMENT_NOT_ALLOWED');
    expect(validateSchedule(v, '2026-09-26', 'pix')).toBe('2026-09-26');
    const plain = scheduleView([{ requiresPreorder: false, preorderLeadDays: 0 }], { hours }, now);
    expect(validateSchedule(plain, undefined, 'cash')).toBeNull();
  });
});

describe('coupons', () => {
  const base: CouponRow = {
    id: 'c',
    code: 'X',
    kind: 'percent',
    value: 15,
    label: null,
    min_subtotal_cents: 0,
    max_discount_cents: null,
    starts_at: null,
    ends_at: null,
    max_redemptions: null,
    per_phone_limit: null,
    first_order_only: false,
    phone: null,
    source: 'staff',
    active: true,
  };
  const now = new Date('2026-09-27T12:00:00Z');
  const ev = (c: Partial<CouponRow>, ctx: Partial<Parameters<typeof evaluateCoupon>[1]> = {}) =>
    evaluateCoupon(
      { ...base, ...c },
      { subtotalCents: 3333, deliveryFeeCents: 700, usage: { total: 0 }, now, ...ctx },
    );
  test('percent floors, caps at max', () => {
    expect(ev({}).discountCents).toBe(499);
    expect(ev({ max_discount_cents: 300 }).discountCents).toBe(300);
  });
  test('fixed never exceeds subtotal; free delivery = fee', () => {
    expect(ev({ kind: 'fixed', value: 5000 }).discountCents).toBe(3333);
    expect(ev({ kind: 'free_delivery' }).discountCents).toBe(700);
  });
  test('window, limits, min subtotal, personal, first order', () => {
    expect(ev({ ends_at: '2026-09-01T00:00:00Z' }).reason).toBe('COUPON_EXPIRED');
    expect(ev({ starts_at: '2026-10-01T00:00:00Z' }).reason).toBe('COUPON_NOT_STARTED');
    expect(ev({ max_redemptions: 1 }, { usage: { total: 1 } }).reason).toBe('COUPON_EXHAUSTED');
    expect(ev({ min_subtotal_cents: 4000 }).details).toEqual({
      minSubtotalCents: 4000,
      remainingCents: 667,
    });
    expect(ev({ phone: '2299' }, { phone: '2188' }).reason).toBe('COUPON_NOT_YOURS');
    expect(
      ev({ per_phone_limit: 1 }, { phone: '2188', usage: { total: 3, byPhone: 1 } }).reason,
    ).toBe('COUPON_ALREADY_USED');
    expect(
      ev(
        { first_order_only: true },
        { phone: '2188', usage: { total: 0, byPhone: 0, priorOrders: 2 } },
      ).reason,
    ).toBe('COUPON_FIRST_ORDER_ONLY');
    // unknown phone (cart preview): phone rules wait for checkout
    expect(ev({ first_order_only: true, phone: '2299' }).ok).toBe(true);
    expect(ev({ active: false }).reason).toBe('COUPON_NOT_FOUND');
  });
});

describe('combos + stock', () => {
  const slots: ComboSlot[] = [
    {
      id: U(1),
      name: 'Sabores',
      minSelect: 3,
      maxSelect: 4,
      qtyPerItem: 2,
      items: [
        {
          productId: U(10),
          slug: 'a',
          name: 'A',
          priceDeltaCents: 0,
          status: 'active',
          stockQuantity: null,
          imageUrl: null,
        },
        {
          productId: U(11),
          slug: 'b',
          name: 'B',
          priceDeltaCents: 150,
          status: 'active',
          stockQuantity: 3,
          imageUrl: null,
        },
        {
          productId: U(12),
          slug: 'c',
          name: 'C',
          priceDeltaCents: 0,
          status: 'sold_out',
          stockQuantity: 0,
          imageUrl: null,
        },
      ],
    },
  ];
  test('selections canonicalize (merge + sort) so equal kits share a cart line', () => {
    const a = parseSelections([
      { slotId: U(1), productId: U(11), qty: 1 },
      { slotId: U(1), productId: U(10) },
      { slotId: U(1), productId: U(11), qty: 1 },
    ]);
    expect(a).toEqual([
      { slotId: U(1), productId: U(10), qty: 1 },
      { slotId: U(1), productId: U(11), qty: 2 },
    ]);
  });
  test('count, per-item cap, sold-out picks', () => {
    expect(
      validateCombo(slots, parseSelections([{ slotId: U(1), productId: U(10), qty: 2 }])).error
        ?.code,
    ).toBe('COMBO_SLOT_COUNT');
    expect(
      validateCombo(slots, parseSelections([{ slotId: U(1), productId: U(10), qty: 3 }])).error
        ?.code,
    ).toBe('COMBO_ITEM_LIMIT');
    expect(
      validateCombo(slots, parseSelections([{ slotId: U(1), productId: U(12), qty: 1 }])).error
        ?.code,
    ).toBe('COMBO_ITEM_SOLD_OUT');
    expect(
      validateCombo(slots, parseSelections([{ slotId: U(2), productId: U(10), qty: 1 }])).error
        ?.code,
    ).toBe('INVALID_COMBO');
    const ok = validateCombo(
      slots,
      parseSelections([
        { slotId: U(1), productId: U(10), qty: 2 },
        { slotId: U(1), productId: U(11), qty: 2 },
      ]),
    );
    expect(ok.error).toBeNull();
    expect(ok.picks.map((p) => p.priceDeltaCents * p.qty)).toEqual([0, 300]);
  });
  test('stock demand counts kit picks × kit qty', () => {
    const d = stockDemand([
      { productId: 'kit', qty: 2, combo: [{ productId: 'b', qty: 2 }] },
      { productId: 'b', qty: 1 },
    ]);
    expect(d.get('b')).toBe(5);
    expect(shortfall(d, new Map([['b', { name: 'B', stock: 4 }]]))?.details).toEqual({
      productId: 'b',
      available: 4,
    });
    expect(shortfall(d, new Map([['b', { name: 'B', stock: null }]]))).toBeNull();
  });
});

describe('customer + address', () => {
  test('phones collapse to the national number', () => {
    expect(normalizePhone('+55 (22) 99999-0001')).toBe('22999990001');
    expect(normalizePhone('22999990001')).toBe('22999990001');
  });
  test('customer tokens bind tenant + phone + anchor order and expire', () => {
    const anchor = '0b9c1d4e-1111-4222-8333-444455556666';
    const { token } = mintCustomerToken('s', 't1', '22999990001', anchor, Date.UTC(2026, 8, 1));
    expect(verifyCustomerToken('s', 't1', token, Date.UTC(2026, 8, 2))).toEqual({
      phone: '22999990001',
      anchorOrderId: anchor,
    });
    expect(verifyCustomerToken('s', 't2', token, Date.UTC(2026, 8, 2))).toBeNull();
    expect(verifyCustomerToken('other', 't1', token, Date.UTC(2026, 8, 2))).toBeNull();
    expect(verifyCustomerToken('s', 't1', token, Date.UTC(2027, 1, 1))).toBeNull();
    for (const forged of [
      token.replace('22999990001', '22999990002'),
      token.replace(anchor, '0b9c1d4e-1111-4222-8333-444455556667'),
    ])
      expect(verifyCustomerToken('s', 't1', forged, Date.UTC(2026, 8, 2))).toBeNull();
  });
  test('old-format (phone-only) customer tokens are rejected', () => {
    expect(verifyCustomerToken('s', 't1', 'vcu.22999990001.1999999999.abc')).toBeNull();
  });
  test('loyalty program parsing rejects nonsense', () => {
    expect(parseLoyalty({ stampsRequired: 1, reward: { kind: 'fixed', value: 1 } })).toBeNull();
    expect(parseLoyalty({ stampsRequired: 10, reward: { kind: 'bogus' } })).toBeNull();
    expect(
      parseLoyalty({ stampsRequired: 10, reward: { kind: 'percent', value: 20, label: 'x' } })
        ?.rewardValidDays,
    ).toBe(60);
  });
  test('structured address composes one courier line', () => {
    expect(
      composeAddress({ mode: 'delivery', street: ' Rua A ', number: '10', complement: 'ap 3' }),
    ).toBe('Rua A, 10 — ap 3');
    expect(composeAddress({ mode: 'delivery', address: 'Rua B, 2' })).toBe('Rua B, 2');
  });
});
