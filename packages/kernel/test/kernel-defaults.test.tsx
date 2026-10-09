import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { StoreStatusBadge, SurfaceRegion } from '../src/index.ts';
import type { TemplateSet } from '@vendua/templates';
import { DETAIL, STORE, flush, mockCore, mount, type MockCore, type Mounted } from './harness.tsx';

// Kernel 1.14 — the Kernel's own defaults decide through the rules or Core: the add button
// shows Core's price for the line, low stock and delivery fees follow Core's numbers, the
// funnel counts what Core charged, each page names itself, notices keep their window.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
});

const $ = (s: string) => document.querySelector(s);
const text = (s: string) => $(s)?.textContent ?? '';
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** mockCore with some routes answered differently (a function sees the request) */
function core(
  routes: Record<string, unknown | ((url: URL, init?: RequestInit) => unknown)>,
  over: Partial<MockCore> = {},
) {
  const c = mockCore(over);
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    if (url.pathname in routes) {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      c.calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search, body });
      const r = routes[url.pathname];
      return json(200, typeof r === 'function' ? r(url, init) : r);
    }
    return base(input, init);
  }) as typeof fetch;
  return c;
}

const productPage = (blocks: unknown[]) =>
  ({
    product: {
      version: 1,
      page: 'product',
      sections: [{ id: 'purchase', type: 'sdk:purchase-panel', blocks: { 'after-price': blocks } }],
    },
  }) as unknown as TemplateSet;

const events = () =>
  (
    (globalThis as { __VENDUA_EVENTS__?: { name: string; props: Record<string, unknown> }[] })
      .__VENDUA_EVENTS__ ?? []
  ).filter((e) => e.name === 'add_to_cart');

describe('purchase panel — Core’s price for the line', () => {
  test('an amount only once Core priced these picks at this qty, never base × qty', async () => {
    const c = mockCore({
      quote: (_slug, q) => {
        const qty = Number(q.get('qty'));
        return { status: 200, body: { qty, unitPriceCents: 2161, lineTotalCents: 2161 * qty } };
      },
    });
    m = await mount({ path: '/produto/pudim' });
    const price = () => $('[data-part="add-price"]') as HTMLElement;
    // the required size isn't picked: no quote asked, no amount (one unit's price isn't the line's)
    expect(price().getAttribute('data-state')).toBe('none');
    expect(price().textContent).toBe('');
    expect(c.calls.some((x) => x.path.includes('/quote'))).toBe(false);
    await click($('[role="radio"]'));
    await click($('[aria-label="Aumentar quantidade"]'));
    // asked, not answered yet
    expect(price().getAttribute('data-state')).toBe('pending');
    expect(price().textContent).toBe('');
    await wait(250);
    await flush();
    expect(price().getAttribute('data-state')).toBe('quote');
    expect(price().textContent).toMatch(/R\$\s43,22/);
    expect(price().textContent).not.toContain('36,00');
    const asked = c.calls.filter((x) => x.path.includes('/quote')).at(-1)!.path;
    expect(asked).toContain('qty=2');
    expect(asked).toContain('modifiers=m1:1');
    // another qty: the last total is stale, so no amount until Core prices the new one
    await click($('[aria-label="Aumentar quantidade"]'));
    expect(price().getAttribute('data-state')).toBe('pending');
    expect(price().textContent).toBe('');
    await wait(250);
    await flush();
    expect(price().textContent).toMatch(/R\$\s64,83/);
  });

  test('a refused quote shows no amount', async () => {
    mockCore({
      quote: () => ({ status: 409, body: { error: { code: 'SOLD_OUT', message: 'x' } } }),
    });
    m = await mount({ path: '/produto/pudim' });
    await click($('[role="radio"]'));
    await wait(250);
    await flush();
    expect($('[data-part="add-price"]')?.getAttribute('data-state')).toBe('none');
    expect(text('[data-part="add-price"]')).toBe('');
    expect(text('[data-part="add"]')).not.toContain('R$');
  });
});

