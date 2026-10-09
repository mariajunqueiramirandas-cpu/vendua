import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useCustomer, useTable } from '../src/index.ts';
import { orderPath, orderStateLabel, orderStepLabel } from '../src/rules/index.ts';
import { PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.22 — ordering at the table from its QR code (ADR 0036).

let m: Mounted | null = null;
let seen: ReturnType<typeof useTable>;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
});
// the analytics tape is shared by the whole run and halves itself past 200 events: leave it short
afterAll(() => {
  delete (globalThis as { __VENDUA_EVENTS__?: unknown }).__VENDUA_EVENTS__;
});

const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];
const text = (s: string) => ($(s)?.textContent ?? '').replace(/ /g, ' ');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function Grab() {
  seen = useTable();
  return null;
}

// a profile remembered by an earlier test lives in the hook's memory: start with none
function NoProfile() {
  const { customer, forget } = useCustomer();
  if (customer) queueMicrotask(forget);
  return null;
}

const TOKEN = `vqr.0b9a4f4e-1c1d-4e2f-9a3b-5c6d7e8f9a0b.1.${'a'.repeat(43)}`;
const TABLE_STORE = {
  ...STORE,
  dineIn: { enabled: true },
  paymentMethods: ['pix', 'card_online', 'card_on_delivery', 'cash'],
  onlinePayments: { pix: true, card: true },
};
const OPEN_CART = {
  id: 'cart',
  status: 'open',
  items: [
    {
      id: 'line-1',
      productId: PRODUCT.id,
      slug: 'pudim',
      name: 'Pudim',
      qty: 1,
      unitPriceCents: 1800,
      productStatus: 'active',
      modifiers: [],
      lineTotalCents: 1800,
    },
  ],
  totals: {
    subtotalCents: 1800,
    deliveryFeeCents: 0,
    totalCents: 1800,
    itemCount: 1,
    minOrderCents: 0,
    remainingMinOrderCents: 0,
    belowMinOrder: false,
  },
  delivery: null,
};
const ORDER_ID = '77777777-7777-4777-8777-777777777777';
const ORDER = {
  id: ORDER_ID,
  number: 31,
  state: 'placed',
  customer: { name: 'Ana', phone: '' },
  delivery: {
    mode: 'dine_in',
    table: 'Mesa 5',
    etaMin: null,
    etaMax: null,
    address: null,
    feeCents: 0,
    neighborhood: null,
  },
  payment: { method: 'tab', status: 'pending', provider: 'pdv', online: false, instructions: null },
  subtotalCents: 1800,
  deliveryFeeCents: 0,
  totalCents: 1800,
  placedAt: '2026-10-07T15:00:00Z',
  timeline: [{ at: '2026-10-07T15:00:00Z', from: null, to: 'placed', actor: 'shopper', meta: {} }],
  version: 1,
};

type Route = (url: URL, init?: RequestInit) => Response | null;
function core(over: Record<string, unknown | Route> = {}) {
  const c = mockCore();
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    const r = over[url.pathname];
    if (r !== undefined) {
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      c.calls.push({ method, path: url.pathname + url.search, body });
      if (typeof r === 'function') {
        const res = (r as Route)(url, init);
        if (res) return res;
      } else return json(200, r);
    }
    return base(input, init);
  }) as typeof fetch;
  return c;
}

const tableRoute = (table: unknown) => () => json(200, { table });
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

