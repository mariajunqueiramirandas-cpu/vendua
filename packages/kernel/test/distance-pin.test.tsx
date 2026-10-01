import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { PRODUCT, STORE, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.15 (ADR 0024) — a store priced by road distance: the shopper confirms the delivery
// pin on a map, Core quotes that point, and the address step carries it.

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  window.history.replaceState(null, '', '/');
  globalThis.localStorage?.clear();
});
const $ = (s: string) => document.querySelector(s);
const text = (s: string) => $(s)?.textContent ?? '';
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label)) ?? null;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

const cart = {
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
    totalCents: 4700,
    itemCount: 1,
    minOrderCents: 0,
    remainingMinOrderCents: 0,
    belowMinOrder: false,
  },
  delivery: { mode: 'pickup' },
};
const DISTANCE = {
  baseFeeCents: 500,
  feePerKmCents: 150,
  minFeeCents: 700,
  maxKm: 8,
  freeOverCents: null,
  fromFeeCents: 700,
  center: { lat: -22.93, lng: -42.51 },
  tiles: { url: 'https://t.test/{z}/{x}/{y}.png', attribution: '© OpenStreetMap', maxZoom: 19 },
};

function distanceCore() {
  return core((url) => {
    if (url.pathname === '/storefront/v1/store')
      return json(200, { ...STORE, distancePricing: DISTANCE });
    if (url.pathname === '/checkout/v1/cart') return json(200, { cart });
    if (url.pathname === '/storefront/v1/geocode')
      return json(200, { point: { lat: -22.9301, lng: -42.4801, precision: 'address' } });
    if (url.pathname === '/checkout/v1/quote')
      return json(200, {
        eligible: true,
        zoneId: 'distance',
        zoneKind: 'distance',
        feeCents: 1550,
        distanceKm: 6.4,
        distanceSource: 'route',
        etaMin: 40,
        etaMax: 50,
        totals: { ...cart.totals, deliveryFeeCents: 1550, totalCents: 6250 },
      });
    if (url.pathname === '/checkout/v1/cart/delivery') return json(200, { cart });
    return null;
  });
}

describe('checkout — distance pricing pin', () => {
  test('the shopper confirms the pin; the quote and the address carry it', async () => {
    const c = distanceCore();
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      setValue('#checkout-name', 'Ana');
      setValue('#checkout-phone', '(22) 99999-0001');
    });
    await submitForm();
    await flush();

    expect($('[data-vendua="checkout"] .v-pin, .v-pin')).not.toBeNull();
    expect(document.body.textContent).toContain('a partir de R$');
    // the old bairro-zone locate button gives way to the map's own
    expect($('[data-part="locate"].v-locate')).toBeNull();

    // no pin yet: the step waits, nothing is sent
    await act(async () => {
      setValue('#checkout-street', 'Rua A');
      setValue('#checkout-number', '10');
      setValue('#checkout-neighborhood', 'Centro');
    });
    await submitForm();
    await flush();
    expect(text('.v-pin [data-part="error"]')).toContain('Confirme no mapa');
    expect(c.calls.some((x) => x.path === '/checkout/v1/cart/delivery')).toBe(false);

    // the typed address is placed on the map (debounced)
    await wait(800);
    await flush();
    const geo = c.calls.find((x) => x.path.startsWith('/storefront/v1/geocode'));
    expect(geo?.path).toContain('street=Rua+A');
    expect(geo?.path).toContain('number=10');

    await click(button('Confirmar local'));
    await flush();
    const q = c.calls.find((x) => x.path === '/checkout/v1/quote');
    expect(q?.body).toEqual({ lat: -22.9301, lng: -42.4801, paymentMethod: 'pix' });
    expect(text('.v-pin [data-part="status"]')).toMatch(
      /^6,4 km · entrega R\$\s15,50 · 40–50 min$/,
    );
    expect(button('Local confirmado')?.disabled).toBe(true);

    await submitForm();
    await flush();
    expect(c.calls.find((x) => x.path === '/checkout/v1/cart/delivery')?.body).toMatchObject({
      mode: 'delivery',
      street: 'Rua A',
      number: '10',
      lat: -22.9301,
      lng: -42.4801,
    });
  });

  test('a new street drops the confirmed pin', async () => {
    distanceCore();
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      setValue('#checkout-name', 'Ana');
      setValue('#checkout-phone', '(22) 99999-0001');
    });
    await submitForm();
    await flush();
    await click(button('Confirmar local'));
    await flush();
    expect(button('Local confirmado')).not.toBeNull();
    await act(async () => setValue('#checkout-street', 'Rua B'));
    await flush();
    expect(button('Local confirmado')).toBeNull();
    expect(button('Confirmar local')).not.toBeNull();
  });

  test('the map draws the tiles that cover it and moves with the keyboard', async () => {
    distanceCore();
    m = await mount({ path: '/checkout', session: 'tok' });
    await act(async () => {
      setValue('#checkout-name', 'Ana');
      setValue('#checkout-phone', '(22) 99999-0001');
    });
    await submitForm();
    await flush();
    const tiles = () =>
      [...document.querySelectorAll('.v-pin-tile')].map((i) => i.getAttribute('src'));
    expect(tiles().length).toBeGreaterThan(0);
    expect(tiles().every((s) => /^https:\/\/t\.test\/14\/\d+\/\d+\.png$/.test(s ?? ''))).toBe(true);
    await act(async () => {
      $('.v-pin-map')!.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    });
    expect(tiles().every((s) => s?.startsWith('https://t.test/15/'))).toBe(true);
    expect(text('.v-pin [data-part="attribution"]')).toBe('© OpenStreetMap');
  });
});