describe('AddToCart — the funnel counts what Core charged', () => {
  test('add_to_cart value is Core’s `added.lineTotalCents`; without it, no value', async () => {
    let withAdded = true;
    core({
      '/checkout/v1/cart/items': () => ({
        cart: { id: 'cart', status: 'open', items: [], totals: { itemCount: 1 } },
        ...(withAdded
          ? { added: { itemId: 'i1', qty: 1, unitPriceCents: 2600, lineTotalCents: 2600 } }
          : {}),
      }),
    });
    m = await mount({ path: '/produto/pudim', config: { paths: {} } });
    const before = events().length;
    // the priced option: base 1800 + 800, priced by Core — the old value was base × qty
    await click([...document.querySelectorAll('[role="radio"]')][1]!);
    await click($('[data-vendua="add-to-cart"]'));
    await flush();
    const first = events().slice(before);
    expect(first).toHaveLength(1);
    expect(first[0]!.props.value).toBe(2600);

    withAdded = false;
    m.unmount();
    m = await mount({ path: '/produto/pudim' });
    const mark = events().length;
    await click($('[role="radio"]'));
    await click($('[data-vendua="add-to-cart"]'));
    await flush();
    const second = events().slice(mark);
    expect(second).toHaveLength(1);
    expect('value' in second[0]!.props).toBe(false);
  });
});

describe('SDK blocks over the rules', () => {
  test('StockCounter follows Core’s low stock, not its own threshold setting', async () => {
    const page = productPage([
      { id: 'stock', type: 'sdk:stock-counter', settings: { threshold: 50 } },
    ]);
    // 8 left, Core's threshold 3: plenty — the block's old threshold (50) would say "Restam 8"
    core(
      {
        '/storefront/v1/products/pudim': {
          product: { ...DETAIL, stockQuantity: 8, lowStockThreshold: 3, lowStock: false },
        },
      },
      { templates: page },
    );
    m = await mount({ path: '/produto/pudim' });
    expect($('.v-stock')).toBeNull();
    m.unmount();

    core(
      {
        '/storefront/v1/products/pudim': {
          product: { ...DETAIL, stockQuantity: 3, lowStockThreshold: 3, lowStock: true },
        },
      },
      { templates: page },
    );
    m = await mount({ path: '/produto/pudim' });
    expect(text('.v-stock')).toBe('Restam 3 unidades');
    expect($('.v-stock')?.getAttribute('data-tone')).toBe('low');
  });

  test('DeliveryEta: a per-km zone with no base fee is never "grátis"', async () => {
    core(
      {
        '/storefront/v1/zones': {
          zones: [
            {
              id: 'z1',
              name: 'Raio',
              neighborhoods: [],
              feeCents: 0,
              minOrderCents: 0,
              etaMin: 30,
              etaMax: 50,
              kind: 'radius',
              maxDistanceKm: 8,
              feePerKmCents: 150,
              // Core's floor: the first km
              minFeeCents: 150,
            },
          ],
        },
      },
      { templates: productPage([{ id: 'eta', type: 'sdk:delivery-eta' }]) },
    );
    m = await mount({ path: '/produto/pudim' });
    const line = text('.v-eta');
    expect(line).toMatch(/^Entrega a partir de R\$\s1,50 · 30–50 min · Retirada em ~30 min$/);
    expect(line).not.toContain('grátis');
  });
});

