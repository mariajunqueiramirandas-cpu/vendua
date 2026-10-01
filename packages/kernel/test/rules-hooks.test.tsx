import { afterEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';
import {
  ProductImage,
  ProductPrice,
  QrCode,
  qrMatrix,
  useCardState,
  useLineQuote,
  useNotices,
  useStoreStatus,
  type CardState,
  type LinePicks,
} from '../src/index.ts';
import { PRODUCT, STORE, flush, mockCore, mount, type MockCore, type Mounted } from './harness.tsx';

// Kernel 1.14 — the rules bound to live data: card state after the bag, the status line from
// Core's instants, Core's line quote, and notices inside their window.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** mockCore with some routes answered differently */
function core(routes: Record<string, unknown>, over: Partial<MockCore> = {}) {
  const c = mockCore(over);
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    if (url.pathname in routes) {
      c.calls.push({ method: init?.method ?? 'GET', path: url.pathname + url.search });
      return json(200, routes[url.pathname]);
    }
    return base(input, init);
  }) as typeof fetch;
  return c;
}

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

describe('useCardState', () => {
  test('low stock on what the bag leaves, by Core’s threshold', async () => {
    const tracked = {
      ...PRODUCT,
      stockQuantity: 5,
      lowStockThreshold: 2,
      lowStock: false,
      needsChoices: false,
    };
    core({
      '/checkout/v1/cart': {
        cart: {
          id: 'cart',
          status: 'open',
          items: [
            {
              id: 'i1',
              productId: PRODUCT.id,
              slug: 'pudim',
              name: 'Pudim',
              qty: 3,
              unitPriceCents: 1800,
              productStatus: 'active',
              modifiers: [],
              lineTotalCents: 5400,
            },
          ],
          totals: {
            subtotalCents: 5400,
            deliveryFeeCents: 0,
            totalCents: 5400,
            itemCount: 3,
            minOrderCents: 0,
            remainingMinOrderCents: 0,
            belowMinOrder: false,
          },
          delivery: null,
        },
      },
    });
    const seen: CardState[] = [];
    function Probe() {
      seen.push(useCardState(tracked as Parameters<typeof useCardState>[0]));
      return null;
    }
    m = await mount({ path: '/nada', session: 'tok', children: <Probe /> });
    await flush();
    expect(seen.at(-1)).toMatchObject({
      stockLeft: 2,
      lowStock: true,
      badge: 'low-stock',
      canQuickAdd: true,
      maxQty: 2,
    });
  });
});

describe('useStoreStatus', () => {
  test('Core’s closesAt as the line, in the store’s zone', async () => {
    const closesAt = new Date(Date.now() + 2 * 3_600_000).toISOString();
    core({ '/storefront/v1/store': { ...STORE, status: 'open', closesAt } });
    let s: ReturnType<typeof useStoreStatus> | undefined;
    function Probe() {
      s = useStoreStatus();
      return null;
    }
    m = await mount({ path: '/nada', children: <Probe /> });
    await flush();
    const hhmm = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(closesAt));
    expect(s).toMatchObject({
      status: 'open',
      closesAt,
      hint: { kind: 'open-until', at: closesAt },
      label: `Aberto até ${hhmm}`,
      timeZone: 'America/Sao_Paulo',
      loading: false,
    });
  });

  test('a manual close with no time says only "Fechado"', async () => {
    core({ '/storefront/v1/store': { ...STORE, status: 'closed' } });
    let s: ReturnType<typeof useStoreStatus> | undefined;
    function Probe() {
      s = useStoreStatus();
      return null;
    }
    m = await mount({ path: '/nada', children: <Probe /> });
    await flush();
    expect(s?.hint).toEqual({ kind: 'closed' });
    expect(s?.label).toBe('Fechado');
  });
});

describe('useLineQuote', () => {
  let set: ((next: { qty: number; picks: LinePicks }) => void) | null = null;
  let last: ReturnType<typeof useLineQuote> | null = null;
  function Probe() {
    const [line, setLine] = useState<{ qty: number; picks: LinePicks }>({
      qty: 1,
      picks: { modifiers: [{ id: 'm2' }] },
    });
    set = setLine;
    last = useLineQuote({ slug: 'pudim' }, line.picks, line.qty);
    return null;
  }
  const quotes = (c: MockCore) => c.calls.filter((x) => x.path.includes('/quote'));

  test('debounced, the newest configuration only, the last answer kept while pending', async () => {
    const c = mockCore();
    m = await mount({ path: '/nada', children: <Probe /> });
    expect(last).toMatchObject({ pending: true, quote: null, error: null });
    await wait(200);
    expect(last).toEqual({
      quote: { qty: 1, unitPriceCents: 2600, lineTotalCents: 2600 },
      pending: false,
      error: null,
    });
    expect(quotes(c).map((x) => x.path)).toEqual([
      '/storefront/v1/products/pudim/quote?qty=1&modifiers=m2:1',
    ]);

    // three quick changes: one request, for the last one; the old quote stays meanwhile
    await act(async () => set!({ qty: 2, picks: { modifiers: [{ id: 'm2' }] } }));
    await act(async () => set!({ qty: 3, picks: { modifiers: [{ id: 'm2' }] } }));
    await act(async () => set!({ qty: 3, picks: { modifiers: [{ id: 'm2', qty: 2 }] } }));
    expect(last!.pending).toBe(true);
    expect(last!.quote?.lineTotalCents).toBe(2600);
    await wait(200);
    expect(quotes(c)).toHaveLength(2);
    expect(quotes(c)[1]!.path).toBe('/storefront/v1/products/pudim/quote?qty=3&modifiers=m2:2');
    expect(last).toEqual({
      quote: { qty: 3, unitPriceCents: 3400, lineTotalCents: 10200 },
      pending: false,
      error: null,
    });
  });

  test('a refusal is the error code, never thrown', async () => {
    mockCore({
      quote: () => ({ status: 422, body: { error: { code: 'MODIFIER_REQUIRED', message: 'x' } } }),
    });
    m = await mount({ path: '/nada', children: <Probe /> });
    await wait(200);
    expect(last).toEqual({ quote: null, pending: false, error: 'MODIFIER_REQUIRED' });
  });

  test('kit picks ride the query', async () => {
    const c = mockCore({
      quote: () => ({ status: 200, body: { qty: 1, unitPriceCents: 1, lineTotalCents: 1 } }),
    });
    m = await mount({ path: '/nada', children: <Probe /> });
    await act(async () =>
      set!({
        qty: 1,
        picks: { comboSelections: [{ slotId: 's1', productId: 'p9', qty: 2 }] },
      }),
    );
    await wait(200);
    expect(quotes(c).at(-1)!.path).toBe('/storefront/v1/products/pudim/quote?qty=1&combo=s1:p9:2');
  });
});

