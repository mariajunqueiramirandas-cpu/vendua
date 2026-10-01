import { describe, expect, test } from 'bun:test';
import { paletteFrom, validateTokens } from '@vendua/templates';
import fixture from './fixtures/menu-import/instadelivery.json';
import cwFixture from './fixtures/menu-import/cardapioweb.json';
import olaFixture from './fixtures/menu-import/olaclick.json';
import tkFixture from './fixtures/menu-import/takeat.json';
import ddFixture from './fixtures/menu-import/deliverydireto.json';
import spFixture from './fixtures/menu-import/saipos.json';
import gmFixture from './fixtures/menu-import/goomer.json';
import { recognise, type Adapter } from '../src/modules/menu-import/adapters/index.ts';
import { cardapioweb } from '../src/modules/menu-import/adapters/cardapioweb.ts';
import { olaclick } from '../src/modules/menu-import/adapters/olaclick.ts';
import { takeat } from '../src/modules/menu-import/adapters/takeat.ts';
import { deliverydireto } from '../src/modules/menu-import/adapters/deliverydireto.ts';
import { saipos } from '../src/modules/menu-import/adapters/saipos.ts';
import { goomer } from '../src/modules/menu-import/adapters/goomer.ts';
import { instadelivery } from '../src/modules/menu-import/adapters/instadelivery.ts';
import { TEMPLATE_TOKENS } from '../src/modules/menu-import/apply.ts';
import { liftFloor } from '../src/modules/menu-import/adapters/shared.ts';
import { unitPriceCents } from '../src/modules/cart.ts';
import { haversineKm, pointInPolygon } from '../src/modules/geo.ts';
import {
  LIMITS,
  TooLarge,
  httpsUrl,
  normalizeWhatsapp,
  shortenName,
  storedBytes,
  toCents,
  validateDoc,
  type ImportProduct,
  type MenuImportV1,
} from '../src/modules/menu-import/doc.ts';
import {
  ImportFailure,
  createImportHttp,
  fetchImage,
  sniffImage,
} from '../src/modules/menu-import/http.ts';

// Menu import, the pure parts (docs/menu-import.md §8): money, limits, link recognition, the
// Instadelivery mapping on a synthetic fixture, and the outbound HTTP rules.

const source = {
  platform: 'instadelivery' as const,
  url: 'https://instadelivery.com.br/doceriaexemplo',
  ref: 'doceriaexemplo',
  readAt: '2026-10-01T12:00:00.000Z',
};

const base = (over: Partial<MenuImportV1> = {}): MenuImportV1 => ({
  v: 1,
  source,
  store: {},
  categories: [],
  lost: [],
  ...over,
});
const prod = (over: Partial<ImportProduct> = {}): ImportProduct => ({
  name: 'Bolo',
  priceCents: 1000,
  tags: [],
  images: [],
  status: 'active',
  optionGroups: [],
  ...over,
});
const one = (p: ImportProduct) =>
  validateDoc(base({ categories: [{ name: 'Doces', products: [p] }] }));

describe('toCents', () => {
  test('floats round; strings parse exactly; junk is null', () => {
    expect(toCents(12.9)).toBe(1290);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(20)).toBe(2000);
    expect(toCents('12.90')).toBe(1290);
    expect(toCents('12,90')).toBe(1290);
    expect(toCents('12,5')).toBe(1250);
    expect(toCents('R$ 1.234,56')).toBe(123456);
    expect(toCents('1.234,5')).toBe(123450);
    expect(toCents('1.234.567')).toBe(123456700);
    expect(toCents('1,234.56')).toBe(123456);
    expect(toCents('1.234')).toBeNull();
    expect(toCents('12.')).toBeNull();
    expect(toCents('1.2.3')).toBeNull();
    expect(toCents('0')).toBe(0);
    expect(toCents(-1)).toBeNull();
    expect(toCents('abc')).toBeNull();
    expect(toCents('12,345')).toBeNull();
    expect(toCents(null)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });
});

describe('timed promotions and the floor lift', () => {
  test('a promotion below the price with readable windows comes along; any other is a note', () => {
    const windows = [{ days: [5], from: '18:00', to: '23:00' }];
    const kept = one(prod({ priceCents: 3000, promoSchedule: { priceCents: 2000, windows } }));
    expect(kept.doc.categories[0]!.products[0]!.promoSchedule).toEqual({
      priceCents: 2000,
      windows,
    });
    for (const promoSchedule of [
      { priceCents: 3000, windows },
      { priceCents: 2000, windows: [{ days: [9] }] },
      {
        priceCents: 2000,
        windows: Array.from({ length: 8 }, (_, d) => ({
          days: [d % 7],
          from: `0${d}:00`,
          to: `0${d}:30`,
        })),
      },
    ]) {
      const r = one(prod({ priceCents: 3000, promoSchedule }));
      expect(r.doc.categories[0]!.products[0]!.promoSchedule).toBeUndefined();
      expect(r.doc.lost.map((l) => l.code)).toContain('promo_schedule');
    }
  });

  test('a sum list of exactly N units lifts N floors; prices stay', () => {
    const p = prod({
      priceCents: 0,
      optionGroups: [
        {
          name: 'Três sabores',
          min: 3,
          max: 3,
          options: [
            { name: 'A', priceDeltaCents: 900, maxQty: 3 },
            { name: 'B', priceDeltaCents: 1200, maxQty: 3 },
          ],
        },
      ],
    });
    liftFloor(p);
    expect(p.priceCents).toBe(2700);
    expect(p.optionGroups[0]!.options.map((o) => o.priceDeltaCents)).toEqual([0, 300]);
    // 2×A + B: 0 + 2×900 + 1200 there, 2700 + 300 here
    expect(
      unitPriceCents(p.priceCents, [
        {
          pricingRule: 'sum',
          picks: [
            { priceDeltaCents: 0, qty: 2 },
            { priceDeltaCents: 300, qty: 1 },
          ],
        },
      ]),
    ).toBe(3000);
    // between a minimum and a maximum the units vary: no exact floor to lift
    const open = prod({
      priceCents: 0,
      optionGroups: [
        {
          name: 'Sabores',
          min: 1,
          max: 10,
          options: [{ name: 'A', priceDeltaCents: 900, maxQty: 10 }],
        },
      ],
    });
    liftFloor(open);
    expect(open.priceCents).toBe(0);
  });
});

describe('validateDoc limits (§4.6)', () => {
  test('long names and descriptions are cut and noted', () => {
    const { doc } = validateDoc(
      base({
        categories: [
          {
            name: 'C'.repeat(80),
            products: [prod({ name: 'Bolo '.repeat(40), description: 'palavra '.repeat(200) })],
          },
        ],
      }),
    );
    const c = doc.categories[0]!;
    expect(c.name.length).toBeLessThanOrEqual(LIMITS.categoryName);
    const p = c.products[0]!;
    expect(p.name.length).toBeLessThanOrEqual(LIMITS.productName);
    expect(p.description!.length).toBeLessThanOrEqual(LIMITS.productDescription);
    expect(p.description!.endsWith('…')).toBe(true);
    expect(doc.lost.map((l) => l.code)).toEqual(
      expect.arrayContaining(['name_shortened', 'description_shortened']),
    );
  });

  test('tags keep the first 12 (≤ 30 chars); photos the first 12 https ones', () => {
    const { doc } = one(
      prod({
        tags: Array.from({ length: 15 }, (_, i) => `Tag ${i}`).concat('x'.repeat(40)),
        images: [
          'http://insecure.example/a.jpg',
          ...Array.from({ length: 14 }, (_, i) => `https://cdn.example/${i}.jpg`),
        ],
      }),
    );
    const p = doc.categories[0]!.products[0]!;
    expect(p.tags).toHaveLength(12);
    expect(p.images).toHaveLength(12);
    expect(p.images.every((u) => u.startsWith('https://'))).toBe(true);
    expect(doc.lost.map((l) => l.code)).toEqual(
      expect.arrayContaining(['tags_dropped', 'photos_dropped']),
    );
  });

  test('a price Venduá cannot hold hides the product, never reprices it', () => {
    for (const priceCents of [-1, 10_000_001, 12.5]) {
      const { doc, counts } = one(prod({ priceCents }));
      expect(doc.categories[0]!.products[0]!.status).toBe('archived');
      expect(counts.hidden).toBe(1);
      expect(doc.lost[0]).toMatchObject({ scope: 'product', code: 'price_out_of_range' });
    }
  });

  test('too many option groups or options: hidden + lost', () => {
    const group = (n: number) => ({
      name: 'G',
      min: 0,
      max: 1,
      options: Array.from({ length: n }, (_, i) => ({ name: `o${i}`, priceDeltaCents: 0 })),
    });
    const many = one(prod({ optionGroups: Array.from({ length: 13 }, () => group(2)) }));
    expect(many.doc.categories[0]!.products[0]!.status).toBe('archived');
    expect(many.doc.categories[0]!.products[0]!.optionGroups).toHaveLength(12);
    expect(many.doc.lost[0]!.code).toBe('too_many_option_groups');
    // a pizzeria's long flavour list fits; past 100 it can't be shown as it was
    expect(one(prod({ optionGroups: [group(100)] })).doc.categories[0]!.products[0]!.status).toBe(
      'active',
    );
    const wide = one(prod({ optionGroups: [group(101)] }));
    expect(wide.doc.categories[0]!.products[0]!.status).toBe('archived');
    expect(wide.doc.lost[0]!.code).toBe('too_many_options');
  });

  test('option rules match Core: max ≤ units, discounts once, a line never below zero', () => {
    const { doc } = one(
      prod({
        priceCents: 500,
        optionGroups: [
          {
            name: 'Extras',
            min: 0,
            max: 10,
            options: [
              { name: 'Queijo', priceDeltaCents: 300, maxQty: 3 },
              { name: 'Sem cebola', priceDeltaCents: -100, maxQty: 4 },
            ],
          },
        ],
      }),
    );
    const g = doc.categories[0]!.products[0]!.optionGroups[0]!;
    expect(g.max).toBe(4);
    expect(g.options[1]!.maxQty).toBeUndefined();
    const below = one(
      prod({
        priceCents: 100,
        optionGroups: [
          { name: 'Desconto', min: 1, max: 1, options: [{ name: 'X', priceDeltaCents: -200 }] },
        ],
      }),
    );
    expect(below.doc.categories[0]!.products[0]!.status).toBe('archived');
    expect(below.doc.lost[0]!.code).toBe('price_mismatch');
  });

  test('compare-at price only above the price', () => {
    expect(
      one(prod({ compareAtPriceCents: 900 })).doc.categories[0]!.products[0]!,
    ).not.toHaveProperty('compareAtPriceCents');
    expect(
      one(prod({ compareAtPriceCents: 1200 })).doc.categories[0]!.products[0]!.compareAtPriceCents,
    ).toBe(1200);
  });

  test('kits resolve against products in the document, else hidden', () => {
    const { doc } = validateDoc(
      base({
        categories: [
          {
            name: 'Kits',
            products: [
              prod({ ref: 'a', name: 'Brigadeiro' }),
              prod({
                ref: 'k',
                name: 'Kit festa',
                kit: { slots: [{ name: 'Doces', min: 1, max: 2, items: [{ ref: 'a' }] }] },
              }),
              prod({
                ref: 'z',
                name: 'Kit quebrado',
                kit: { slots: [{ name: 'Doces', min: 1, max: 1, items: [{ ref: 'nope' }] }] },
              }),
            ],
          },
        ],
      }),
    );
    const [, kit, broken] = doc.categories[0]!.products;
    expect(kit!.kit!.slots[0]!.items).toEqual([{ ref: 'a', priceDeltaCents: 0 }]);
    expect(kit!.status).toBe('active');
    expect(broken!.status).toBe('archived');
    expect(doc.lost.find((l) => l.subject === 'Kit quebrado')!.code).toBe('kit_unresolved');
  });

  test('WhatsApp normalised, Pix beneficiary and city shortened for the merchant to confirm', () => {
    expect(normalizeWhatsapp('+55 (22) 98144-8322')).toBe('5522981448322');
    expect(normalizeWhatsapp('2299')).toBeNull();
    expect(shortenName('Maria do Carmo Junqueira Miranda Silva', 25)).toBe('Maria C J M Silva');
    const { doc } = validateDoc(
      base({
        store: { whatsapp: '123' },
        payments: {
          methods: ['cash'],
          pix: {
            key: 'a@b.co',
            type: 'email',
            beneficiary: 'Maria do Carmo Junqueira Miranda Silva',
            city: 'São João de Meriti do Norte',
          },
        },
      }),
    );
    expect(doc.store.whatsapp).toBeUndefined();
    expect(doc.payments!.pix!.beneficiary.length).toBeLessThanOrEqual(25);
    expect(doc.payments!.pix!.city!.length).toBeLessThanOrEqual(15);
    expect(doc.payments!.methods).toEqual(['pix', 'cash']);
    expect(doc.lost.map((l) => l.code)).toEqual(
      expect.arrayContaining([
        'whatsapp_invalid',
        'pix_beneficiary_shortened',
        'pix_city_shortened',
      ]),
    );
  });

  test('> 200 neighbourhoods split into zones with one fee; > 28 hour ranges noted', () => {
    const { doc } = validateDoc(
      base({
        zones: [
          {
            name: 'Cidade',
            kind: 'neighborhood',
            neighborhoods: Array.from({ length: 450 }, (_, i) => `Bairro ${i}`),
            feeCents: 700,
          },
        ],
        hours: Array.from({ length: 30 }, (_, i) => ({
          days: [i % 7],
          open: `${String(i % 20).padStart(2, '0')}:00`,
          close: '21:00',
        })),
      }),
    );
    expect(doc.zones!.map((z) => z.neighborhoods!.length)).toEqual([200, 200, 50]);
    expect(new Set(doc.zones!.map((z) => z.feeCents))).toEqual(new Set([700]));
    expect(doc.hours).toHaveLength(28);
    expect(doc.lost.map((l) => l.code)).toContain('hours_dropped');
  });

  test('URLs are bounded after normalising; notes are capped and trimmed', () => {
    expect(httpsUrl(`https://cdn.example/${'ç'.repeat(200)}.jpg`)).toBeNull();
    expect(httpsUrl('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
    const { doc } = validateDoc(
      base({
        lost: Array.from({ length: 600 }, (_, i) => ({
          scope: 'store' as const,
          code: `c${i}`,
          detail: 'x'.repeat(2000),
        })),
      }),
    );
    expect(doc.lost).toHaveLength(500);
    expect(doc.lost[0]!.detail!.length).toBeLessThanOrEqual(300);
  });

  test("the size bound covers jsonb's text form", () => {
    // '{"a": "é"}' in Postgres: 11 bytes
    expect(storedBytes({ a: 'é' })).toBe(11);
  });

  test('over 1000 products fails TOO_LARGE', () => {
    expect(() =>
      validateDoc(
        base({
          categories: [
            {
              name: 'Tudo',
              products: Array.from({ length: 1001 }, (_, i) => prod({ name: `P${i}` })),
            },
          ],
        }),
      ),
    ).toThrow(TooLarge);
  });

  test('empty categories stay out, and say so', () => {
    const { doc, counts } = validateDoc(
      base({
        categories: [
          { name: 'Vazia', products: [] },
          { name: 'Cheia', products: [prod()] },
        ],
      }),
    );
    expect(doc.categories.map((c) => c.name)).toEqual(['Cheia']);
    expect(counts.categories).toBe(1);
    expect(doc.lost).toEqual([{ scope: 'category', subject: 'Vazia', code: 'empty_category' }]);
  });
});

describe('recognise', () => {
  test('Instadelivery store links, with or without scheme', () => {
    for (const u of [
      'https://instadelivery.com.br/doceriaexemplo',
      'instadelivery.com.br/doceriaexemplo',
      'http://www.instadelivery.com.br/DoceriaExemplo/',
      'https://instadelivery.com.br/doceriaexemplo?utm_source=ig',
    ]) {
      const r = recognise(u);
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.adapter.platform).toBe('instadelivery');
        expect(r.ref).toBe('doceriaexemplo');
        expect(r.url.protocol).toBe('https:');
      }
    }
  });

  test('platform pages, other hosts and junk are not stores', () => {
    expect(recognise('https://instadelivery.com.br/').kind).toBe('unsupported');
    expect(recognise('https://instadelivery.com.br/blog').kind).toBe('unsupported');
    expect(recognise('https://blog.instadelivery.com.br/x').kind).toBe('unsupported');
    expect(recognise('https://evil.example/instadelivery.com.br/x').kind).toBe('unsupported');
    expect(recognise('https://user:pw@instadelivery.com.br/x').kind).toBe('invalid');
    expect(recognise('javascript:alert(1)').kind).toBe('invalid');
    expect(recognise('').kind).toBe('invalid');
    expect(recognise('x'.repeat(501)).kind).toBe('invalid');
  });

  test('anota.ai and iFood are blocked; a platform page is not a store', () => {
    expect(recognise('https://pedido.anota.ai/loja/x')).toEqual({
      kind: 'blocked',
      platform: 'anotaai',
    });
    expect(recognise('https://www.ifood.com.br/delivery/rio-de-janeiro-rj/x/abc')).toEqual({
      kind: 'blocked',
      platform: 'ifood',
    });
    expect(recognise('https://www.saipos.com')).toEqual({ kind: 'unsupported', platform: null });
    // a store on its own domain is placed by the read job (step 4)
    expect(recognise('https://minha-loja.com.br')).toMatchObject({
      kind: 'custom',
      host: 'minha-loja.com.br',
    });
  });
});

