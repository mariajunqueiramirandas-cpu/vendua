import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { DETAIL, PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';
import { Img } from '../src/index.ts';
import { createApi } from '../src/api.ts';

// Kernel 1.7 — online payments in the Kernel-owned checkout and order page (card via
// Mercado Pago's hosted checkout, online Pix), pickup details, scheduled products, media srcsets.

let m: Mounted | null = null;
let assigned: string[] = [];
const realAssign = window.location.assign;
beforeEach(() => {
  assigned = [];
  window.location.assign = ((url: string | URL) => void assigned.push(String(url))) as never;
});
afterEach(() => {
  m?.unmount();
  m = null;
  window.location.assign = realAssign;
  window.history.replaceState(null, '', '/');
});
const $ = (s: string) => document.querySelector(s);
const text = (s: string) => $(s)?.textContent ?? '';

const ORDER_ID = '66666666-6666-4666-8666-666666666666';
const QR =
  '00020101021226300014br.gov.bcb.pix0110loja@x.com5204000053039865406100.005802BR5904LOJA6006CIDADE62070503***6304ABCD';
const NEW_QR = QR.replace('ABCD', 'EFGH');

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

const ONLINE_STORE = {
  ...STORE,
  paymentMethods: ['pix', 'card_online', 'cash'],
  onlinePayments: { pix: true, card: true },
  pickup: { address: 'Rua das Flores, 12 — fundos', instructions: 'Toque a campainha azul.' },
};

type Pay = Record<string, unknown>;
const order = (version: number, payment: Pay, over: Record<string, unknown> = {}) => ({
  id: ORDER_ID,
  number: 42,
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
  payment: { provider: 'mercadopago', instructions: null, online: true, ...payment },
  subtotalCents: 4700,
  deliveryFeeCents: 0,
  totalCents: 4700,
  placedAt: '2026-09-30T12:00:00Z',
  timeline: [{ at: '2026-09-30T12:00:00Z', from: null, to: 'placed', actor: 'customer', meta: {} }],
  version,
  ...over,
});

const cartWithItem = () => ({
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
    totalCents: 4700,
    itemCount: 1,
    minOrderCents: 0,
    remainingMinOrderCents: 0,
    belowMinOrder: false,
  },
  delivery: null,
});

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
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) ?? null;