describe('document title per page', () => {
  const meta = (attr: 'name' | 'property', key: string) => {
    const el = document.createElement('meta');
    el.setAttribute(attr, key);
    el.setAttribute('content', 'from index.html');
    document.head.appendChild(el);
    return el;
  };

  test('store pages, the product page and the Kernel pages each name themselves', async () => {
    const description = meta('name', 'description');
    const ogTitle = meta('property', 'og:title');
    try {
      core({
        '/storefront/v1/store': { ...STORE, tagline: 'Doces finos', description: 'Da Rua A.' },
      });
      m = await mount({ path: '/' });
      expect(document.title).toBe('Loja Teste — Doces finos');
      expect(description.getAttribute('content')).toBe('Da Rua A.');
      expect(ogTitle.getAttribute('content')).toBe('Loja Teste — Doces finos');
      m.unmount();

      core({ '/storefront/v1/store': { ...STORE, tagline: 'Doces finos' } });
      m = await mount({ path: '/produto/pudim' });
      expect(document.title).toBe('Pudim · Loja Teste');
      expect(description.getAttribute('content')).toBe('Lisinho.');
      m.unmount();

      for (const [path, title] of [
        ['/sacola', 'Sacola · Loja Teste'],
        ['/checkout', 'Finalizar pedido · Loja Teste'],
        ['/pedidos', 'Meus pedidos · Loja Teste'],
      ] as const) {
        mockCore();
        m = await mount({ path });
        expect(document.title).toBe(title);
        m.unmount();
      }
      m = null;
    } finally {
      description.remove();
      ogTitle.remove();
    }
  });

  test('the order page names the order', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    core({
      [`/checkout/v1/orders/${id}`]: {
        order: {
          id,
          number: 42,
          state: 'placed',
          customer: { name: 'Ana', phone: '22999990001' },
          delivery: { mode: 'pickup', etaMin: null, etaMax: null, address: null, feeCents: 0 },
          payment: { method: 'cash', status: 'pending', instructions: null },
          subtotalCents: 1800,
          deliveryFeeCents: 0,
          totalCents: 1800,
          placedAt: '2026-09-30T12:00:00Z',
          timeline: [],
          version: 1,
        },
      },
    });
    m = await mount({ path: `/pedido/${id}` });
    // Kernel 1.21: the state rides in the tab title
    expect(document.title).toBe('Pedido #42 · Recebido · Loja Teste');
  });
});

describe('notices keep their window', () => {
  test('SystemSurfaces and SurfaceRegion show only notices inside startsAt/endsAt', async () => {
    const hour = 3_600_000;
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    const notice = (id: string, over: Record<string, unknown> = {}) => ({
      id,
      kind: 'info',
      severity: 'info',
      title: id,
      dismissible: true,
      priority: 1,
      ...over,
    });
    mockCore({
      surfaces: {
        version: 1,
        store: { status: 'open' },
        notices: [
          notice('agora'),
          notice('passou', { endsAt: at(-hour) }),
          notice('depois', { startsAt: at(hour) }),
          notice('regiao-agora', { payload: { region: 'hero' } }),
          notice('regiao-passou', { payload: { region: 'hero' }, endsAt: at(-hour) }),
        ],
      },
    });
    m = await mount({ path: '/', children: <SurfaceRegion name="hero" /> });
    const stack = text('[data-vendua="banner-stack"]');
    expect(stack).toContain('agora');
    expect(stack).not.toContain('passou');
    expect(stack).not.toContain('depois');
    const region = text('[data-vendua="surface-region"]');
    expect(region).toContain('regiao-agora');
    expect(region).not.toContain('regiao-passou');
  });
});

describe('StoreStatusBadge', () => {
  test('the store’s own words per status; Core’s moment in the title; parts', async () => {
    const closesAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    core({ '/storefront/v1/store': { ...STORE, closesAt } });
    m = await mount({
      path: '/nowhere',
      children: (
        <>
          <StoreStatusBadge />
          <StoreStatusBadge labels={{ open: 'Estamos abertos' }} />
        </>
      ),
    });
    // the last two: the layout's header may carry its own badge
    const [plain, custom] = [...document.querySelectorAll('[data-vendua="store-status"]')].slice(
      -2,
    ) as HTMLElement[];
    expect(plain!.querySelector('[data-part="label"]')?.textContent).toBe('Aberto');
    expect(custom!.querySelector('[data-part="label"]')?.textContent).toBe('Estamos abertos');
    expect(custom!.getAttribute('data-status')).toBe('open');
    expect(custom!.getAttribute('data-hint')).toBe('open-until');
    expect(custom!.getAttribute('title')).toMatch(/^Aberto até \d\d:\d\d$/);
  });
});
