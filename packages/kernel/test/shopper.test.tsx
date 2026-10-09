import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TemplateSet } from '@vendua/templates';
import { createApi } from '../src/api.ts';
import { useCustomer, type CustomerProfile } from '../src/hooks.ts';
import { arrangeMenu, dietaryBadges, matchProduct } from '../src/rules/index.ts';
import { DETAIL, PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.21 — shopper conveniences: the bag and past orders outlive the tab, diet tags, the
// delivery fee before the delivery step, a checkout that survives a reload, saved addresses,
// the returning shopper's last order, the order page's way to the store, jump navigation,
// sharing a product, focus on route change, the offline banner and loading skeletons.

let m: Mounted | null = null;
let nav: ReturnType<typeof useNavigate>;
let customer: ReturnType<typeof useCustomer>;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
});

const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];
// money and phones carry no-break spaces
const text = (s: string) => ($(s)?.textContent ?? '').replace(/\u00a0/g, ' ');
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Grab() {
  nav = useNavigate();
  customer = useCustomer();
  return null;
}

type Answer = unknown | { status: number; body: unknown };
type Route = Answer | ((url: URL, init?: RequestInit) => Answer);
const isStatus = (a: unknown): a is { status: number; body: unknown } =>
  !!a && typeof a === 'object' && 'status' in a && 'body' in a;

/** mockCore with some routes answered here (a function sees the request) */
function core(routes: Record<string, Route>) {
  const c = mockCore();
  const base = globalThis.fetch;
  const seen: { path: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    if (url.pathname in routes) {
      seen.push({ path: url.pathname + url.search, ...(init ? { init } : {}) });
      const r = routes[url.pathname];
      const a = typeof r === 'function' ? (r as (u: URL, i?: RequestInit) => Answer)(url, init) : r;
      return isStatus(a) ? json(a.status, a.body) : json(200, a);
    }
    return base(input, init);
  }) as typeof fetch;
  return { ...c, seen };
}

const LINE = {
  id: 'line-1',
  productId: PRODUCT.id,
  slug: 'pudim',
  name: 'Pudim',
  qty: 1,
  unitPriceCents: 1800,
  productStatus: 'active',
  modifiers: [],
  lineTotalCents: 1800,
};
const totals = (over: Record<string, unknown> = {}) => ({
  subtotalCents: 1800,
  deliveryFeeCents: 0,
  totalCents: 1800,
  itemCount: 1,
  minOrderCents: 0,
  remainingMinOrderCents: 0,
  belowMinOrder: false,
  ...over,
});
const OPEN_CART = { id: 'cart', status: 'open', items: [LINE], totals: totals(), delivery: null };
const ZONE = {
  id: 'z1',
  name: 'Centro',
  neighborhoods: ['Centro'],
  feeCents: 500,
  minOrderCents: 2000,
  etaMin: 30,
  etaMax: 50,
  kind: 'neighborhood',
  freeDeliveryOverCents: 8000,
};

const ORDER_ID = '77777777-7777-4777-8777-777777777777';
const order = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  number: 12,
  state: 'preparing',
  customer: { name: 'Ana', phone: '22999990001' },
  delivery: { mode: 'pickup', etaMin: null, etaMax: null, address: null, feeCents: 0 },
  payment: { method: 'cash', status: 'pending', instructions: null },
  subtotalCents: 1800,
  deliveryFeeCents: 0,
  totalCents: 1800,
  placedAt: '2026-10-01T15:00:00Z',
  timeline: [],
  items: [
    {
      productId: PRODUCT.id,
      slug: 'pudim',
      name: 'Pudim',
      qty: 2,
      unitPriceCents: 900,
      modifiers: [],
      combo: [],
      lineTotalCents: 1800,
    },
  ],
  version: 3,
  ...over,
});

const DIET_CATALOG = {
  categories: [
    {
      id: 'c1',
      slug: 'doces',
      name: 'Doces',
      sort: 1,
      products: [
        { ...PRODUCT, dietary: ['vegano', 'sem_gluten', 'contem_castanhas'] },
        {
          ...PRODUCT,
          id: '22222222-2222-4222-8222-222222222222',
          slug: 'brigadeiro',
          name: 'Brigadeiro',
          dietary: ['contem_lactose'],
        },
      ],
    },
    {
      id: 'c2',
      slug: 'salgados',
      name: 'Salgados',
      sort: 2,
      products: [
        {
          ...PRODUCT,
          id: '33333333-3333-4333-8333-333333333333',
          slug: 'coxinha',
          name: 'Coxinha',
          dietary: ['apimentado'],
        },
      ],
    },
  ],
};

