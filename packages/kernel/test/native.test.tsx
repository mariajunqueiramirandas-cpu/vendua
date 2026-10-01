import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useEffect } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { defineSection } from '../src/index.ts';
import { dismissError, showInfo } from '../src/errors.ts';
import { uaTraversal } from '../src/transitions.tsx';
import { PRODUCT, flush, mockCore, mount, type Mounted } from './harness.tsx';

// Kernel 1.11 — native feel: the bag as a modal route, checkout steps as history entries,
// pushes as view transitions.

let m: Mounted | null = null;
let nav: ReturnType<typeof useNavigate>;
let loc: ReturnType<typeof useLocation>;
const doc = document as unknown as { startViewTransition?: unknown };
const realAnimate = Element.prototype.animate;
afterEach(() => {
  m?.unmount();
  m = null;
  delete doc.startViewTransition;
  Element.prototype.animate = realAnimate;
  window.history.replaceState(null, '', '/');
});
const $ = (s: string) => document.querySelector(s);

function Grab() {
  nav = useNavigate();
  loc = useLocation();
  return null;
}

/** Element.animate that only finishes when told to (happy-dom has no animations) */
function holdAnimations() {
  const held: { keyframes: unknown; finish: () => void; cancelled: boolean }[] = [];
  Element.prototype.animate = function (keyframes: unknown) {
    let finish = () => {};
    let fail = (_: unknown) => {};
    const finished = new Promise<void>((res, rej) => {
      finish = () => res();
      fail = rej;
    });
    const rec = { keyframes, finish, cancelled: false };
    held.push(rec);
    return {
      finished,
      cancel: () => {
        rec.cancelled = true;
        fail(new Error('cancelled'));
      },
    } as unknown as Animation;
  } as typeof Element.prototype.animate;
  return held;
}

const fill = (name: string, value: string) => {
  const input = $(`input[name="${name}"]`) as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const submit = (step: string) =>
  act(async () =>
    ($(`form[data-step="${step}"]`) as HTMLFormElement).dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    ),
  );

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
function coreWithCart(over: Parameters<typeof mockCore>[0] = {}) {
  const core = mockCore(over);
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

  const STEPS = [
    '/',
    '/checkout',
    { pathname: '/checkout', state: { vStep: 'entrega', vStepN: 1, vFrom: 'dados' } },
    { pathname: '/checkout', state: { vStep: 'pagamento', vStepN: 2, vFrom: 'entrega' } },
  ];

  test('a reload mid-checkout goes back to the first step entry, one back from leaving', async () => {
    coreWithCart();
    m = await mount({ entries: STEPS, index: 3, session: 'tok', children: <Grab /> });
    await flush();
    expect($('form[data-step="dados"]')).not.toBeNull();
    expect(loc.pathname).toBe('/checkout');
    expect(loc.state).toBeNull();
    await act(async () => void nav(-1));
    await flush();
    expect(loc.pathname).toBe('/');
  });

  test('back onto a step once the order is placed leaves checkout in one press', async () => {
    mockCore(); // the order closed the cart: nothing open
    m = await mount({
      entries: [...STEPS, '/pedido/o1?novo=1'],
      index: 3,
      session: 'tok',
      children: <Grab />,
    });
    await flush();
    expect(loc.pathname).toBe('/');
  });

  test('the skip link (#main) keeps the step it was used on', async () => {
    coreWithCart();
    m = await mount({ path: '/checkout', session: 'tok', children: <Grab /> });
    await act(async () => {
      fill('name', 'Ana');
      fill('phone', '22999990000');
    });
    await submit('dados');
    await flush();
    expect($('form[data-step="entrega"]')).not.toBeNull();
    await act(async () => void nav({ hash: '#main' }));
    await flush();
    expect($('form[data-step="entrega"]')).not.toBeNull();
    expect(loc.hash).toBe('#main');
    expect((loc.state as { vStep?: string }).vStep).toBe('entrega');
    await act(async () => void nav(-1));
    await flush();
    expect($('form[data-step="entrega"]')).not.toBeNull();
    await act(async () => void nav(-1));
    await flush();
    expect($('form[data-step="dados"]')).not.toBeNull();
  });

  test('back while entrega syncs keeps the shopper where they went', async () => {
    coreWithCart();
    let release = () => {};
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input), 'http://shop.test').pathname === '/checkout/v1/cart/delivery') {
        await new Promise<void>((r) => (release = r));
        return new Response(JSON.stringify({ cart: OPEN_CART }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return base(input, init);
    }) as typeof fetch;
    m = await mount({ path: '/checkout', session: 'tok', children: <Grab /> });
    await act(async () => {
      fill('name', 'Ana');
      fill('phone', '22999990000');
    });
    await submit('dados');
    await flush();
    await act(async () => {
      fill('neighborhood', 'Centro');
      fill('street', 'Rua A');
      fill('number', '10');
    });
    await submit('entrega');
    await flush(2);
    await act(async () => void nav(-1));
    await flush();
    expect($('form[data-step="dados"]')).not.toBeNull();
    await act(async () => release());
    await flush();
    expect($('form[data-step="dados"]')).not.toBeNull();
    expect(loc.state).toBeNull();
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

  test('keep their location while the sheet opens over them', async () => {
    const schema = defineSection({ type: 'store:loc', settings: {} });
    let runs = 0;
    coreWithCart({
      templates: {
        home: { version: 1, page: 'home', sections: [{ id: 'l', type: 'store:loc' }] },
      },
    });
    m = await mount({
      path: '/',
      session: 'tok',
      sections: {
        '/sections/loc.tsx': {
          schema,
          default: function Loc() {
            const location = useLocation();
            useEffect(() => void runs++, [location]);
            return null;
          },
        },
      },
    });
    const before = runs;
    expect(before).toBeGreaterThan(0);
    await act(async () => ($('.v-header [data-vendua="cart-trigger"]') as HTMLElement).click());
    await flush();
    expect($('dialog[data-vendua="cart-sheet"]')).not.toBeNull();
    expect(runs).toBe(before);
  });
});

