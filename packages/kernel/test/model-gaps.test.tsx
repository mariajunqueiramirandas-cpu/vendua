import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { DETAIL, PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.12 — the catalog model gaps: promo ("de/por") prices, option quantities, option
// details and group pricing rules, category descriptions, payment-method adjustments and
// the meal voucher, polygon delivery zones.

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

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | null;
function core(extra: Handler) {
  const base = mockCore();
  const fallback = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    const hit = await extra(url, init);
    if (hit) {
      base.calls.push({
        method: init?.method ?? 'GET',
        path: url.pathname + url.search,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return hit;
    }
    return fallback(input, init);
  }) as typeof fetch;
  return base;
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function setValue(sel: string, v: string) {
  const el = $(sel) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const submitForm = () =>
  act(async () =>
    ($('form[data-step]') as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ),
  );

describe('catalog — promo price and category description', () => {
  test('the "de" price is struck through only when it is above the price', async () => {
    const promo = { ...PRODUCT, compareAtPriceCents: 2400 };
    const same = { ...PRODUCT, id: 'p2', slug: 'b', name: 'Brigadeiro', compareAtPriceCents: 1800 };
    const none = { ...PRODUCT, id: 'p3', slug: 'c', name: 'Cocada', compareAtPriceCents: null };
    core((url) =>
      url.pathname === '/storefront/v1/catalog'
        ? json(200, {
            categories: [
              {
                id: 'c1',
                slug: 'doces',
                name: 'Doces',
                sort: 1,
                description: 'Feitos no dia, em porções individuais.',
                products: [promo, same, none],
              },
            ],
          })
        : null,
    );
    m = await mount({ path: '/' });
    await flush();
    const cards = $$('.v-card');
    expect(cards).toHaveLength(3);
    const struck = cards[0]!.querySelector('s[data-part="compare-at"]');
    expect(struck?.textContent).toContain('24,00');
    // read aloud as "de R$ 24,00 por R$ 18,00"
    expect(cards[0]!.querySelector('[data-part="price"]')?.textContent).toMatch(
      /de R\$\s24,00 por R\$\s18,00/,
    );
    expect(cards[0]!.querySelector('a')?.getAttribute('aria-label')).toMatch(
      /Pudim, de R\$\s24,00 por R\$\s18,00/,
    );
    expect(cards[1]!.querySelector('s')).toBeNull();
    expect(cards[2]!.querySelector('s')).toBeNull();
    const desc = $('[data-part="category-description"]');
    expect(desc?.textContent).toBe('Feitos no dia, em porções individuais.');
    expect(desc?.previousElementSibling?.classList.contains('v-cat-title')).toBe(true);
  });
});

const FLAVOURS = {
  id: 'g2',
  name: 'Coberturas',
  required: false,
  minSelect: 0,
  maxSelect: 4,
  pricingRule: 'most_expensive',
  modifiers: [
    {
      id: 'calda',
      name: 'Calda',
      priceDeltaCents: 300,
      status: 'active',
      maxQty: 3,
      description: 'De caramelo.',
      imageUrl: '/v1/media/calda.webp',
    },
    { id: 'coco', name: 'Coco', priceDeltaCents: 200, status: 'active', maxQty: 3 },
    { id: 'nozes', name: 'Nozes', priceDeltaCents: 500, status: 'active' },
  ],
};

describe('product page — options with quantities', () => {
  test('a stepper clamps to maxQty and to what the group leaves; units ride the add', async () => {
    const detail = { ...DETAIL, compareAtPriceCents: 2200, modifierGroups: [FLAVOURS] };
    const c = core((url) =>
      url.pathname === '/storefront/v1/products/pudim' ? json(200, { product: detail }) : null,
    );
    m = await mount({ path: '/produto/pudim' });
    await flush();
    // promo price on the page
    expect(text('[data-section] [data-part="price"], .v-pp-price')).toMatch(
      /de R\$\s22,00 por R\$\s18,00/,
    );
    // option details and the group's rule (Core's data, never a client price)
    expect(text('[data-part="option-description"]')).toBe('De caramelo.');
    expect($('img[data-part="option-image"]')?.getAttribute('src')).toBe('/v1/media/calda.webp');
    expect(text('[data-part="pricing-rule"]')).toBe('Vale o preço da opção mais cara.');
    // maxQty 1 stays a toggle
    expect(button('Nozes')?.getAttribute('role')).toBe('checkbox');

    const steppers = $$('[data-part="option-qty"]');
    expect(steppers).toHaveLength(2);
    const [calda, coco] = steppers as HTMLElement[];
    const plus = (el: HTMLElement) => el.querySelectorAll('button')[1] as HTMLButtonElement;
    const minus = (el: HTMLElement) => el.querySelectorAll('button')[0] as HTMLButtonElement;
    expect(minus(calda!).disabled).toBe(true);
    for (let i = 0; i < 5; i++) await click(plus(calda!));
    expect(calda!.querySelector('output')?.textContent).toBe('3');
    expect(plus(calda!).disabled).toBe(true);
    // the group takes 4 units: one more coco, then the group is full
    await click(plus(coco!));
    expect(coco!.querySelector('output')?.textContent).toBe('1');
    expect(plus(coco!).disabled).toBe(true);
    expect((button('Nozes') as HTMLButtonElement).disabled).toBe(true);
    await click(minus(calda!));
    expect(calda!.querySelector('output')?.textContent).toBe('2');
    // a priced option is on: the add button leaves the total to Core's cart line
    const add = $('[data-part="add"]') as HTMLButtonElement;
    expect(add.querySelector('.v-pp-add-price')).toBeNull();
    await click(add);
    await flush();
    const body = c.calls.find((x) => x.path === '/checkout/v1/cart/items')?.body as {
      modifierIds: string[];
      modifiers?: { id: string; qty: number }[];
    };
    expect(body.modifierIds.sort()).toEqual(['calda', 'coco']);
    expect(body.modifiers).toEqual([{ id: 'calda', qty: 2 }]);
  });

  test('without a priced option the button keeps its price; no modifiers array is sent', async () => {
    const c = core(() => null);
    m = await mount({ path: '/produto/pudim' });
    await flush();
    await click(button('Pequeno'));
    expect(text('.v-pp-add-price')).toContain('18,00');
    await click($('[data-part="add"]'));
    await flush();
    const body = c.calls.find((x) => x.path === '/checkout/v1/cart/items')?.body as Record<
      string,
      unknown
    >;
    expect(body.modifierIds).toEqual(['m1']);
    expect('modifiers' in body).toBe(false);
  });
});

const ADJ_STORE = {
  ...STORE,
  paymentMethods: ['pix', 'card_on_delivery', 'meal_voucher', 'cash'],
  paymentAdjustments: { pix: { percentBps: -500 }, cash: { fixedCents: 150 } },
};
const cart = (adjustment = 0) => ({
  id: 'cart',
  status: 'open',
  items: [
    {
      id: 'line',
      productId: PRODUCT.id,
      slug: 'pudim',
      name: 'Pudim',
      qty: 1,
      unitPriceCents: 4700,
      productStatus: 'active',
      modifiers: [],
      lineTotalCents: 4700,
    },
  ],
  totals: {
    subtotalCents: 4700,
    deliveryFeeCents: 0,
    discountCents: 0,
    paymentAdjustmentCents: adjustment,
    totalCents: 4700 + adjustment,
    itemCount: 1,
    minOrderCents: 0,
    remainingMinOrderCents: 0,
    belowMinOrder: false,
  },
  delivery: { mode: 'pickup' },
});
const ADJ: Record<string, number> = { pix: -235, cash: 150 };

describe('checkout — payment adjustments and the meal voucher', () => {
  test('labels each rule, shows Core’s adjustment line (hidden at 0) and its total', async () => {
    const c = core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ADJ_STORE);
      if (url.pathname === '/checkout/v1/cart') {
        const method = url.searchParams.get('paymentMethod') ?? '';
        return json(200, { cart: cart(ADJ[method] ?? 0) });
      }
      if (url.pathname === '/checkout/v1/cart/delivery') return json(200, { cart: cart() });
      if (url.pathname === '/checkout/v1/checkout')
        return json(201, {
          order: {
            id: '77777777-7777-4777-8777-777777777777',
            number: 9,
            state: 'placed',
            customer: { name: 'Ana', phone: '22999990001' },
            delivery: {
              mode: 'pickup',
              etaMin: null,
              etaMax: null,
              address: null,
              feeCents: 0,
              neighborhood: null,
            },
            payment: { method: 'meal_voucher', status: 'pending', provider: 'sandbox' },
            subtotalCents: 4700,
            deliveryFeeCents: 0,
            totalCents: 4700,
            placedAt: '2026-10-01T12:00:00Z',
            timeline: [],
          },
        });
      return null;
    });
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      setValue('#checkout-name', 'Ana');
      setValue('#checkout-phone', '(22) 99999-0001');
    });
    await submitForm();
    await click($('input[value="pickup"]'));
    // before the payment step nothing asks for a method's price
    expect(c.calls.some((x) => x.path.includes('paymentMethod='))).toBe(false);
    await submitForm();
    await flush();

    const chip = (id: string) =>
      $(`input[value="${id}"]`)?.closest('label')?.querySelector('[data-part="adjustment"]');
    expect(chip('pix')?.textContent).toContain('−5%');
    expect(chip('pix')?.getAttribute('data-kind')).toBe('discount');
    expect(chip('cash')?.textContent).toMatch(/\+R\$\s1,50/);
    expect(chip('cash')?.getAttribute('data-kind')).toBe('surcharge');
    expect(chip('card_on_delivery')).toBeNull();
    expect($('input[value="meal_voucher"]')?.closest('label')?.textContent).toContain(
      'Vale-refeição',
    );

    // pix (the default): Core's −R$ 2,35 is its own line and the total is Core's
    expect(c.calls.some((x) => x.path === '/checkout/v1/cart?paymentMethod=pix')).toBe(true);
    expect(text('[data-part="payment-adjustment"]')).toMatch(/Desconto · Pix.*−R\$\s2,35/);
    expect(text('[data-vendua="total"]')).toMatch(/R\$\s44,65/);
    expect(button('Confirmar pedido')?.textContent).toMatch(/44,65/);

    await click($('input[value="cash"]'));
    await flush();
    expect(text('[data-part="payment-adjustment"]')).toMatch(/Acréscimo · Dinheiro.*\+R\$\s1,50/);
    expect(text('[data-vendua="total"]')).toMatch(/R\$\s48,50/);

    // no rule → Core answers 0 → no line
    await click($('input[value="meal_voucher"]'));
    await flush();
    expect($('[data-part="payment-adjustment"]')).toBeNull();
    expect(text('[data-vendua="total"]')).toMatch(/R\$\s47,00/);

    await submitForm();
    await flush();
    expect(c.calls.find((x) => x.path === '/checkout/v1/checkout')?.body).toMatchObject({
      payment: { method: 'meal_voucher' },
    });
  });
});