describe('the bag and past orders outlive the tab', () => {
  test('the cart session lives in localStorage; a legacy tab token moves over', async () => {
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem('vendua.session', 'old-tab');
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const p = new URL(String(input), 'http://shop.test').pathname;
      calls.push(`${init?.method ?? 'GET'} ${p}`);
      if (p === '/checkout/v1/cart')
        return json(200, { cart: { ...OPEN_CART, status: 'completed' } });
      if (p === '/checkout/v1/session')
        return json(201, { sessionToken: 'fresh', cart: OPEN_CART });
      return json(404, { error: { code: 'NOT_FOUND', message: p } });
    }) as typeof fetch;
    const api = createApi();
    expect(api.sessionToken).toBe('old-tab');
    // a completed cart starts a fresh one quietly
    await api.ensureSession();
    expect(localStorage.getItem('vendua.session')).toBe('fresh');
    expect(sessionStorage.getItem('vendua.session')).toBeNull();
    // another tab rotating the device's cart is seen on the next call
    localStorage.setItem('vendua.session', 'other-tab');
    expect(api.sessionToken).toBe('other-tab');
  });

  test('order tokens: kept on the device, the newest 20, a refused one dropped', async () => {
    sessionStorage.clear();
    localStorage.clear();
    const old: Record<string, string> = {};
    for (let i = 0; i < 20; i++) old[`order-${i}`] = `vst.${i}`;
    localStorage.setItem('vendua.orderTokens', JSON.stringify(old));
    localStorage.setItem('vendua.session', 'vst.cart');
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const p = new URL(String(input), 'http://shop.test').pathname;
      if (p === '/checkout/v1/checkout') return json(201, { order: order() });
      if (p === '/checkout/v1/session')
        return json(201, { sessionToken: 'vst.next', cart: OPEN_CART });
      if (p === '/checkout/v1/orders/order-5')
        return json(404, { error: { code: 'ORDER_NOT_FOUND', message: 'gone' } });
      return json(404, { error: { code: 'NOT_FOUND', message: p } });
    }) as typeof fetch;
    const api = createApi();
    await api.checkout({
      customer: { name: 'Ana', phone: '22999990001' },
      delivery: { mode: 'pickup' },
      payment: { method: 'cash' },
    });
    const kept = JSON.parse(localStorage.getItem('vendua.orderTokens')!) as Record<string, string>;
    expect(Object.keys(kept)).toHaveLength(20);
    expect(kept[ORDER_ID]).toBe('vst.cart');
    expect(kept['order-0']).toBeUndefined();
    expect(api.orderIds()[0]).toBe(ORDER_ID);
    // a fresh device (another createApi, a later visit) still opens it
    expect(createApi().orderIds()).toContain(ORDER_ID);
    await api.order('order-5').catch(() => {});
    expect(api.orderIds()).not.toContain('order-5');
  });

  test('a cart Core no longer knows reads as an empty bag and forgets the token', async () => {
    core({
      '/checkout/v1/cart': {
        status: 401,
        body: { error: { code: 'SESSION_REQUIRED', message: 'x' } },
      },
    });
    m = await mount({ path: '/sacola', session: 'stale' });
    expect($('[data-vendua="empty-cart"]')).not.toBeNull();
    expect(localStorage.getItem('vendua.session')).toBeNull();
  });
});

