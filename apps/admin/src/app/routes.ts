import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createElement, lazy, type ComponentType } from 'react';
import { api } from '../lib/api.ts';
import { isoDate } from '../lib/format.ts';
import { qk } from '../lib/query.ts';
import { rangeOf } from '../features/reports/range.ts';

// Every screen in one place: its code chunk and the query it opens with (its skeleton lives in
// routeSkeletons.tsx). Chunks warm up in the background after the first screen (Shell), and a
// finger on a link starts both the chunk and the data before the tap lands, so most screens
// open already filled in.

// A chunk's module, once it has arrived: a screen whose code is here renders at once, without
// React.lazy's first-render suspend (and the ~300 ms React holds a fallback once it's shown).
const arrived = new Map<() => Promise<unknown>, unknown>();
function once<T>(load: () => Promise<T>) {
  const get = (): Promise<T> =>
    load().then((m) => {
      arrived.set(get, m);
      return m;
    });
  return get;
}

export const chunks = {
  login: once(() => import('../features/auth/Login.tsx')),
  home: once(() => import('../features/home/Home.tsx')),
  orders: once(() => import('../features/orders/Orders.tsx')),
  history: once(() => import('../features/orders/History.tsx')),
  scheduled: once(() => import('../features/orders/Scheduled.tsx')),
  order: once(() => import('../features/orders/OrderPage.tsx')),
  menu: once(() => import('../features/menu/Menu.tsx')),
  product: once(() => import('../features/menu/ProductPage.tsx')),
  importMenu: once(() => import('../features/import/ImportPage.tsx')),
  stock: once(() => import('../features/menu/Stock.tsx')),
  store: once(() => import('../features/store/Store.tsx')),
  payments: once(() => import('../features/payments/Payments.tsx')),
  whatsapp: once(() => import('../features/whatsapp/Whatsapp.tsx')),
  customers: once(() => import('../features/customers/Customers.tsx')),
  customer: once(() => import('../features/customers/CustomerPage.tsx')),
  marketing: once(() => import('../features/marketing/Marketing.tsx')),
  appearance: once(() => import('../features/appearance/Appearance.tsx')),
  reports: once(() => import('../features/reports/Reports.tsx')),
  team: once(() => import('../features/team/Team.tsx')),
  account: once(() => import('../features/account/Account.tsx')),
  profile: once(() => import('../features/account/Profile.tsx')),
  help: once(() => import('../features/help/Help.tsx')),
  onboarding: once(() => import('../features/onboarding/Onboarding.tsx')),
  signup: once(() => import('../features/signup/Signup.tsx')),
  notFound: once(() => import('../features/notfound/NotFound.tsx')),
  sheets: once(() => import('./ShellSheets.tsx')),
  search: once(() => import('./Search.tsx')),
  skeletons: once(() => import('./routeSkeletons.tsx')),
};

/** A lazy screen that skips Suspense when its chunk is already here (warmed up or preloaded). */
export function screen<M, P extends object = object>(
  load: () => Promise<M>,
  pick: (m: M) => ComponentType<P>,
) {
  const Lazy = lazy(() =>
    load().then((m) => ({ default: pick(m) })),
  ) as unknown as ComponentType<P>;
  return function Screen(props: P) {
    const m = arrived.get(load) as M | undefined;
    return m ? createElement(pick(m), props) : createElement(Lazy, props);
  };
}

export type RouteId =
  | 'home'
  | 'history'
  | 'scheduled'
  | 'order'
  | 'orders'
  | 'product'
  | 'importMenu'
  | 'stock'
  | 'menu'
  | 'store'
  | 'payments'
  | 'whatsapp'
  | 'customer'
  | 'customers'
  | 'marketing'
  | 'appearance'
  | 'reports'
  | 'team'
  | 'account'
  | 'profile'
  | 'help';

interface RouteDef {
  id: RouteId;
  match: RegExp;
  chunk: () => Promise<unknown>;
  /** the query the screen opens with — same key and fetcher, so the screen finds it warm */
  data?: (qc: QueryClient, m: RegExpMatchArray) => Promise<unknown>;
}

const q = (qc: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<unknown>) =>
  qc.prefetchQuery({ queryKey, queryFn });