describe('the QR code at boot', () => {
  test('?mesa= is asked once, kept for the session, stripped and announced', async () => {
    window.history.replaceState(null, '', `/?mesa=${TOKEN}&utm=qr`);
    const c = core({
      '/storefront/v1/table': tableRoute({ label: 'Mesa 5', ordering: true, reason: null }),
    });
    m = await mount({ path: '/', children: <Grab /> });
    await flush(8);
    expect(c.calls.filter((x) => x.path.startsWith('/storefront/v1/table'))).toEqual([
      { method: 'GET', path: `/storefront/v1/table?t=${TOKEN}`, body: undefined },
    ]);
    expect(window.location.search).toBe('?utm=qr');
    expect(text('[data-vendua="banner-stack"]')).toContain('Você está na Mesa 5');
    expect(seen.table).toEqual({ label: 'Mesa 5', ordering: true, reason: null });
    // the token stays the Kernel's
    expect(JSON.stringify(seen)).not.toContain('vqr.');
    expect(sessionStorage.getItem('vendua.table')).toContain(TOKEN);
    await act(async () => seen.leave());
    expect(seen.table).toBeNull();
    expect(sessionStorage.getItem('vendua.table')).toBeNull();
  });

  test('a table that can’t order says why', async () => {
    window.history.replaceState(null, '', `/?mesa=${TOKEN}`);
    core({
      '/storefront/v1/table': tableRoute({ label: '7', ordering: false, reason: 'closed' }),
    });
    m = await mount({ path: '/', children: <Grab /> });
    await flush(8);
    expect(text('[data-vendua="banner-stack"]')).toContain('Você está na Mesa 7');
    expect(text('[data-vendua="banner-stack"]')).toContain('A loja está fechada agora');
    expect(seen.table?.ordering).toBe(false);
  });

  test('a replaced QR is dropped with a gentle message', async () => {
    window.history.replaceState(null, '', `/?mesa=${TOKEN}`);
    core({
      '/storefront/v1/table': () =>
        json(404, { error: { code: 'TABLE_NOT_FOUND', message: 'gone' } }),
    });
    m = await mount({ path: '/', children: <Grab /> });
    await flush(8);
    expect(window.location.search).toBe('');
    expect(text('[data-vendua="banner-stack"]')).toContain('Esse QR code não vale mais');
    expect(seen.table).toBeNull();
  });
});

describe('checkout at a table', () => {
  const at = (table = { label: 'Mesa 5', ordering: true, reason: null }) => {
    sessionStorage.setItem('vendua.table', JSON.stringify({ ...table, token: TOKEN }));
  };

  test('name only, the table as the delivery, pay at the table or online', async () => {
    const c = core({
      '/storefront/v1/store': TABLE_STORE,
      '/storefront/v1/table': tableRoute({ label: 'Mesa 5', ordering: true, reason: null }),
      '/checkout/v1/cart': { cart: OPEN_CART },
      '/checkout/v1/cart/delivery': { cart: { ...OPEN_CART, delivery: { mode: 'dine_in' } } },
      '/checkout/v1/checkout': { order: ORDER },
      [`/checkout/v1/orders/${ORDER_ID}`]: { order: ORDER },
    });
    localStorage.setItem('vendua.session', 'tok');
    at();
    m = await mount({ path: '/checkout', keep: true });
    await flush();
    expect($('input[name="name"]')).not.toBeNull();
    expect($('input[name="phone"]')).toBeNull();
    await act(async () => fill('name', 'Ana'));
    await submit('dados');
    await flush();
    const modes = $$('input[name="delivery-mode"]') as HTMLInputElement[];
    expect(modes.map((i) => i.value)).toEqual(['dine_in']);
    expect(modes[0]!.checked).toBe(true);
    expect(text('[data-vendua="checkout"], main')).toContain('Na Mesa 5');
    expect($('[data-vendua="table-leave"] button')).not.toBeNull();
    expect($('input[name="street"]')).toBeNull();
    await submit('entrega');
    await flush();
    expect(c.calls.find((x) => x.path === '/checkout/v1/cart/delivery')?.body).toEqual({
      mode: 'dine_in',
    });
    const pays = ($$('input[name="payment-method"]') as HTMLInputElement[]).map((i) => i.value);
    expect(pays).toEqual(['tab', 'pix', 'card_online']);
    expect(text('main')).toContain('Pagar na mesa');
    expect($('[data-vendua="checkout"] input[name="change-for"]')).toBeNull();
    await submit('pagamento');
    await flush();
    expect(c.calls.find((x) => x.path === '/checkout/v1/checkout')?.body).toEqual({
      customer: { name: 'Ana' },
      delivery: { mode: 'dine_in', table: TOKEN },
      payment: { method: 'tab' },
      // no payment rules: the cart's total is the one on the button
      expectedTotalCents: 1800,
    });
  });

  test('no online payments: only "Pagar na mesa"', async () => {
    core({
      '/storefront/v1/store': { ...TABLE_STORE, onlinePayments: { pix: false, card: false } },
      '/storefront/v1/table': tableRoute({ label: 'Mesa 5', ordering: true, reason: null }),
      '/checkout/v1/cart': { cart: OPEN_CART },
      '/checkout/v1/cart/delivery': { cart: OPEN_CART },
    });
    localStorage.setItem('vendua.session', 'tok');
    at();
    m = await mount({ path: '/checkout', keep: true });
    await flush();
    await act(async () => fill('name', 'Ana'));
    await submit('dados');
    await flush();
    await submit('entrega');
    await flush();
    const pays = ($$('input[name="payment-method"]') as HTMLInputElement[]).map((i) => i.value);
    expect(pays).toEqual(['tab']);
  });

  test('Core’s refusals in words; "não estou na mesa" brings delivery and pickup back', async () => {
    core({
      '/storefront/v1/store': TABLE_STORE,
      '/storefront/v1/table': tableRoute({ label: 'Mesa 5', ordering: true, reason: null }),
      '/checkout/v1/cart': { cart: OPEN_CART },
      '/checkout/v1/cart/delivery': { cart: OPEN_CART },
      '/checkout/v1/checkout': () =>
        json(429, { error: { code: 'TABLE_ORDERS_PENDING', message: 'wait' } }),
    });
    localStorage.setItem('vendua.session', 'tok');
    at();
    m = await mount({ path: '/checkout', keep: true, children: <NoProfile /> });
    m.unmount();
    // and no answers kept from an earlier checkout in this tab
    sessionStorage.removeItem('vendua.checkoutDraft');
    m = await mount({ path: '/checkout', keep: true });
    await flush();
    expect(($('input[name="name"]') as HTMLInputElement).value).toBe('');
    await act(async () => fill('name', 'Ana'));
    await submit('dados');
    await flush();
    await submit('entrega');
    await flush();
    await submit('pagamento');
    await flush();
    expect(text('[data-vendua="checkout-error"]')).toContain(
      'Esta mesa já tem pedidos esperando a equipe',
    );
    // back to the table step, then leave the table
    await act(async () =>
      (
        $$('[data-part="actions"] button').find((b) => b.textContent === 'Voltar') as HTMLElement
      ).click(),
    );
    await flush();
    await act(async () => ($('[data-vendua="table-leave"] button') as HTMLElement).click());
    await flush();
    // the phone was never asked: checkout starts over from "Seus dados"
    expect($('form[data-step="dados"]')).not.toBeNull();
    expect($('input[name="phone"]')).not.toBeNull();
    expect(sessionStorage.getItem('vendua.table')).toBeNull();
  });

  test('without a table, nothing changes', async () => {
    core({
      '/storefront/v1/store': TABLE_STORE,
      '/checkout/v1/cart': { cart: OPEN_CART },
      '/checkout/v1/cart/delivery': { cart: OPEN_CART },
    });
    m = await mount({ path: '/checkout', session: 'tok' });
    await flush();
    expect($('input[name="phone"]')).not.toBeNull();
    await act(async () => {
      fill('name', 'Ana');
      fill('phone', '22999990001');
    });
    await submit('dados');
    await flush();
    const modes = ($$('input[name="delivery-mode"]') as HTMLInputElement[]).map((i) => i.value);
    expect(modes).toEqual(['delivery', 'pickup']);
    expect(text('legend')).toContain('Como você quer receber?');
    expect($('[data-vendua="table-leave"]')).toBeNull();
  });
});

