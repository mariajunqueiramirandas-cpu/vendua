import { describe, expect, test } from 'bun:test';
import type { CatalogCategory, CatalogProduct, DeliveryZone, Notice } from '../src/api.ts';
import {
  COUPON_REASON,
  DEFAULT_PATHS,
  DEFAULT_VOCABULARY,
  MAX_LINE_QTY,
  PIX_KEY_LABEL,
  absoluteUrl,
  adjustmentKind,
  adjustmentShort,
  adjustmentText,
  arrangeMenu,
  cardState,
  catalogHref,
  contactLinks,
  couponMessage,
  deliverySummary,
  deliveryWords,
  errorCopy,
  foldText,
  formatCents,
  formatCentsParts,
  formatWhen,
  hoursRows,
  instagramHandle,
  instagramUrl,
  interpolate,
  isBlocking,
  isCouponError,
  isValidCep,
  isValidPhone,
  lineSummary,
  localNow,
  maskCep,
  maskPhone,
  matchProduct,
  orderPath,
  orderProgress,
  orderStepLabel,
  phoneDisplay,
  phoneKey,
  plural,
  priceDisplay,
  priceWords,
  productAnchor,
  productHref,
  qrMatrix,
  qrSvg,
  qrSvgPath,
  resolvePaths,
  statusHint,
  statusWords,
  todayHours,
  visibleNotices,
  vocabularyOf,
  whatsappDigits,
  whatsappUrl,
  zoneFeeFloor,
} from '../src/rules/index.ts';

// Kernel 1.14 — the pure rules: one decision per Core field, the words apart.

const SP = 'America/Sao_Paulo';
// Monday 2026-10-05 02:30 UTC = Sunday 2026-10-04 23:30 in São Paulo
const NOW = new Date('2026-10-05T02:30:00Z');
const brl = (c: number) => formatCents(c);

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: 'p1',
  slug: 'pudim',
  name: 'Pudim',
  description: 'Lisinho',
  basePriceCents: 1800,
  status: 'active',
  figureVariant: 'default',
  tags: [],
  needsChoices: false,
  kind: 'simple',
  ...over,
});

describe('format', () => {
  test('money and its parts', () => {
    expect(formatCents(1200)).toMatch(/^R\$\s12,00$/);
    expect(formatCentsParts(123456)).toEqual({
      symbol: 'R$',
      amount: '1.234,56',
      symbolFirst: true,
    });
    expect(formatCentsParts(500, 'EUR').symbol).toBe('€');
  });

  test('formatWhen: today, tomorrow, a weekday, a date — in the store’s zone', () => {
    // 09:00 Monday in São Paulo is "tomorrow" there, and "today" in UTC
    expect(formatWhen('2026-10-05T12:00:00Z', SP, NOW)).toBe('amanhã às 09:00');
    expect(formatWhen('2026-10-05T12:00:00Z', 'UTC', NOW)).toBe('hoje às 12:00');
    expect(formatWhen('2026-10-04T23:50:00Z', SP, NOW)).toBe('hoje às 20:50');
    expect(formatWhen('2026-10-08T12:00:00Z', SP, NOW)).toBe('qui às 09:00');
    expect(formatWhen('2026-10-10T12:00:00Z', SP, NOW)).toBe('sáb às 09:00');
    expect(formatWhen('2026-10-11T12:00:00Z', SP, NOW)).toBe('11/10 às 09:00');
    // a store saved without a zone reads as Core does (São Paulo); a bad one doesn't throw
    expect(formatWhen('2026-10-05T12:00:00Z', '', NOW)).toBe('amanhã às 09:00');
    expect(formatWhen('2026-10-05T12:00:00Z', 'Nowhere/Zone', NOW)).toBe('amanhã às 09:00');
  });

  test('localNow', () => {
    expect(localNow(SP, NOW)).toEqual({ date: '2026-10-04', weekday: 0, minutes: 23 * 60 + 30 });
    expect(localNow('UTC', NOW)).toEqual({ date: '2026-10-05', weekday: 1, minutes: 150 });
  });

  test('plural, foldText, interpolate', () => {
    expect(`0 ${plural(0, 'item', 'itens')}`).toBe('0 itens');
    expect(plural(1, 'item', 'itens')).toBe('item');
    expect(foldText('AÇAÍ com Pão')).toBe('acai com pao');
    expect(
      interpolate('{store} entrega em {city}!', { store: 'Quero Pudim', city: 'Saquarema' }),
    ).toBe('Quero Pudim entrega em Saquarema!');
    expect(interpolate('Em {city}, {missing}{store}', { city: null })).toBe('Em , ');
    expect(interpolate('{ store } fica', { store: 'x' })).toBe('{ store } fica');
  });
});