describe('instadelivery.map', () => {
  const { doc, counts } = validateDoc(instadelivery.map(fixture, source));
  const byName = new Map(doc.categories.flatMap((c) => c.products).map((p) => [p.name, p]));
  const codes = (scope?: string) =>
    doc.lost.filter((l) => !scope || l.scope === scope).map((l) => `${l.subject ?? ''}:${l.code}`);

  test('allowlisted fields only — no credential-like field survives', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('sk_live');
    expect(json).not.toContain('should-not-appear');
  });

  test('categories in source order; empty ones become lost notes with their description', () => {
    expect(doc.categories.map((c) => c.name)).toEqual(['BOLOS', 'AÇAÍ', 'PIZZAS']);
    expect(doc.categories[0]!.description).toBe('Feitos no dia');
    expect(doc.lost).toEqual(
      expect.arrayContaining([
        { scope: 'category', subject: 'COMBOS', code: 'hidden_items' },
        {
          scope: 'category',
          subject: 'PUDINS',
          code: 'hidden_items',
          detail: 'Pudim lisinho, feito em casa',
        },
      ]),
    );
  });

  test('prices in cents, promo strike-through, badges, stock, photos', () => {
    expect(byName.get('Bolo de cenoura')).toMatchObject({
      priceCents: 3500,
      tags: ['Mais vendido'],
      stockQuantity: 4,
      status: 'active',
      description: 'Com cobertura de chocolate.',
    });
    expect(byName.get('Bolo de cenoura')!.images).toHaveLength(2);
    expect(byName.get('Bolo de fubá')).toMatchObject({
      priceCents: 2890,
      compareAtPriceCents: 3200,
      tags: ['Novidade', 'Sem glúten'],
    });
    // tracked stock at zero reads sold out and wakes the waitlist on restock
    expect(byName.get('Bolo de laranja')).toMatchObject({ stockQuantity: 0, status: 'active' });
    expect(byName.get('Bolo encomenda')).toMatchObject({ requiresPreorder: true, images: [] });
    expect(byName.get('Torta só de sábado')!.availability).toEqual({
      windows: [{ days: [6], from: '10:00', to: '14:00' }],
      outside: 'unavailable',
    });
    expect(byName.has('Bolo do salão')).toBe(false);
    expect(codes('product')).toContain('Bolo do salão:dine_in_only');
  });

  test('"a partir de": the required size list carries the price, floor moved to the base', () => {
    const acai = byName.get('Açaí no copo')!;
    expect(acai.priceCents).toBe(1490);
    expect(acai.status).toBe('active');
    const [size, extras] = acai.optionGroups;
    expect(size).toMatchObject({ name: 'Tamanho', min: 1, max: 1 });
    expect(size!.options.map((o) => o.priceDeltaCents)).toEqual([0, 500, 1000]);
    // 2 + 1 + 1 + 1 units can be picked; the hidden "Brindes" list isn't there at all
    expect(extras).toMatchObject({ name: 'Adicionais', min: 0, max: 5 });
    expect(acai.optionGroups).toHaveLength(2);
    expect(extras!.options[0]).toMatchObject({
      name: 'Leite em pó',
      priceDeltaCents: 250,
      maxQty: 2,
    });
    expect(extras!.options[2]).toMatchObject({ priceDeltaCents: 0, description: 'Moída na hora' });
    expect(extras!.options[3]).toMatchObject({ name: 'Morango (acabou)', soldOut: true });
  });

  test('a flavour list without the pizza flag sums, exactly as the old store; only_one = no repeats', () => {
    const pote = byName.get('Bolo de pote duplo')!;
    expect(pote.status).toBe('active');
    const g = pote.optionGroups[0]!;
    expect(g.pricingRule).toBeUndefined();
    expect(g.options.every((o) => o.maxQty === undefined)).toBe(true);
    expect(g).toMatchObject({ min: 1, max: 2 });
  });

  test('a pizza list charges every half at the dearest half: n × dearest, exactly', () => {
    // the storefront: ½ R$ 20 + ½ R$ 25,50 = R$ 51,00 (each half at the dearest)
    const pizza = byName.get('Pizza meio a meio')!;
    expect(pizza.status).toBe('active');
    const g = pizza.optionGroups[0]!;
    expect(g).toMatchObject({ pricingRule: 'most_expensive', min: 2, max: 2 });
    // priced by Core's own cart math, as a shopper's line would be
    const price = (picks: string[]) =>
      unitPriceCents(pizza.priceCents, [
        {
          pricingRule: g.pricingRule!,
          picks: g.options
            .filter((o) => picks.includes(o.name))
            .map((o) => ({ priceDeltaCents: o.priceDeltaCents, qty: 1 })),
        },
      ]);
    expect(price(['1/2 Mussarela', '1/2 Cinco queijos'])).toBe(5100);
    expect(price(['1/2 Mussarela', '1/2 Margherita'])).toBe(4550);
    // "a partir de": two of the cheapest half
    expect(pizza.priceCents).toBe(4000);
  });

  test('a pizza list with no cap (max 0) is not a fixed number of flavours: hidden', () => {
    type Item = { name: string; complementos: Record<string, unknown>[] };
    const raw = structuredClone(fixture) as unknown as { groups: { itens: Item[] }[] };
    const item = raw.groups.flatMap((g) => g.itens).find((i) => i.name === 'Pizza meio a meio')!;
    Object.assign(item.complementos[0]!, { min: 0, max: 0 });
    const p = validateDoc(instadelivery.map(raw, source))
      .doc.categories.flatMap((c) => c.products)
      .find((x) => x.name === 'Pizza meio a meio')!;
    expect(p.status).toBe('archived');
    expect(p.optionGroups[0]!.options.map((o) => o.priceDeltaCents)).toEqual([2000, 2550, 2275]);
  });

  test('a pizza list where the number of flavours varies has no rule here: hidden', () => {
    const pizza = byName.get('Pizza doce')!;
    expect(pizza.status).toBe('archived');
    expect(pizza.optionGroups[0]).toMatchObject({ pricingRule: 'most_expensive', min: 1, max: 2 });
    expect(doc.lost).toContainEqual({
      scope: 'product',
      subject: 'Pizza doce',
      code: 'pizza_pricing',
      detail: 'Escolha 2 sabores',
    });
  });

  test('what the storefront never charges comes over at the menu price', () => {
    // item_discount applies only through the item's own share link
    expect(byName.get('Bolo do link')).toMatchObject({ status: 'active', priceCents: 1000 });
    expect(doc.lost).toContainEqual({
      scope: 'product',
      subject: 'Bolo do link',
      code: 'link_discount',
      detail: '10',
    });
    // price2 and a pizza category's sizes are never read: price1 is the price
    expect(byName.get('Bolo dois preços')).toMatchObject({ status: 'active', priceCents: 2000 });
    expect(
      codes('product').filter((c) => /second_price|pizza_sizes|promo_unreadable/.test(c)),
    ).toEqual([]);
  });

  test('prices we cannot reproduce exactly are imported hidden, with the reason', () => {
    expect(byName.get('Item estranho')!.status).toBe('archived');
    expect(byName.get('Muçarela por quilo')!.status).toBe('archived');
    expect(codes('product')).toEqual(
      expect.arrayContaining([
        'Item estranho:options_unreadable',
        'Muçarela por quilo:sold_by_weight',
      ]),
    );
  });

  test('store: profile, colour, hours with shifts and past midnight, delivery, payments', () => {
    expect(doc.store).toMatchObject({
      name: 'Doceria Exemplo',
      tagline: 'Doces e bolos',
      whatsapp: '5521999990000',
      instagram: 'doceria.exemplo',
      address: 'Rua das Flores, 100',
      announcement: {
        title: 'Seja bem-vindo(a) à Doceria Exemplo!',
        body: 'Entregamos nos bairros abaixo. Pedido mínimo de R$ 20.',
      },
      brandColor: '#C0392B',
    });
    expect(doc.store.logoUrl).toStartWith(
      'https://instadelivery-public.nyc3.cdn.digitaloceanspaces.com/',
    );
    expect(doc.hours).toEqual([
      { days: [0], open: '10:00', close: '18:00' },
      { days: [1, 2, 5], open: '13:00', close: '20:00' },
      { days: [5], open: '10:00', close: '12:00' },
      { days: [6], open: '18:00', close: '02:00' },
    ]);
    expect(doc.operations).toEqual({
      minOrderCents: 2000,
      prepTimeMinutes: 25,
      pickup: true,
      delivery: true,
    });
    // free above the store's R$ 100, or the neighbourhood's own R$ 60 (subtotal ≥ either)
    expect(doc.zones).toEqual([
      {
        name: 'Taxa R$ 5,00',
        kind: 'neighborhood',
        feeCents: 500,
        neighborhoods: ['Centro', 'Jardim'],
        etaMin: 30,
        etaMax: 40,
        freeDeliveryOverCents: 10000,
      },
      {
        name: 'Taxa R$ 8,50',
        kind: 'neighborhood',
        feeCents: 850,
        neighborhoods: ['Vila Nova'],
        freeDeliveryOverCents: 6000,
      },
    ]);
    expect(doc.payments).toEqual({
      methods: ['cash', 'pix', 'card_on_delivery', 'meal_voucher'],
      // percents of the subtotal: Pix −5 %, debit and credit +3 %, voucher +2 %
      adjustments: {
        pix: { percentBps: -500 },
        card_on_delivery: { percentBps: 300 },
        meal_voucher: { percentBps: 200 },
      },
      pix: {
        key: 'exemplo@vendua.test',
        type: 'email',
        beneficiary: 'Fulana T B S Exemplo',
        city: 'Cidade Exemplo',
      },
    });
  });

  test('what did not come over, in codes the admin words', () => {
    expect(codes('store')).toEqual(
      expect.arrayContaining([
        ':loyalty',
        ':referral',
        ':instagram_points',
        ':birthday_message',
        ':miss_you_message',
        ':upsell',
        ':time_slots',
        ':payment_method',
        ':pix_beneficiary_shortened',
        ':pix_city_shortened',
      ]),
    );
    expect(doc.lost.find((l) => l.code === 'payment_method')!.detail).toBe('Fiado');
    expect(doc.lost.find((l) => l.code === 'loyalty')!.detail).toBe('2');
  });

  test('km tiers: radius zones; "no delivery" past the last tier is just the edge', () => {
    const raw = {
      ...fixture,
      fee_type: -2,
      free_delivery: null,
      feesKm: [
        { km: 3, price: 5, price_free: 0, no_delivery: 0, estimate: '20-30' },
        { km: 5, price: 0, price_free: 0, no_delivery: 1, estimate: null },
        { km: 8, price: 9.5, price_free: 80, no_delivery: 0, estimate: null },
        { km: 12, price: 0, price_free: 0, no_delivery: 1, estimate: null },
        { km: 20, price: 0, price_free: 0, no_delivery: 1, estimate: null },
      ],
    };
    const m = validateDoc(instadelivery.map(raw, source)).doc;
    // the neighbourhood list the store keeps but doesn't use stays out
    expect(m.zones).toEqual([
      { name: 'Até 3 km', kind: 'radius', feeCents: 500, maxDistanceKm: 3, etaMin: 20, etaMax: 30 },
      // free strictly above R$ 80 there: from R$ 80,01 here
      {
        name: 'Até 8 km',
        kind: 'radius',
        feeCents: 950,
        maxDistanceKm: 8,
        freeDeliveryOverCents: 8001,
      },
    ]);
    const gaps = m.lost.filter((l) => l.code === 'delivery_gap');
    expect(gaps).toEqual([{ scope: 'store', code: 'delivery_gap', detail: '5' }]);
    expect(m.lost.map((l) => l.code)).toContain('delivery_distance_straight_line');
  });

  test('fee_type: a fee agreed later or a flat fee for any address has no zone here', () => {
    const later = validateDoc(instadelivery.map({ ...fixture, fee_type: -3 }, source)).doc;
    expect(later.zones).toBeUndefined();
    expect(later.operations?.delivery).toBe(false);
    expect(later.lost).toContainEqual({ scope: 'store', code: 'delivery_fee_later' });
    const flat = validateDoc(instadelivery.map({ ...fixture, fee_type: 8 }, source)).doc;
    expect(flat.zones).toBeUndefined();
    expect(flat.lost).toContainEqual({
      scope: 'store',
      code: 'delivery_flat_fee',
      detail: 'R$ 8,00',
    });
    const free = validateDoc(instadelivery.map({ ...fixture, fee_type: 0 }, source)).doc;
    expect(free.lost).toContainEqual({
      scope: 'store',
      code: 'delivery_flat_fee',
      detail: 'grátis',
    });
  });

  test('payment percents map only when every order pays what it paid there', () => {
    const adj = (over: Record<string, unknown>) => {
      const d = validateDoc(instadelivery.map({ ...fixture, ...over }, source)).doc;
      return {
        adjustments: d.payments?.adjustments,
        notes: d.lost.filter((l) => l.code === 'payment_adjustment').map((l) => l.detail),
      };
    };
    // a store-wide discount replaces the payment's own, on every method
    expect(adj({ discount: 10 })).toEqual({
      adjustments: { cash: { percentBps: -1000 }, pix: { percentBps: -1000 } },
      // cards and the voucher carry −10 % and an increment, each rounded on its own there
      notes: ['cartão', 'vale-refeição'],
    });
    // a pickup discount wins on pickup orders: Pix's own discount isn't one rule any more
    expect(adj({ takeaway_discount: 10 })).toEqual({
      adjustments: { card_on_delivery: { percentBps: 300 }, meal_voucher: { percentBps: 200 } },
      notes: ['retirada', 'Pix'],
    });
    // debit +2 % and credit +3 % are one method here
    expect(adj({ debt_increment: 2 }).notes).toEqual(['cartão']);
    // a percent past Venduá's cap, or finer than a basis point, is a note, never a cut
    expect(adj({ pix_discount: 60 }).notes).toEqual(['Pix']);
    expect(adj({ pix_discount: 4.999 }).notes).toEqual(['Pix']);
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 3,
      products: 13,
      hidden: 3,
      photos: 13,
      optionGroups: 5,
      hours: 4,
      zones: 2,
      paymentMethods: 4,
      pix: true,
      logo: true,
      cover: true,
    });
  });
});

