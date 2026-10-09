import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { ERROR_CODES } from '../src/api.ts';
import { PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.21, second round — the order's status through the store's WhatsApp link (`?t=`),
// a note on one line of the order ("sem cebola"), and the bag reminder's opt-in at checkout.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
});

const $ = (s: string) => document.querySelector(s);
const $$ = (s: string) => [...document.querySelectorAll(s)];
const text = (s: string) => ($(s)?.textContent ?? '').replace(/ /g, ' ');
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const typeInto = (el: Element | null, value: string) =>
  act(async () => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });

type Answer = unknown | { status: number; body: unknown };
type Route = Answer | ((url: URL, init?: RequestInit) => Answer);
const isStatus = (a: unknown): a is { status: number; body: unknown } =>
  !!a && typeof a === 'object' && 'status' in a && 'body' in a;

/** mockCore with some routes answered here; `seen` keeps their requests (method, auth, body) */
function core(routes: Record<string, Route>) {
  const c = mockCore();
  const base = globalThis.fetch;
  const seen: { method: string; path: string; auth: string | null; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const r = routes[key] ?? routes[url.pathname];
    if (r !== undefined) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        method: init?.method ?? 'GET',
        path: url.pathname + url.search,
        auth: headers.authorization ?? null,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const a = typeof r === 'function' ? (r as (u: URL, i?: RequestInit) => Answer)(url, init) : r;
      return isStatus(a) ? json(a.status, a.body) : json(200, a);
    }
    return base(input, init);
  }) as typeof fetch;
  return { ...c, seen };
}

const ORDER_ID = '77777777-7777-4777-8777-777777777777';
const VOT = `vot.${ORDER_ID}.1793000000.${'a'.repeat(43)}`;
const TRACKING = {
  statusOnly: true,
  id: ORDER_ID,
  number: 12,
  state: 'preparing',
  storeName: 'Loja Teste',
  delivery: { mode: 'delivery', promisedFrom: null, promisedTo: null, etaMin: 30, etaMax: 45 },
  scheduledFor: null,
  placedAt: '2026-10-01T15:00:00Z',
  updatedAt: '2026-10-01T15:05:00Z',
  version: 2,
  timeline: [
    { at: '2026-10-01T15:00:00Z', to: 'placed' },
    { at: '2026-10-01T15:05:00Z', to: 'preparing' },
  ],
  items: [
    {
      name: 'Pudim',
      qty: 2,
      modifiers: [{ name: 'Calda extra', qty: 1 }],
      combo: [],
      note: 'sem granulado',
    },
  ],
};
const FULL = {
  id: ORDER_ID,
  number: 12,
  state: 'preparing',
  customer: { name: 'Ana Souza', phone: '22999990001' },
  delivery: { mode: 'delivery', etaMin: 30, etaMax: 45, address: 'Rua A, 10', feeCents: 500 },
  payment: { method: 'cash', status: 'pending', instructions: null },
  subtotalCents: 3600,
  deliveryFeeCents: 500,
  totalCents: 4100,
  placedAt: '2026-10-01T15:00:00Z',
  timeline: [],
  items: [
    {
      productId: PRODUCT.id,
      slug: 'pudim',
      name: 'Pudim',
      qty: 2,
      unitPriceCents: 1800,
      modifiers: [],
      combo: [],
      lineTotalCents: 3600,
      note: 'sem granulado',
    },
  ],
  version: 3,
};

