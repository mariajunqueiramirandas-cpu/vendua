import { describe, expect, test } from 'bun:test';
import { paletteFrom, validateTokens } from '@vendua/templates';
import fixture from './fixtures/menu-import/instadelivery.json';
import { recognise } from '../src/modules/menu-import/adapters/index.ts';
import { instadelivery } from '../src/modules/menu-import/adapters/instadelivery.ts';
import { TEMPLATE_TOKENS } from '../src/modules/menu-import/apply.ts';
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
    const wide = one(prod({ optionGroups: [group(41)] }));
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
    expect(normalizeWhatsapp('+55 (22) 98144-8322')).toBe('22981448322');
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

  test('anota.ai and iFood are blocked; known platforms without an adapter are named', () => {
    expect(recognise('https://pedido.anota.ai/loja/x')).toEqual({
      kind: 'blocked',
      platform: 'anotaai',
    });
    expect(recognise('https://www.ifood.com.br/delivery/rio-de-janeiro-rj/x/abc')).toEqual({
      kind: 'blocked',
      platform: 'ifood',
    });
    expect(recognise('https://app.cardapioweb.com/loja')).toEqual({
      kind: 'unsupported',
      platform: 'cardapioweb',
    });
    expect(recognise('https://pizzaria.goomer.app')).toEqual({
      kind: 'unsupported',
      platform: 'goomer',
    });
    expect(recognise('https://minha-loja.com.br')).toEqual({ kind: 'unsupported', platform: null });
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
    expect(doc.categories.map((c) => c.name)).toEqual(['BOLOS', 'AÇAÍ']);
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

  test('pizza flavour list charges the dearest flavour — exactly', () => {
    const pizza = byName.get('Pizza doce')!;
    expect(pizza.status).toBe('active');
    expect(pizza.priceCents).toBe(4990);
    expect(pizza.optionGroups[0]).toMatchObject({ pricingRule: 'most_expensive', min: 1, max: 2 });
    const deltas = pizza.optionGroups[0]!.options.map((o) => o.priceDeltaCents);
    // two flavours: base + the dearest delta = the dearest flavour's price on the old store
    expect(pizza.priceCents + Math.max(...deltas)).toBe(5990);
  });

  test('prices we cannot reproduce exactly are imported hidden, with the reason', () => {
    expect(byName.get('Bolo dois preços')!.status).toBe('archived');
    expect(byName.get('Item estranho')!.status).toBe('archived');
    expect(byName.get('Promo misteriosa')!.status).toBe('archived');
    expect(codes('product')).toEqual(
      expect.arrayContaining([
        'Bolo dois preços:second_price',
        'Item estranho:options_unreadable',
        'Promo misteriosa:promo_unreadable',
      ]),
    );
  });

  test('store: profile, colour, hours with shifts and past midnight, delivery, payments', () => {
    expect(doc.store).toMatchObject({
      name: 'Doceria Exemplo',
      tagline: 'Doces e bolos',
      whatsapp: '21999990000',
      instagram: '@doceria.exemplo',
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
    expect(doc.zones).toEqual([
      {
        name: 'Taxa R$ 5,00',
        kind: 'neighborhood',
        feeCents: 500,
        neighborhoods: ['Centro', 'Jardim'],
        etaMin: 30,
        etaMax: 40,
      },
      { name: 'Taxa R$ 8,50', kind: 'neighborhood', feeCents: 850, neighborhoods: ['Vila Nova'] },
    ]);
    expect(doc.payments).toEqual({
      methods: ['cash', 'pix', 'card_on_delivery', 'meal_voucher'],
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
        ':payment_adjustment',
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
      fees: [],
      feesKm: [
        { km: 3, price: 5, price_free: 0, no_delivery: 0, estimate: '20-30' },
        { km: 5, price: 0, price_free: 0, no_delivery: 1, estimate: null },
        { km: 8, price: 9.5, price_free: 0, no_delivery: 0, estimate: null },
        { km: 12, price: 0, price_free: 0, no_delivery: 1, estimate: null },
        { km: 20, price: 0, price_free: 0, no_delivery: 1, estimate: null },
      ],
    };
    const m = validateDoc(instadelivery.map(raw, source)).doc;
    expect(m.zones).toEqual([
      { name: 'Até 3 km', kind: 'radius', feeCents: 500, maxDistanceKm: 3, etaMin: 20, etaMax: 30 },
      { name: 'Até 8 km', kind: 'radius', feeCents: 950, maxDistanceKm: 8 },
    ]);
    const gaps = m.lost.filter((l) => l.code === 'delivery_gap');
    expect(gaps).toEqual([{ scope: 'store', code: 'delivery_gap', detail: '5' }]);
    expect(m.lost.map((l) => l.code)).toContain('delivery_distance_straight_line');
  });

  test('counts', () => {
    expect(counts).toMatchObject({
      categories: 2,
      products: 11,
      hidden: 3,
      photos: 11,
      optionGroups: 4,
      hours: 4,
      zones: 2,
      paymentMethods: 4,
      pix: true,
      logo: true,
      cover: true,
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
  });
});