describe('priceDisplay', () => {
  test('plain, promo and from', () => {
    expect(priceDisplay({ basePriceCents: 1800 })).toEqual({
      form: 'plain',
      cents: 1800,
      struckCents: null,
      promoLabel: null,
    });
    const promo = priceDisplay({
      basePriceCents: 1800,
      compareAtPriceCents: 2400,
      promoLabel: 'Seg a sex, 18h–20h',
    });
    expect(promo).toEqual({
      form: 'promo',
      cents: 1800,
      struckCents: 2400,
      promoLabel: 'Seg a sex, 18h–20h',
    });
    expect(priceWords(promo)).toMatch(/^de R\$\s24,00 por R\$\s18,00$/);
    const from = priceDisplay({ basePriceCents: 0, fromPriceCents: 2290 });
    expect(from.form).toBe('from');
    expect(priceWords(from)).toMatch(/^a partir de R\$\s22,90$/);
    expect(priceWords(priceDisplay({ basePriceCents: 1800 }))).toMatch(/^R\$\s18,00$/);
  });

  test('a from-price is never struck, and a "de" price at or below the price is ignored', () => {
    const both = priceDisplay({
      basePriceCents: 1000,
      fromPriceCents: 2290,
      compareAtPriceCents: 3000,
    });
    expect(both.form).toBe('from');
    expect(both.struckCents).toBeNull();
    expect(priceDisplay({ basePriceCents: 1800, compareAtPriceCents: 1800 }).form).toBe('plain');
    expect(priceDisplay({ basePriceCents: 1800, compareAtPriceCents: 1000 }).form).toBe('plain');
    expect(priceDisplay({ basePriceCents: 1800, fromPriceCents: 1800 }).form).toBe('plain');
    expect(priceDisplay({ basePriceCents: 1800, fromPriceCents: null }).form).toBe('plain');
  });
});

describe('cardState', () => {
  test('an available product with plenty', () => {
    expect(cardState(product({ stockQuantity: 20 }), 20)).toEqual({
      soldOut: false,
      scheduleLabel: null,
      stockLeft: 20,
      allInBag: false,
      lowStock: false,
      canQuickAdd: true,
      maxQty: 20,
      badge: null,
    });
    const untracked = cardState(product(), null);
    expect(untracked.maxQty).toBe(MAX_LINE_QTY);
    expect(untracked.lowStock).toBe(false);
  });

  test('sold out — any status but active, with the schedule label', () => {
    const s = cardState(product({ status: 'sold_out', availabilityLabel: 'Só sábados' }), 5);
    expect(s).toMatchObject({
      soldOut: true,
      scheduleLabel: 'Só sábados',
      canQuickAdd: false,
      badge: 'sold-out',
      lowStock: false,
      allInBag: false,
    });
    // a status this Kernel doesn't know (e.g. "paused") is not addable either
    const paused = cardState(product({ status: 'paused' as CatalogProduct['status'] }), null);
    expect(paused.soldOut).toBe(true);
    expect(paused.badge).toBe('sold-out');
    expect(cardState(product({ availabilityLabel: 'Só sábados' }), 5).scheduleLabel).toBeNull();
  });

  test('all of it in the bag', () => {
    const s = cardState(product({ stockQuantity: 3, lowStock: true }), 0);
    expect(s).toMatchObject({
      allInBag: true,
      lowStock: false,
      canQuickAdd: false,
      maxQty: 0,
      badge: 'all-in-bag',
    });
  });

  test('low stock is Core’s: its flag, or its threshold on what the bag leaves', () => {
    expect(cardState(product({ lowStock: true }), 2).badge).toBe('low-stock');
    // Core said plenty (10 > 3), but the bag holds 8: 2 left is at the threshold
    const afterBag = cardState(
      product({ stockQuantity: 10, lowStock: false, lowStockThreshold: 3 }),
      2,
    );
    expect(afterBag.lowStock).toBe(true);
    expect(afterBag.badge).toBe('low-stock');
    expect(cardState(product({ lowStockThreshold: 3 }), 4).lowStock).toBe(false);
    // no client threshold: no Core flag and no threshold means never low
    expect(cardState(product(), 1).lowStock).toBe(false);
  });

  test('quick add needs Core’s "no choices", not a combo, not an encomenda', () => {
    expect(cardState(product({ needsChoices: true }), null).canQuickAdd).toBe(false);
    const { needsChoices: _, ...unknown } = product();
    expect(cardState(unknown, null).canQuickAdd).toBe(false);
    expect(cardState(product({ kind: 'combo' }), null).canQuickAdd).toBe(false);
    const pre = cardState(product({ requiresPreorder: true }), null);
    expect(pre.canQuickAdd).toBe(false);
    expect(pre.badge).toBe('preorder');
    // low stock outranks encomenda
    expect(cardState(product({ requiresPreorder: true, lowStock: true }), 1).badge).toBe(
      'low-stock',
    );
  });
});