/** Runs an adapter's read against canned answers; records each request and its headers. */
async function fakeRead(
  adapter: Adapter,
  ref: string,
  routes: Record<string, unknown>,
): Promise<{ raw: unknown; seen: { url: string; headers: Record<string, string> }[] }> {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const http = createImportHttp({
    hosts: adapter.hosts.api,
    fetch: async (url, init) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      const body = routes[url];
      if (typeof body === 'function') return (body as () => Response)();
      return body === undefined
        ? new Response('{"message":"not found"}', { status: 404 })
        : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    },
  });
  return { raw: await adapter.read(ref, http), seen };
}

const mapped = (adapter: Adapter, raw: unknown, ref = 'loja') =>
  validateDoc(
    adapter.map(raw, {
      platform: adapter.platform,
      url: `https://example.test/${ref}`,
      ref,
      readAt: '2026-10-01T12:00:00.000Z',
    }),
  );

describe('cardapioweb', () => {
  const { doc, counts } = mapped(cardapioweb, cwFixture, 'pizzaria_exemplo');
  const byName = new Map(doc.categories.flatMap((c) => c.products).map((p) => [p.name, p]));
  const lostCodes = doc.lost.map((l) => `${l.subject ?? ''}:${l.code}`);

  test('recognise: app.cardapioweb.com/<slug> and the mode hosts; not its own pages', () => {
    for (const u of [
      'https://app.cardapioweb.com/pizzaria_exemplo',
      'app.cardapioweb.com/pizzaria_exemplo?utm=ig',
      'https://menu.cardapioweb.com/Pizzaria_Exemplo/',
      'https://entrega.cardapioweb.com/pizzaria_exemplo/item/12',
    ]) {
      const r = recognise(u);
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.adapter.platform).toBe('cardapioweb');
        expect(r.ref).toBe('pizzaria_exemplo');
      }
    }
    for (const u of [
      'https://app.cardapioweb.com/',
      'https://app.cardapioweb.com/login',
      'https://www.cardapioweb.com/planos',
      'https://ajuda.cardapioweb.com/x',
    ])
      expect(recognise(u).kind).toBe('unsupported');
  });

  test('read: the profile, then the menu with the store id and slug headers', async () => {
    const base = 'https://integracao.cardapioweb.com/api/menu/company';
    const { raw, seen } = await fakeRead(cardapioweb, 'pizzaria_exemplo', {
      [`${base}/profile?company=pizzaria_exemplo`]: cwFixture.profile,
      [`${base}/categories?only_available_for=delivery`]: cwFixture.categories,
    });
    expect(seen.map((s) => s.url)).toEqual([
      `${base}/profile?company=pizzaria_exemplo`,
      `${base}/categories?only_available_for=delivery`,
    ]);
    expect(seen[1]!.headers).toMatchObject({ 'company-id': '4242', company: 'pizzaria_exemplo' });
    expect(raw).toEqual(cwFixture);
    await expect(fakeRead(cardapioweb, 'naoexiste', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('allowlisted fields only — no credential-like field survives', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('should-not-appear');
    expect(json).not.toContain('00000000000000');
  });

  test('flavours: MEAN averages, MAX charges the dearest, MIN has no rule here', () => {
    // Média + ½ Calabresa + ½ Marguerita there: 39,90 + mean(40,00; 45,50) = 82,65
    const pizza = byName.get('Pizza meio a meio')!;
    const [size, flavours, crust] = pizza.optionGroups;
    expect(pizza.priceCents).toBe(3990);
    expect(size!.options.map((o) => o.priceDeltaCents)).toEqual([0, 1000]);
    expect(flavours).toMatchObject({ pricingRule: 'average', min: 1, max: 2 });
    const line = unitPriceCents(pizza.priceCents, [
      { pricingRule: 'sum', picks: [{ priceDeltaCents: 0, qty: 1 }] },
      {
        pricingRule: 'average',
        picks: [
          { priceDeltaCents: flavours!.options[0]!.priceDeltaCents, qty: 1 },
          { priceDeltaCents: flavours!.options[1]!.priceDeltaCents, qty: 1 },
        ],
      },
    ]);
    expect(line).toBe(8265);
    // SUMMABLE: a quantity per option, up to the group's maximum
    expect(flavours!.options.every((o) => o.maxQty === 2)).toBe(true);
    expect(crust!.options[0]).toMatchObject({ name: 'Catupiry', soldOut: true });

    const dear = byName.get('Pizza do mais caro')!;
    expect(dear.optionGroups[0]).toMatchObject({ pricingRule: 'most_expensive' });
    expect(
      dear.priceCents + Math.max(...dear.optionGroups[0]!.options.map((o) => o.priceDeltaCents)),
    ).toBe(5290);
    expect(byName.get('Pizza do mais barato')!.status).toBe('archived');
    expect(lostCodes).toContain('Pizza do mais barato:pizza_pricing');
  });

  test('an average maps only where it cannot fall on a half cent', () => {
    const raw = structuredClone(cwFixture) as unknown as {
      categories: { items: Record<string, any>[] }[];
    };
    const pizza = raw.categories[0]!.items.find((i) => i.name === 'Pizza meio a meio')!;
    // R$ 40,00 and R$ 45,55: half of 85,55 is a half cent the two sides round differently
    pizza.add_ons[1].subitems[1].price = 45.55;
    const p = mapped(cardapioweb, raw)
      .doc.categories.flatMap((c) => c.products)
      .find((x) => x.name === 'Pizza meio a meio')!;
    expect(p.status).toBe('archived');
  });

  test('a promo price every day, or in its days; hours of sale; stock; preorder', () => {
    expect(byName.get('X-Burguer')).toMatchObject({
      priceCents: 2490,
      compareAtPriceCents: 2990,
      tags: ['Destaque'],
    });
    expect(byName.get('X-Burguer')!.optionGroups[0]!.options[0]).toMatchObject({ maxQty: 2 });
    // R$ 22,90 on tuesdays and wednesdays: the regular price, with the promotion's days
    expect(byName.get('X-Salada')).toMatchObject({
      priceCents: 2790,
      promoSchedule: { priceCents: 2290, windows: [{ days: [2, 3] }] },
    });
    expect(byName.get('X-Salada')!.compareAtPriceCents).toBeUndefined();
    expect(lostCodes).not.toContain('X-Salada:promo_schedule');
    // the category sells from 18h; the item only on weekends: both apply
    expect(byName.get('X-Fim de semana')!.availability).toEqual({
      windows: [{ days: [0, 6], from: '18:00', to: '23:59' }],
      outside: 'unavailable',
    });
    expect(byName.get('Torta inteira')).toMatchObject({ stockQuantity: 3, requiresPreorder: true });
    expect(byName.get('Hambúrguer esgotado')!.status).toBe('sold_out');
    expect(byName.get('Coca-Cola lata')!.tags).toEqual(['Mais vendido']);
    expect(byName.has('Prato do salão')).toBe(false);
    expect(lostCodes).toContain('Prato do salão:dine_in_only');
    expect(byName.has('Sumiu')).toBe(false);
  });

  test('combos become kits when every pick is a plain product here', () => {
    expect(byName.get('Combo lanche')).toMatchObject({ priceCents: 2900, status: 'active' });
    const slots = byName.get('Combo lanche')!.kit!.slots;
    expect(slots.map((s) => [s.name, s.min, s.max, s.items.map((i) => i.priceDeltaCents)])).toEqual(
      [
        ['Escolha o lanche', 1, 1, [0, 500]],
        ['Escolha a bebida', 1, 1, [0]],
      ],
    );
    // its pizza is chosen with a required flavour there, which a kit can't ask here
    expect(byName.get('Combo pizza')!.status).toBe('archived');
    expect(lostCodes).toContain('Combo pizza:kit_unresolved');
  });

  test('store: profile, hours, pickup, Pix from the payment note; fees by address are a note', () => {
    expect(doc.store).toMatchObject({
      name: 'Pizzaria Exemplo',
      tagline: 'Pizzas de fermentação natural',
      whatsapp: '5521999990000',
      instagram: 'pizzaria.exemplo',
      address: 'Rua das Pizzas, 42 - Loja 2 - Centro',
      city: 'Cidade Exemplo',
      coords: { lat: -22.9, lng: -43.2 },
      brandColor: '#B03A2E',
    });
    expect(doc.hours).toEqual([
      { days: [0, 2, 3, 4], open: '18:00', close: '23:00' },
      { days: [2, 3], open: '11:00', close: '14:00' },
      { days: [5, 6], open: '18:00', close: '23:59' },
    ]);
    // the minimum is for delivery only there: here it waits for the zones the merchant draws
    expect(doc.operations).toEqual({ prepTimeMinutes: 40, pickup: true, delivery: false });
    expect(doc.zones).toBeUndefined();
    expect(doc.payments).toEqual({
      methods: ['cash', 'pix', 'card_on_delivery', 'meal_voucher'],
      pix: {
        key: 'pix@exemplo.test',
        type: 'email',
        beneficiary: 'Pizzaria E C Alimentos',
        city: 'Cidade Exemplo',
      },
    });
    expect(
      doc.lost.filter((l) => l.scope === 'store').map((l) => [l.code, l.detail ?? '']),
    ).toEqual(
      expect.arrayContaining([
        ['delivery_by_address', 'Centro, Jardim'],
        ['free_delivery_rule', 'R$ 120,00'],
        ['delivery_minimum', 'R$ 30,00'],
        ['payment_adjustment', 'Cartão de débito'],
        ['payment_method', 'Transferência'],
        ['online_payment', ''],
        ['loyalty', ''],
        ['coupons', ''],
        ['time_slots', '30'],
      ]),
    );
  });

  test('a hidden product stays hidden; a window past midnight intersects; unknown rules hide', () => {
    const raw = structuredClone(cwFixture) as unknown as {
      categories: { allowed_times: unknown[]; items: Record<string, any>[] }[];
    };
    const pizzas = raw.categories[0]!.items;
    const cheap = pizzas.find((i) => i.name === 'Pizza do mais barato')!;
    // MIN pricing (hidden) and every flavour out: hidden wins over sold out
    for (const o of cheap.add_ons[0].subitems) o.status = 'MISSING';
    cheap.add_ons[0].minimum_quantity = 1;
    const dear = pizzas.find((i) => i.name === 'Pizza do mais caro')!;
    dear.add_ons[0].price_calculation_type = 'MEDIAN';
    const lanches = raw.categories[1]!;
    lanches.allowed_times = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ].map((d, i) => ({ id: i, weekday: d, start_at: '00:00', end_at: '23:59' }));
    lanches.items.find((i) => i.name === 'X-Fim de semana')!.allowed_times = [
      { id: 1, weekday: 'saturday', start_at: '18:00', end_at: '02:00' },
    ];
    const ps = new Map(
      mapped(cardapioweb, raw)
        .doc.categories.flatMap((c) => c.products)
        .map((p) => [p.name, p]),
    );
    expect(ps.get('Pizza do mais barato')!.status).toBe('archived');
    expect(ps.get('Pizza do mais caro')!.status).toBe('archived');
    expect(ps.get('X-Fim de semana')!.availability).toEqual({
      windows: [
        { days: [0], from: '00:00', to: '02:00' },
        { days: [6], from: '18:00', to: '23:59' },
      ],
      outside: 'unavailable',
    });
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 4,
      products: 12,
      hidden: 2,
      optionGroups: 7,
      hours: 3,
      zones: 0,
      paymentMethods: 4,
      pix: true,
      logo: true,
      cover: true,
    });
  });
});

