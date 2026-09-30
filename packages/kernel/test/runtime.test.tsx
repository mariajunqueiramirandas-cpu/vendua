import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { TemplateSet } from '@vendua/templates';
import { defineBlock, defineSection, text, BlockArea, useAnalytics } from '../src/index.ts';
import { TOKENS, flush, mockCore, mount, reports, type Mounted } from './harness.tsx';

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  reports().length = 0;
  delete (globalThis as Record<string, unknown>).__VENDUA_STATE__;
});

const $ = (sel: string) => document.querySelector(sel);
const $$ = (sel: string) => [...document.querySelectorAll(sel)];

describe('StorefrontRoutes (Contract 2)', () => {
  test('a store with no templates renders the Kernel defaults', async () => {
    mockCore();
    m = await mount({ path: '/' });
    expect($('.v-header')?.textContent).toContain('Loja Teste');
    const links = $$('a[data-vendua="product-link"]');
    expect(links.length).toBe(1);
    expect(links[0]!.getAttribute('href')).toBe('/produto/pudim');
    expect($('.v-footer')).not.toBeNull();
  });

  test('live Core templates win over the build snapshot', async () => {
    const snapshot: TemplateSet = {
      home: {
        version: 1,
        page: 'home',
        sections: [{ id: 'rt', type: 'sdk:rich-text', settings: { title: 'Do snapshot' } }],
      },
    };
    mockCore({
      templates: {
        home: {
          version: 1,
          page: 'home',
          sections: [{ id: 'rt', type: 'sdk:rich-text', settings: { title: 'Do Core' } }],
        },
      },
    });
    m = await mount({ path: '/', snapshot });
    expect(document.body.textContent).toContain('Do Core');
    expect(document.body.textContent).not.toContain('Do snapshot');
  });

  test('the edge-injected design is the first paint: its tokens and templates', async () => {
    (globalThis as Record<string, unknown>).__VENDUA_STATE__ = {
      version: 1,
      store: { status: 'open' },
      notices: [],
      tokens: { ...TOKENS, color: { ...TOKENS.color, accent: '#123456' } },
      templates: {
        home: {
          version: 1,
          page: 'home',
          sections: [{ id: 'rt', type: 'sdk:rich-text', settings: { title: 'Da borda' } }],
        },
      },
    };
    const snapshot: TemplateSet = {
      home: {
        version: 1,
        page: 'home',
        sections: [{ id: 'rt', type: 'sdk:rich-text', settings: { title: 'Do snapshot' } }],
      },
    };
    mockCore();
    m = await mount({ path: '/', snapshot });
    expect(document.documentElement.style.getPropertyValue('--v-color-accent')).toBe('#123456');
    expect(document.body.textContent).toContain('Da borda');
    expect(document.body.textContent).not.toContain('Do snapshot');
  });

  test('injected tokens that fail validation are ignored', async () => {
    (globalThis as Record<string, unknown>).__VENDUA_STATE__ = {
      version: 1,
      store: { status: 'open' },
      notices: [],
      tokens: { color: { accent: 'javascript:alert(1)' } },
    };
    mockCore();
    m = await mount({ path: '/' });
    expect(document.documentElement.style.getPropertyValue('--v-color-accent')).toBe(
      TOKENS.color.accent,
    );
  });

  test('unknown section types render nothing, are reported, and never break the page', async () => {
    mockCore({
      templates: {
        home: {
          version: 1,
          page: 'home',
          sections: [
            { id: 'future', type: 'sdk:from-the-future' },
            {
              id: 'rt',
              type: 'sdk:rich-text',
              settings: { title: 'Ainda aqui', body: 'ok', bogus: 1 },
            },
          ],
        },
      },
    });
    m = await mount({ path: '/' });
    expect(document.body.textContent).toContain('Ainda aqui');
    expect(
      reports().some((r) => r.kind === 'section_unknown' && r.target === 'sdk:from-the-future'),
    ).toBe(true);
  });

  test('a throwing store section is contained and reported', async () => {
    const schema = defineSection({ type: 'store:boom', settings: {} });
    mockCore({
      templates: {
        home: {
          version: 1,
          page: 'home',
          sections: [
            { id: 'boom', type: 'store:boom' },
            { id: 'rt', type: 'sdk:rich-text', settings: { title: 'Sobrevive' } },
          ],
        },
      },
    });
    const orig = console.error;
    console.error = () => {};
    m = await mount({
      path: '/',
      sections: {
        '/sections/boom.tsx': {
          schema,
          default: () => {
            throw new Error('kaboom');
          },
        },
      },
    });
    console.error = orig;
    expect(document.body.textContent).toContain('Sobrevive');
    expect(
      reports().some((r) => r.kind === 'section_error' && r.target === 'store:boom#boom'),
    ).toBe(true);
  });

  test('areas accept blocks by category, cap at max, and settings come from the template', async () => {
    const story = defineSection({
      type: 'store:story',
      settings: { title: text({ max: 40, default: 'História' }) },
      areas: { aside: { accepts: ['badge'], max: 1 } },
    });
    const note = defineBlock({ type: 'store:note', category: 'info', settings: {} });
    mockCore({
      templates: {
        home: {
          version: 1,
          page: 'home',
          sections: [
            {
              id: 'story',
              type: 'store:story',
              settings: { title: 'Da cozinha' },
              blocks: {
                aside: [
                  { id: 'b1', type: 'sdk:promo-badge', settings: { text: 'Novo!' } },
                  { id: 'b2', type: 'sdk:promo-badge', settings: { text: 'Excede o max' } },
                  { id: 'b3', type: 'store:note' },
                ],
              },
            },
          ],
        },
      },
    });
    m = await mount({
      path: '/',
      sections: {
        '/sections/story.tsx': {
          schema: story,
          default: ({ settings }: { settings: { title: string } }) => (
            <section>
              <h2>{settings.title}</h2>
              <BlockArea name="aside" />
            </section>
          ),
        },
        '/sections/note.tsx': { schema: note, default: () => <p>nota</p> },
      },
    });
    expect(document.body.textContent).toContain('Da cozinha');
    expect(document.body.textContent).toContain('Novo!');
    expect(document.body.textContent).not.toContain('Excede o max');
    expect(document.body.textContent).not.toContain('nota');
  });

  test('a store module cannot claim the sdk: namespace', async () => {
    mockCore();
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (...a: unknown[]) => warned.push(String(a[0]));
    m = await mount({
      path: '/',
      sections: {
        '/sections/fake.tsx': {
          schema: defineSection({ type: 'sdk:header', settings: {} }),
          default: () => <p>fake</p>,
        },
      },
    });
    console.warn = warn;
    expect(warned.some((w) => w.includes("store sections must use a 'store:' type"))).toBe(true);
    expect($('.v-header')).not.toBeNull();
  });
});