describe('arrangeMenu', () => {
  const cats: CatalogCategory[] = [
    {
      id: 'c1',
      slug: 'doces',
      name: 'Doces',
      sort: 1,
      products: [
        product({ id: 'a', name: 'Açaí', status: 'sold_out' }),
        product({ id: 'b', name: 'Brigadeiro', description: 'Com granulado belga' }),
        product({ id: 'c', name: 'Cocada', status: 'sold_out' }),
        product({ id: 'd', name: 'Doce de leite' }),
      ],
    },
    { id: 'c2', slug: 'vazia', name: 'Vazia', sort: 2, products: [] },
    {
      id: 'c3',
      slug: 'salgados',
      name: 'Salgados de festa',
      sort: 3,
      products: [product({ id: 'e', name: 'Coxinha' }), product({ id: 'f', name: 'Empada' })],
    },
  ];
  const ids = (cs: CatalogCategory[]) => cs.map((c) => [c.id, c.products.map((p) => p.id)]);

  test('no query: empty categories drop, sold out sinks (stable)', () => {
    expect(ids(arrangeMenu(cats))).toEqual([
      ['c1', ['b', 'd', 'a', 'c']],
      ['c3', ['e', 'f']],
    ]);
  });

  test('search folds accents and matches name or description', () => {
    expect(ids(arrangeMenu(cats, { query: 'ACAI' }))).toEqual([['c1', ['a']]]);
    expect(ids(arrangeMenu(cats, { query: 'belga' }))).toEqual([['c1', ['b']]]);
    expect(arrangeMenu(cats, { query: 'nada disso' })).toEqual([]);
  });

  test('a category-name hit keeps every product of it', () => {
    expect(ids(arrangeMenu(cats, { query: 'festa' }))).toEqual([['c3', ['e', 'f']]]);
    expect(matchProduct({ name: 'Coxinha' }, 'Salgados', 'salgad')).toBe(true);
    expect(matchProduct({ name: 'Coxinha', description: null }, 'Salgados', 'doce')).toBe(false);
    expect(matchProduct({ name: 'Coxinha' }, 'Salgados', '  ')).toBe(true);
  });
});