describe('the sheet and its surroundings', () => {
  const openSheet = async () => {
    await act(async () => ($('.v-header [data-vendua="cart-trigger"]') as HTMLElement).click());
    await flush();
    return $('dialog[data-vendua="cart-sheet"]') as HTMLDialogElement;
  };

  test('a toast raised over the sheet lives inside it (not inert, still announced)', async () => {
    coreWithCart();
    m = await mount({ path: '/', session: 'tok', children: <Grab /> });
    const sheet = await openSheet();
    await act(async () => showInfo('t1', 'Link da sacola copiado'));
    const region = $('[data-vendua="toast-region"]')!;
    expect(sheet.contains(region)).toBe(true);
    expect(region.getAttribute('aria-live')).toBe('polite');
    await act(async () => dismissError('info:t1'));
  });

  test('a dismissed toast leaves from the same node, hidden from the live region', async () => {
    const held = holdAnimations();
    mockCore();
    m = await mount({ path: '/' });
    await act(async () => showInfo('t2', 'Oi'));
    const node = $('[data-part="toast"]');
    expect(node).not.toBeNull();
    const added: Node[] = [];
    const mo = new MutationObserver((rs) => rs.forEach((r) => added.push(...r.addedNodes)));
    mo.observe(document.body, { childList: true, subtree: true });
    await act(async () => dismissError('info:t2'));
    await flush(1);
    mo.disconnect();
    expect($('[data-part="toast"]')).toBe(node);
    expect(node!.getAttribute('aria-hidden')).toBe('true');
    expect(added.filter((n) => n instanceof Element && n.closest('.v-toast-region'))).toEqual([]);
    await act(async () => held.forEach((a) => a.finish()));
    await flush();
    expect($('[data-part="toast"]')).toBeNull();
  });

  test('forward again while the back press animates the sheet away keeps it open', async () => {
    const held = holdAnimations();
    coreWithCart();
    m = await mount({ path: '/', session: 'tok', children: <Grab /> });
    const home = loc;
    const sheet = await openSheet();
    const sheetLoc = loc;
    const outs = () =>
      held.filter((a) => /translate[XY]\(100%\)"\}\]$/.test(JSON.stringify(a.keyframes))).length;
    // the browser went back: history now holds the page under the sheet
    window.history.replaceState({ usr: home.state, key: home.key, idx: 0 }, '', '/');
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    expect(outs()).toBe(1);
    // …and forward again before the close finished
    window.history.replaceState({ usr: sheetLoc.state, key: sheetLoc.key, idx: 1 }, '', '/sacola');
    await act(async () => void window.dispatchEvent(new PopStateEvent('popstate')));
    await act(async () => held.forEach((a) => a.finish()));
    await flush();
    expect(sheet.open).toBe(true);
    expect(loc.pathname).toBe('/sacola');
    // and it closes again normally
    await act(async () => (sheet.querySelector('[data-part="close"]') as HTMLElement).click());
    expect(outs()).toBe(2);
  });

  test('a blocking notice closes the sheet', async () => {
    const core = coreWithCart();
    m = await mount({ path: '/', session: 'tok', children: <Grab /> });
    await openSheet();
    core.surfaces.notices = [{ id: 'em', kind: 'emergency', title: 'Fechado agora' }];
    const { showError } = await import('../src/errors.ts');
    await act(async () => showError({ code: 'STORE_PAUSED' }));
    await flush();
    await act(async () => new Promise((r) => setTimeout(r, 450)));
    await flush();
    expect($('[data-vendua="blocking-overlay"]')).not.toBeNull();
    expect($('dialog[data-vendua="cart-sheet"]')).toBeNull();
    expect(loc.pathname).toBe('/');
    await act(async () => dismissError('error:STORE_PAUSED'));
  });

  test("the empty bag's 'Ver cardápio' goes to the menu", async () => {
    mockCore();
    m = await mount({ path: '/produto/pudim', session: 'tok', children: <Grab /> });
    await act(async () => void nav('/sacola', { state: { vBackground: loc } }));
    await flush();
    const sheet = $('dialog[data-vendua="cart-sheet"]')!;
    const browse = [...sheet.querySelectorAll('a, button')].find((b) =>
      /card[aá]pio/i.test(b.textContent ?? ''),
    ) as HTMLElement;
    await act(async () => browse.click());
    await act(async () => new Promise((r) => setTimeout(r, 450)));
    await flush();
    expect(loc.pathname).toBe('/cardapio');
    expect($('dialog[data-vendua="cart-sheet"]')).toBeNull();
  });

  test('a traversal the browser animated itself is flagged for its entry', async () => {
    mockCore();
    m = await mount({ path: '/', children: <Grab /> });
    window.history.replaceState({ usr: null, key: 'k-ua', idx: 0 }, '', '/');
    const e = new PopStateEvent('popstate');
    Object.defineProperty(e, 'hasUAVisualTransition', { value: true });
    window.dispatchEvent(e);
    expect(uaTraversal('k-ua')).toBe(true);
    // the next Kernel push clears it
    await act(async () => ($('[data-vendua="product-link"]') as HTMLElement).click());
    await flush();
    expect(uaTraversal('k-ua')).toBe(false);
  });
});
