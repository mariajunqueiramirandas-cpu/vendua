import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { DETAIL, PRODUCT, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.2 (roadmap Phase 2): kits, live orders, share links, cross-device history.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
});
const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];

const SLOT = '22222222-2222-4222-8222-222222222222';
const A = '33333333-3333-4333-8333-333333333333';
const B = '44444444-4444-4444-8444-444444444444';
const ORDER_ID = '55555555-5555-4555-8555-555555555555';

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | null;

/** mockCore plus per-test routes (checked first). */
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

const order = (version: number, state: string) => ({
  id: ORDER_ID,
  number: 7,
  state,
  customer: { name: 'Ana', phone: '22999990001' },
  delivery: {
    mode: 'pickup',
    etaMin: null,
    etaMax: null,
    address: null,
    feeCents: 0,
    neighborhood: null,
  },
  payment: {
    method: 'pix',
    status: 'pending',
    provider: 'sandbox',
    instructions: 'Pague no Pix',
    pix: {
      key: 'loja@x.com',
      keyType: 'email',
      beneficiary: 'LOJA',
      copyPaste:
        '00020101021226300014br.gov.bcb.pix0110loja@x.com5204000053039865406100.005802BR5904LOJA6006CIDADE62070503***6304ABCD',
    },
  },
  subtotalCents: 10000,
  deliveryFeeCents: 0,
  discountCents: 0,
  totalCents: 10000,
  placedAt: '2026-09-27T12:00:00Z',
  timeline: [{ at: '2026-09-27T12:00:00Z', from: null, to: 'placed', actor: 'customer', meta: {} }],
  items: [
    {
      productId: PRODUCT.id,
      slug: 'pudim',
      name: 'Pudim',
      qty: 2,
      unitPriceCents: 5000,
      modifiers: [],
      combo: [],
      lineTotalCents: 10000,
    },
  ],
  notes: 'Sem granulado',
  version,
});