describe('the order at the table', () => {
  test('the table, "Pagar na mesa", and a path that ends served', async () => {
    core({
      '/storefront/v1/store': TABLE_STORE,
      [`/checkout/v1/orders/${ORDER_ID}`]: { order: { ...ORDER, state: 'ready' } },
    });
    localStorage.setItem('vendua.orderTokens', JSON.stringify({ [ORDER_ID]: 'tok' }));
    m = await mount({ path: `/pedido/${ORDER_ID}`, keep: true });
    await flush(8);
    const status = text('[data-vendua="order-status"]');
    expect(text('[data-vendua="order-status"] [data-part="table"]')).toContain('Mesa 5');
    expect(status).toContain('Pagar na mesa');
    expect(text('[data-part="progress"]')).toContain('Servido');
    expect(status).not.toContain('Saiu para entrega');
  });

  test('rules', () => {
    expect(orderPath('dine_in')).toEqual([
      'placed',
      'confirmed',
      'preparing',
      'ready',
      'delivered',
    ]);
    expect(orderStepLabel('delivered', 'dine_in')).toBe('Servido');
    expect(orderStateLabel('delivered', 'dine_in')).toBe('Servido');
    expect(orderStateLabel('delivered', 'delivery')).toBe('Entregue');
    expect(orderStateLabel('preparing')).toBe('Em preparo');
  });
});