describe('allergen and diet tags', () => {
  test('rules: badges in words, diets filter, search finds a diet', () => {
    expect(dietaryBadges({ dietary: ['contem_ovo', 'zzz', 'vegano'] })).toEqual([
      { tag: 'vegano', label: 'Vegano', kind: 'diet' },
      { tag: 'contem_ovo', label: 'Contém ovo', kind: 'allergen' },
    ]);
    const cats = DIET_CATALOG.categories as never;
    expect(
      arrangeMenu(cats, { dietary: ['vegano'] }).flatMap((c) => c.products.map((p) => p.slug)),
    ).toEqual(['pudim']);
    expect(matchProduct({ name: 'Bolo', dietary: ['sem_gluten'] }, 'Doces', 'sem gluten')).toBe(
      true,
    );
    // an allergen warning isn't a diet: searching "lactose" doesn't list what contains it
    expect(matchProduct({ name: 'Bolo', dietary: ['contem_lactose'] }, 'Doces', 'lactose')).toBe(
      false,
    );
  });

  test('cards show diets, the grid filters by them, the product page lists all', async () => {
    core({
      '/storefront/v1/catalog': DIET_CATALOG,
      '/storefront/v1/products/pudim': {
        product: { ...DETAIL, dietary: ['vegano', 'contem_castanhas'] },
      },
    });
    m = await mount({ path: '/', children: <Grab /> });
    const chips = $$('[data-part="diet-filter"] .v-chip').map((b) => b.textContent);
    // only diets some product states; never an allergen
    expect(chips).toEqual(['Vegano', 'Sem glúten']);
    expect(text('.v-card [data-part="dietary"]')).toContain('Vegano');
    expect(text('.v-card [data-part="dietary"]')).not.toContain('castanhas');
    expect($('a[aria-label^="Pudim, vegano, sem glúten"]')).not.toBeNull();
    await click($$('[data-part="diet-filter"] .v-chip')[0]!);
    expect($$('.v-card [data-part="name"]').map((n) => n.textContent)).toEqual(['Pudim']);
    expect(text('#v-catalog-hits')).toBe('1 resultado');
    await act(async () => void nav('/produto/pudim'));
    await flush();
    expect(
      $$(
        '[data-section="sdk:purchase-panel"] [data-part="dietary"] li, .v-pp [data-part="dietary"] li',
      ).map((li) => li.getAttribute('data-kind')),
    ).toEqual(['diet', 'allergen']);
  });
});

describe('jump navigation', () => {
  test("categoryNav 'jump' keeps every category and links each tab to it", async () => {
    core({ '/storefront/v1/catalog': DIET_CATALOG });
    m = await mount({
      path: '/',
      snapshot: {
        home: {
          version: 1,
          page: 'home',
          sections: [{ id: 'c', type: 'sdk:catalog-grid', settings: { categoryNav: 'jump' } }],
        },
      } as TemplateSet,
    });
    const tabs = $$('[data-part="tabs"][data-mode="jump"] a');
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual([
      '#categoria-doces',
      '#categoria-salgados',
    ]);
    expect($('#categoria-doces')).not.toBeNull();
    expect($('#categoria-salgados')).not.toBeNull();
    let scrolled = '';
    ($('#categoria-salgados') as HTMLElement).scrollIntoView = function (this: HTMLElement) {
      scrolled = this.id;
    };
    await click(tabs[1]!);
    expect(scrolled).toBe('categoria-salgados');
    expect(tabs[1]!.getAttribute('aria-current')).toBe('true');
  });

  test('the default stays filter tabs', async () => {
    core({ '/storefront/v1/catalog': DIET_CATALOG });
    m = await mount({
      path: '/',
      snapshot: {
        home: { version: 1, page: 'home', sections: [{ id: 'c', type: 'sdk:catalog-grid' }] },
      } as TemplateSet,
    });
    expect($('[data-part="tabs"] button[aria-pressed="true"]')?.textContent).toBe('Tudo');
  });
});