describe('hours', () => {
  const week = (windows: { days: number[]; open: string; close: string }[], tz = SP) => ({
    timezone: tz,
    windows,
  });

  test('Monday first; same hours fold; closed days are rows', () => {
    const rows = hoursRows(
      week([
        { days: [1, 2, 3, 4, 5], open: '09:00', close: '18:00' },
        { days: [6, 0], open: '10:00', close: '14:00' },
      ]),
      NOW,
    );
    expect(rows.map((r) => [r.label, r.windows, r.closed])).toEqual([
      ['Seg – Sex', [{ open: '09:00', close: '18:00' }], false],
      ['Sáb – Dom', [{ open: '10:00', close: '14:00' }], false],
    ]);
    const closed = hoursRows(week([{ days: [2, 3, 4, 5, 6], open: '11:00', close: '22:00' }]), NOW);
    expect(closed.map((r) => [r.label, r.closed])).toEqual([
      ['Segunda', true],
      ['Ter – Sáb', false],
      ['Domingo', true],
    ]);
    expect(
      hoursRows(week([{ days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '22:00' }]), NOW)[0]!
        .label,
    ).toBe('Todos os dias');
  });

  test('Sat–Mon with the same hours: Monday stays first, the week doesn’t wrap', () => {
    const rows = hoursRows(
      week([
        { days: [6, 0, 1], open: '08:00', close: '12:00' },
        { days: [2, 3, 4, 5], open: '09:00', close: '18:00' },
      ]),
      NOW,
    );
    expect(rows.map((r) => [r.label, r.days])).toEqual([
      ['Segunda', [1]],
      ['Ter – Sex', [2, 3, 4, 5]],
      ['Sáb – Dom', [6, 0]],
    ]);
  });

  test('today is the store’s, in its zone', () => {
    const hours = week([
      { days: [1, 2, 3, 4, 5], open: '09:00', close: '18:00' },
      { days: [6, 0], open: '10:00', close: '14:00' },
    ]);
    // 02:30 UTC Monday is still Sunday in São Paulo
    expect(hoursRows(hours, NOW).find((r) => r.today)!.label).toBe('Sáb – Dom');
    expect(hoursRows({ ...hours, timezone: 'UTC' }, NOW).find((r) => r.today)!.label).toBe(
      'Seg – Sex',
    );
  });

  test('todayHours honours a special day', () => {
    const hours = {
      ...week([{ days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '22:00' }]),
      specialDays: [
        { date: '2026-10-04', closed: true, label: 'Feriado' },
        { date: '2026-10-05', closed: false, open: '10:00', close: '14:00' },
      ],
    };
    expect(todayHours(hours, NOW)).toEqual({
      date: '2026-10-04',
      windows: [],
      closed: true,
      special: { label: 'Feriado' },
    });
    expect(todayHours({ ...hours, timezone: 'UTC' }, NOW)).toEqual({
      date: '2026-10-05',
      windows: [{ open: '10:00', close: '14:00' }],
      closed: false,
      special: { label: null },
    });
    const plain = todayHours({ ...hours, specialDays: [] }, NOW);
    expect(plain).toEqual({
      date: '2026-10-04',
      windows: [{ open: '09:00', close: '22:00' }],
      closed: false,
      special: null,
    });
  });

  test('statusHint never invents a time Core didn’t serve', () => {
    expect(statusHint({ status: 'open', closesAt: '2026-10-04T21:00:00Z' })).toEqual({
      kind: 'open-until',
      at: '2026-10-04T21:00:00Z',
    });
    expect(statusHint({ status: 'open' })).toEqual({ kind: 'open' });
    expect(statusHint({ status: 'closed', resumesAt: '2026-10-05T12:00:00Z' })).toEqual({
      kind: 'opens',
      at: '2026-10-05T12:00:00Z',
    });
    // a manual close: no time, even though the store has hours
    expect(statusHint({ status: 'closed' })).toEqual({ kind: 'closed' });
    expect(statusHint({ status: 'closed', closesAt: '2026-10-04T21:00:00Z' })).toEqual({
      kind: 'closed',
    });
    expect(statusHint({ status: 'paused', resumesAt: null })).toEqual({ kind: 'paused' });
  });

  test('statusWords', () => {
    const at = (kind: Parameters<typeof statusWords>[0]['kind'], iso?: string) =>
      statusWords(iso ? { kind, at: iso } : { kind }, SP, NOW);
    expect(at('open-until', '2026-10-05T02:59:00Z')).toBe('Aberto até 23:59');
    expect(at('opens', '2026-10-05T12:00:00Z')).toBe('Abre amanhã às 09:00');
    expect(at('paused-until', '2026-10-05T02:45:00Z')).toBe('Pausado até 23:45');
    expect(at('paused-until', '2026-10-05T12:00:00Z')).toBe('Pausado até amanhã às 09:00');
    expect(at('open')).toBe('Aberto');
    expect(at('closed')).toBe('Fechado');
    expect(at('paused')).toBe('Pausado');
  });
});