describe('kits (combo products)', () => {
  test('add stays disabled until every slot is filled; picks ride the add call', async () => {
    const kit = {
      ...DETAIL,
      modifierGroups: [],
      slug: 'kit',
      name: 'Kit festa',
      kind: 'combo',
      comboSlots: [
        {
          id: SLOT,
          name: 'Sabores',
          minSelect: 2,
          maxSelect: 2,
          qtyPerItem: 2,
          items: [
            {
              productId: A,
              slug: 'a',
              name: 'Coco',
              priceDeltaCents: 0,
              status: 'active',
              stockQuantity: null,
              imageUrl: null,
            },
            {
              productId: B,
              slug: 'b',
              name: 'Maracujá',
              priceDeltaCents: 0,
              status: 'sold_out',
              stockQuantity: 0,
              imageUrl: null,
            },
          ],
        },
      ],
    };
    const c = core((url) =>
      url.pathname === '/storefront/v1/products/kit' ? json(200, { product: kit }) : null,
    );
    m = await mount({ path: '/produto/kit' });
    const add = $('[data-vendua="add-to-cart"]') as HTMLButtonElement;
    expect($('[data-vendua="combo-picker"]')).not.toBeNull();
    expect(add.disabled).toBe(true);
    expect($('[data-part="missing"]')?.textContent).toContain('2 em Sabores');
    const plus = $('[aria-label="mais Coco"]') as HTMLButtonElement;
    expect(($('[aria-label="mais Maracujá"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => plus.click());
    await act(async () => plus.click());
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    await flush();
    const post = c.calls.find((x) => x.path === '/checkout/v1/cart/items');
    expect(post?.body).toEqual({
      productId: DETAIL.id,
      qty: 1,
      modifierIds: [],
      comboSelections: [{ slotId: SLOT, productId: A, qty: 2 }],
    });
  });
});

describe('live order (Kernel-owned SSE, long-poll fallback)', () => {
  test("SSE: the order page streams Core's events and re-renders on each new version", async () => {
    const enc = new TextEncoder();
    let streams = 0;
    let push: (frame: string) => void = () => {};
    const c = core((url, init) => {
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/events`) {
        streams++;
        const body = new ReadableStream<Uint8Array>({
          start(ctrl) {
            push = (f) => ctrl.enqueue(enc.encode(f));
            // current order (already seen → ignored), a heartbeat, then a change
            push(`event: order\nid: 1\ndata: ${JSON.stringify(order(1, 'placed'))}\n\n`);
            push(':ka\n\n');
            init?.signal?.addEventListener('abort', () =>
              ctrl.error(new DOMException('x', 'AbortError')),
            );
          },
        });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, { order: order(1, 'placed') });
      return null;
    });
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(4);
    expect(streams).toBe(0);
    await act(async () => new Promise((r) => setTimeout(r, 1700)));
    await flush(6);
    expect(streams).toBe(1);
    const call = c.calls.find((x) => x.path.endsWith('/events'));
    expect(call).toBeDefined();
    await act(async () =>
      push(`event: order\nid: 2\ndata: ${JSON.stringify(order(2, 'confirmed'))}\n\n`),
    );
    await flush(6);
    expect($('[data-vendua="order-status"]')?.getAttribute('data-state')).toBe('confirmed');
    // a frame split across chunks still parses
    const frame = `event: order\nid: 3\ndata: ${JSON.stringify(order(3, 'preparing'))}\n\n`;
    await act(async () => push(frame.slice(0, 40)));
    await act(async () => push(frame.slice(40)));
    await flush(6);
    expect($('[data-vendua="order-status"]')?.getAttribute('data-state')).toBe('preparing');
    // one stream carried every update — no reconnect per version, no long poll
    expect(streams).toBe(1);
    expect(c.calls.some((x) => x.path.includes('wait='))).toBe(false);
  });

  test('fallback: a Core without the stream route gets the long poll', async () => {
    let waits = 0;
    const c = core((url, init) => {
      if (url.pathname !== `/checkout/v1/orders/${ORDER_ID}`) return null;
      const since = url.searchParams.get('since');
      if (since === null) return json(200, { order: order(1, 'placed') });
      waits++;
      if (since === '1') return json(200, { order: order(2, 'confirmed'), changed: true });
      // since=2: hold until the page unmounts (abort)
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
      );
    });
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    // the first wait opens after the page settles (network-idle friendly)
    await flush(4);
    expect(waits).toBe(0);
    await act(async () => new Promise((r) => setTimeout(r, 1700)));
    await flush(10);
    expect($('[data-vendua="order-status"]')?.getAttribute('data-state')).toBe('confirmed');
    expect(c.calls.some((x) => x.path.endsWith('?since=1&wait=25'))).toBe(true);
    expect(waits).toBe(2);
    // items, notes and the Pix copia e cola render from the order
    expect($('[data-vendua="order-items"]')?.textContent).toContain('2× Pudim');
    expect($('[data-vendua="order-items"]')?.textContent).toContain('Sem granulado');
    expect(($('#v-pix-code') as HTMLTextAreaElement).value).toStartWith('000201');
    expect($('[data-vendua="pix"] svg path')).not.toBeNull();
  });
});

describe('links + cross-device history', () => {
  test('?cart=CODE imports the shared sacola and strips the param', async () => {
    window.history.replaceState(null, '', '/?cart=abcdEFGH&utm=x');
    const c = core((url) =>
      url.pathname === '/checkout/v1/cart/import'
        ? json(200, {
            cart: {
              id: 'cart',
              status: 'open',
              items: [],
              totals: {
                subtotalCents: 0,
                deliveryFeeCents: 0,
                totalCents: 0,
                itemCount: 0,
                minOrderCents: 0,
                remainingMinOrderCents: 0,
                belowMinOrder: false,
              },
              delivery: null,
            },
            report: { added: 2, skipped: [] },
          })
        : null,
    );
    m = await mount({ path: '/' });
    await flush(8);
    expect(c.calls.find((x) => x.path === '/checkout/v1/cart/import')?.body).toEqual({
      shareCode: 'abcdEFGH',
    });
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/sacola');
    expect($('[data-vendua="banner-stack"]')?.textContent).toContain('Sacola recuperada');
  });

  test('/pedidos verifies a phone with an order number, then lists that phone’s orders', async () => {
    const c = core((url, init) => {
      if (url.pathname === '/checkout/v1/customer/session')
        return json(201, {
          customerToken: 'vcu.22999990001.9999999999.sig',
          expiresAt: '2099-01-01T00:00:00Z',
          phone: '22999990001',
        });
      if (url.pathname === '/checkout/v1/customer/orders') {
        const h = new Headers(init?.headers);
        return h.get('x-vendua-customer')
          ? json(200, {
              phone: '22999990001',
              orders: [
                {
                  id: ORDER_ID,
                  number: 7,
                  state: 'delivered',
                  placedAt: '2026-09-20T12:00:00Z',
                  scheduledFor: null,
                  mode: 'pickup',
                  totalCents: 10000,
                  items: [{ name: 'Pudim', qty: 2 }],
                },
              ],
            })
          : json(401, { error: { code: 'CUSTOMER_REQUIRED', message: 'x' } });
      }
      if (url.pathname === '/checkout/v1/customer/loyalty')
        return json(200, {
          phone: '22999990001',
          loyalty: {
            enabled: true,
            stampsRequired: 5,
            stamps: 1,
            minOrderCents: 0,
            rewardLabel: '1 pudim grátis',
            rewards: [],
          },
        });
      return null;
    });
    m = await mount({ path: '/pedidos' });
    expect($('[data-vendua="phone-verify"]')).not.toBeNull();
    const set = (sel: string, v: string) => {
      const el = $(sel) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      set('#v-verify-phone', '(22) 99999-0001');
      set('#v-verify-number', '7');
    });
    await act(async () =>
      ($('[data-vendua="phone-verify"]') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    await flush(10);
    expect(c.calls.find((x) => x.path === '/checkout/v1/customer/session')?.body).toEqual({
      phone: '(22) 99999-0001',
      orderNumber: 7,
    });
    expect($$('[data-origin="phone"]')).toHaveLength(1);
    expect(document.body.textContent).toContain('2× Pudim');
    expect($('[data-vendua="loyalty-card"]')?.textContent).toContain('1 pudim grátis');
    expect($('[data-vendua="phone-verify"]')).toBeNull();
  });
});