describe('the delivery fee before the delivery step', () => {
  test('a CEP is looked up and quoted on this cart: Core’s fee and total', async () => {
    const c = core({
      '/checkout/v1/cart': { cart: OPEN_CART },
      '/storefront/v1/zones': { zones: [ZONE] },
      '/storefront/v1/cep/28990000': {
        address: {
          cep: '28990000',
          street: 'Rua A',
          neighborhood: 'Centro',
          city: 'Saquarema',
          state: 'RJ',
        },
        zone: { eligible: true, feeCents: 500 },
      },
      '/checkout/v1/quote': {
        eligible: true,
        feeCents: 500,
        etaMin: 30,
        etaMax: 50,
        totals: totals({
          deliveryFeeCents: 500,
          totalCents: 2300,
          minOrderCents: 2000,
          remainingMinOrderCents: 200,
          belowMinOrder: true,
          freeDeliveryRemainingCents: 6200,
        }),
      },
    });
    m = await mount({ path: '/sacola', session: 'tok' });
    const input = $('input[name="estimate-cep"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '28990-000',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      ($('[data-part="form"]') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    await flush();
    expect(text('[data-vendua="delivery-estimate"] [data-part="fee"]')).toContain('R$ 5,00');
    expect(text('[data-vendua="delivery-estimate"] [data-part="total"]')).toContain('R$ 23,00');
    expect(text('[data-vendua="delivery-estimate"] [data-part="min-order"]')).toContain(
      'faltam R$ 2,00',
    );
    expect(text('[data-vendua="delivery-estimate"] [data-part="free-delivery"]')).toContain(
      'R$ 62,00',
    );
    const q = c.seen.find((x) => x.path === '/checkout/v1/quote')!;
    expect(JSON.parse(String(q.init?.body))).toEqual({ neighborhood: 'Centro' });
    expect((q.init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  test('a remembered bairro is quoted by itself', async () => {
    core({
      '/checkout/v1/cart': { cart: OPEN_CART },
      '/storefront/v1/zones': { zones: [ZONE] },
      '/checkout/v1/quote': { eligible: false, reason: 'OUT_OF_ZONE' },
    });
    m = await mount({ path: '/', session: 'tok', children: <Grab /> });
    act(() =>
      customer.remember({
        name: 'Ana',
        phone: '22999990001',
        address: { street: 'Rua B', number: '2', neighborhood: 'Longe', complement: '' },
      }),
    );
    await act(async () => void nav('/sacola'));
    await flush();
    expect(text('[data-part="out"]')).toContain('Longe fica fora da área de entrega');
    act(() => customer.forget());
  });

  test('sdk:delivery-eta says the minimum order and the free-delivery threshold', async () => {
    core({ '/storefront/v1/zones': { zones: [ZONE] } });
    m = await mount({
      path: '/produto/pudim',
      snapshot: {
        product: {
          version: 1,
          page: 'product',
          sections: [
            {
              id: 'p',
              type: 'sdk:purchase-panel',
              blocks: { 'after-price': [{ id: 'eta', type: 'sdk:delivery-eta' }] },
            },
          ],
        },
      } as TemplateSet,
    });
    expect(text('[data-part="terms"]')).toBe('Pedido mínimo R$ 20,00 · grátis acima de R$ 80,00');
  });
});

describe('avise-me when the store opens', () => {
  test('a closed store offers it (subject store), with when it opens', async () => {
    const c = core({
      '/storefront/v1/store': { ...STORE, status: 'closed', resumesAt: '2099-01-01T12:00:00Z' },
      '/checkout/v1/notify-me': { subscribed: true },
    });
    m = await mount({
      path: '/produto/pudim',
      snapshot: {
        product: {
          version: 1,
          page: 'product',
          sections: [
            {
              id: 'p',
              type: 'sdk:purchase-panel',
              blocks: { 'after-cta': [{ id: 'n', type: 'sdk:notify-me' }] },
            },
          ],
        },
      } as TemplateSet,
    });
    expect(text('.v-notify label')).toBe('Estamos fechados agora. Quer um aviso quando abrir?');
    expect(text('.v-notify [data-part="when"]')).toContain('Abre');
    const input = $('#v-notify-phone') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input,
        '22999990001',
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click($('[data-vendua="notify-me"]'));
    await flush();
    const sent = c.seen.find((x) => x.path === '/checkout/v1/notify-me')!;
    expect(JSON.parse(String(sent.init?.body))).toEqual({ subject: 'store', phone: '22999990001' });
  });
});

describe('the checkout keeps its answers', () => {
  const fill = (name: string, value: string) => {
    const input = $(`input[name="${name}"]`) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const submit = (step: string) =>
    act(async () =>
      ($(`form[data-step="${step}"]`) as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );

  test('a reload lands on the same step with what was typed; placing the order clears it', async () => {
    const routes = {
      '/checkout/v1/cart': { cart: OPEN_CART },
      '/checkout/v1/cart/delivery': { cart: OPEN_CART },
      '/checkout/v1/checkout': { order: order({ state: 'placed' }) },
      [`/checkout/v1/orders/${ORDER_ID}`]: { order: order({ state: 'placed' }) },
    };
    core(routes);
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      fill('name', 'Ana');
      fill('phone', '22999990001');
    });
    await submit('dados');
    await flush();
    await act(async () => {
      fill('neighborhood', 'Centro');
      fill('street', 'Rua A');
      fill('number', '10');
      fill('reference', 'Portão azul');
    });
    expect(sessionStorage.getItem('vendua.checkoutDraft')).toContain('Portão azul');
    m.unmount();
    // the reload: same tab storage, the browser keeps the step entry
    core(routes);
    m = await mount({
      entries: [
        '/',
        { pathname: '/checkout', state: { vStep: 'entrega', vStepN: 1, vFrom: 'dados' } },
      ],
      keep: true,
    });
    expect($('form[data-step="entrega"]')).not.toBeNull();
    expect(($('input[name="street"]') as HTMLInputElement).value).toBe('Rua A');
    expect(($('input[name="reference"]') as HTMLInputElement).value).toBe('Portão azul');
    await submit('entrega');
    await flush();
    await submit('pagamento');
    await flush();
    expect(sessionStorage.getItem('vendua.checkoutDraft')).toBeNull();
  });

  test('saved addresses: up to three, the newest first, picked to fill the form', async () => {
    core({ '/checkout/v1/cart': { cart: OPEN_CART } });
    m = await mount({ path: '/', session: 'tok', children: <Grab /> });
    const at = (street: string, n: string): CustomerProfile => ({
      name: 'Ana',
      phone: '22999990001',
      address: {
        street,
        number: n,
        neighborhood: 'Centro',
        complement: '',
        reference: `perto ${n}`,
      },
    });
    act(() => {
      for (const [s, n] of [
        ['Rua A', '1'],
        ['Rua B', '2'],
        ['Rua C', '3'],
        ['Rua D', '4'],
        ['Rua B', '2'],
      ] as const)
        customer.remember(at(s, n));
    });
    expect(customer.customer?.addresses?.map((a) => a.street)).toEqual(['Rua B', 'Rua D', 'Rua C']);
    // a pickup keeps them
    act(() =>
      customer.remember({
        ...at('', ''),
        address: { street: '', number: '', neighborhood: '', complement: '' },
      }),
    );
    expect(customer.customer?.addresses).toHaveLength(3);
    await act(async () => void nav('/checkout'));
    await flush();
    await submit('dados');
    await flush();
    const options = $$('[data-part="saved-address"]');
    expect(options.map((o) => o.textContent)).toEqual([
      'Rua B, 2 — Centroperto 2',
      'Rua D, 4 — Centroperto 4',
      'Rua C, 3 — Centroperto 3',
      'Outro endereço',
    ]);
    expect(($('input[name="saved-address"]:checked') as HTMLInputElement).value).toBe('0');
    await click(options[2]!.querySelector('input'));
    expect(($('input[name="street"]') as HTMLInputElement).value).toBe('Rua C');
    expect(($('input[name="reference"]') as HTMLInputElement).value).toBe('perto 3');
    await click(options[3]!.querySelector('input'));
    expect(($('input[name="street"]') as HTMLInputElement).value).toBe('');
    act(() => customer.forget());
  });
});

describe('the returning shopper', () => {
  const home = {
    home: {
      version: 1,
      page: 'home',
      sections: [
        {
          id: 'c',
          type: 'sdk:catalog-grid',
          blocks: { 'before-grid': [{ id: 'r', type: 'sdk:recent-order' }] },
        },
      ],
    },
  } as TemplateSet;

  test('nothing on a device with no order', async () => {
    mockCore();
    m = await mount({ path: '/', snapshot: home });
    expect($('.v-recent-order')).toBeNull();
  });

  test('an order still running: follow it', async () => {
    core({ [`/checkout/v1/orders/${ORDER_ID}`]: { order: order() } });
    m = await mount({
      path: '/',
      snapshot: home,
      local: { 'vendua.orderTokens': JSON.stringify({ [ORDER_ID]: 'vst.o' }) },
    });
    expect(text('.v-recent-order [data-part="summary"]')).toContain('Pedido #12');
    expect(text('.v-recent-order [data-part="summary"]')).toContain('Em preparo');
    expect($(`.v-recent-order a[href="/pedido/${ORDER_ID}"]`)?.textContent).toBe(
      'Acompanhar pedido',
    );
  });

  test('a finished one: order it again', async () => {
    const c = core({
      [`/checkout/v1/orders/${ORDER_ID}`]: { order: order({ state: 'delivered' }) },
      '/checkout/v1/cart/reorder': { cart: OPEN_CART, report: { added: 1, skipped: [] } },
    });
    m = await mount({
      path: '/',
      snapshot: home,
      local: { 'vendua.orderTokens': JSON.stringify({ [ORDER_ID]: 'vst.o' }) },
    });
    expect(text('.v-recent-order [data-part="items"]')).toBe('2× Pudim');
    await click($('.v-recent-order [data-part="reorder"]'));
    await flush();
    expect(c.seen.some((x) => x.path === '/checkout/v1/cart/reorder')).toBe(true);
  });
});

describe('the order page', () => {
  test('always offers the store’s WhatsApp; the state is in the tab title', async () => {
    core({ [`/checkout/v1/orders/${ORDER_ID}`]: { order: order() } });
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    const wa = $('[data-vendua="order-whatsapp"]') as HTMLAnchorElement;
    expect(wa.href).toContain('wa.me/5522999990000');
    expect(decodeURIComponent(wa.href)).toContain('pedido #12');
    expect(document.title).toBe('Pedido #12 · Em preparo · Loja Teste');
  });

  test('loads with its shape, not a blank box', async () => {
    let release = () => {};
    core({
      [`/checkout/v1/orders/${ORDER_ID}`]: () => {
        throw new Error('unused');
      },
    });
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes(`/orders/${ORDER_ID}`)) {
        await new Promise<void>((r) => (release = r));
        return json(200, { order: order() });
      }
      return base(input, init);
    }) as typeof fetch;
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    expect($('[data-vendua="order-skeleton"][aria-busy="true"]')).not.toBeNull();
    await act(async () => release());
    await flush();
    expect($('[data-vendua="order-skeleton"]')).toBeNull();
  });
});

describe('a product can be shared', () => {
  test('the share sheet with the product’s own link', async () => {
    mockCore();
    const shared: ShareData[] = [];
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (d: ShareData) => void shared.push(d),
    });
    try {
      m = await mount({ path: '/produto/pudim' });
      await click($('[data-part="share"]'));
      expect(shared[0]?.url).toBe('http://shop.test/produto/pudim');
      expect(shared[0]?.title).toBe('Pudim');
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });
});

describe('accessibility and loading', () => {
  test('a new page takes focus on its heading and is announced', async () => {
    core({ '/checkout/v1/cart': { cart: OPEN_CART } });
    m = await mount({ path: '/', session: 'tok', children: <Grab /> });
    await act(async () => void nav('/sacola'));
    await flush();
    await wait(20);
    expect(document.activeElement?.tagName).toBe('H1');
    expect(document.activeElement?.textContent).toBe('Sacola');
    expect(text('[data-vendua="route-announcer"]')).toBe('Sacola · Loja Teste');
  });

  test('the first load leaves focus alone', async () => {
    mockCore();
    m = await mount({ path: '/sacola' });
    await wait(20);
    expect(text('[data-vendua="route-announcer"]')).toBe('');
  });

  test('offline: a banner until the connection is back', async () => {
    mockCore();
    m = await mount({ path: '/' });
    let online = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    try {
      await act(async () => void window.dispatchEvent(new Event('offline')));
      expect(text('[data-vendua="banner-stack"]')).toContain('Você está sem internet');
      online = true;
      await act(async () => void window.dispatchEvent(new Event('online')));
      expect(text('[data-vendua="banner-stack"]')).not.toContain('sem internet');
    } finally {
      delete (navigator as { onLine?: unknown }).onLine;
    }
  });

  test('the bag loads with its shape', async () => {
    let release = () => {};
    mockCore();
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), 'http://shop.test').pathname === '/checkout/v1/cart') {
        await new Promise<void>((r) => (release = r));
        return json(200, { cart: OPEN_CART });
      }
      return base(input, init);
    }) as typeof fetch;
    m = await mount({ path: '/sacola', session: 'tok' });
    expect($('[data-vendua="cart-skeleton"][aria-busy="true"]')).not.toBeNull();
    await act(async () => release());
    await flush();
    expect($('[data-vendua="cart-skeleton"]')).toBeNull();
  });
});