/** An order-events stream the test pushes frames into. */
function sse(init: RequestInit | undefined, onPush: (push: (o: unknown) => void) => void) {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) {
      onPush((o) =>
        ctrl.enqueue(
          enc.encode(
            `event: order\nid: ${(o as { version: number }).version}\ndata: ${JSON.stringify(o)}\n\n`,
          ),
        ),
      );
      init?.signal?.addEventListener('abort', () =>
        ctrl.error(new DOMException('x', 'AbortError')),
      );
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('checkout — online methods and pickup', () => {
  test('card_online: places the order, asks Core to pay, and leaves for Mercado Pago', async () => {
    const c = core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === '/checkout/v1/cart') return json(200, { cart: cartWithItem() });
      if (url.pathname === '/checkout/v1/cart/delivery')
        return json(200, { cart: { ...cartWithItem(), delivery: { mode: 'pickup' } } });
      if (url.pathname === '/checkout/v1/checkout')
        return json(201, { order: order(1, { method: 'card_online', status: 'pending' }) });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`)
        return json(200, {
          order: order(2, { method: 'card_online', status: 'pending' }),
          next: { kind: 'redirect', url: 'https://mp.test/checkout?pref=1' },
        });
      return null;
    });
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      setValue('#checkout-name', 'Ana');
      setValue('#checkout-phone', '(22) 99999-0001');
    });
    await submitForm();
    // pickup shows the store's pickup address, and its instructions once chosen
    const pickup = $('input[value="pickup"]') as HTMLInputElement;
    expect(pickup.closest('label')?.textContent).toContain('Rua das Flores, 12 — fundos');
    expect(text('[data-part="option-note"]')).toBe('');
    await click(pickup);
    expect(text('[data-part="option-note"]')).toBe('Toque a campainha azul.');
    await submitForm();
    await flush();
    // Pix says the QR comes next; the online card is offered because the store lists it
    expect($('input[value="pix"]')?.closest('label')?.textContent).toContain(
      'QR Code na próxima tela',
    );
    const card = $('input[value="card_online"]') as HTMLInputElement;
    expect(card.closest('label')?.textContent).toContain('Cartão de crédito');
    expect(card.closest('label')?.textContent).toContain('Mercado Pago');
    expect($('input[value="card_on_delivery"]')).toBeNull();
    await click(card);
    expect(button('Ir para o pagamento')).not.toBeNull();
    await submitForm();
    await flush(10);
    expect(c.calls.find((x) => x.path === '/checkout/v1/checkout')?.body).toMatchObject({
      payment: { method: 'card_online' },
      delivery: { mode: 'pickup' },
    });
    const pay = c.calls.find((x) => x.path === `/checkout/v1/orders/${ORDER_ID}/pay`);
    expect(pay?.method).toBe('POST');
    expect(assigned).toEqual(['https://mp.test/checkout?pref=1']);
    // the hand-off is a designed state, with a manual link if the browser doesn't follow
    const panel = $('[data-vendua="payment-status"]');
    expect(panel?.getAttribute('data-status')).toBe('redirecting');
    expect(panel?.textContent).toContain('Levando você ao Mercado Pago');
    expect($('[data-part="provider-link"]')?.getAttribute('href')).toBe(
      'https://mp.test/checkout?pref=1',
    );
  });

  test('an older Core (no paymentMethods) never offers the online card', async () => {
    core((url) =>
      url.pathname === '/checkout/v1/cart' ? json(200, { cart: cartWithItem() }) : null,
    );
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      setValue('#checkout-name', 'Ana');
      setValue('#checkout-phone', '(22) 99999-0001');
    });
    await submitForm();
    await click($('input[value="pickup"]'));
    await submitForm();
    await flush();
    expect($('input[value="pix"]')).not.toBeNull();
    expect($('input[value="card_online"]')).toBeNull();
  });
});

describe('order page — online payments', () => {
  test('online Pix: asks Core for the QR, counts down, then celebrates the live "paid"', async () => {
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    let push: (o: unknown) => void = () => {};
    const c = core((url, init) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/events`)
        return sse(init, (p) => (push = p));
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`)
        return json(200, {
          order: order(2, { method: 'pix', status: 'pending', pix: { copyPaste: QR, expiresAt } }),
          next: { kind: 'pix', copyPaste: QR, expiresAt },
        });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, {
          order: c.calls.some((x) => x.path.endsWith('/pay'))
            ? order(2, { method: 'pix', status: 'pending', pix: { copyPaste: QR, expiresAt } })
            : order(1, { method: 'pix', status: 'pending', pix: null }),
        });
      return null;
    });
    m = await mount({ path: `/pedido/${ORDER_ID}?novo=1` });
    await flush(10);
    expect(c.calls.filter((x) => x.path.endsWith('/pay'))).toHaveLength(1);
    expect(($('#v-pix-code') as HTMLInputElement).value).toBe(QR);
    expect($('[data-vendua="pix"] svg path')).not.toBeNull();
    expect(text('[data-part="expires"]')).toMatch(/Vale por mais (29|30):\d\d/);
    expect(text('[data-part="waiting"]')).toContain('na hora');
    // pickup order: the store's pickup address and instructions
    expect(text('[data-vendua="order-status"]')).toContain('Rua das Flores, 12 — fundos');
    expect(text('[data-part="pickup-instructions"]')).toBe('Toque a campainha azul.');
    // the webhook lands → Core bumps the version → the stream delivers it
    await act(async () => new Promise((r) => setTimeout(r, 1700)));
    await flush(6);
    await act(async () =>
      push(order(3, { method: 'pix', status: 'paid', paidAt: '2026-09-30T12:05:00Z' })),
    );
    await flush(6);
    const panel = $('[data-vendua="payment-status"]');
    expect(panel?.getAttribute('data-status')).toBe('paid');
    expect(panel?.hasAttribute('data-just-paid')).toBe(true);
    expect(panel?.textContent).toContain('Pagamento confirmado');
    expect($('[data-vendua="pix"]')).toBeNull();
  });

  test('expired Pix → "Gerar novo Pix" issues a fresh code', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() + 30 * 60_000).toISOString();
    const c = core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`)
        return json(200, {
          order: order(5, {
            method: 'pix',
            status: 'pending',
            pix: { copyPaste: NEW_QR, expiresAt: later },
          }),
          next: { kind: 'pix', copyPaste: NEW_QR, expiresAt: later },
        });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, {
          order: c.calls.some((x) => x.path.endsWith('/pay'))
            ? order(5, {
                method: 'pix',
                status: 'pending',
                pix: { copyPaste: NEW_QR, expiresAt: later },
              })
            : order(4, {
                method: 'pix',
                status: 'pending',
                pix: { copyPaste: QR, expiresAt: past },
              }),
        });
      return null;
    });
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(8);
    expect($('[data-vendua="payment-status"]')?.getAttribute('data-status')).toBe('expired');
    expect($('[data-vendua="pix"]')).toBeNull();
    expect(c.calls.some((x) => x.path.endsWith('/pay'))).toBe(false);
    await click(button('Gerar novo Pix'));
    await flush(10);
    expect(c.calls.filter((x) => x.path.endsWith('/pay'))).toHaveLength(1);
    expect($('[data-vendua="payment-status"]')).toBeNull();
    expect(($('#v-pix-code') as HTMLInputElement).value).toBe(NEW_QR);
  });

  test('card return (?pagamento=retorno) syncs with Core and confirms the payment', async () => {
    const c = core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`)
        return json(200, {
          order: order(3, { method: 'card_online', status: 'paid' }),
          next: { kind: 'none' },
        });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, {
          order: c.calls.some((x) => x.path.endsWith('/pay'))
            ? order(3, { method: 'card_online', status: 'paid' })
            : order(2, { method: 'card_online', status: 'pending' }),
        });
      return null;
    });
    m = await mount({ path: `/pedido/${ORDER_ID}?pagamento=retorno` });
    await flush(10);
    const pay = c.calls.filter((x) => x.path.endsWith('/pay'));
    expect(pay).toHaveLength(1);
    expect(assigned).toEqual([]);
    const panel = $('[data-vendua="payment-status"]');
    expect(panel?.getAttribute('data-status')).toBe('paid');
    expect(panel?.hasAttribute('data-just-paid')).toBe(true);
    expect(text('[data-vendua="order-status"] [data-part="payment-status"]')).toContain('pago');
  });

  test('card return with nothing approved → "Tentar de novo" goes back to Mercado Pago', async () => {
    core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`)
        return json(200, {
          order: order(2, { method: 'card_online', status: 'pending' }),
          next: { kind: 'redirect', url: 'https://mp.test/checkout?pref=2' },
        });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, { order: order(2, { method: 'card_online', status: 'pending' }) });
      return null;
    });
    m = await mount({ path: `/pedido/${ORDER_ID}?pagamento=retorno&status=rejected` });
    await flush(10);
    expect($('[data-vendua="payment-status"]')?.getAttribute('data-status')).toBe('failed');
    expect(assigned).toEqual([]);
    await click(button('Tentar de novo'));
    await flush(6);
    expect(assigned).toEqual(['https://mp.test/checkout?pref=2']);
  });

  test('provider down (503) → retry and the store’s WhatsApp', async () => {
    let down = true;
    const c = core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`)
        return down
          ? json(503, { error: { code: 'PAYMENT_UNAVAILABLE', message: 'mp down' } })
          : json(200, {
              order: order(2, { method: 'pix', status: 'pending', pix: { copyPaste: QR } }),
              next: { kind: 'pix', copyPaste: QR, expiresAt: null },
            });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, { order: order(1, { method: 'pix', status: 'pending', pix: null }) });
      return null;
    });
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(10);
    const panel = $('[data-vendua="payment-status"]');
    expect(panel?.getAttribute('data-status')).toBe('unavailable');
    const wa = $('[data-part="whatsapp"]')?.getAttribute('href') ?? '';
    expect(wa).toStartWith('https://wa.me/5522999990000?text=');
    expect(decodeURIComponent(wa)).toContain('pedido #42');
    down = false;
    await click(button('Tentar de novo'));
    await flush(10);
    expect(c.calls.filter((x) => x.path.endsWith('/pay'))).toHaveLength(2);
    expect(($('#v-pix-code') as HTMLInputElement).value).toBe(QR);
  });

  test('refunds show the amount returned; offline orders get no payment panel', async () => {
    core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, {
          order: order(
            6,
            { method: 'card_online', status: 'partially_refunded', refundedCents: 1500 },
            { state: 'delivered' },
          ),
        });
      return null;
    });
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(8);
    const panel = $('[data-vendua="payment-status"]');
    expect(panel?.getAttribute('data-status')).toBe('refunded');
    expect(panel?.textContent).toMatch(/R\$\s15,00/);
    expect(panel?.textContent).toContain('Parte do pagamento foi devolvida');
    m.unmount();

    core((url) =>
      url.pathname === `/checkout/v1/orders/${ORDER_ID}`
        ? json(200, {
            order: order(1, {
              method: 'cash',
              status: 'pending',
              provider: 'sandbox',
              online: false,
            }),
          })
        : null,
    );
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(8);
    expect($('[data-vendua="order-status"]')).not.toBeNull();
    expect($('[data-vendua="payment-status"]')).toBeNull();
  });
});

describe('catalog — scheduled products', () => {
  const scheduled = {
    ...PRODUCT,
    status: 'sold_out',
    availabilityLabel: 'Só sábados, 9h–13h',
  };

  test('the product card shows availabilityLabel instead of "Esgotado"', async () => {
    core((url) =>
      url.pathname === '/storefront/v1/catalog'
        ? json(200, {
            categories: [
              { id: 'c1', slug: 'doces', name: 'Doces', sort: 1, products: [scheduled] },
            ],
          })
        : null,
    );
    m = await mount({ path: '/' });
    expect(text('.v-card [data-part="availability"]')).toBe('Só sábados, 9h–13h');
    expect(text('.v-card')).not.toContain('Esgotado');
  });

  test('the purchase panel says when the product is back', async () => {
    core((url) =>
      url.pathname === '/storefront/v1/products/pudim'
        ? json(200, { product: { ...DETAIL, ...scheduled } })
        : null,
    );
    m = await mount({ path: '/produto/pudim' });
    expect(text('[data-part="availability"]')).toContain('Só sábados, 9h–13h');
    expect($('[data-vendua="add-to-cart"]')).toBeNull();
  });
});

describe('Img', () => {
  test('without a CDN, Core media get a ?w= srcset; other srcs stay plain', async () => {
    mockCore();
    m = await mount({
      path: '/nada-aqui',
      children: (
        <>
          <Img src="/v1/media/t1/abc.webp" alt="a" width={320} height={320} data-t="core" />
          <Img src="https://elsewhere.test/x.jpg" alt="b" width={320} height={320} data-t="ext" />
        </>
      ),
    });
    const core = $('img[data-t="core"]') as HTMLImageElement;
    expect(core.getAttribute('srcset')).toBe(
      '/v1/media/t1/abc.webp?w=320 320w, /v1/media/t1/abc.webp?w=480 480w, /v1/media/t1/abc.webp?w=640 640w',
    );
    expect(core.getAttribute('sizes')).toBe('(max-width: 320px) 100vw, 320px');
    expect(($('img[data-t="ext"]') as HTMLImageElement).hasAttribute('srcset')).toBe(false);
  });
});

describe('payOrder — the redirect is https only', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const pay = (url: string) => {
    globalThis.fetch = (async () =>
      json(200, {
        order: order(2, { method: 'card_online', status: 'pending' }),
        next: { kind: 'redirect', url },
      })) as unknown as typeof fetch;
    return createApi('http://shop.test').payOrder(ORDER_ID);
  };

  test('an https provider URL passes through', async () => {
    expect((await pay('https://mp.test/checkout?pref=9')).next).toEqual({
      kind: 'redirect',
      url: 'https://mp.test/checkout?pref=9',
    });
  });

  test('a javascript: or plain-http URL from Core is refused', async () => {
    for (const bad of ['javascript:alert(1)', 'http://evil.test/pay', 'not a url'])
      await expect(pay(bad)).rejects.toMatchObject({ code: 'PAYMENT_UNAVAILABLE' });
  });

  test('dev stores on *.localhost may use http', async () => {
    expect((await pay('http://pudim.localhost:5174/pedido/1?pagamento=retorno')).next.kind).toBe(
      'redirect',
    );
  });
});