describe('the order through the WhatsApp link', () => {
  test('?t= goes to the api client before the first read, leaves the address bar, stays', async () => {
    const c = core({ [`/checkout/v1/orders/${ORDER_ID}`]: { order: TRACKING } });
    window.history.replaceState(null, '', `/pedido/${ORDER_ID}?t=${VOT}&utm=wa`);
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    expect(window.location.search).toBe('?utm=wa');
    const reads = c.seen.filter((s) => s.path === `/checkout/v1/orders/${ORDER_ID}`);
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((r) => r.auth === `Bearer ${VOT}`)).toBe(true);
    expect(JSON.parse(localStorage.getItem('vendua.trackTokens') ?? '{}')[ORDER_ID]).toBe(VOT);

    // status only: state, items and the note, the way to the store — nothing to pay, nobody's data
    expect($('[data-vendua="order-tracking"]')).not.toBeNull();
    expect(text('[data-part="state"]')).toBe('Em preparo');
    expect(text('[data-vendua="order-tracking"] [data-part="items"]')).toContain('2× Pudim');
    expect(text('[data-part="item-note"]')).toContain('sem granulado');
    expect($('[data-vendua="order-whatsapp"]')).not.toBeNull();
    expect($('[data-vendua="order-status"]')).toBeNull();
    expect($('[data-part="reorder"]')).toBeNull();
    expect($('[data-vendua="order-items"]')).toBeNull();
    expect(document.body.textContent).not.toContain('R$');
    expect(document.title).toBe('Pedido #12 · Em preparo · Loja Teste');
    expect(c.seen.some((s) => s.path.endsWith('/pay'))).toBe(false);

    // a reload (the param is gone) still reads through the kept link
    m.unmount();
    const again = core({ [`/checkout/v1/orders/${ORDER_ID}`]: { order: TRACKING } });
    m = await mount({ path: `/pedido/${ORDER_ID}`, keep: true });
    expect(again.seen[0]?.auth).toBe(`Bearer ${VOT}`);
    expect($('[data-vendua="order-tracking"]')).not.toBeNull();
  });

  test('the device that placed the order keeps its full view', async () => {
    const c = core({ [`/checkout/v1/orders/${ORDER_ID}`]: { order: FULL } });
    window.history.replaceState(null, '', `/pedido/${ORDER_ID}?t=${VOT}`);
    m = await mount({
      path: `/pedido/${ORDER_ID}`,
      local: { 'vendua.orderTokens': JSON.stringify({ [ORDER_ID]: 'vst.cart.sig' }) },
    });
    expect(window.location.search).toBe('');
    expect(c.seen[0]?.auth).toBe('Bearer vst.cart.sig');
    expect($('[data-vendua="order-tracking"]')).toBeNull();
    expect($('[data-vendua="order-status"]')).not.toBeNull();
    // the item's note shows on the full order too
    expect(text('[data-vendua="order-items"] [data-part="item-note"]')).toContain('sem granulado');
  });

  test('a link Core refuses is dropped; a malformed one is ignored', async () => {
    core({
      [`/checkout/v1/orders/${ORDER_ID}`]: {
        status: 404,
        body: { error: { code: 'ORDER_NOT_FOUND', message: 'x' } },
      },
    });
    window.history.replaceState(null, '', `/pedido/${ORDER_ID}?t=${VOT}`);
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    expect($('[data-vendua="order-tracking"]')).toBeNull();
    expect(
      JSON.parse(localStorage.getItem('vendua.trackTokens') ?? '{}')[ORDER_ID],
    ).toBeUndefined();
    m.unmount();

    const c = core({ [`/checkout/v1/orders/${ORDER_ID}`]: { order: FULL } });
    window.history.replaceState(null, '', `/pedido/${ORDER_ID}?t=nope`);
    m = await mount({ path: `/pedido/${ORDER_ID}` });
    expect(window.location.search).toBe('');
    expect(localStorage.getItem('vendua.trackTokens')).toBeNull();
    expect(c.seen[0]?.auth ?? null).toBeNull();
  });
});