describe('checkout — polygon zones', () => {
  test('a store with only drawn zones offers "usar minha localização"', async () => {
    const nav = navigator as Navigator & { geolocation?: unknown };
    const had = Object.getOwnPropertyDescriptor(nav, 'geolocation');
    Object.defineProperty(nav, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: () => {} },
    });
    try {
      core((url) => {
        if (url.pathname === '/storefront/v1/zones')
          return json(200, {
            zones: [
              {
                id: 'z1',
                name: 'Centro',
                neighborhoods: [],
                feeCents: 500,
                minOrderCents: 0,
                etaMin: 30,
                etaMax: 45,
                kind: 'polygon',
                polygon: [
                  [-22.9, -42.5],
                  [-22.9, -42.4],
                  [-22.8, -42.4],
                ],
              },
            ],
          });
        if (url.pathname === '/checkout/v1/cart') return json(200, { cart: cart() });
        return null;
      });
      m = await mount({ path: '/checkout', session: 'tok' });
      await act(async () => {
        setValue('#checkout-name', 'Ana');
        setValue('#checkout-phone', '(22) 99999-0001');
      });
      await submitForm();
      await flush();
      expect($('[data-part="locate"]')).not.toBeNull();
      expect(button('Usar minha localização')).not.toBeNull();
    } finally {
      if (had) Object.defineProperty(nav, 'geolocation', had);
      else delete (nav as { geolocation?: unknown }).geolocation;
    }
  });
});