describe('purchase panel + primitives', () => {
  test('add-to-cart stays disabled until the required group is chosen', async () => {
    const core = mockCore();
    m = await mount({ path: '/produto/pudim' });
    expect($('h1')?.textContent).toBe('Pudim');
    const add = $('[data-vendua="add-to-cart"]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await act(async () => ($('[role="radio"]') as HTMLButtonElement).click());
    expect(add.disabled).toBe(false);
    await act(async () => add.click());
    await flush();
    const post = core.calls.find((c) => c.path === '/checkout/v1/cart/items');
    expect(post?.body).toEqual({
      productId: '11111111-1111-4111-8111-111111111111',
      qty: 1,
      modifierIds: ['m1'],
    });
    // afterAdd: 'cart' → the Kernel cart page
    expect($('[data-vendua-page="cart"]')).not.toBeNull();
    const events =
      (globalThis as { __VENDUA_EVENTS__?: { name: string }[] }).__VENDUA_EVENTS__ ?? [];
    expect(events.map((e) => e.name)).toEqual(
      expect.arrayContaining(['page_view', 'product_view', 'add_to_cart']),
    );
  });

  test('an unhandled typed error surfaces as a default notice', async () => {
    mockCore({ failAdd: { status: 409, code: 'SOLD_OUT' } });
    m = await mount({ path: '/produto/pudim' });
    await act(async () => ($('[role="radio"]') as HTMLButtonElement).click());
    // the panel handles its own errors; exercise the no-onError path with a bare primitive
    const { AddToCart } = await import('../src/index.ts');
    const host = document.createElement('div');
    m.el.appendChild(host);
    m.unmount();
    m = await mount({
      path: '/nowhere-special',
      children: <AddToCart product={{ id: 'x', status: 'active' }} />,
    });
    await act(async () =>
      (
        document.querySelector('[data-vendua="add-to-cart"]:not(.v-btn)') as HTMLButtonElement
      ).click(),
    );
    await flush();
    expect($('[data-vendua="banner-stack"]')?.textContent).toContain('Esgotou agora há pouco');
  });

  test('product not found is a stable surface, not a crash', async () => {
    mockCore();
    m = await mount({ path: '/produto/nada' });
    expect(document.body.textContent).toContain('Produto não encontrado.');
  });
});

describe('Kernel pages (the (vendua) route group)', () => {
  for (const [path, page] of [
    ['/sacola', 'cart'],
    ['/checkout', 'checkout'],
    ['/pedidos', 'orders'],
    ['/nao-existe', 'not-found'],
  ] as const) {
    test(`${path} renders ${page} inside the layout`, async () => {
      mockCore();
      m = await mount({ path });
      expect($(`[data-vendua-page="${page}"]`)).not.toBeNull();
      expect($('.v-header')).not.toBeNull();
    });
  }

  test('config redirects keep old URLs alive', async () => {
    mockCore();
    m = await mount({ path: '/cart', config: { redirects: { '/cart': '/sacola' } } });
    expect($('[data-vendua-page="cart"]')).not.toBeNull();
  });
});

describe('slots, aliases, consent', () => {
  test('an override registered under a deprecated alias still reaches its slot', async () => {
    mockCore({
      surfaces: {
        version: 1,
        store: { status: 'paused' },
        notices: [
          {
            id: 'p',
            kind: 'store_paused',
            severity: 'blocking',
            title: 'Pausado',
            dismissible: false,
            priority: 1,
          },
        ],
      },
    });
    m = await mount({
      path: '/',
      config: {
        overrides: {
          'system.StorePausedNotice': async () => ({
            default: () => <div data-testid="brand-paused">marca</div>,
          }),
        },
      },
    });
    await flush(10);
    expect($('[data-vendua="blocking-overlay"] [data-testid="brand-paused"]')).not.toBeNull();
  });

  test('a throwing override falls back to the Kernel default and is reported', async () => {
    mockCore({
      surfaces: {
        version: 1,
        store: { status: 'open' },
        notices: [
          {
            id: 'n',
            kind: 'quantum',
            severity: 'weird',
            title: 'Aviso do futuro',
            dismissible: true,
            priority: 1,
          },
        ],
      },
    });
    const orig = console.error;
    console.error = () => {};
    m = await mount({
      path: '/',
      config: {
        overrides: {
          'system.Notice': async () => ({
            default: () => {
              throw new Error('override broke');
            },
          }),
        },
      },
    });
    await flush(10);
    console.error = orig;
    const stack = $('[data-vendua="banner-stack"]');
    expect(stack?.textContent).toContain('Aviso do futuro');
    expect(stack?.querySelector('[data-severity="info"]')).not.toBeNull();
    expect(reports().some((r) => r.kind === 'slot_error' && r.target === 'system.Notice')).toBe(
      true,
    );
  });

  test('consent banner only when the store declares purposes; custom events gated on it', async () => {
    mockCore();
    let track: ((n: `custom.${string}`) => boolean) | null = null;
    function Grab() {
      track = useAnalytics().track;
      return null;
    }
    m = await mount({
      path: '/',
      config: { consent: { purposes: ['analytics'] } },
      children: <Grab />,
    });
    expect($('[data-vendua="consent"]')).not.toBeNull();
    expect(track!('custom.hero_click')).toBe(false);
    await act(async () =>
      ($('[data-vendua="consent"] .v-btn-accent') as HTMLButtonElement).click(),
    );
    expect($('[data-vendua="consent"]')).toBeNull();
    expect(track!('custom.hero_click')).toBe(true);
    expect(track!('add_to_cart' as `custom.${string}`)).toBe(false);
  });
});