describe('olaclick', () => {
  const { doc, counts } = mapped(olaclick, olaFixture, 'lanchonete-exemplo.ola.click');
  const byName = new Map(doc.categories.flatMap((c) => c.products).map((p) => [p.name, p]));

  test('recognise: any <store>.ola.click page; the platform subdomains are not stores', () => {
    for (const u of [
      'https://lanchonete-exemplo.ola.click/',
      'lanchonete-exemplo.ola.click/products',
      'https://LANCHONETE-EXEMPLO.ola.click/acai/acai-copo-700ml',
    ]) {
      const r = recognise(u);
      expect(r.kind).toBe('ok');
      if (r.kind === 'ok') {
        expect(r.adapter.platform).toBe('olaclick');
        expect(r.ref).toBe('lanchonete-exemplo.ola.click');
      }
    }
    for (const u of ['https://ola.click/', 'https://www.ola.click/', 'https://api.ola.click/x'])
      expect(recognise(u).kind).toBe('unsupported');
  });

  test('read: the host lookup, then the menu, company, settings and payment methods', async () => {
    const api = 'https://api.olaclick.app';
    const id = '00000000-0000-4000-8000-0000000000aa';
    const c = `${api}/ms-companies/public/companies/${id}`;
    const { raw, seen } = await fakeRead(olaclick, 'lanchonete-exemplo.ola.click', {
      [`${api}/ms-companies/public/hosts/lanchonete-exemplo.ola.click`]: {
        data: {
          company_id: id,
          custom_url: null,
          olaclick_url: 'https://lanchonete-exemplo.ola.click',
        },
      },
      [`${api}/ms-products/public/companies/${id}/categories`]: { data: olaFixture.categories },
      [c]: { data: olaFixture.company },
      [`${c}/ecommerce-settings`]: { data: olaFixture.settings },
      [`${api}/ms-orders/public/companies/${id}/payment-methods`]: { data: olaFixture.payments },
    });
    expect(seen).toHaveLength(5);
    expect(seen.every((s) => s.url.startsWith(`${api}/`))).toBe(true);
    expect(raw).toEqual(olaFixture);
    await expect(fakeRead(olaclick, 'sumiu.ola.click', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  test('allowlisted fields only — no token, tracking id or cost survives', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('should-not-appear');
    expect(json).not.toContain('3.21');
  });

  test('variants: one is the price, several a size group; strike-through and stock', () => {
    expect(byName.get('X-Burguer')).toMatchObject({
      priceCents: 2500,
      compareAtPriceCents: 2990,
      tags: ['Destaque'],
    });
    const pizza = byName.get('Pizza')!;
    expect(pizza.priceCents).toBe(3990);
    expect(pizza.optionGroups[0]).toMatchObject({ name: 'Tamanho', min: 1, max: 1 });
    expect(
      pizza.optionGroups[0]!.options.map((o) => [o.name, o.priceDeltaCents, !!o.soldOut]),
    ).toEqual([
      ['Média', 0, false],
      ['Grande', 1000, true],
      ['Gigante', 2000, false],
    ]);
    // every size discounted: the cheapest one's list price, struck through
    expect(byName.get('Açaí')).toMatchObject({ priceCents: 1500, compareAtPriceCents: 1800 });
    expect(byName.get('Brownie')).toMatchObject({ priceCents: 990, stockQuantity: 3 });
    expect(byName.get('Marmita')!.status).toBe('archived');
    expect(doc.lost).toContainEqual({
      scope: 'product',
      subject: 'Marmita',
      code: 'packaging_fee',
    });
    expect(byName.has('Fora do ar')).toBe(false);
    expect(byName.has('Sumiu')).toBe(false);
  });

  test('a price that is not a number, sold-out sizes under a hidden product, the list price', () => {
    const raw = structuredClone(olaFixture) as unknown as {
      categories: { products: Record<string, any>[] }[];
    };
    const lanches = raw.categories[1]!.products;
    // the storefront charges price, else original_price
    lanches[1]!.product_variants[0]!.price = null;
    lanches[1]!.product_variants[0]!.original_price = 11.5;
    lanches[0]!.product_variants[0]!.price = '25.00';
    const pizzas = raw.categories[2]!.products;
    for (const v of pizzas[0]!.product_variants) v.stock = 0;
    pizzas[0]!.product_variants[0]!.packaging_price = 1;
    const ps = new Map(
      mapped(olaclick, raw)
        .doc.categories.flatMap((c) => c.products)
        .map((p) => [p.name, p]),
    );
    expect(ps.get('Brownie')).toMatchObject({ priceCents: 1150, status: 'active' });
    expect(ps.get('X-Burguer')!.status).toBe('archived');
    expect(ps.get('Pizza')!.status).toBe('archived');
  });

  test('modifiers: a sum; the minimum only when required; max_limit is a quantity', () => {
    const [extras, drink] = byName.get('X-Burguer')!.optionGroups;
    expect(extras!.options[0]).toMatchObject({ name: 'Bacon', priceDeltaCents: 400, maxQty: 3 });
    expect(drink).toMatchObject({ name: 'Quer bebida?', min: 0, max: 1 });
    const flavours = byName.get('Pizza')!.optionGroups[1]!;
    expect(flavours).toMatchObject({ name: 'Sabores', min: 1, max: 2 });
    expect(flavours.pricingRule).toBeUndefined();
    // a list with every option hidden isn't there
    expect(byName.get('Pizza')!.optionGroups).toHaveLength(2);
  });

  test('delivery: only the live mode; free above the threshold; the other modes', () => {
    expect(doc.zones).toEqual([
      {
        name: 'Taxa R$ 5,00',
        kind: 'neighborhood',
        neighborhoods: ['Centro', 'Jardim'],
        feeCents: 500,
        etaMin: 30,
        etaMax: 45,
        minOrderCents: 2500,
        freeDeliveryOverCents: 8000,
      },
      {
        name: 'Taxa R$ 8,00',
        kind: 'neighborhood',
        neighborhoods: ['Vila Nova'],
        feeCents: 800,
        etaMin: 30,
        etaMax: 45,
        minOrderCents: 2500,
        freeDeliveryOverCents: 8000,
      },
    ]);
    const as = (type: string, distance?: Record<string, number>) => {
      const raw = structuredClone(olaFixture) as unknown as {
        settings: { delivery: { prices: Record<string, any> } };
      };
      raw.settings.delivery.prices.type = type;
      if (distance) raw.settings.delivery.prices.distance = distance;
      return mapped(olaclick, raw).doc;
    };
    expect(as('BY_AREA').zones!.map((z) => [z.kind, z.feeCents, z.polygon?.length])).toEqual([
      ['polygon', 600, 3],
    ]);
    expect(as('BY_RANGE').zones!.map((z) => [z.maxDistanceKm, z.feeCents])).toEqual([
      [3, 500],
      [6, 900],
    ]);
    expect(as('BY_DRIVE_DISTANCE').zones).toEqual([
      {
        name: 'Até 8 km',
        kind: 'radius',
        maxDistanceKm: 8,
        feeCents: 300,
        feePerKmCents: 150,
        etaMin: 30,
        etaMax: 45,
        minOrderCents: 2500,
        freeDeliveryOverCents: 8000,
      },
    ]);
    expect(as('BY_DRIVE_DISTANCE').lost.map((l) => l.code)).toContain(
      'delivery_distance_straight_line',
    );
    // a fixed fee is for any address (the distance limit belongs to the per-km mode): a note,
    // and the delivery minimum with it
    const flat = as('FIXED');
    expect(flat.zones).toBeUndefined();
    expect(flat.operations?.delivery).toBe(false);
    expect(flat.lost).toEqual(
      expect.arrayContaining([
        { scope: 'store', code: 'delivery_flat_fee', detail: 'R$ 7,00' },
        { scope: 'store', code: 'delivery_minimum', detail: 'R$ 25,00' },
      ]),
    );
    // a band that starts past the previous end leaves a ring with no delivery there
    const gap = structuredClone(olaFixture) as unknown as {
      settings: { delivery: { prices: Record<string, any> } };
    };
    gap.settings.delivery.prices.type = 'BY_RANGE';
    gap.settings.delivery.prices.ranges[1].min = 4000;
    expect(mapped(olaclick, gap).doc.lost.map((l) => [l.code, l.detail ?? ''])).toEqual(
      expect.arrayContaining([
        ['delivery_gap', '4'],
        ['delivery_distance_straight_line', ''],
      ]),
    );
    const out = structuredClone(gap);
    out.settings.delivery.prices.type = 'BY_AREA';
    out.settings.delivery.prices.area.enable_out_of_area = true;
    expect(mapped(olaclick, out).doc.lost).toContainEqual({
      scope: 'store',
      code: 'delivery_out_of_area',
    });
  });

  test('store: profile, colour, hours past midnight, minimum, payments', () => {
    expect(doc.store).toMatchObject({
      name: 'Lanchonete Exemplo',
      whatsapp: '5521999990000',
      coords: { lat: -22.9, lng: -43.2 },
      brandColor: '#E4572E',
    });
    expect(doc.store.coverUrl).toStartWith('https://assets.olaclick.app/');
    expect(doc.hours).toEqual([
      { days: [1, 2, 3, 4], open: '18:00', close: '23:00' },
      { days: [3], open: '11:00', close: '14:00' },
      { days: [5, 6], open: '18:00', close: '01:00' },
    ]);
    expect(doc.operations).toEqual({ pickup: true, delivery: true });
    expect(doc.payments).toEqual({ methods: ['cash', 'card_on_delivery', 'pix'] });
    expect(
      doc.lost.filter((l) => l.scope === 'store').map((l) => [l.code, l.detail ?? '']),
    ).toEqual([
      ['payment_method', 'Transferência'],
      ['online_payment', ''],
      ['pix_unreadable', ''],
    ]);
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 2,
      products: 5,
      hidden: 1,
      optionGroups: 5,
      hours: 3,
      zones: 2,
      paymentMethods: 3,
      pix: false,
      logo: true,
      cover: true,
    });
  });
});

describe('takeat', () => {
  const { doc, counts } = mapped(takeat, tkFixture, 'pizzariaexemplo');
  const byName = new Map(doc.categories.flatMap((c) => c.products).map((p) => [p.name, p]));
  const lostCodes = doc.lost.map((l) => `${l.subject ?? ''}:${l.code}`);

  test('recognise: pedido.takeat.app/<slug>', () => {
    const r = recognise('pedido.takeat.app/PizzariaExemplo?utm=ig');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.adapter.platform).toBe('takeat');
      expect(r.ref).toBe('pizzariaexemplo');
    }
    for (const u of [
      'https://pedido.takeat.app/',
      'https://takeat.app/planos',
      'https://www.takeat.app/x',
    ])
      expect(recognise(u).kind).toBe('unsupported');
  });

  test('read: restaurant, menu (gd, brand), hours, and the fee table when it has one', async () => {
    const base = 'https://backend-delivery.takeat.app/public';
    const routes = {
      [`${base}/restaurant/pizzariaexemplo`]: tkFixture.store,
      [`${base}/restaurants/menu/777?gd=true&brand_id=88`]: tkFixture.menu,
      [`${base}/restaurants/delivery-schedules/777`]: tkFixture.schedule,
      [`${base}/restaurants/delivery-addresses/777`]: tkFixture.fees,
    };
    const { raw, seen } = await fakeRead(takeat, 'pizzariaexemplo', routes);
    expect(seen.map((s) => s.url)).toEqual(Object.keys(routes));
    expect(raw).toEqual(tkFixture);
    // no neighbourhood table: one request fewer
    const store = structuredClone(tkFixture.store);
    store.delivery_info.allow_delivery_addresses = false;
    const { seen: three } = await fakeRead(takeat, 'pizzariaexemplo', {
      ...routes,
      [`${base}/restaurant/pizzariaexemplo`]: store,
    });
    expect(three).toHaveLength(3);
    await expect(fakeRead(takeat, 'sumiu', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('allowlisted fields only — no token, pixel, fiscal id or cost survives', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('should-not-appear');
    expect(json).not.toContain('00000000000000');
    expect(json).not.toContain('1.23');
  });

  test('only what sells for delivery, at the delivery price, promo first', () => {
    expect(byName.get('X-Burguer')).toMatchObject({ priceCents: 2200, compareAtPriceCents: 2700 });
    // no delivery price: the dine-in promo is the price there too
    expect(byName.get('X-Salada')).toMatchObject({ priceCents: 2000, compareAtPriceCents: 2400 });
    expect(byName.get('X-Esgotado')!.status).toBe('sold_out');
    expect(byName.has('X-Salão')).toBe(false);
    expect(byName.has('Prato executivo')).toBe(false);
    expect(byName.has('Refeição colaborador')).toBe(false);
    expect(lostCodes).toEqual(
      expect.arrayContaining(['X-Salão:dine_in_only', 'Salão:dine_in_only']),
    );
    expect(lostCodes.some((c) => c.includes('colaborador') || c.includes('FUNCIONÁRIOS'))).toBe(
      false,
    );
    expect(byName.get('Queijo por quilo')!.status).toBe('archived');
    // a delivery price of 0 under a priced item isn't sold for free
    expect(byName.get('Brinde zerado')!.status).toBe('archived');
    expect(byName.get('Pizza grande')!.tags).toEqual(['Mais pedido']);
  });

  test('complements: the dearest once, sums, included lists, optional minimums', () => {
    const [flavours, crust, drink] = byName.get('Pizza grande')!.optionGroups;
    expect(flavours).toMatchObject({
      name: 'Escolha até 2 sabores (meio a meio)',
      pricingRule: 'most_expensive',
      max: 2,
    });
    // the crust: optional, its delivery price
    expect(crust).toMatchObject({ min: 0, max: 1 });
    expect(crust!.options.map((o) => o.priceDeltaCents)).toEqual([1200, 900]);
    // prices of a list that isn't "additional" don't count
    expect(drink!.options.map((o) => o.priceDeltaCents)).toEqual([0, 0]);
    // the storefront's average isn't repeated: hidden
    expect(byName.get('Pizza média')!.status).toBe('archived');
    expect(lostCodes).toContain('Pizza média:pizza_pricing');
    // "none or at least 2" has no rule here: no minimum, and a note
    const extras = byName.get('Combo só à noite')!.optionGroups[0]!;
    expect(extras).toMatchObject({ min: 0 });
    expect(extras.options.map((o) => [o.name, o.maxQty ?? 1])).toEqual([
      ['Bacon', 2],
      ['Ovo', 1],
    ]);
    expect(lostCodes).toContain('Combo só à noite:option_minimum');
    // "a partir de": the size list carries the price
    expect(byName.get('Pizza a partir de')).toMatchObject({ priceCents: 2990 });
  });

  test('an average added once per line, a missing price, minimums by order type', () => {
    type Raw = Record<string, any>;
    const raw = structuredClone(tkFixture) as unknown as {
      store: Raw;
      menu: { products: Raw[] }[];
      schedule: Raw[];
    };
    const lanches = raw.menu[1]!.products;
    // a single-pick average still differs on a line of 2: hidden
    lanches.find((p) => p.name === 'Combo só à noite')!.complement_categories[0].use_average = true;
    lanches.find((p) => p.name === 'Combo só à noite')!.complement_categories[0].limit = 1;
    lanches.find((p) => p.name === 'X-Esgotado')!.price = null;
    // Saturday 18:00 → 02:00 there
    raw.schedule[6]!.close_time = '2021-01-10T05:00:00.000Z';
    raw.store.delivery_info.withdrawal_minimum_price = '40.00';
    const d = mapped(takeat, raw).doc;
    const ps = new Map(d.categories.flatMap((c) => c.products).map((p) => [p.name, p]));
    expect(ps.get('Combo só à noite')!.status).toBe('archived');
    expect(ps.get('X-Esgotado')!.status).toBe('archived');
    expect(d.hours).toContainEqual({ days: [6], open: '18:00', close: '02:00' });
    // pickup's R$ 40 binds every order here, so the lower delivery minimum is a note
    expect(d.operations?.minOrderCents).toBe(4000);
    expect(d.zones!.every((z) => z.minOrderCents === undefined)).toBe(true);
    expect(d.lost).toContainEqual({
      scope: 'store',
      code: 'delivery_minimum_lower',
      detail: 'R$ 30,00',
    });
    // no pickup: the delivery minimum is the store's
    raw.store.delivery_info.is_withdrawal_allowed = false;
    expect(mapped(takeat, raw).doc.operations).toMatchObject({
      minOrderCents: 3000,
      pickup: false,
    });
  });

  test('times are a Brasília clock: hours, shifts, windows of sale', () => {
    expect(doc.hours).toEqual([
      { days: [0, 2, 3, 4, 5, 6], open: '18:00', close: '23:30' },
      { days: [3], open: '11:00', close: '14:00' },
    ]);
    expect(byName.get('Combo só à noite')!.availability).toEqual({
      windows: [{ days: [6], from: '18:00', to: '23:00' }],
      outside: 'unavailable',
    });
  });

  test('store: profile, neighbourhood fees, minimum, payments', () => {
    expect(doc.store).toMatchObject({
      name: 'Pizzaria Exemplo',
      announcement: { title: 'Bem-vindo à Pizzaria Exemplo!', body: 'Peça pelo site.' },
      whatsapp: '5521999990000',
      instagram: 'pizzaria.exemplo',
      address: 'Rua das Pizzas, 42 - Loja 2 - Centro',
      brandColor: '#8E44AD',
    });
    expect(doc.zones).toEqual([
      {
        name: 'Taxa R$ 7,00',
        kind: 'neighborhood',
        neighborhoods: ['Centro', 'Jardim'],
        feeCents: 700,
        etaMin: 50,
        etaMax: 50,
        minOrderCents: 3000,
      },
      {
        name: 'Taxa R$ 10,50',
        kind: 'neighborhood',
        neighborhoods: ['Vila Nova'],
        feeCents: 1050,
        etaMin: 50,
        etaMax: 50,
        minOrderCents: 3000,
      },
    ]);
    // the delivery minimum rides on the zones; pickup had none
    expect(doc.operations).toEqual({ prepTimeMinutes: 50, pickup: true, delivery: true });
    expect(doc.payments).toEqual({ methods: ['cash', 'pix', 'card_on_delivery', 'meal_voucher'] });
    expect(
      doc.lost.filter((l) => l.scope === 'store').map((l) => [l.code, l.detail ?? '']),
    ).toEqual([
      ['payment_method', 'Banricard'],
      ['cashback', ''],
      ['online_payment', ''],
      ['pix_unreadable', ''],
    ]);
    // a store priced by distance or area: the fee is a note
    const raw = structuredClone(tkFixture);
    raw.store.delivery_info.allow_delivery_addresses = false;
    raw.store.delivery_info.is_delivery_by_distance = true;
    const d = mapped(takeat, raw).doc;
    expect(d.zones).toBeUndefined();
    expect(d.operations?.delivery).toBe(false);
    expect(d.lost).toContainEqual({ scope: 'store', code: 'delivery_by_address' });
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 2,
      products: 9,
      hidden: 3,
      optionGroups: 6,
      hours: 2,
      zones: 2,
      paymentMethods: 4,
      logo: true,
      cover: true,
    });
  });
});