describe('a note on one line', () => {
  test('the product page sends it with the add', async () => {
    const c = core({
      'POST /checkout/v1/cart/items': {
        cart: { id: 'cart', status: 'open', items: [], totals: { itemCount: 1 } },
      },
    });
    m = await mount({ path: '/produto/pudim', session: 'tok' });
    const field = $('[data-part="note"] textarea') as HTMLTextAreaElement;
    expect(field.maxLength).toBe(140);
    await typeInto(field, '  sem calda  ');
    expect(text('[data-part="note"] .v-counter')).toBe('13/140');
    await click($('[role="radio"]'));
    await click($('[data-vendua="add-to-cart"]'));
    await flush();
    const add = c.seen.find((s) => s.path === '/checkout/v1/cart/items');
    expect(add?.body).toMatchObject({ productId: PRODUCT.id, note: 'sem calda' });
  });

  test('the bag shows it and edits it in place', async () => {
    const line = {
      id: 'line-1',
      productId: PRODUCT.id,
      slug: 'pudim',
      name: 'Pudim',
      qty: 1,
      unitPriceCents: 1800,
      productStatus: 'active',
      modifiers: [],
      lineTotalCents: 1800,
      note: 'sem calda',
    };
    const cart = (note: string | null) => ({
      id: 'cart',
      status: 'open',
      items: [{ ...line, note }],
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
    });
    let note = 'sem calda';
    const c = core({
      'GET /checkout/v1/cart': () => ({ cart: cart(note) }),
      'PATCH /checkout/v1/cart/items/line-1': () => {
        note = 'bem gelado';
        return { cart: cart(note) };
      },
    });
    m = await mount({ path: '/sacola', session: 'tok' });
    expect(text('.v-line [data-part="note"]')).toContain('sem calda');
    await click($('[data-part="note-toggle"]'));
    const field = $('[data-part="note-edit"] textarea') as HTMLTextAreaElement;
    expect(field.value).toBe('sem calda');
    await typeInto(field, 'bem gelado');
    await click($('[data-part="note-save"]'));
    await flush();
    const patch = c.seen.find((s) => s.method === 'PATCH');
    expect(patch?.body).toEqual({ note: 'bem gelado' });
    expect(text('.v-line [data-part="note"]')).toContain('bem gelado');
  });
});

describe('the bag reminder at checkout', () => {
  const OPEN = {
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
  const fill = (name: string, value: string) => typeInto($(`input[name="${name}"]`), value);
  const box = () => $('[data-vendua="cart-reminder"] input') as HTMLInputElement | null;

  test('unticked, only with a valid phone; ticking and unticking tell Core', async () => {
    const c = core({
      '/storefront/v1/store': { ...STORE, cartReminder: true },
      'GET /checkout/v1/cart': { cart: OPEN },
      'POST /checkout/v1/cart/reminder': { reminder: { on: true } },
      'DELETE /checkout/v1/cart/reminder': { reminder: { on: false } },
    });
    m = await mount({ path: '/checkout', session: 'tok' });
    await fill('name', 'Ana');
    await fill('phone', '2299999');
    expect(box()).toBeNull();
    await fill('phone', '22999990001');
    expect(box()).not.toBeNull();
    expect(box()!.checked).toBe(false);
    expect(text('[data-vendua="cart-reminder"]')).toContain(
      'Me lembre pelo WhatsApp se eu não terminar o pedido',
    );
    await click(box());
    await flush();
    const on = c.seen.find((s) => s.method === 'POST' && s.path === '/checkout/v1/cart/reminder');
    expect(on?.body).toEqual({ phone: '(22) 99999-0001', name: 'Ana' });
    expect(on?.auth).toBe('Bearer tok');
    expect(box()!.checked).toBe(true);
    await click(box());
    await flush();
    expect(c.seen.some((s) => s.method === 'DELETE')).toBe(true);
    expect(box()!.checked).toBe(false);
  });

  test('a refusal unticks quietly; a store without it shows nothing', async () => {
    core({
      '/storefront/v1/store': { ...STORE, cartReminder: true },
      'GET /checkout/v1/cart': { cart: OPEN },
      'POST /checkout/v1/cart/reminder': {
        status: 409,
        body: { error: { code: 'REMINDER_OFF', message: 'x' } },
      },
    });
    m = await mount({ path: '/checkout', session: 'tok' });
    await fill('phone', '22999990001');
    await click(box());
    await flush();
    expect(box()!.checked).toBe(false);
    expect($('[role="alert"]')).toBeNull();
    m.unmount();

    core({ 'GET /checkout/v1/cart': { cart: OPEN } });
    m = await mount({ path: '/checkout', session: 'tok' });
    await fill('phone', '22999990001');
    expect(box()).toBeNull();
    expect($$('input[type="checkbox"]').length).toBeGreaterThan(0);
  });

  test('its error codes are known', () => {
    expect(ERROR_CODES).toContain('REMINDER_OFF');
    expect(ERROR_CODES).toContain('INVALID_PHONE');
  });
});