describe('delivery', () => {
  const store = {
    deliveryEnabled: true,
    pickupEnabled: true,
    minOrderCents: 1000,
    prepTimeMinutes: 30,
  };
  const zone = (over: Partial<DeliveryZone> = {}): DeliveryZone => ({
    id: 'z',
    name: 'Centro',
    neighborhoods: [],
    feeCents: 500,
    minOrderCents: 0,
    etaMin: 30,
    etaMax: 50,
    kind: 'neighborhood',
    ...over,
  });
  const fee = (zones: DeliveryZone[]) => deliverySummary(store, zones).delivery!.fee;

  test('fee forms', () => {
    expect(fee([zone({ feeCents: 0 }), zone({ feeCents: 0 })])).toEqual({ form: 'free', cents: 0 });
    expect(fee([zone(), zone()])).toEqual({ form: 'flat', cents: 500 });
    expect(fee([zone({ feeCents: 300 }), zone()])).toEqual({ form: 'from', cents: 300 });
    expect(fee([zone({ feeCents: 0 }), zone()])).toEqual({ form: 'some-free', cents: 0 });
  });

  test('a per-km zone is never free, nor flat', () => {
    const radius = zone({ kind: 'radius', feeCents: 0, feePerKmCents: 200, maxDistanceKm: 5 });
    expect(zoneFeeFloor(radius)).toBe(200);
    expect(zoneFeeFloor(zone({ kind: 'neighborhood', feePerKmCents: 200 }))).toBe(500);
    expect(fee([radius])).toEqual({ form: 'from', cents: 200 });
    expect(fee([zone({ kind: 'radius', feeCents: 300, feePerKmCents: 0 })])).toEqual({
      form: 'flat',
      cents: 300,
    });
  });

  test('free over a subtotal only when every paid zone has one', () => {
    const s = deliverySummary(store, [
      zone({ feeCents: 0 }),
      zone({ freeDeliveryOverCents: 5000 }),
      zone({ feeCents: 800, freeDeliveryOverCents: 8000 }),
    ]);
    expect(s.delivery!.freeOverCents).toBe(8000);
    expect(
      deliverySummary(store, [zone({ freeDeliveryOverCents: 5000 }), zone()]).delivery!
        .freeOverCents,
    ).toBeNull();
    expect(deliverySummary(store, [zone({ feeCents: 0 })]).delivery!.freeOverCents).toBeNull();
  });

  test('minimum order per zone is the store’s or the zone’s, the higher', () => {
    const s = deliverySummary(store, [
      zone({ minOrderCents: 1500, etaMin: 20, etaMax: 40 }),
      zone({ minOrderCents: 0, etaMin: 40, etaMax: 70 }),
    ]).delivery!;
    expect([s.minOrderCents, s.minOrderVaries, s.etaMin, s.etaMax]).toEqual([1000, true, 20, 70]);
    const same = deliverySummary(store, [zone({ minOrderCents: 500 }), zone()]).delivery!;
    expect([same.minOrderCents, same.minOrderVaries]).toEqual([1000, false]);
  });

  test('no zones or no delivery: only pickup', () => {
    expect(deliverySummary(store, [])).toEqual({ delivery: null, pickup: { prepMinutes: 30 } });
    expect(
      deliverySummary({ ...store, deliveryEnabled: false, pickupEnabled: false }, [zone()]),
    ).toEqual({
      delivery: null,
      pickup: null,
    });
    expect(deliveryWords({ delivery: null, pickup: null })).toBeNull();
  });

  test('words', () => {
    const w = (zones: DeliveryZone[], s = store) => deliveryWords(deliverySummary(s, zones))!;
    expect(w([zone({ feeCents: 0 })]).fee).toBe('entrega grátis');
    expect(w([zone()]).fee).toMatch(/^entrega R\$\s5,00$/);
    expect(w([zone({ feeCents: 300 }), zone()]).fee).toMatch(/^entrega a partir de R\$\s3,00$/);
    expect(w([zone({ feeCents: 0 }), zone()]).fee).toBe('entrega grátis em algumas regiões');
    const words = w([
      zone({ minOrderCents: 1500, freeDeliveryOverCents: 6000 }),
      zone({ freeDeliveryOverCents: 4000 }),
    ]);
    expect(words.eta).toBe('30–50 min');
    expect(words.minOrder).toMatch(/^pedido mínimo a partir de R\$\s10,00$/);
    expect(words.freeOver).toMatch(/^grátis acima de R\$\s60,00$/);
    expect(w([zone({ etaMin: 40, etaMax: 40 })], { ...store, minOrderCents: 0 })).toMatchObject({
      eta: '40 min',
      minOrder: null,
    });
  });
});

