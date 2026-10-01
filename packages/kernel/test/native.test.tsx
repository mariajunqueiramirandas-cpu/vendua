import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useNavigate, useNavigationType } from 'react-router-dom';
import { defineSection } from '../src/index.ts';
import { PRODUCT, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.11 — native feel: the bag as a modal route, checkout steps as history entries,
// pushes as view transitions.

let m: Mounted | null = null;
let nav: ReturnType<typeof useNavigate>;
const doc = document as unknown as { startViewTransition?: unknown };
afterEach(() => {
  m?.unmount();
  m = null;
  delete doc.startViewTransition;
  window.history.replaceState(null, '', '/');
});
const $ = (s: string) => document.querySelector(s);

function Grab() {
  nav = useNavigate();
  return null;
}

const ITEM = {
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
const OPEN_CART = {
  id: 'cart',
  status: 'open',
  items: [ITEM],
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

/** mockCore with a cart that already holds a line */
function coreWithCart() {
  const core = mockCore();
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    if (url.pathname === '/checkout/v1/cart')
      return new Response(JSON.stringify({ cart: OPEN_CART }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    return base(input, init);
  }) as typeof fetch;
  return core;
}

describe('the bag as a sheet', () => {
  test('CartTrigger opens /sacola over the page; closing returns to it', async () => {
    coreWithCart();
    m = await mount({
      path: '/',
      session: 'tok',
      children: <Grab />,
    });
    expect($('main[data-page="home"]')).not.toBeNull();
    await act(async () =>
      (
        $(
          'main [data-vendua="cart-trigger"], .v-header [data-vendua="cart-trigger"]',
        ) as HTMLElement
      ).click(),
    );
    await flush();
    const sheet = $('dialog[data-vendua="cart-sheet"]') as HTMLDialogElement | null;
    expect(sheet).not.toBeNull();
    expect(sheet!.open).toBe(true);
    // the page under the sheet is still the home page, not the cart page
    expect($('main[data-page="home"]')).not.toBeNull();
    expect($('main[data-vendua-page="cart"]')).toBeNull();
    expect(sheet!.querySelector('[data-presentation="drawer"]')).not.toBeNull();

    await act(async () => (sheet!.querySelector('[data-part="close"]') as HTMLElement).click());
    // the sheet animates out before the route pops
    await act(async () => new Promise((r) => setTimeout(r, 450)));
    await flush();
    expect($('dialog[data-vendua="cart-sheet"]')).toBeNull();
    expect($('main[data-page="home"]')).not.toBeNull();
  });

  test('a direct visit to /sacola keeps the full page', async () => {
    coreWithCart();
    m = await mount({ path: '/sacola', session: 'tok' });
    expect($('main[data-vendua-page="cart"]')).not.toBeNull();
    expect($('dialog[data-vendua="cart-sheet"]')).toBeNull();
    expect($('[data-presentation="page"]')).not.toBeNull();
  });
});

describe('checkout steps are history entries', () => {
  test('continuing pushes a step; back returns to the previous step, not out of checkout', async () => {
    coreWithCart();
    m = await mount({ path: '/checkout', session: 'tok', children: <Grab /> });
    expect($('form[data-step="dados"]')).not.toBeNull();
    const fill = (name: string, value: string) => {
      const input = $(`input[name="${name}"]`) as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    await act(async () => {
      fill('name', 'Ana');
      fill('phone', '22999990000');
    });
    await act(async () =>
      ($('form[data-step="dados"]') as HTMLFormElement).dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      ),
    );
    await flush();
    expect($('form[data-step="entrega"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toContain('Etapa 2 de 3');

    await act(async () => void nav(-1));
    await flush();
    expect($('form[data-step="dados"]')).not.toBeNull();
    expect($('[data-vendua-page="checkout"]')).not.toBeNull();
    expect(($('input[name="name"]') as HTMLInputElement).value).toBe('Ana');

    await act(async () => void nav(1));
    await flush();
    expect($('form[data-step="entrega"]')).not.toBeNull();
  });

  test('a step entry whose earlier answers are gone starts over at the first step', async () => {
    coreWithCart();
    m = await mount({ path: '/', session: 'tok', children: <Grab /> });
    await act(async () => void nav('/checkout', { state: { vStep: 'pagamento', vStepN: 2 } }));
    await flush();
    expect($('form[data-step="dados"]')).not.toBeNull();
  });
});

describe('navigator wrap', () => {
  test('a Kernel push runs inside startViewTransition with a typed transition', async () => {
    const calls: { types: string[] | undefined }[] = [];
    doc.startViewTransition = (arg: { update: () => Promise<void>; types?: string[] }) => {
      calls.push({ types: arg.types });
      const done = arg.update();
      return { finished: done, ready: done, updateCallbackDone: done };
    };
    mockCore();
    m = await mount({
      path: '/',
      children: <Grab />,
    });
    await act(async () => ($('[data-vendua="product-link"]') as HTMLElement).click());
    await flush();
    // ≥ 768 px a push degrades to a crossfade
    const wide = matchMedia('(min-width: 768px)').matches;
    expect(calls).toEqual([{ types: [wide ? 'fade' : 'push'] }]);
    expect($('main[data-page="product"]')).not.toBeNull();

    // filters (same path) and plain replaces never animate
    await act(async () => void nav('/produto/pudim?x=1'));
    await act(async () => void nav('/', { replace: true }));
    await flush();
    expect(calls).toHaveLength(1);
  });

  test('without View Transitions navigation is unchanged', async () => {
    mockCore();
    m = await mount({ path: '/' });
    await act(async () => ($('[data-vendua="product-link"]') as HTMLElement).click());
    await flush();
    expect($('main[data-page="product"]')).not.toBeNull();
  });
});

describe('pages under the modal-route table', () => {
  test('still see the real navigation type', async () => {
    const schema = defineSection({ type: 'store:nav-type', settings: {} });
    mockCore({
      templates: {
        catalog: {
          version: 1,
          page: 'catalog',
          sections: [{ id: 'nt', type: 'store:nav-type' }],
        },
      },
    });
    m = await mount({
      path: '/',
      sections: {
        '/sections/nav-type.tsx': {
          schema,
          default: function NavType() {
            return <p data-nav-type>{useNavigationType()}</p>;
          },
        },
      },
      children: <Grab />,
    });
    await act(async () => nav('/cardapio'));
    await flush();
    expect($('[data-nav-type]')?.textContent).toBe('PUSH');
    await act(async () => nav(-1));
    await act(async () => nav(1));
    await flush();
    expect($('[data-nav-type]')?.textContent).toBe('POP');
  });
});