describe('useNotices', () => {
  test('only notices inside their window; blocking by the forward-compatible rule', async () => {
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
          notice('now'),
          notice('expired', { endsAt: at(-hour) }),
          notice('later', { startsAt: at(hour) }),
          notice('emergency', { kind: 'emergency', severity: 'loud', payload: { region: 'x' } }),
        ],
      },
    });
    let n: ReturnType<typeof useNotices> | undefined;
    function Probe() {
      n = useNotices();
      return null;
    }
    m = await mount({ path: '/nada', children: <Probe /> });
    await flush();
    expect(n!.notices.map((x) => x.id)).toEqual(['now', 'emergency']);
    expect(n!.blocking.map((x) => x.id)).toEqual(['emergency']);
  });
});

describe('display components', () => {
  test('ProductPrice: the form, the struck price, the promotion', async () => {
    mockCore();
    m = await mount({
      path: '/nada',
      children: (
        <>
          <ProductPrice
            product={{
              basePriceCents: 1800,
              compareAtPriceCents: 2400,
              promoLabel: 'Sex, 18h–20h',
            }}
            className="mine"
          />
          <ProductPrice
            product={{ basePriceCents: 0, fromPriceCents: 2290, compareAtPriceCents: 3000 }}
          />
        </>
      ),
    });
    const [promo, from] = [...document.querySelectorAll('[data-vendua="product-price"]')];
    expect(promo!.getAttribute('data-form')).toBe('promo');
    expect(promo!.className).toBe('mine');
    expect(promo!.querySelector('[data-part="struck"]')!.textContent).toMatch(/^de R\$\s24,00$/);
    expect(promo!.querySelector('[data-part="amount"]')!.textContent).toMatch(/^R\$\s18,00$/);
    expect(promo!.querySelector('[data-part="promo"]')!.textContent).toBe('Promoção: Sex, 18h–20h');
    expect(from!.getAttribute('data-form')).toBe('from');
    expect(from!.querySelector('[data-part="struck"]')).toBeNull();
    expect(from!.querySelector('[data-part="amount"]')!.textContent).toMatch(
      /^a partir de R\$\s22,90$/,
    );
  });

  test('ProductImage: Core’s srcset, the morph source, the fallback on error', async () => {
    mockCore();
    m = await mount({
      path: '/nada',
      children: (
        <>
          <ProductImage
            product={{ slug: 'pudim', name: 'Pudim', imageUrl: '/v1/media/t/pudim.jpg' }}
            fallback={<span data-test="fallback">P</span>}
          />
          <ProductImage
            product={{ slug: 'sem', name: 'Sem foto', imageUrl: null }}
            fallback={<span data-test="none">S</span>}
          />
        </>
      ),
    });
    const img = document.querySelector('img[data-vt-src="product:pudim"]') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('Pudim');
    expect(img.getAttribute('srcset')).toContain('/v1/media/t/pudim.jpg?w=320 320w');
    expect(document.querySelector('[data-test="none"]')).not.toBeNull();
    await act(async () => img.dispatchEvent(new Event('error')));
    expect(document.querySelector('img[data-vt-src="product:pudim"]')).toBeNull();
    expect(document.querySelector('[data-test="fallback"]')).not.toBeNull();
  });

  test('QrCode: the Kernel’s encoder, inline', async () => {
    mockCore();
    m = await mount({
      path: '/nada',
      children: <QrCode value="https://loja.test/cardapio" size={120} title="QR do cardápio" />,
    });
    const svg = document.querySelector('svg[data-vendua="qr-code"]')!;
    const n = qrMatrix('https://loja.test/cardapio').length + 8;
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${n} ${n}`);
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('aria-label')).toBe('QR do cardápio');
    expect(svg.querySelector('path')!.getAttribute('d')).toMatch(/^M\d/);
  });
});