describe('links', () => {
  test('paths', () => {
    expect(resolvePaths({})).toEqual(DEFAULT_PATHS);
    const config = { paths: { catalog: '/menu', product: '/p/:slug' as const } };
    expect(productHref(config, 'pão de mel')).toBe('/p/p%C3%A3o%20de%20mel');
    expect(productHref({}, 'pudim')).toBe('/produto/pudim');
    expect(catalogHref(config)).toBe('/menu');
    expect(catalogHref({})).toBe('/cardapio');
    expect(productAnchor('pudim')).toBe('produto-pudim');
    expect(absoluteUrl('https://loja.vendua.com.br/', '/produto/pudim')).toBe(
      'https://loja.vendua.com.br/produto/pudim',
    );
    expect(absoluteUrl('https://loja.com', 'cardapio')).toBe('https://loja.com/cardapio');
    expect(absoluteUrl('https://loja.com', 'https://other.com/x')).toBe('https://other.com/x');
  });

  test('WhatsApp: Core’s normalisation', () => {
    expect(whatsappDigits('(22) 98179-5040')).toBe('5522981795040');
    expect(whatsappDigits('+55 22 98179-5040')).toBe('5522981795040');
    expect(whatsappDigits('5522981795040')).toBe('5522981795040');
    expect(whatsappDigits('022 2645-1234')).toBe('552226451234');
    expect(whatsappDigits('5522981795040')).toBe('5522981795040');
    expect(whatsappDigits('4422981795040')).toBeNull();
    expect(whatsappDigits('123')).toBeNull();
    expect(whatsappDigits('55229817950401')).toBeNull();
    expect(whatsappDigits('')).toBeNull();
    expect(whatsappDigits(null)).toBeNull();
    expect(whatsappUrl('22981795040', 'Oi! Pedido #12')).toBe(
      'https://wa.me/5522981795040?text=Oi!%20Pedido%20%2312',
    );
    expect(whatsappUrl(undefined)).toBeNull();
  });

  test('Instagram: the bare handle from any form', () => {
    expect(instagramHandle('@queropudim')).toBe('queropudim');
    expect(instagramHandle('https://www.instagram.com/quero.pudim_1/?hl=pt-br')).toBe(
      'quero.pudim_1',
    );
    expect(instagramHandle('instagram.com/queropudim')).toBe('queropudim');
    expect(instagramHandle('HTTP://Instagram.com/queropudim#top')).toBe('queropudim');
    expect(instagramHandle('instagram.com/doce/?hl=pt')).toBe('doce');
    expect(instagramHandle('facebook.com/doce')).toBeNull();
    expect(instagramHandle('instagram.com/doce/reels')).toBeNull();
    expect(instagramHandle('@queropudim/')).toBe('queropudim');
    expect(instagramHandle(' queropudim ')).toBe('queropudim');
    expect(instagramHandle('não é um perfil')).toBeNull();
    expect(instagramHandle('')).toBeNull();
    expect(instagramUrl('@queropudim')).toBe('https://www.instagram.com/queropudim/');
  });

  test('phone display and contact links', () => {
    expect(phoneDisplay('5522981795040')).toBe('(22)\u00a098179-5040');
    expect(phoneDisplay('2226451234')).toBe('(22)\u00a02645-1234');
    expect(phoneDisplay('123')).toBe('123');
    expect(contactLinks({ whatsapp: '22981795040', instagram: '@loja' }, 'Oi')).toEqual({
      whatsapp: { href: 'https://wa.me/5522981795040?text=Oi', display: '(22)\u00a098179-5040' },
      instagram: { href: 'https://www.instagram.com/loja/', handle: 'loja' },
    });
    expect(contactLinks(null)).toEqual({ whatsapp: null, instagram: null });
  });
});