describe('deliverydireto', () => {
  const { doc, counts } = mapped(deliverydireto, ddFixture, 'pizzariaexemplo/centro');
  const byName = new Map(doc.categories.flatMap((c) => c.products).map((p) => [p.name, p]));
  const lostCodes = doc.lost.map((l) => `${l.subject ?? ''}:${l.code}`);

  test('recognise: the store link, a brand link, and the pages under them', () => {
    const ref = (u: string) => {
      const r = recognise(u);
      return r.kind === 'ok' && r.adapter.platform === 'deliverydireto' ? r.ref : null;
    };
    expect(ref('https://deliverydireto.com.br/pizzariaexemplo/centro')).toBe(
      'pizzariaexemplo/centro',
    );
    expect(ref('deliverydireto.com.br/PizzariaExemplo/Centro/pages/area-de-entrega')).toBe(
      'pizzariaexemplo/centro',
    );
    expect(ref('https://www.deliverydireto.com.br/pizzariaexemplo')).toBe('pizzariaexemplo');
    expect(ref('https://deliverydireto.com.br/pizzariaexemplo/pages/sobre')).toBe(
      'pizzariaexemplo',
    );
    for (const u of ['https://deliverydireto.com.br/', 'https://deliverydireto.com.br/ss/x/y/z.js'])
      expect(recognise(u).kind).toBe('unsupported');
  });

  test('read: units, categories one by one, the pizza module, fees, payment forms', async () => {
    const o = 'https://deliverydireto.com.br';
    const base = `${o}/pizzariaexemplo/centro`;
    const routes: Record<string, unknown> = {
      [`${o}/pizzariaexemplo/basic_info`]: {
        status: 'success',
        data: { brand: { stores: [ddFixture.unit] } },
      },
      [`${base}/categories`]: {
        status: 'success',
        data: {
          categories: [
            ...ddFixture.categories.map((c) => ({ ...c, items: [] })),
            { id: 9999, name: 'Bebidas', encoded_name: 'bebidas' },
          ],
        },
      },
      [`${base}/categories/9999?include=items,properties`]: { status: 'error' },
      [`${base}/pizza_module/get_pizza_sizes`]: {
        status: 'success',
        data: { items: ddFixture.pizza.sizes },
      },
      [`${base}/delivery/fees`]: { status: 'success', data: ddFixture.fees },
      [`${base}/payment-forms`]: { status: 'success', data: ddFixture.forms },
    };
    for (const c of ddFixture.categories)
      routes[`${base}/categories/${c.id}?include=items,properties`] = {
        status: 'success',
        data: { category: c },
      };
    for (const sz of ddFixture.pizza.sizes) {
      routes[`${base}/pizza_module/get_pizza_flavors?size=${sz.id}`] = {
        status: 'success',
        data: { items: (ddFixture.pizza.flavors as Record<string, unknown>)[String(sz.id)] ?? [] },
      };
      routes[`${base}/pizza_module/get_pizza_additionals?size=${sz.id}`] = {
        status: 'success',
        data: { properties: [] },
      };
    }
    const { raw, seen } = await fakeRead(deliverydireto, 'pizzariaexemplo/centro', routes);
    expect(new Set(seen.map((s) => s.url))).toEqual(new Set(Object.keys(routes)));
    expect(seen.every((s) => Object.keys(s.headers).length === 2)).toBe(true);
    const doc2 = mapped(deliverydireto, raw).doc;
    expect(doc2.categories.flatMap((c) => c.products).map((p) => [p.name, p.priceCents])).toEqual(
      doc.categories.flatMap((c) => c.products).map((p) => [p.name, p.priceCents]),
    );
    // a category that wouldn't read is a note, not a silent gap
    expect(doc2.lost).toContainEqual({
      scope: 'category',
      subject: 'Bebidas',
      code: 'category_unreadable',
    });
    // a brand link opens its only unit; a unit that isn't the brand's is not found
    const brandOnly = await fakeRead(deliverydireto, 'pizzariaexemplo', routes);
    expect(brandOnly.seen[1]!.url).toBe(`${base}/categories`);
    await expect(fakeRead(deliverydireto, 'pizzariaexemplo/outra', routes)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // several units and a brand link: the merchant pastes the unit's link
    const two = {
      ...routes,
      [`${o}/pizzariaexemplo/basic_info`]: {
        status: 'success',
        data: { brand: { stores: [ddFixture.unit, { ...ddFixture.unit, encoded_name: 'praia' }] } },
      },
    };
    await expect(fakeRead(deliverydireto, 'pizzariaexemplo', two)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  }, 30_000);

  test('allowlisted fields only — no fiscal id, platform id or merchant id survives', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('should-not-appear');
    expect(json).not.toContain('00000000000000');
    expect(json).not.toContain('00.000.000');
  });

  test('flavours: the dearest maps; an average only off half cents; the cheapest hides', () => {
    const pizza = byName.get('Pizza meio a meio')!;
    expect(pizza.priceCents).toBe(4990);
    const [flavours, crust] = pizza.optionGroups;
    expect(flavours).toMatchObject({ pricingRule: 'average', min: 1, max: 2 });
    // ½ Calabresa + ½ Camarão there: (49,90 + 64,90) / 2 = 57,40
    expect(
      unitPriceCents(pizza.priceCents, [
        {
          pricingRule: 'average',
          picks: [0, 2].map((i) => ({
            priceDeltaCents: flavours!.options[i]!.priceDeltaCents,
            qty: 1,
          })),
        },
      ]),
    ).toBe(5740);
    expect(crust!.options[1]).toMatchObject({ name: 'Cheddar', soldOut: true });
    expect(byName.get('Pizza do mais caro')!.optionGroups[0]).toMatchObject({
      pricingRule: 'most_expensive',
    });
    expect(byName.get('Pizza do mais barato')!.status).toBe('archived');
    expect(byName.get('Pizza média torta')!.status).toBe('archived');
    expect(lostCodes).toEqual(
      expect.arrayContaining([
        'Pizza do mais barato:pizza_pricing',
        'Pizza média torta:pizza_pricing',
      ]),
    );
  });

  test('the pizza module: a product per size, its flavours priced for that size', () => {
    const big = byName.get('Grande')!;
    expect(big.priceCents).toBe(5490);
    expect(big.optionGroups.map((g) => g.name)).toEqual(['Escolha até 2 sabores', 'Borda']);
    expect(
      big.optionGroups[0]!.options.map((o) => [o.name, o.priceDeltaCents, !!o.soldOut]),
    ).toEqual([
      ['Mussarela', 0, false],
      ['Portuguesa', 400, false],
      ['Chocolate', 200, true],
    ]);
    expect(byName.has('Família escondida')).toBe(false);
  });

  test('items: statuses, order types, hours of sale, quantities', () => {
    expect(byName.get('X-Burguer')).toMatchObject({ priceCents: 2500, tags: ['Novidade'] });
    expect(byName.get('X-Burguer')!.optionGroups[0]!.options).toEqual([
      { name: 'Bacon', priceDeltaCents: 400, maxQty: 3 },
      { name: 'Ovo', priceDeltaCents: 250 },
    ]);
    expect(byName.get('X-Pausado')!.status).toBe('sold_out');
    // UNAVAILABLE is only "outside its hours right now"
    expect(byName.get('X-Fora de hora')).toMatchObject({
      status: 'active',
      availability: {
        windows: [{ days: [0, 6], from: '18:00', to: '23:00' }],
        outside: 'unavailable',
      },
    });
    expect(byName.has('X-Salão')).toBe(false);
    expect(lostCodes).toContain('X-Salão:dine_in_only');
    expect(byName.has('Escondido')).toBe(false);
  });

  test('store: unit profile, wall-clock hours, zones from polygons and circles, payments', () => {
    expect(doc.store).toMatchObject({
      name: 'Pizzaria Exemplo - Centro',
      whatsapp: '5521999990000',
      instagram: 'pizzaria.exemplo',
      address: 'Rua das Pizzas, 42 - Loja 2 - Centro',
      brandColor: '#C0392B',
    });
    expect(doc.hours).toEqual([
      { days: [0, 2, 3, 4], open: '18:00', close: '23:30' },
      { days: [5, 6], open: '18:00', close: '01:00' },
    ]);
    const [centre, disc] = doc.zones!;
    // lng,lat pairs, closed and padded: a [lat, lng] ring of 4
    expect(centre).toMatchObject({
      kind: 'polygon',
      feeCents: 500,
      minOrderCents: 3000,
      freeDeliveryOverCents: 9000,
      etaMin: 30,
      etaMax: 45,
    });
    expect(centre!.polygon).toEqual([
      [-22.9, -43.2],
      [-22.9, -43.21],
      [-22.91, -43.21],
      [-22.91, -43.2],
    ]);
    // a 5 km circle: a 48-sided polygon drawn just outside it
    expect(disc).toMatchObject({ name: 'Até 5 km', kind: 'polygon', feeCents: 900 });
    expect(disc!.polygon).toHaveLength(48);
    // every address 5 km away (Core's haversine) is inside; 5.2 km is not
    const at = (km: number, deg: number) => {
      const [φ, λ, δ, θ] = [-22.9, -43.2, km / 6371, deg].map((x, i) =>
        i < 2 || i === 3 ? (x * Math.PI) / 180 : x,
      ) as [number, number, number, number];
      const φ2 = Math.asin(Math.sin(φ) * Math.cos(δ) + Math.cos(φ) * Math.sin(δ) * Math.cos(θ));
      const λ2 =
        λ +
        Math.atan2(
          Math.sin(θ) * Math.sin(δ) * Math.cos(φ),
          Math.cos(δ) - Math.sin(φ) * Math.sin(φ2),
        );
      return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
    };
    for (let deg = 0; deg < 360; deg += 0.5) {
      const p = at(5, deg);
      expect(haversineKm({ lat: -22.9, lng: -43.2 }, p)).toBeCloseTo(5, 6);
      expect(pointInPolygon(p, disc!.polygon!)).toBe(true);
      expect(pointInPolygon(at(5.2, deg), disc!.polygon!)).toBe(false);
    }
    expect(doc.zones).toHaveLength(2);
    expect(doc.operations).toEqual({ prepTimeMinutes: 40, pickup: true, delivery: true });
    expect(doc.payments).toEqual({ methods: ['cash', 'card_on_delivery', 'meal_voucher', 'pix'] });
    // Centro sits inside the disc; a CNPJ or phone in a form's name never reaches a note
    expect(
      doc.lost.filter((l) => l.scope === 'store').map((l) => [l.code, l.detail ?? '']),
    ).toEqual([
      ['delivery_overlap', ''],
      ['payment_adjustment', 'Dinheiro'],
      ['payment_adjustment', 'PIX - CNPJ: …'],
      ['payment_method', 'Fiado'],
      ['payment_method', 'Transferência CNPJ … ou fone …'],
      ['pix_unreadable', ''],
    ]);
  });

  test('minimums: a lower delivery one, or one with no area to carry it, is a note', () => {
    const raw = structuredClone(ddFixture) as typeof ddFixture & Record<string, any>;
    raw.unit.takeout_minimum_order = 40;
    let d = mapped(deliverydireto, raw).doc;
    expect(d.operations?.minOrderCents).toBe(4000);
    expect(d.zones!.every((z) => z.minOrderCents === undefined)).toBe(true);
    expect(d.lost).toContainEqual({
      scope: 'store',
      code: 'delivery_minimum_lower',
      detail: 'R$ 30,00',
    });
    raw.unit.takeout_minimum_order = 0;
    raw.fees.fees = [];
    d = mapped(deliverydireto, raw).doc;
    expect(d.operations?.minOrderCents).toBeUndefined();
    expect(d.lost).toContainEqual({ scope: 'store', code: 'delivery_minimum', detail: 'R$ 30,00' });
    expect(d.lost).toContainEqual({ scope: 'store', code: 'delivery_flat_fee', detail: 'grátis' });
  });

  test('a quantity group averaged: exact up to two units of one parity, else hidden', () => {
    const raw = structuredClone(ddFixture) as typeof ddFixture & Record<string, any>;
    const burger = () =>
      raw.categories.flatMap((c: any) => c.items ?? []).find((i: any) => i.name === 'X-Burguer');
    const extras = burger().properties[0];
    extras.price_calculation_type = 'AVERAGE';
    let p = mapped(deliverydireto, raw)
      .doc.categories.flatMap((c) => c.products)
      .find((x) => x.name === 'X-Burguer')!;
    expect(p.status).toBe('archived');
    extras.combo_max_choices = 2;
    for (const o of extras.options) o.price = 4;
    p = mapped(deliverydireto, raw)
      .doc.categories.flatMap((c) => c.products)
      .find((x) => x.name === 'X-Burguer')!;
    expect(p.status).not.toBe('archived');
    expect(p.optionGroups[0]).toMatchObject({ pricingRule: 'average', max: 2 });
    expect(p.optionGroups[0]!.options[0]!.maxQty).toBe(2);
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 3,
      products: 8,
      hidden: 2,
      optionGroups: 8,
      hours: 2,
      zones: 2,
      paymentMethods: 4,
      logo: true,
      cover: true,
    });
  });
});

