import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { DETAIL, PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';
import { Img } from '../src/index.ts';
import { createApi } from '../src/api.ts';

// Kernel 1.7 — online payments in the Kernel-owned checkout and order page (online Pix; the
// card in the page since 1.19 — Mercado Pago's Card Payment Brick, or Core's fake provider in
// tests), pickup details, scheduled products, media srcsets.

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

type Handler = (
  url: URL,
  init: RequestInit | undefined,
) => Response | null | Promise<Response | null>;
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

const CARD_NEXT = {
  kind: 'card',
  provider: 'fake',
  publicKey: 'TEST-fake',
  amountCents: 4700,
  declined: null,
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
  test('card_online: places the order and opens the card form on the order page', async () => {
    const c = core((url) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === '/checkout/v1/cart') return json(200, { cart: cartWithItem() });
      if (url.pathname === '/checkout/v1/cart/delivery')
        return json(200, { cart: { ...cartWithItem(), delivery: { mode: 'pickup' } } });
      if (url.pathname === '/checkout/v1/checkout')
        return json(201, { order: order(1, { method: 'card_online', status: 'pending' }) });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`)
        return json(200, { order: order(1, { method: 'card_online', status: 'pending' }) });
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`)
        return json(200, {
          order: order(1, { method: 'card_online', status: 'pending' }),
          next: CARD_NEXT,
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
    await flush(12);
    expect(c.calls.find((x) => x.path === '/checkout/v1/checkout')?.body).toMatchObject({
      payment: { method: 'card_online' },
      delivery: { mode: 'pickup' },
    });
    // no hand-off: the order page asks Core for the in-page form and shows it
    expect(assigned).toEqual([]);
    const pay = c.calls.filter((x) => x.path === `/checkout/v1/orders/${ORDER_ID}/pay`);
    expect(pay).toHaveLength(1);
    expect(pay[0]?.body).toEqual({ card: 'form' });
    expect($('[data-vendua="checkout-success"]')).not.toBeNull();
    expect($('[data-vendua="card-payment"]')?.getAttribute('data-phase')).toBe('ready');
    expect($('[data-vendua="payment-status"]')).toBeNull();
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

  test('an older Core that still answers "redirect" → "Pagar com cartão" goes to Mercado Pago', async () => {
    const c = core((url) => {
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
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(10);
    expect($('[data-vendua="payment-status"]')?.getAttribute('data-status')).toBe('due');
    expect($('[data-vendua="card-payment"]')).toBeNull();
    expect(assigned).toEqual([]);
    await click(button('Pagar com cartão'));
    await flush(6);
    expect(c.calls.filter((x) => x.path.endsWith('/pay'))).toHaveLength(2);
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

describe('order page — the card in the page (Kernel 1.19)', () => {
  /** Core with a pending card order: `/pay` opens the form, `/card` answers `onCard`. */
  function cardCore(
    onCard: (body: Record<string, unknown>) => Response,
    next: unknown = CARD_NEXT,
  ) {
    let paid = false;
    // the order read follows the last order Core answered with
    let last: unknown = order(1, { method: 'card_online', status: 'pending' });
    const c = core(async (url, init) => {
      if (url.pathname === '/storefront/v1/store') return json(200, ONLINE_STORE);
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/card`) {
        const r = onCard(JSON.parse(String(init?.body)));
        const body = await r.clone().json();
        if (body?.order) last = body.order;
        return r;
      }
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}/pay`) {
        last = order(4, { method: 'card_online', status: paid ? 'paid' : 'pending' });
        // like Core: an answered challenge MP hasn't settled yet is processing, not a new form
        const answered =
          (JSON.parse(String(init?.body ?? '{}')) as { challenge?: string }).challenge ===
          'complete';
        return json(200, { order: last, next: paid || answered ? { kind: 'none' } : next });
      }
      if (url.pathname === `/checkout/v1/orders/${ORDER_ID}`) return json(200, { order: last });
      return null;
    });
    return Object.assign(c, { pay: () => (paid = true) });
  }
  const cards = (c: { calls: { path: string; body?: unknown }[] }) =>
    c.calls.filter((x) => x.path.endsWith('/card'));
  const fake = (outcome: string) => $(`[data-provider="fake"] [data-outcome="${outcome}"]`);
  const phase = () => $('[data-vendua="card-payment"]')?.getAttribute('data-phase');

  test('approved: posts the token (never an amount) and celebrates the payment', async () => {
    const c = cardCore(() =>
      json(200, {
        order: order(3, { method: 'card_online', status: 'paid', paidAt: '2026-09-30T12:05:00Z' }),
        next: { kind: 'none' },
      }),
    );
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(10);
    expect(c.calls.find((x) => x.path.endsWith('/pay'))?.body).toEqual({ card: 'form' });
    expect(phase()).toBe('ready');
    expect(text('[data-vendua="card-payment"]')).toContain('vão direto para o Mercado Pago');
    expect(text('[data-vendua="card-payment"] [data-part="amount"]')).toMatch(/R\$\s47,00/);
    await click(fake('approved'));
    await flush(8);
    const [sent] = cards(c);
    expect(sent?.body).toMatchObject({
      paymentMethodId: 'visa',
      issuerId: null,
      installments: 1,
      payer: { email: 'comprador@example.com', identification: null },
      deviceId: null,
    });
    expect((sent?.body as { token: string }).token).toMatch(
      /^fake-card-approved\.[A-Za-z0-9]{1,40}$/,
    );
    expect(JSON.stringify(sent?.body)).not.toMatch(/amount|cents/i);
    const panel = $('[data-vendua="payment-status"]');
    expect(panel?.getAttribute('data-status')).toBe('paid');
    expect(panel?.hasAttribute('data-just-paid')).toBe(true);
    expect($('[data-vendua="card-payment"]')).toBeNull();
  });

  test('declined: says why and offers a fresh form; a reload shows the last refusal', async () => {
    const c = cardCore(() =>
      json(200, {
        order: order(2, { method: 'card_online', status: 'failed' }),
        next: { kind: 'declined', reason: 'insufficient_funds' },
      }),
    );
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(10);
    expect($('[data-part="declined"]')).toBeNull();
    const before = $('[data-vendua="card-fields"]');
    await click(fake('rejected-cc_rejected_insufficient_amount'));
    await flush(8);
    expect(text('[data-part="declined"]')).toContain('Saldo ou limite insuficiente');
    expect(phase()).toBe('ready');
    // tokens are single-use: a new form, and the next submit carries a new token
    expect($('[data-vendua="card-fields"]')).not.toBe(before);
    await click(fake('rejected-cc_rejected_insufficient_amount'));
    await flush(8);
    const tokens = cards(c).map((x) => (x.body as { token: string }).token);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).not.toBe(tokens[1]);
    m.unmount();

    cardCore(() => json(500, {}), { ...CARD_NEXT, declined: 'challenge_failed' });
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(10);
    expect(text('[data-part="declined"]')).toContain('A verificação do banco não foi concluída');
  });

  test('3-D Secure: the challenge posts creq into a frame in the page; COMPLETE syncs', async () => {
    const submitted: HTMLFormElement[] = [];
    const realSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
      submitted.push(this);
    };
    try {
      const c = cardCore(() =>
        json(200, {
          order: order(2, { method: 'card_online', status: 'pending' }),
          next: { kind: 'challenge', url: '/checkout/v1/fake/3ds', creq: 'CREQ-1' },
        }),
      );
      m = await mount({ path: `/pedido/${ORDER_ID}` });
      await flush(10);
      await click(fake('challenge'));
      await flush(8);
      expect(phase()).toBe('challenge');
      expect(assigned).toEqual([]);
      const frame = $('[data-vendua="card-challenge"] iframe') as HTMLIFrameElement;
      expect(frame).not.toBeNull();
      expect(submitted).toHaveLength(1);
      const form = submitted[0]!;
      expect(form.getAttribute('action')).toBe('http://shop.test/checkout/v1/fake/3ds');
      expect(form.getAttribute('method')).toBe('post');
      expect(form.getAttribute('target')).toBe(frame.getAttribute('name'));
      expect((form.querySelector('input[name="creq"]') as HTMLInputElement).value).toBe('CREQ-1');
      // a message from anywhere else is ignored
      await act(async () =>
        window.dispatchEvent(new MessageEvent('message', { data: { status: 'COMPLETE' } })),
      );
      await flush(4);
      expect(c.calls.filter((x) => x.path.endsWith('/pay'))).toHaveLength(1);
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { status: 'COMPLETE' },
            source: frame.contentWindow as Window,
          }),
        ),
      );
      await act(() => new Promise((r) => setTimeout(r, 20)));
      await flush(8);
      // MP hasn't settled it yet: processing, never a fresh card form
      const pays = c.calls.filter((x) => x.path.endsWith('/pay'));
      expect(pays).toHaveLength(2);
      expect(pays[1]?.body).toEqual({ card: 'form', challenge: 'complete' });
      expect($('[data-vendua="card-challenge"]')).toBeNull();
      expect($('[data-vendua="card-fields"]')).toBeNull();
      expect($('[data-vendua="payment-status"]')?.getAttribute('data-status')).toBe('processing');
    } finally {
      HTMLFormElement.prototype.submit = realSubmit;
    }
  });

  test('provider down (503) → unavailable, retry and the store’s WhatsApp', async () => {
    const c = cardCore(() =>
      json(503, { error: { code: 'PAYMENT_UNAVAILABLE', message: 'mp down' } }),
    );
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(10);
    await click(fake('approved'));
    await flush(8);
    expect($('[data-vendua="payment-status"]')?.getAttribute('data-status')).toBe('unavailable');
    expect($('[data-part="whatsapp"]')?.getAttribute('href')).toStartWith('https://wa.me/');
    await click(button('Tentar de novo'));
    await flush(8);
    expect(c.calls.filter((x) => x.path.endsWith('/pay'))).toHaveLength(2);
    expect(phase()).toBe('ready');
  });

  test('an earlier submit still unresolved (PAYMENT_IN_PROGRESS) → processing', async () => {
    cardCore(() => json(409, { error: { code: 'PAYMENT_IN_PROGRESS', message: 'busy' } }));
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(10);
    await click(fake('pending'));
    await flush(8);
    const panel = $('[data-vendua="payment-status"]');
    expect(panel?.getAttribute('data-status')).toBe('processing');
    expect(panel?.textContent).toContain('Pagamento em análise');
    expect(panel?.textContent).not.toContain('ambiente do Mercado Pago');
    expect($('[data-vendua="card-payment"]')).toBeNull();
  });

  describe('Mercado Pago: the Card Payment Brick', () => {
    const MP = { ...CARD_NEXT, provider: 'mercadopago', publicKey: 'APP_USR-pk' };
    const settings = () =>
      (window as unknown as { happyDOM: { settings: Record<string, boolean> } }).happyDOM.settings;
    afterEach(() => {
      delete (globalThis as { MercadoPago?: unknown }).MercadoPago;
      settings().handleDisabledFileLoadingAsSuccess = false;
      document.querySelectorAll('script[src*="mercadopago"]').forEach((s) => s.remove());
    });

    test('the SDK fails to load → the form says so and offers a retry', async () => {
      cardCore(() => json(500, {}), MP);
      m = await mount({ path: `/pedido/${ORDER_ID}` });
      await flush(10);
      expect(phase()).toBe('unavailable');
      expect(text('[data-part="unavailable"]')).toContain('não carregou');
      expect($('[data-part="retry"]')).not.toBeNull();
    });

    test('loads the SDK once and mounts the Brick with the amount and the store’s colours', async () => {
      const created: { brick: string; id: string; settings: Record<string, any> }[] = [];
      const unmounted: number[] = [];
      class FakeMP {
        constructor(
          public key: string,
          public opts: unknown,
        ) {
          expect(key).toBe('APP_USR-pk');
          expect(opts).toEqual({ locale: 'pt-BR' });
        }
        bricks() {
          return {
            create: async (brick: string, id: string, s: Record<string, any>) => {
              created.push({ brick, id, settings: s });
              return { unmount: () => unmounted.push(1) };
            },
          };
        }
      }
      // absent until the script "loads", like the real SDK
      settings().handleDisabledFileLoadingAsSuccess = true;
      let reads = 0;
      Object.defineProperty(globalThis, 'MercadoPago', {
        configurable: true,
        get: () => (reads++ ? FakeMP : undefined),
      });
      const c = cardCore(
        () =>
          json(200, {
            order: order(3, { method: 'card_online', status: 'paid' }),
            next: { kind: 'none' },
          }),
        MP,
      );
      m = await mount({ path: `/pedido/${ORDER_ID}` });
      await flush(10);
      expect([...document.querySelectorAll('script')].map((s) => s.src)).toContain(
        'https://sdk.mercadopago.com/js/v2',
      );
      expect(created).toHaveLength(1);
      const [b] = created;
      expect(b!.brick).toBe('cardPayment');
      expect(document.getElementById(b!.id)?.getAttribute('data-vendua')).toBe('card-fields');
      expect(b!.settings.initialization).toEqual({ amount: 47 });
      expect(b!.settings.customization.visual.hideFormTitle).toBe(true);
      expect(b!.settings.customization.visual.texts.formSubmit).toMatch(/^Pagar R\$\s47,00$/);
      expect(b!.settings.customization.visual.style.theme).toBe('default');
      expect(b!.settings.customization.visual.style.customVariables.baseColor).toBe('#224466');
      expect(b!.settings.customization.paymentMethods.maxInstallments).toBe(12);
      expect(phase()).toBe('loading');
      await act(async () => b!.settings.callbacks.onReady());
      expect(phase()).toBe('ready');
      await act(async () => {
        await b!.settings.callbacks.onSubmit({
          token: 'mp-token-1',
          payment_method_id: 'master',
          issuer_id: '24',
          installments: 3,
          payer: {
            email: 'ana@example.com',
            identification: { type: 'CPF', number: '12345678909' },
          },
        });
      });
      await flush(6);
      expect(cards(c)[0]?.body).toEqual({
        token: 'mp-token-1',
        paymentMethodId: 'master',
        issuerId: '24',
        installments: 3,
        payer: { email: 'ana@example.com', identification: { type: 'CPF', number: '12345678909' } },
        deviceId: null,
      });
      expect($('[data-vendua="payment-status"]')?.getAttribute('data-status')).toBe('paid');
      expect(unmounted).toHaveLength(1);
    });
  });
});

describe('cash change (Kernel 1.17)', () => {
  const CASH_STORE = { ...STORE, paymentMethods: ['pix', 'cash'] };
  /** dados → retirada → pagamento, with Core answering checkout through `checkout` */
  async function toPayment(checkout: (body: unknown) => Response) {
    const c = core((url, init) => {
      if (url.pathname === '/storefront/v1/store') return json(200, CASH_STORE);
      if (url.pathname === '/checkout/v1/cart') return json(200, { cart: cartWithItem() });
      if (url.pathname === '/checkout/v1/cart/delivery')
        return json(200, { cart: { ...cartWithItem(), delivery: { mode: 'pickup' } } });
      if (url.pathname === '/checkout/v1/checkout')
        return checkout(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      return null;
    });
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      setValue('#checkout-name', 'Ana');
      setValue('#checkout-phone', '(22) 99999-0001');
    });
    await submitForm();
    await click($('input[value="pickup"]'));
    await submitForm();
    await flush();
    return c;
  }
  const placed = (payment: Pay) =>
    json(201, { order: order(1, { status: 'pending', provider: 'sandbox', ...payment }) });
  const checkoutBody = (c: ReturnType<typeof core>) =>
    c.calls.filter((x) => x.path === '/checkout/v1/checkout').map((x) => x.body);

  test('asked only for cash, sent as cents, and dropped when the shopper switches method', async () => {
    const c = await toPayment(() => placed({ method: 'cash', changeForCents: 10000 }));
    expect($('[data-part="change"]')).toBeNull();
    await click($('input[value="cash"]'));
    expect(text('[data-part="change"]')).toContain('Precisa de troco?');
    expect($('label[for="v-change-for"]')?.textContent).toBe('Troco para');
    await act(async () => setValue('#v-change-for', '100'));
    // Pix: the typed change stays behind, never sent
    await click($('input[value="pix"]'));
    expect($('[data-part="change"]')).toBeNull();
    await submitForm();
    await flush(10);
    expect(checkoutBody(c)[0]).toMatchObject({ payment: { method: 'pix' } });
    expect((checkoutBody(c)[0] as { payment: object }).payment).not.toHaveProperty(
      'changeForCents',
    );
  });

  test('cash sends changeForCents; after "não preciso de troco" it sends none', async () => {
    let n = 0;
    const c = await toPayment(() =>
      n++ === 0
        ? json(422, {
            error: { code: 'INVALID_CHANGE', message: 'x', details: { minCents: 4700 } },
          })
        : placed({ method: 'cash', changeForCents: null }),
    );
    await click($('input[value="cash"]'));
    await act(async () => setValue('#v-change-for', '1.000,50'));
    await submitForm();
    await flush(10);
    expect((checkoutBody(c)[0] as { payment: unknown }).payment).toEqual({
      method: 'cash',
      changeForCents: 100050,
    });
    await click($('input[name="no-change"]'));
    expect(($('#v-change-for') as HTMLInputElement).disabled).toBe(true);
    await submitForm();
    await flush(10);
    expect((checkoutBody(c)[1] as { payment: unknown }).payment).toEqual({ method: 'cash' });
  });

  test("Core's INVALID_CHANGE shows at the field with the total, and clears on edit", async () => {
    const c = await toPayment(() =>
      json(422, {
        error: {
          code: 'INVALID_CHANGE',
          message: 'change below total',
          details: { field: 'payment.changeForCents', minCents: 4700 },
        },
      }),
    );
    await click($('input[value="cash"]'));
    await act(async () => setValue('#v-change-for', '20'));
    await submitForm();
    await flush(10);
    expect((checkoutBody(c)[0] as { payment: unknown }).payment).toEqual({
      method: 'cash',
      changeForCents: 2000,
    });
    expect(text('#v-change-error')).toMatch(
      /^O troco precisa ser para um valor igual ou maior que o total, R\$\s47,00\.$/,
    );
    const input = $('#v-change-for') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('v-change-error');
    await act(async () => setValue('#v-change-for', '50'));
    expect($('#v-change-error')).toBeNull();
  });

  test("Core's cap on the change (maxCents) shows the upper bound, not the total", async () => {
    const c = await toPayment(() =>
      json(422, {
        error: {
          code: 'INVALID_CHANGE',
          message: 'change above cap',
          details: { field: 'payment.changeForCents', minCents: 4700, maxCents: 1_000_000 },
        },
      }),
    );
    await click($('input[value="cash"]'));
    await act(async () => setValue('#v-change-for', '20.000'));
    await submitForm();
    await flush(10);
    expect((checkoutBody(c)[0] as { payment: unknown }).payment).toEqual({
      method: 'cash',
      changeForCents: 2_000_000,
    });
    expect(text('#v-change-error')).toMatch(/^O troco pode ser para até R\$\s10\.000,00\.$/);
  });

  test('the order page says what the change is for, only for cash', async () => {
    const offline = { status: 'pending', provider: 'sandbox', online: false };
    core((url) =>
      url.pathname === `/checkout/v1/orders/${ORDER_ID}`
        ? json(200, { order: order(1, { ...offline, method: 'cash', changeForCents: 10000 }) })
        : null,
    );
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(8);
    expect(text('[data-part="change-for"]')).toMatch(/^Troco para R\$\s100,00$/);
    m.unmount();

    core((url) =>
      url.pathname === `/checkout/v1/orders/${ORDER_ID}`
        ? json(200, { order: order(1, { ...offline, method: 'cash', changeForCents: null }) })
        : null,
    );
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    await flush(8);
    expect($('[data-vendua="order-status"]')).not.toBeNull();
    expect($('[data-part="change-for"]')).toBeNull();
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

describe('payOrder / payCard — the Kernel 1.19 calls', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const seen: { url: string; init?: RequestInit }[] = [];
  const answer = (next: unknown) => {
    seen.length = 0;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, ...(init ? { init } : {}) });
      return json(200, { order: order(2, { method: 'card_online', status: 'pending' }), next });
    }) as unknown as typeof fetch;
  };
  const INPUT = {
    token: 't',
    paymentMethodId: 'visa',
    issuerId: null,
    installments: 1,
    payer: { email: 'a@b.co', identification: null },
    deviceId: null,
  };

  test('payOrder sends { card: "form" } only when asked', async () => {
    answer({ kind: 'none' });
    const api = createApi('https://api.test');
    await api.payOrder(ORDER_ID);
    expect(seen[0]?.init?.body).toBeUndefined();
    await api.payOrder(ORDER_ID, { cardForm: true });
    expect(JSON.parse(String(seen[1]?.init?.body))).toEqual({ card: 'form' });
  });

  test('payCard posts the input with a fresh Idempotency-Key each time', async () => {
    answer({ kind: 'none' });
    const api = createApi('https://api.test');
    await api.payCard(ORDER_ID, INPUT);
    await api.payCard(ORDER_ID, INPUT);
    expect(seen[0]?.url).toBe(`https://api.test/checkout/v1/orders/${ORDER_ID}/card`);
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual(INPUT);
    const key = (i: number) =>
      (seen[i]?.init?.headers as Record<string, string>)['idempotency-key'];
    expect(key(0)).toBeTruthy();
    expect(key(0)).not.toBe(key(1));
  });

  test('a relative challenge resolves against the API base; plain-http elsewhere is refused', async () => {
    answer({ kind: 'challenge', url: '/checkout/v1/fake/3ds', creq: 'c' });
    expect((await createApi('https://api.test').payCard(ORDER_ID, INPUT)).next).toEqual({
      kind: 'challenge',
      url: 'https://api.test/checkout/v1/fake/3ds',
      creq: 'c',
    });
    answer({ kind: 'challenge', url: 'https://acs.bank.test/3ds', creq: 'c' });
    expect((await createApi('').payCard(ORDER_ID, INPUT)).next).toMatchObject({
      url: 'https://acs.bank.test/3ds',
    });
    for (const bad of ['http://evil.test/3ds', '//evil.test/3ds', 'javascript:alert(1)']) {
      answer({ kind: 'challenge', url: bad, creq: 'c' });
      await expect(createApi('').payCard(ORDER_ID, INPUT)).rejects.toMatchObject({
        code: 'PAYMENT_UNAVAILABLE',
      });
    }
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