describe('phone and CEP', () => {
  test('masks are progressive', () => {
    const steps = '22981795040'.split('').map((_, i) => maskPhone('22981795040'.slice(0, i + 1)));
    expect(steps).toEqual([
      '(2',
      '(22',
      '(22) 9',
      '(22) 98',
      '(22) 981',
      '(22) 9817',
      '(22) 9817-9',
      '(22) 9817-95',
      '(22) 9817-950',
      '(22) 9817-9504',
      '(22) 98179-5040',
    ]);
    expect(maskPhone('+55 (22) 98179-5040')).toBe('(22) 98179-5040');
    expect(maskPhone('')).toBe('');
    expect(maskCep('28990')).toBe('28990');
    expect(maskCep('289900')).toBe('28990-0');
    expect(maskCep('28990-000 e mais')).toBe('28990-000');
  });

  test('validity and keys', () => {
    expect(isValidPhone('(22) 98179-5040')).toBe(true);
    expect(isValidPhone('2226451234')).toBe(true);
    expect(isValidPhone('5522981795040')).toBe(true);
    expect(isValidPhone('4422981795040')).toBe(false);
    expect(isValidPhone('981795040')).toBe(false);
    expect(phoneKey('+55 22 98179-5040')).toBe('22981795040');
    expect(isValidCep('28990-000')).toBe(true);
    expect(isValidCep('2899000')).toBe(false);
  });
});

describe('notices', () => {
  const n = (over: Partial<Notice>): Notice => ({
    id: 'n',
    kind: 'info',
    severity: 'info',
    title: 'Aviso',
    dismissible: true,
    priority: 1,
    ...over,
  });
  test('visible only inside the window', () => {
    const now = Date.parse('2026-10-04T12:00:00Z');
    const list = [
      n({ id: 'open' }),
      n({ id: 'past', endsAt: '2026-10-04T11:00:00Z' }),
      n({ id: 'future', startsAt: '2026-10-04T13:00:00Z' }),
      n({ id: 'now', startsAt: '2026-10-04T12:00:00Z', endsAt: '2026-10-04T12:00:01Z' }),
      n({ id: 'ending', endsAt: '2026-10-04T12:00:00Z' }),
    ];
    expect(visibleNotices(list, now).map((x) => x.id)).toEqual(['open', 'now']);
  });
  test('blocking: the severity, or an emergency of any severity', () => {
    expect(isBlocking(n({ severity: 'blocking' }))).toBe(true);
    expect(isBlocking(n({ kind: 'emergency', severity: 'whatever' }))).toBe(true);
    expect(isBlocking(n({ severity: 'critical' }))).toBe(false);
  });
});

describe('orders', () => {
  test('the path follows the mode', () => {
    expect(orderPath('delivery')).toEqual([
      'placed',
      'confirmed',
      'preparing',
      'ready',
      'out_for_delivery',
      'delivered',
    ]);
    expect(orderPath('pickup')).not.toContain('out_for_delivery');
  });

  test('progress along the path', () => {
    const p = orderProgress({ state: 'preparing', delivery: { mode: 'delivery' } });
    expect(p.current).toBe(2);
    expect(p.steps.map((s) => s.status)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
      'todo',
    ]);
    expect(p).toMatchObject({ terminal: false, outcome: null });
    const ready = orderProgress({ state: 'ready', mode: 'pickup' });
    expect([ready.current, ready.steps.length]).toEqual([3, 5]);
    const done = orderProgress({ state: 'delivered', mode: 'pickup' });
    expect([done.current, done.terminal]).toEqual([4, true]);
  });

  test('cancelled and refunded: the outcome and the last step reached', () => {
    const c = orderProgress({
      state: 'cancelled',
      delivery: { mode: 'delivery' },
      timeline: [{ to: 'placed' }, { to: 'confirmed' }, { to: 'cancelled' }],
    });
    expect(c).toMatchObject({ current: 1, terminal: true, outcome: 'cancelled' });
    expect(c.steps.map((s) => s.status)).toEqual(['done', 'done', 'todo', 'todo', 'todo', 'todo']);
    const r = orderProgress({ state: 'refunded', mode: 'pickup' });
    expect(r).toMatchObject({ current: -1, terminal: true, outcome: 'refunded' });
    expect(r.steps.every((s) => s.status === 'todo')).toBe(true);
  });

  test('step labels', () => {
    expect(orderStepLabel('delivered', 'pickup')).toBe('Retirado');
    expect(orderStepLabel('delivered', 'delivery')).toBe('Entregue');
    expect(orderStepLabel('out_for_delivery', 'delivery')).toBe('A caminho');
  });

  test('payment adjustments', () => {
    expect(adjustmentKind({ percentBps: -500 })).toBe('discount');
    expect(adjustmentKind({ fixedCents: 200 })).toBe('surcharge');
    expect(adjustmentKind({ percentBps: -500, fixedCents: 100 })).toBe('mixed');
    expect(adjustmentKind({})).toBeNull();
    expect(adjustmentShort({ percentBps: -500 })).toBe('−5%');
    expect(adjustmentShort({ percentBps: 250, fixedCents: 150 })).toMatch(/^\+2,5% \+R\$\s1,50$/);
    expect(adjustmentShort(undefined)).toBeNull();
    expect(adjustmentText({ percentBps: -500 })).toBe('5% de desconto');
    expect(adjustmentText({ fixedCents: 200 })).toMatch(/^R\$\s2,00 de acréscimo$/);
    expect(adjustmentText({ percentBps: -500, fixedCents: -100 })).toMatch(
      /^5% \+ R\$\s1,00 de desconto$/,
    );
    expect(adjustmentText({ percentBps: -500, fixedCents: 100 })).toMatch(
      /^5% de desconto e R\$\s1,00 de acréscimo$/,
    );
  });

  test('line summary and labels', () => {
    expect(
      lineSummary({
        modifiers: [
          { name: 'Calda', priceDeltaCents: 200, qty: 2 },
          { name: 'Granulado', priceDeltaCents: 0 },
        ],
        combo: [{ name: 'Pudim de leite', qty: 1 }],
      }),
    ).toBe(`2× Calda (+${brl(200)}), Granulado, 1× Pudim de leite`);
    expect(lineSummary({ modifiers: [] })).toBe('');
    expect(PIX_KEY_LABEL.random).toBe('chave aleatória');
  });
});