const ROUTES: RouteDef[] = [
  {
    id: 'home',
    match: /^\/$/,
    chunk: chunks.home,
    data: (qc) => q(qc, qk.home, api.home),
  },
  {
    id: 'history',
    match: /^\/pedidos\/historico$/,
    chunk: chunks.history,
    data: (qc) => {
      const params = { q: '', state: '', from: isoDate(new Date(Date.now() - 6 * 86_400_000)) };
      return qc.prefetchInfiniteQuery({
        queryKey: ['orders', 'list', params],
        queryFn: ({ pageParam }) =>
          api.orders({ ...params, ...(pageParam ? { before: pageParam } : {}) }),
        initialPageParam: '',
      });
    },
  },
  {
    id: 'scheduled',
    match: /^\/pedidos\/agendados$/,
    chunk: chunks.scheduled,
  },
  {
    id: 'order',
    match: /^\/pedidos\/([^/]+)$/,
    chunk: chunks.order,
    // the board already holds the whole order: the detail opens with it, then refreshes
    data: (qc, m) => q(qc, qk.order(m[1]!), () => api.order(m[1]!)),
  },
  {
    id: 'orders',
    match: /^\/pedidos$/,
    chunk: chunks.orders,
    data: (qc) => q(qc, qk.board, api.board),
  },
  {
    id: 'product',
    match: /^\/cardapio\/produto\/([^/]+)$/,
    chunk: chunks.product,
    data: (qc, m) => q(qc, qk.product(m[1]!), () => api.product(m[1]!)),
  },
  {
    id: 'importMenu',
    match: /^\/cardapio\/importar$/,
    chunk: chunks.importMenu,
    data: (qc) => q(qc, qk.imports, api.imports),
  },
  {
    id: 'stock',
    match: /^\/cardapio\/estoque$/,
    chunk: chunks.stock,
    data: (qc) => q(qc, qk.catalog, api.catalog),
  },
  {
    id: 'menu',
    match: /^\/cardapio$/,
    chunk: chunks.menu,
    data: (qc) => q(qc, qk.catalog, api.catalog),
  },
  {
    id: 'store',
    match: /^\/loja$/,
    chunk: chunks.store,
    data: (qc) => q(qc, qk.store, api.store),
  },
  {
    id: 'payments',
    match: /^\/pagamentos$/,
    chunk: chunks.payments,
    data: (qc) => q(qc, qk.payments, api.payments),
  },
  {
    id: 'whatsapp',
    match: /^\/whatsapp$/,
    chunk: chunks.whatsapp,
    data: (qc) => q(qc, qk.whatsapp, api.whatsapp),
  },
  {
    id: 'customer',
    match: /^\/clientes\/([^/]+)$/,
    chunk: chunks.customer,
    data: (qc, m) => q(qc, qk.customer(m[1]!), () => api.customer(m[1]!)),
  },
  {
    id: 'customers',
    match: /^\/clientes$/,
    chunk: chunks.customers,
    data: (qc) =>
      qc.prefetchInfiniteQuery({
        queryKey: ['customers', { q: '', sort: 'recent' }],
        queryFn: ({ pageParam }) => api.customers({ q: '', sort: 'recent', offset: pageParam }),
        initialPageParam: 0,
      }),
  },
  {
    id: 'marketing',
    match: /^\/marketing$/,
    chunk: chunks.marketing,
    data: (qc) => q(qc, qk.marketing, api.marketing),
  },
  {
    id: 'appearance',
    match: /^\/aparencia$/,
    chunk: chunks.appearance,
    data: (qc) => q(qc, qk.appearance, api.appearance),
  },
  {
    id: 'reports',
    match: /^\/relatorios$/,
    chunk: chunks.reports,
    data: (qc) => {
      const { from, to } = rangeOf('7d');
      return q(qc, qk.reports(from, to), () => api.reports(from, to));
    },
  },
  {
    id: 'team',
    match: /^\/equipe$/,
    chunk: chunks.team,
    data: (qc) => q(qc, qk.team, api.team),
  },
  {
    id: 'account',
    match: /^\/conta$/,
    chunk: chunks.account,
    data: (qc) => q(qc, qk.account, api.account),
  },
  {
    id: 'profile',
    match: /^\/perfil$/,
    chunk: chunks.profile,
  },
  {
    id: 'help',
    match: /^\/ajuda$/,
    chunk: chunks.help,
  },
];

export const matchRoute = (path: string) => {
  const clean = path.replace(/^\/admin/, '').split(/[?#]/)[0] || '/';
  for (const r of ROUTES) {
    const m = clean.match(r.match);
    if (m) return { r, m };
  }
  return null;
};

const warmed = new Map<string, number>();

/** Intent (hover, touch, focus on a link): start the screen's code and its data now. */
export function preloadRoute(qc: QueryClient, path: string) {
  const hit = matchRoute(path);
  if (!hit) return;
  void hit.r.chunk().catch(() => undefined);
  // one data warm-up per screen every few seconds is plenty; staleTime dedupes the rest
  const last = warmed.get(path) ?? 0;
  if (hit.r.data && Date.now() - last > 5_000) {
    warmed.set(path, Date.now());
    void hit.r.data(qc, hit.m).catch(() => undefined);
  }
}

/** Handlers for a link: preload on the first sign the finger (or pointer) is heading there. */
export function intent(qc: QueryClient, path: string) {
  const go = () => preloadRoute(qc, path);
  return { onPointerEnter: go, onPointerDown: go, onFocus: go };
}

/** `{...preload(path)}` on any link into a screen. */
export function usePreload() {
  const qc = useQueryClient();
  return (path: string) => intent(qc, path);
}

const slow = () => {
  const c = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return !!c?.saveData || /(^|-)2g$/.test(c?.effectiveType ?? '');
};

/**
 * After the first screen settles, fetch the code for every screen this person can open (and the
 * sheets), one at a time while the browser is idle — so a first tap never waits on the network.
 * Nothing on a data-saver or 2G connection; the service worker precaches them for later anyway.
 */
export function warmUp(paths: string[]) {
  if (slow()) return () => undefined;
  const loaders = [
    chunks.sheets,
    chunks.search,
    ...paths.map((p) => matchRoute(p)?.r.chunk).filter((x): x is () => Promise<unknown> => !!x),
    chunks.order,
    chunks.product,
    chunks.stock,
    chunks.customer,
    chunks.history,
  ];
  let stopped = false;
  const idle = (fn: () => void) =>
    'requestIdleCallback' in window
      ? requestIdleCallback(fn, { timeout: 3000 })
      : setTimeout(fn, 200);
  const next = () => {
    const load = loaders.shift();
    if (stopped || !load) return;
    idle(() => void load().then(next, next));
  };
  const start = setTimeout(next, 1200);
  return () => {
    stopped = true;
    clearTimeout(start);
  };
}