describe('saipos', () => {
  const { doc, counts } = mapped(saipos, spFixture, 'exemplo.saipos.com');
  const all = doc.categories.flatMap((c) => c.products);
  const byName = new Map(all.map((p) => [p.name, p]));
  const lostCodes = doc.lost.map((l) => `${l.subject ?? ''}:${l.code}`);

  test('recognise: a store subdomain, not the platform own ones', () => {
    const ref = (u: string) => {
      const r = recognise(u);
      return r.kind === 'ok' && r.adapter.platform === 'saipos' ? r.ref : null;
    };
    expect(ref('https://exemplo.saipos.com/')).toBe('exemplo.saipos.com');
    expect(ref('Exemplo.saipos.com/cardapio?x=1')).toBe('exemplo.saipos.com');
    for (const u of ['https://www.saipos.com/', 'https://conta.saipos.com/', 'https://saipos.com'])
      expect(recognise(u).kind).toBe('unsupported');
    expect(ref('https://exemplo.saipos.com.evil.example/')).toBeNull();
  });

  test('read: the store by its domain, then its view data; an unknown domain is not found', async () => {
    const api = 'https://delivery-api.saipos.com/v1';
    const filter = encodeURIComponent(JSON.stringify({ domain_name: 'exemplo.saipos.com' }));
    const routes: Record<string, unknown> = {
      [`${api}/stores?filter=${filter}`]: [spFixture.store],
      [`${api}/stores/4242/sales/view-data`]: {
        payment_types: [],
        items: spFixture.items,
        choices: spFixture.choices,
        enabled_products: [],
      },
    };
    const { raw, seen } = await fakeRead(saipos, 'exemplo.saipos.com', routes);
    expect(seen.map((s) => s.url)).toEqual(Object.keys(routes));
    expect(mapped(saipos, raw).doc.categories).toEqual(doc.categories);
    await expect(
      fakeRead(saipos, 'exemplo.saipos.com', { ...routes, [`${api}/stores?filter=${filter}`]: [] }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('allowlisted fields only — no tracking code, token or legal name survives', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('should-not-appear');
    expect(json).not.toContain('00.000.000');
    expect(json).not.toContain('4242');
  });

  test('categories: enabled ones in order, extra placements listed, a stale site list ignored', () => {
    expect(doc.categories.map((c) => c.name)).toEqual([
      'Destaques',
      'Pizzas',
      'Lanches',
      'Bebidas',
      'Combos',
    ]);
    expect(byName.has('Fora do site')).toBe(false);
    expect(all.filter((p) => p.name === 'Promo X')).toHaveLength(2);
    expect(lostCodes).toContain('Combos:required_item');
    expect(doc.lost).toContainEqual({
      scope: 'category',
      subject: 'Combos',
      code: 'required_item',
      detail: 'Hambúrguer',
    });
    const raw = structuredClone(spFixture) as typeof spFixture & Record<string, any>;
    // a category requiring the one item it has asks nothing
    const combo = raw.items.find((i) => i.desc_store_item === 'Combo casal')!;
    (combo.category_item as Record<string, unknown>).id_store_item_required = 5000;
    expect(mapped(saipos, raw).doc.lost.some((l) => l.code === 'required_item')).toBe(false);
    // the site lists the categories it shows by id
    raw.store.categories = '10##PIZZAS**30##BEBIDAS';
    expect(mapped(saipos, raw).doc.categories.map((c) => c.name)).toEqual(['Pizzas', 'Bebidas']);
    // a list naming none of them shows nothing there: everything comes, with a note
    raw.store.categories = '777##PIZZAS';
    const stale = mapped(saipos, raw).doc;
    expect(stale.categories).toHaveLength(5);
    expect(stale.lost).toContainEqual({ scope: 'store', code: 'site_categories_stale' });
  });

  test('sizes: a size list when options cost the same, one product per size when not', () => {
    // Camarão costs R$ 10 on the medium and R$ 14 on the large
    expect(byName.get('Pizza — Média')).toMatchObject({ priceCents: 4000, status: 'active' });
    expect(byName.get('Pizza — Grande')!.optionGroups[0]).toMatchObject({
      name: 'Sabores',
      pricingRule: 'average',
      min: 1,
      max: 2,
      options: [
        { name: 'Calabresa', priceDeltaCents: 0, maxQty: 2 },
        { name: 'Camarão', priceDeltaCents: 1400, maxQty: 2 },
      ],
    });
    // ½ Calabresa + ½ Camarão on the large: 50 + (0 + 14) / 2
    expect(
      unitPriceCents(5000, [
        {
          pricingRule: 'average',
          picks: [0, 1400].map((d) => ({ priceDeltaCents: d, qty: 1 })),
        },
      ]),
    ).toBe(5700);
    // the internal "Único" size and a disabled one are skipped
    expect(byName.get('Suco')).toMatchObject({
      priceCents: 800,
      optionGroups: [
        {
          name: 'Tamanho',
          min: 1,
          max: 1,
          options: [{ priceDeltaCents: 0 }, { priceDeltaCents: 400 }],
        },
        { name: 'Sabor', min: 1, max: 1 },
      ],
    });
    // R$ 0 with a required list: its cheapest pick is the starting price
    expect(byName.get('Açaí')).toMatchObject({ priceCents: 1200 });
    expect(byName.get('Açaí')!.optionGroups[0]!.options.map((o) => o.priceDeltaCents)).toEqual([
      0, 600,
    ]);
    expect(byName.has('Sem tamanho')).toBe(false);
  });

  test('lists: quantities up to the maximum; dearest maps, an average past two units hides', () => {
    const burger = byName.get('Hambúrguer')!;
    // a reference to a list the payload doesn't have, and an empty list, are skipped
    expect(burger.optionGroups).toEqual([
      {
        name: 'Adicionais',
        min: 0,
        max: 3,
        options: [
          { name: 'Bacon', priceDeltaCents: 400, maxQty: 3 },
          { name: 'Ovo', priceDeltaCents: 250, maxQty: 3, description: 'Ovo frito' },
        ],
      },
    ]);
    expect(byName.get('Pizza do mais caro')!.optionGroups[0]!.pricingRule).toBe('most_expensive');
    expect(byName.get('Pizza de três')!.status).toBe('archived');
    expect(lostCodes).toContain('Pizza de três:pizza_pricing');
  });

  test('promotions: a standing one is the price; one with hours rides along; an odd flag hides', () => {
    expect(byName.get('Promo X')).toMatchObject({ priceCents: 2500, compareAtPriceCents: 3000 });
    // R$ 20 on fridays from 18h to 23h, as there
    expect(byName.get('Promo noite')).toMatchObject({
      priceCents: 3000,
      status: 'active',
      promoSchedule: { priceCents: 2000, windows: [{ days: [5], from: '18:00', to: '23:00' }] },
    });
    expect(lostCodes).not.toContain('Promo noite:promo_schedule');
    expect(byName.get('Promo estranha')!.status).toBe('archived');
    expect(lostCodes).toContain('Promo estranha:promo_unreadable');
  });

  test('a timed promotion on one size: each size its own product, the promotion on its own', () => {
    const raw = structuredClone(spFixture) as typeof spFixture & Record<string, any>;
    const suco = raw.items.find((i) => i.desc_store_item === 'Suco')!;
    (suco.variations[1] as Record<string, unknown>).promotions = [
      {
        id_partner_sale: 7,
        enabled: true,
        price: 10,
        availabilities: [{ day_week: 2, start_time: '14:00', end_time: '17:00' }],
      },
    ];
    const ps = new Map(
      mapped(saipos, raw)
        .doc.categories.flatMap((c) => c.products)
        .map((p) => [p.name, p]),
    );
    expect(ps.has('Suco')).toBe(false);
    expect(ps.get('Suco — 300 ml')).toMatchObject({ priceCents: 800 });
    expect(ps.get('Suco — 300 ml')!.promoSchedule).toBeUndefined();
    expect(ps.get('Suco — 500 ml')).toMatchObject({
      priceCents: 1200,
      promoSchedule: { priceCents: 1000, windows: [{ days: [1], from: '14:00', to: '17:00' }] },
    });
  });

  test('sale windows: the site channel only, a late one is that day early and late', () => {
    expect(byName.get('Almoço')!.availability).toEqual({
      windows: [{ days: [1, 2, 3, 4, 5], from: '11:00', to: '15:00' }],
      outside: 'hidden',
    });
    // Friday 22:00 → 02:00 there covers Friday 00:00–02:00 and 22:00 on
    expect(byName.get('Lanche da madrugada')!.availability).toEqual({
      windows: [
        { days: [5], from: '00:00', to: '02:00' },
        { days: [5], from: '22:00', to: '23:59' },
      ],
      outside: 'hidden',
    });
    expect(byName.has('Nunca')).toBe(false);
    expect(lostCodes).toContain('Nunca:never_available');
    // one that ends at midnight is that evening only
    const raw = structuredClone(spFixture) as typeof spFixture & Record<string, any>;
    const late = raw.items.find((i) => i.desc_store_item === 'Lanche da madrugada')!;
    late.availability[0]!.end_time = '00:00';
    const p = mapped(saipos, raw).doc.categories.flatMap((c) => c.products);
    expect(p.find((x) => x.name === 'Lanche da madrugada')!.availability).toEqual({
      windows: [{ days: [5], from: '22:00', to: '23:59' }],
      outside: 'hidden',
    });
  });

  test('store: profile, hours, pickup only with a store-wide minimum, payments', () => {
    expect(doc.store).toMatchObject({
      name: 'Pizzaria Exemplo',
      address: 'Rua das Pizzas, 42 - Loja 2 - Centro',
      city: 'Cidade Exemplo',
      logoUrl: 'https://static.saipos.com/saipos-estatico/site-data/1/logo/logo.png',
      brandColor: '#C0392B',
    });
    expect(doc.hours).toEqual([{ days: [0, 1, 2, 3, 4, 5, 6], open: '18:00', close: '23:30' }]);
    expect(doc.operations).toEqual({
      minOrderCents: 2000,
      prepTimeMinutes: 45,
      pickup: true,
      delivery: false,
    });
    expect(doc.payments).toEqual({ methods: ['cash', 'card_on_delivery', 'pix'] });
    expect(
      doc.lost.filter((l) => l.scope === 'store').map((l) => [l.code, l.detail ?? '']),
    ).toEqual([
      ['delivery_by_address', ''],
      ['free_delivery_rule', 'R$ 80,00'],
      ['time_slots', ''],
      ['payment_method', 'Fiado CNPJ …'],
      ['online_payment', ''],
      ['pix_unreadable', ''],
    ]);
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 5,
      products: 14,
      hidden: 2,
      hours: 1,
      zones: 0,
      paymentMethods: 3,
      logo: true,
      cover: true,
    });
  });
});

describe('goomer', () => {
  const { doc, counts } = mapped(goomer, gmFixture, 'pizzariaexemplo');
  const all = doc.categories.flatMap((c) => c.products);
  const byName = new Map(all.map((p) => [p.name, p]));
  const lostCodes = doc.lost.map((l) => `${l.subject ?? ''}:${l.code}`);

  test('recognise: a store subdomain or a www path, not the platform pages', () => {
    const ref = (u: string) => {
      const r = recognise(u);
      return r.kind === 'ok' && r.adapter.platform === 'goomer' ? r.ref : null;
    };
    expect(ref('https://pizzariaexemplo.goomer.app')).toBe('pizzariaexemplo');
    expect(ref('https://www.goomer.app/PizzariaExemplo/produto/1')).toBe('pizzariaexemplo');
    expect(ref('goomer.app/pizzariaexemplo')).toBe('pizzariaexemplo');
    for (const u of [
      'https://www.goomer.app/',
      'https://www.goomer.app/webmenu/pizzariaexemplo/menu/1',
      'https://static.goomer.app/x.png',
      'https://pizzariaexemplo.goomer.app.evil.example/',
    ])
      expect(ref(u)).toBeNull();
  });

  test('read: info, the menu it names, each product lists (a server error asked once more)', async () => {
    const menu = 'https://www.goomer.app/webmenu/pizzariaexemplo/menu/1790000000000';
    const og = (id: number) =>
      `https://mobile.goomer.app/webmenu/pizzariaexemplo/product/${id}/optiongroups/260101000000`;
    let failures = 0;
    const routes: Record<string, unknown> = {
      'https://api-go.goomer.app/v2/establishments/pizzariaexemplo/info': {
        version: '2.0',
        info: gmFixture.info,
        settings: gmFixture.settings,
      },
      [menu]: { products: gmFixture.products },
    };
    gmFixture.products.forEach((p, i) => {
      const g = gmFixture.groups[i];
      if (g) routes[og(p.id)] = { option_groups: g };
    });
    // the first ask for the pizza's lists meets a passing server error
    const pizza = routes[og(100)];
    routes[og(100)] = () =>
      failures++ === 0
        ? new Response('bad gateway', { status: 502 })
        : new Response(JSON.stringify(pizza), { headers: { 'content-type': 'application/json' } });
    const { raw, seen } = await fakeRead(goomer, 'pizzariaexemplo', routes);
    expect(seen).toHaveLength(2 + gmFixture.products.length + 1);
    expect(mapped(goomer, raw).doc.categories).toEqual(doc.categories);
    // the newer menu isn't read; a dormant store is not found
    const info = routes['https://api-go.goomer.app/v2/establishments/pizzariaexemplo/info'] as {
      info: Record<string, unknown>;
      settings: Record<string, unknown>;
    };
    const variant = (patch: (i: typeof info) => void) => {
      const c = structuredClone(info);
      patch(c);
      return { ...routes, 'https://api-go.goomer.app/v2/establishments/pizzariaexemplo/info': c };
    };
    await expect(
      fakeRead(
        goomer,
        'pizzariaexemplo',
        variant((c) => (c.settings.is_abrahao = 'true')),
      ),
    ).rejects.toMatchObject({ code: 'UNREADABLE' });
    await expect(
      fakeRead(goomer, 'pizzariaexemplo', { ...routes, [menu]: { products: [] } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // a menu address off the platform is never followed
    await expect(
      fakeRead(
        goomer,
        'pizzariaexemplo',
        variant((c) => {
          c.info.menu = 'https://evil.example/webmenu/x/menu/1';
          c.settings.menu_url = '';
        }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(fakeRead(goomer, 'outra', routes)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // a block on one product ends the read: nobody asks for another
    let asked = 0;
    const blocked: Record<string, unknown> = { ...routes };
    for (const p of gmFixture.products)
      blocked[og(p.id)] = () => {
        asked++;
        return new Response('slow down', { status: 429 });
      };
    await expect(fakeRead(goomer, 'pizzariaexemplo', blocked)).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    expect(asked).toBeLessThanOrEqual(5);
  });

  test('a read budget of its own, and a lease that outlasts it', async () => {
    expect(goomer.limits).toEqual({ importMs: 150_000, requests: 600 });
    const http = createImportHttp({
      hosts: ['api.example'],
      limits: { requests: 2 },
      fetch: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }),
    });
    await http.json('https://api.example/a');
    await http.json('https://api.example/b');
    await expect(http.json('https://api.example/c')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  test('allowlisted fields only — no token, pixel, store code or hash survives', () => {
    const json = JSON.stringify(doc);
    expect(json).not.toContain('should-not-appear');
    expect(json).not.toContain('4242');
  });

  test('prices: several are one required pick; lists add up; a quantity list repeats', () => {
    expect(doc.categories.map((c) => c.name)).toEqual(['Pizzas', 'Bebidas', 'Lanches']);
    const pizza = byName.get('Pizza')!;
    expect(pizza.priceCents).toBe(4000);
    expect(pizza.optionGroups.map((g) => [g.name, g.min, g.max])).toEqual([
      ['Escolha 1 opção', 1, 1],
      ['Sabores', 1, 2],
      ['Borda', 0, 1],
    ]);
    // Grande, ½ Calabresa ½ Camarão, Catupiry there: 50 + 0 + 10 + 8
    expect(
      unitPriceCents(pizza.priceCents, [
        { pricingRule: 'sum', picks: [{ priceDeltaCents: 1000, qty: 1 }] },
        {
          pricingRule: 'sum',
          picks: [
            { priceDeltaCents: 0, qty: 1 },
            { priceDeltaCents: 1000, qty: 1 },
          ],
        },
        { pricingRule: 'sum', picks: [{ priceDeltaCents: 800, qty: 1 }] },
      ]),
    ).toBe(6800);
    expect(byName.get('Refrigerante')).toMatchObject({
      priceCents: 700,
      optionGroups: [
        { options: [{ name: 'Coca-Cola', priceDeltaCents: 100 }, { priceDeltaCents: 0 }] },
      ],
    });
    expect(byName.get('Hambúrguer')!.optionGroups[0]!.options).toEqual([
      { name: 'Bacon', priceDeltaCents: 400, maxQty: 3 },
      { name: 'Ovo', priceDeltaCents: 250, maxQty: 3 },
    ]);
    // R$ 0 with a required list: its cheapest pick is the starting price
    expect(byName.get('Açaí')).toMatchObject({ priceCents: 1200 });
  });

  test("what hides: lists that wouldn't read, a price that isn't one; +18 is a note", () => {
    expect(byName.get('Sem listas')!.status).toBe('archived');
    expect(lostCodes).toContain('Sem listas:options_unreadable');
    expect(byName.get('Calzone')!.status).toBe('archived');
    expect(byName.get('Preço estranho')!.status).toBe('archived');
    expect(byName.get('Cerveja')!.status).toBe('active');
    expect(lostCodes).toContain('Cerveja:adults_only');
  });

  test('hours: a late close is that day early and late; 00:00–00:00 is all day', () => {
    expect(doc.hours).toEqual([
      { days: [0], open: '00:00', close: '23:59' },
      { days: [2, 3, 4], open: '18:00', close: '23:00' },
      { days: [5, 6], open: '00:00', close: '01:30' },
      { days: [5, 6], open: '18:00', close: '23:59' },
    ]);
    // none at all: always open
    const raw = structuredClone(gmFixture) as typeof gmFixture & Record<string, any>;
    raw.info.hours = [];
    expect(mapped(goomer, raw).doc.hours).toEqual([
      { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' },
    ]);
  });

  test('delivery: distance bands as discs with the delivery minimum; free strictly above', () => {
    expect(doc.zones).toEqual([
      {
        name: 'Até 3 km',
        kind: 'radius',
        maxDistanceKm: 3,
        feeCents: 500,
        etaMin: 30,
        etaMax: 50,
        minOrderCents: 2500,
        freeDeliveryOverCents: 10001,
      },
      {
        name: 'Até 6 km',
        kind: 'radius',
        maxDistanceKm: 6,
        feeCents: 850,
        minOrderCents: 2500,
        freeDeliveryOverCents: 10001,
      },
    ]);
    expect(doc.operations).toEqual({ prepTimeMinutes: 40, pickup: true, delivery: true });
    // one fee for any address, or none set: notes, no zone
    const raw = structuredClone(gmFixture) as typeof gmFixture & Record<string, any>;
    raw.settings.mm_delivery_zone_type = 'static';
    let d = mapped(goomer, raw).doc;
    expect(d.zones).toBeUndefined();
    expect(d.operations?.delivery).toBe(false);
    expect(d.lost).toContainEqual({
      scope: 'store',
      code: 'delivery_flat_fee',
      detail: 'R$ 10,00',
    });
    expect(d.lost).toContainEqual({ scope: 'store', code: 'delivery_minimum', detail: 'R$ 25,00' });
    raw.settings.mm_delivery_zone_options_static = '';
    d = mapped(goomer, raw).doc;
    expect(d.lost).toContainEqual({ scope: 'store', code: 'delivery_fee_later' });
    raw.settings.mm_delivery_zone_type = 'neighborhood';
    expect(mapped(goomer, raw).doc.lost).toContainEqual({
      scope: 'store',
      code: 'delivery_by_address',
    });
  });

  test('store: profile, payments with a CNPJ Pix key, and the notes', () => {
    expect(doc.store).toEqual({
      name: 'Pizzaria Exemplo',
      announcement: { title: 'Pizza no forno a lenha' },
      whatsapp: '5521999990000',
      address: 'Rua das Pizzas, 42 - Loja 2 - Centro',
      city: 'Cidade Exemplo',
      coords: { lat: -22.9, lng: -43.2 },
      logoUrl: 'https://static.goomer.app/stores/1/logo.png',
      brandColor: '#C0392B',
    });
    expect(doc.payments).toEqual({
      methods: ['cash', 'card_on_delivery', 'pix'],
      pix: {
        key: '00.000.000/0001-00',
        type: 'cnpj',
        beneficiary: 'Pizzaria Exemplo',
        city: 'Cidade Exemplo',
      },
    });
    expect(
      doc.lost.filter((l) => l.scope === 'store').map((l) => [l.code, l.detail ?? '']),
    ).toEqual([
      ['delivery_distance_straight_line', ''],
      ['payment_adjustment', 'retirada'],
      ['coupons', ''],
      ['time_slots', ''],
      ['upsell', ''],
      ['online_payment', ''],
    ]);
    // a key only when its shape can't be two things, and Venduá could charge to it
    const raw = structuredClone(gmFixture) as typeof gmFixture & Record<string, any>;
    const pixFor = (key: string) => {
      raw.settings.mm_payment_pix_info = JSON.stringify({ key, accountName: 'X' });
      return mapped(goomer, raw).doc.payments?.pix?.type ?? null;
    };
    expect(pixFor('+55 21 99999-0000')).toBe('phone');
    expect(pixFor('(21) 99999-0000')).toBe('phone');
    expect(pixFor('loja@example.com')).toBe('email');
    expect(pixFor('000.000.000-00')).toBe('cpf');
    expect(pixFor('00000000000100')).toBe('cnpj');
    for (const key of [
      '21999990000', // a CPF or a mobile
      'abcdef1234567890abcdefabcdefabcd', // a random key without its hyphens
      '(011) 98765-4321',
      '(011) 8765-4321', // no area code starts with 0
      '+7 995 123-4567', // another country's number
      '@pizzaria',
      '',
    ])
      expect(pixFor(key)).toBeNull();
    expect(mapped(goomer, raw).doc.lost).toContainEqual({ scope: 'store', code: 'pix_unreadable' });
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 3,
      products: 9,
      hidden: 3,
      zones: 2,
      paymentMethods: 3,
      pix: true,
      logo: true,
    });
  });
});

describe('tokens from one brand colour', () => {
  test('the import base is the template store baseline, and the palette passes AA', async () => {
    const config = (await import('../../../storefronts/_template/vendua.config.ts')).default as {
      tokens: unknown;
    };
    expect(TEMPLATE_TOKENS).toEqual(config.tokens as never);
    for (const c of ['#C0392B', '#FE9F95', '#FFD2D4', '#111111', '#FFFF00'])
      expect(validateTokens(paletteFrom(c, TEMPLATE_TOKENS)).ok).toBe(true);
  });
});

describe('outbound http', () => {
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  const hosts = ['api.example'];

  test('only allowlisted https hosts; an honest user agent; no cookies', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const http = createImportHttp({
      hosts,
      fetch: async (url, init) => {
        seen.push({ url, headers: new Headers(init.headers) });
        return json({ ok: 1 });
      },
    });
    expect(await http.json('https://api.example/store')).toEqual({ ok: 1 });
    expect(seen[0]!.headers.get('user-agent')).toContain('Vendua-Import');
    expect(seen[0]!.headers.get('cookie')).toBeNull();
    for (const bad of [
      'https://other.example/x',
      'http://api.example/x',
      'https://api.example:8443/x',
    ])
      await expect(http.json(bad)).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(seen).toHaveLength(1);
  });

  test('redirects are followed by hand and re-checked', async () => {
    const http = createImportHttp({
      hosts,
      fetch: async (url) =>
        url.endsWith('/a')
          ? new Response(null, { status: 302, headers: { location: '/b' } })
          : url.endsWith('/b')
            ? new Response(null, { status: 301, headers: { location: 'https://169.254.169.254/' } })
            : json({}),
    });
    await expect(http.json('https://api.example/a')).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  test('statuses and challenge pages map to stable failures', async () => {
    const at = (res: () => Response) => createImportHttp({ hosts, fetch: async () => res() });
    await expect(
      at(() => json({}, { status: 404 })).json('https://api.example/x'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    for (const s of [403, 429])
      await expect(
        at(() => json({}, { status: s })).json('https://api.example/x'),
      ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      at(() => new Response('<html>Just a moment...</html>', { status: 200 })).json(
        'https://api.example/x',
      ),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    await expect(
      at(() => new Response('not json', { status: 200 })).json('https://api.example/x'),
    ).rejects.toMatchObject({ code: 'UNREADABLE' });
    await expect(
      at(() => json({}, { status: 500 })).json('https://api.example/x'),
    ).rejects.toMatchObject({ code: 'UNREADABLE' });
  });

  test('response size and request budget are capped', async () => {
    const big = createImportHttp({
      hosts,
      fetch: async () =>
        new Response('x', { headers: { 'content-length': String(6 * 1024 * 1024) } }),
    });
    await expect(big.json('https://api.example/x')).rejects.toMatchObject({ code: 'TOO_LARGE' });
    const streamed = createImportHttp({
      hosts,
      fetch: async () => new Response(new Uint8Array(5 * 1024 * 1024 + 10)),
    });
    await expect(streamed.json('https://api.example/x')).rejects.toMatchObject({
      code: 'TOO_LARGE',
    });
    const budget = createImportHttp({ hosts, maxRequests: 2, fetch: async () => json({}) });
    await budget.json('https://api.example/1');
    await budget.json('https://api.example/2');
    await expect(budget.json('https://api.example/3')).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  test('a hung platform is a TIMEOUT', async () => {
    const http = createImportHttp({
      hosts,
      deadline: Date.now() + 50,
      fetch: (_url, init) =>
        new Promise((_, reject) =>
          init.signal!.addEventListener('abort', () =>
            reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
          ),
        ),
    });
    await expect(http.json('https://api.example/x')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  test('images: jpeg/png/webp by their bytes, ≤ 8 MB, image hosts only', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(sniffImage(jpeg)).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('<svg></svg>'))).toBeNull();
    const ok = await fetchImage('https://cdn.example/a.jpg', ['cdn.example'], {
      fetch: async () => new Response(jpeg),
    });
    expect(ok.type).toBe('image/jpeg');
    await expect(
      fetchImage('https://cdn.example/a.svg', ['cdn.example'], {
        fetch: async () => new Response('<svg/>'),
      }),
    ).rejects.toBeInstanceOf(ImportFailure);
    await expect(
      fetchImage('https://cdn.example/a.jpg', ['cdn.example'], {
        fetch: async () => new Response(new Uint8Array(8 * 1024 * 1024 + 1)),
      }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(
      fetchImage('https://elsewhere.example/a.jpg', ['cdn.example'], {
        fetch: async () => new Response(jpeg),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    // a shared host is narrowed to the platform's own path
    const bucket = ['storage.example/platform-bucket/'];
    const got = await fetchImage('https://storage.example/platform-bucket/x.jpg', bucket, {
      fetch: async () => new Response(jpeg),
    });
    expect(got.type).toBe('image/jpeg');
    for (const u of [
      'https://storage.example/other-bucket/x.jpg',
      'https://storage.example/platform-bucket-2/x.jpg',
    ])
      await expect(
        fetchImage(u, bucket, { fetch: async () => new Response(jpeg) }),
      ).rejects.toMatchObject({ code: 'BLOCKED' });
  });
});