describe('errors and coupons', () => {
  test('couponMessage', () => {
    expect(couponMessage('COUPON_MIN_SUBTOTAL', { remainingCents: 1200 })).toBe(
      `Faltam ${brl(1200)} para usar este cupom.`,
    );
    expect(couponMessage('COUPON_MIN_SUBTOTAL')).toBe('Falta pouco para usar o cupom');
    expect(couponMessage('COUPON_EXPIRED')).toBe(COUPON_REASON.COUPON_EXPIRED!);
    expect(couponMessage('NETWORK_ERROR')).toBe('Sem conexão com a loja');
    expect(couponMessage('SOMETHING_NEW')).toBe('Este cupom não vale agora.');
    expect(isCouponError('INVALID_COUPON')).toBe(true);
    expect(isCouponError('SOLD_OUT')).toBe(false);
    expect(Object.keys(COUPON_REASON)).toHaveLength(9);
  });
  test('errorCopy falls back', () => {
    expect(errorCopy('SOLD_OUT').title).toBe('Esgotou agora há pouco');
    expect(errorCopy('NEVER_HEARD_OF_IT').title).toBe('Não foi possível concluir');
  });
});

describe('qr', () => {
  test('qrSvg wraps the same matrix', () => {
    const text = 'https://loja.vendua.com.br/cardapio';
    const m = qrMatrix(text);
    expect(m.length).toBe(m[0]!.length);
    // finder pattern: the top-left 7×7 ring
    expect(m[0]!.slice(0, 7).every(Boolean)).toBe(true);
    expect(m[1]![1]).toBe(false);
    const svg = qrSvg(text, { size: 200 });
    const size = m.length + 8;
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${size} ${size}"`);
    expect(svg).toContain('width="200" height="200"');
    expect(svg).toContain(`d="${qrSvgPath(m).d}"`);
    const dark = m.flat().filter(Boolean).length;
    expect(svg.match(/h1v1h-1z/g)!.length).toBe(dark);
    const bare = qrSvg(text, { light: 'none', margin: 0, dark: '#123"/><script>' });
    expect(bare).not.toContain('<rect');
    expect(bare).not.toContain('<script>');
    expect(bare).toContain(`viewBox="0 0 ${m.length} ${m.length}"`);
    expect(() => qrSvg('x'.repeat(500))).toThrow();
  });
});

describe('copy', () => {
  test('the store’s words over the defaults', () => {
    expect(vocabularyOf(null)).toEqual(DEFAULT_VOCABULARY);
    expect(
      vocabularyOf({
        vocabulary: { itemSingular: 'doce', itemPlural: 'doces', bag: ' ', cta: 'Quero' },
      }),
    ).toEqual({ itemSingular: 'doce', itemPlural: 'doces', bag: 'sacola', cta: 'Quero' });
  });
});
