import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { DETAIL, PRODUCT, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.13 — Core's display numbers: "a partir de" for a product priced by a required list,
// a timed promotion's days and hours by the price, and a filter over long option lists.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
});
const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];
const text = (s: string) => $(s)?.textContent ?? '';
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) ?? null;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function core(over: { catalog?: unknown[]; detail?: unknown; unitCents?: number }) {
  const c = mockCore();
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    if (over.unitCents !== undefined && url.pathname === '/storefront/v1/products/pudim/quote') {
      const qty = Number(url.searchParams.get('qty'));
      return json(200, {
        qty,
        unitPriceCents: over.unitCents,
        lineTotalCents: over.unitCents * qty,
      });
    }
    if (over.catalog && url.pathname === '/storefront/v1/catalog')
      return json(200, {
        categories: [{ id: 'c1', slug: 'doces', name: 'Doces', sort: 1, products: over.catalog }],
      });
    if (over.detail && url.pathname === '/storefront/v1/products/pudim')
      return json(200, { product: over.detail });
    return base(input, init);
  }) as typeof fetch;
  return c;
}

async function type(el: HTMLInputElement, v: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const PASTEL = {
  ...PRODUCT,
  id: 'p2',
  slug: 'pastel',
  name: 'Mini pastéis',
  basePriceCents: 0,
  fromPriceCents: 2290,
};

describe('a partir de', () => {
  test('a card shows Core’s from-price, and its link reads it', async () => {
    const plain = { ...PRODUCT, fromPriceCents: null };
    // a "de" price is the base's: beside a from-price (options included) it isn't shown
    const below = { ...PASTEL, id: 'p3', slug: 'b', name: 'Coxinhas', compareAtPriceCents: 2000 };
    const above = { ...PASTEL, id: 'p4', slug: 'c', name: 'Esfihas', compareAtPriceCents: 3000 };
    core({ catalog: [plain, PASTEL, below, above] });
    m = await mount({ path: '/' });
    await flush();
    const cards = $$('.v-card');
    expect(cards).toHaveLength(4);
    const price = (i: number) => cards[i]!.querySelector('[data-part="price"]')?.textContent ?? '';
    const label = (i: number) => cards[i]!.querySelector('a')?.getAttribute('aria-label') ?? '';
    expect(price(0)).toMatch(/^R\$\s18,00/);
    expect(cards[0]!.querySelector('[data-part="from"]')).toBeNull();
    expect(price(1)).toMatch(/a partir de R\$\s22,90/);
    expect(price(1)).not.toContain('0,00');
    expect(label(1)).toMatch(/^Mini pastéis, a partir de R\$\s22,90$/);
    expect(cards[2]!.querySelector('s')).toBeNull();
    expect(cards[3]!.querySelector('s')).toBeNull();
    expect(label(3)).toMatch(/^Esfihas, a partir de R\$\s22,90$/);
  });

  test('the product page says "a partir de" and leaves R$ 0,00 off the add button', async () => {
    core({
      unitCents: 2590,
      detail: {
        ...DETAIL,
        basePriceCents: 0,
        fromPriceCents: 2290,
        modifierGroups: [
          {
            id: 'g1',
            name: 'Sabor',
            required: true,
            minSelect: 1,
            maxSelect: 1,
            modifiers: [
              { id: 'carne', name: 'Carne', priceDeltaCents: 2290, status: 'active' },
              { id: 'queijo', name: 'Queijo', priceDeltaCents: 2590, status: 'active' },
            ],
          },
        ],
      },
    });
    m = await mount({ path: '/produto/pudim' });
    await flush();
    expect(text('.v-pp-price')).toMatch(/^a partir de R\$\s22,90$/);
    // Kernel 1.14: until a flavour is picked the button shows no amount, never the R$ 0,00
    // base; then Core's price for the line
    expect($('[data-part="add-price"]')?.getAttribute('data-state')).toBe('none');
    expect(text('[data-part="add"]')).not.toContain('R$');
    expect($('[data-part="promo"]')).toBeNull();
    await click(button('Queijo'));
    await act(async () => new Promise((r) => setTimeout(r, 200)));
    await flush();
    expect($('[data-part="add-price"]')?.getAttribute('data-state')).toBe('quote');
    expect(text('[data-part="add-price"]')).toMatch(/R\$\s25,90/);
  });

  // Kernel 1.14: Core serves a combo's from-price; a paid slot item alone no longer makes the
  // page say "a partir de" (it said so even when every valid kit cost the base)
  test('a combo says "a partir de" only with Core’s from-price', async () => {
    const slots = [
      {
        id: 's1',
        name: 'Escolha 2',
        minSelect: 2,
        maxSelect: 2,
        qtyPerItem: 1,
        items: [
          { productId: 'a', name: 'Brigadeiro', priceDeltaCents: 0, status: 'active' },
          { productId: 'b', name: 'Bem-casado', priceDeltaCents: 300, status: 'active' },
        ],
      },
    ];
    core({ detail: { ...DETAIL, kind: 'combo', modifierGroups: [], comboSlots: slots } });
    m = await mount({ path: '/produto/pudim' });
    await flush();
    expect(text('.v-pp-price')).toMatch(/^R\$\s18,00$/);
    m.unmount();
    core({
      detail: {
        ...DETAIL,
        kind: 'combo',
        modifierGroups: [],
        comboSlots: slots,
        fromPriceCents: 2100,
      },
    });
    m = await mount({ path: '/produto/pudim' });
    await flush();
    expect(text('.v-pp-price')).toMatch(/^a partir de R\$\s21,00$/);
  });
});

describe('timed promotion', () => {
  test('its days and hours sit by the price; inside them the regular price is struck', async () => {
    core({
      detail: {
        ...DETAIL,
        basePriceCents: 1500,
        compareAtPriceCents: 1800,
        promoLabel: 'Seg a sex, 18h–20h',
      },
    });
    m = await mount({ path: '/produto/pudim' });
    await flush();
    expect(text('.v-pp-price')).toMatch(/de R\$\s18,00 por R\$\s15,00/);
    expect(text('[data-part="promo"]')).toBe('Promoção: Seg a sex, 18h–20h');
  });
});

const FLAVOURS = [
  'Calabresa',
  'Muçarela',
  'Portuguesa',
  'Frango com catupiry',
  'Marguerita',
  'Quatro queijos',
  'Atum',
  'Bacon',
  'Pepperoni',
  'Napolitana',
  'Palmito',
  'Brócolis',
  'Lombo canadense',
  'Doce de leite',
];

describe('long option lists', () => {
  const pizza = (n: number) => ({
    ...DETAIL,
    modifierGroups: [
      {
        id: 'sabores',
        name: 'Sabores',
        required: true,
        minSelect: 1,
        maxSelect: 2,
        modifiers: FLAVOURS.slice(0, n).map((name, i) => ({
          id: `f${i}`,
          name,
          priceDeltaCents: 0,
          status: 'active',
          ...(name === 'Bacon' ? { description: 'Com cebola roxa.' } : {}),
        })),
      },
    ],
  });

  test('up to 12 options: no filter', async () => {
    core({ detail: pizza(12) });
    m = await mount({ path: '/produto/pudim' });
    await flush();
    expect($('[data-part="option-search"]')).toBeNull();
    expect($$('[data-part="modifier"]')).toHaveLength(12);
  });

  test('more than 12: an accent- and case-free filter that keeps picks', async () => {
    core({ detail: pizza(14) });
    m = await mount({ path: '/produto/pudim' });
    await flush();
    const input = $('[data-part="option-search"] input') as HTMLInputElement;
    expect(input.getAttribute('placeholder')).toBe('Buscar sabor');
    expect(input.getAttribute('aria-label')).toBe('Buscar em Sabores');
    const list = $('.v-mod-list')!;
    expect(input.getAttribute('aria-controls')).toBe(list.id);

    await click(button('Calabresa'));
    expect(button('Calabresa')?.getAttribute('aria-checked')).toBe('true');

    // "MUCARELA" finds Muçarela
    await type(input, 'MUCARELA');
    expect($$('[data-part="modifier"]').map((b) => b.textContent)).toEqual(['Muçarela']);
    const hits = $(`#${CSS.escape(input.getAttribute('aria-describedby')!)}`);
    expect(hits?.getAttribute('role')).toBe('status');
    expect(hits?.textContent).toBe('1 sabor · na sua escolha: Calabresa');

    // words in any order, descriptions count
    await type(input, 'catupiry frango');
    expect($$('[data-part="modifier"]').map((b) => b.textContent)).toEqual(['Frango com catupiry']);
    await type(input, 'cebola');
    expect($$('[data-part="modifier"]')).toHaveLength(1);
    await type(input, 'zzz');
    expect($$('[data-part="modifier"]')).toHaveLength(0);
    expect(hits?.textContent).toContain('Nenhum resultado para “zzz”');

    // Escape clears; the pick made before filtering is still there
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(input.value).toBe('');
    expect(hits?.textContent).toBe('');
    expect($$('[data-part="modifier"]')).toHaveLength(14);
    expect(button('Calabresa')?.getAttribute('aria-checked')).toBe('true');
  });
});
