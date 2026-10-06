import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, type MemoryRouterProps } from 'react-router-dom';
import type { TemplateSet } from '@vendua/templates';
import {
  StorefrontRoutes,
  SystemSurfaces,
  VenduaProvider,
  defineStorefront,
  type StorefrontConfig,
} from '../src/index.ts';

// A mocked Core + a mounted storefront, for DOM tests of the Kernel runtime.

export const TOKENS = {
  color: {
    bg: '#FFFFFF',
    surface: '#FFFFFF',
    text: '#111111',
    muted: '#555555',
    accent: '#224466',
    onAccent: '#FFFFFF',
    danger: '#A33B32',
    success: '#3D7A4F',
  },
  font: { display: 'Georgia', body: 'system-ui' },
  radius: { sm: '2px', md: '4px', lg: '8px' },
  space: { scale: 1 },
  motion: { duration: '150ms', easing: 'ease' },
};

export const PRODUCT = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'pudim',
  name: 'Pudim',
  description: 'Lisinho.',
  basePriceCents: 1800,
  status: 'active',
  figureVariant: 'default',
  tags: [],
};

export const DETAIL = {
  ...PRODUCT,
  modifierGroups: [
    {
      id: 'g1',
      name: 'Tamanho',
      required: true,
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: 'm1', name: 'Pequeno', priceDeltaCents: 0, status: 'active' },
        { id: 'm2', name: 'Grande', priceDeltaCents: 800, status: 'active' },
      ],
    },
  ],
};

export const STORE = {
  slug: 'shop',
  name: 'Loja Teste',
  tagline: null,
  description: null,
  whatsapp: '5522999990000',
  instagram: null,
  city: 'Saquarema',
  address: 'Rua A, 1',
  status: 'open',
  hours: {
    timezone: 'America/Sao_Paulo',
    windows: [{ days: [0, 1, 2, 3, 4, 5, 6], open: '09:00', close: '22:00' }],
  },
  prepTimeMinutes: 30,
  minOrderCents: 0,
  pickupEnabled: true,
  deliveryEnabled: true,
  currency: 'BRL',
  vocabulary: {},
};

export interface MockCore {
  calls: { method: string; path: string; body?: unknown }[];
  surfaces: { version: 1; store: { status: string }; notices: unknown[] };
  templates: TemplateSet;
  failAdd?: { status: number; code: string };
  /** Kernel 1.14 — answers `GET /products/:slug/quote` (default: base + option deltas × qty) */
  quote?: (slug: string, query: URLSearchParams) => { status: number; body: unknown };
}

export function mockCore(over: Partial<MockCore> = {}): MockCore {
  const core: MockCore = {
    calls: [],
    surfaces: { version: 1, store: { status: 'open' }, notices: [] },
    templates: {},
    ...over,
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://shop.test');
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    core.calls.push({ method, path: url.pathname + url.search, body });
    const p = url.pathname;
    if (p === '/storefront/v1/store') return json(200, STORE);
    if (p === '/storefront/v1/catalog')
      return json(200, {
        categories: [{ id: 'c1', slug: 'doces', name: 'Doces', sort: 1, products: [PRODUCT] }],
      });
    const quoted = /^\/storefront\/v1\/products\/([^/]+)\/quote$/.exec(p);
    if (quoted) {
      if (core.quote) {
        const r = core.quote(decodeURIComponent(quoted[1]!), url.searchParams);
        return json(r.status, r.body);
      }
      if (quoted[1] !== 'pudim')
        return json(404, { error: { code: 'PRODUCT_NOT_FOUND', message: 'nope' } });
      const qty = Number(url.searchParams.get('qty'));
      const deltas = new Map(
        DETAIL.modifierGroups.flatMap((g) => g.modifiers.map((m) => [m.id, m.priceDeltaCents])),
      );
      const picks = (url.searchParams.get('modifiers') ?? '').split(',').filter(Boolean);
      const unit = picks.reduce((sum, pick) => {
        const [id, n] = pick.split(':');
        return sum + (deltas.get(id!) ?? 0) * Number(n ?? 1);
      }, DETAIL.basePriceCents);
      return json(200, { qty, unitPriceCents: unit, lineTotalCents: unit * qty });
    }
    if (p.startsWith('/storefront/v1/products/'))
      return p.endsWith('/pudim')
        ? json(200, { product: DETAIL })
        : json(404, { error: { code: 'PRODUCT_NOT_FOUND', message: 'nope' } });
    if (p === '/storefront/v1/surfaces') return json(200, core.surfaces);
    if (p === '/storefront/v1/state')
      return json(200, {
        version: 1,
        store: { status: 'open' },
        notices: [],
        loader: { state: 'normal' },
        templates: core.templates,
      });
    if (p === '/storefront/v1/zones') return json(200, { zones: [] });
    if (p === '/storefront/v1/events') return json(202, { accepted: 1 });
    if (p === '/checkout/v1/session') return json(201, { sessionToken: 'tok', cart: emptyCart() });
    if (p === '/checkout/v1/cart') return json(200, { cart: emptyCart() });
    if (p === '/checkout/v1/cart/items') {
      if (core.failAdd)
        return json(core.failAdd.status, { error: { code: core.failAdd.code, message: 'x' } });
      return json(201, { cart: emptyCart() });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: p } });
  }) as typeof fetch;
  return core;
}

function emptyCart() {
  return {
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
  };
}

export async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => new Promise((r) => setTimeout(r, 0)));
}

export interface Mounted {
  root: Root;
  el: HTMLElement;
  unmount: () => void;
}

export async function mount(opts: {
  path?: string;
  config?: Partial<StorefrontConfig>;
  snapshot?: TemplateSet;
  sections?: Record<string, unknown>;
  children?: ReactNode;
  /** a checkout session token already on this device (an open cart) */
  session?: string;
  /** a history to start from (instead of `path`), at `index` (default: the last entry) */
  entries?: MemoryRouterProps['initialEntries'];
  index?: number;
  /** a reload: this tab's storage stays as the last mount left it */
  keep?: boolean;
  /** localStorage entries the device already holds */
  local?: Record<string, string>;
}): Promise<Mounted> {
  if (!opts.keep) {
    sessionStorage.clear();
    localStorage.clear();
  }
  for (const [k, v] of Object.entries(opts.local ?? {})) localStorage.setItem(k, v);
  if (opts.session) localStorage.setItem('vendua.session', opts.session);
  const config = defineStorefront({ contract: 2, tokens: TOKENS, ...opts.config });
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(
      <VenduaProvider
        config={config}
        storefront={{
          sections: opts.sections ?? {},
          snapshot: { templates: opts.snapshot ?? {}, tokens: null },
        }}
      >
        <SystemSurfaces />
        <MemoryRouter
          initialEntries={opts.entries ?? [opts.path ?? '/']}
          {...(opts.index !== undefined ? { initialIndex: opts.index } : {})}
        >
          <StorefrontRoutes />
          {opts.children}
        </MemoryRouter>
      </VenduaProvider>,
    );
  });
  await flush();
  return {
    root,
    el,
    unmount: () => {
      act(() => root.unmount());
      el.remove();
    },
  };
}

export function reports(): { kind: string; target: string }[] {
  return ((
    globalThis as { __VENDUA_REPORTS__?: { kind: string; target: string }[] }
  ).__VENDUA_REPORTS__ ??= []);
}
