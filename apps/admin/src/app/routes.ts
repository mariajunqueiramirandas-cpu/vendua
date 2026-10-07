import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createElement, lazy, type ComponentType } from 'react';
import { api, type PlanFeature, type Session } from '../lib/api.ts';
import { featureOpen } from '../lib/session.ts';
import { isoDate } from '../lib/format.ts';
import { qk } from '../lib/query.ts';
import { DEFAULT_PERIOD, reportsQuery } from '../features/reports/range.ts';

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
  kitchen: once(() => import('../features/kitchen/Kitchen.tsx')),
  pickup: once(() => import('../features/kitchen/Pickup.tsx')),
  pdv: once(() => import('../features/pdv/Vender.tsx')),
  pdvMesas: once(() => import('../features/pdv/Mesas.tsx')),
  pdvQr: once(() => import('../features/pdv/MesasQr.tsx')),
  pdvComanda: once(() => import('../features/pdv/Comanda.tsx')),
  pdvCaixa: once(() => import('../features/pdv/Caixa.tsx')),
  pdvReport: once(() => import('../features/pdv/CaixaReport.tsx')),
  menu: once(() => import('../features/menu/Menu.tsx')),
  product: once(() => import('../features/menu/ProductPage.tsx')),
  importMenu: once(() => import('../features/import/ImportPage.tsx')),
  stock: once(() => import('../features/menu/Stock.tsx')),
  store: once(() => import('../features/store/Store.tsx')),
  payments: once(() => import('../features/payments/Payments.tsx')),
  whatsapp: once(() => import('../features/whatsapp/Whatsapp.tsx')),
  printers: once(() => import('../features/printers/Printers.tsx')),
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
  vendedorHome: once(() => import('../features/vendedor/Home.tsx')),
  vendedorTrain: once(() => import('../features/vendedor/Train.tsx')),
  vendedorConversations: once(() => import('../features/vendedor/Conversations.tsx')),
  vendedorConversation: once(() => import('../features/vendedor/Conversation.tsx')),
  vendedorTeach: once(() => import('../features/vendedor/Teach.tsx')),
  vendedorEnsaio: once(() => import('../features/vendedor/Ensaio.tsx')),
  vendedorClienteOculto: once(() => import('../features/vendedor/ClienteOculto.tsx')),
  vendedorResults: once(() => import('../features/vendedor/Results.tsx')),
  vendedorSettings: once(() => import('../features/vendedor/Settings.tsx')),
  vendedorTest: once(() => import('../features/vendedor/TestChat.tsx')),
  // the route and the wide screens' dock (Shell) share one chunk
  copilot: once(() => import('../features/copilot/Copilot.tsx')),
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
  | 'kitchen'
  | 'pickup'
  | 'pdv'
  | 'pdvMesas'
  | 'pdvQr'
  | 'pdvComanda'
  | 'pdvCaixa'
  | 'pdvReport'
  | 'product'
  | 'importMenu'
  | 'stock'
  | 'menu'
  | 'store'
  | 'payments'
  | 'whatsapp'
  | 'printers'
  | 'customer'
  | 'customers'
  | 'marketing'
  | 'appearance'
  | 'reports'
  | 'team'
  | 'account'
  | 'profile'
  | 'help'
  | 'vendedorHome'
  | 'vendedorTrain'
  | 'vendedorConversations'
  | 'vendedorConversation'
  | 'vendedorTeach'
  | 'vendedorEnsaio'
  | 'vendedorClienteOculto'
  | 'vendedorResults'
  | 'vendedorSettings'
  | 'vendedorTest'
  | 'copilot';

interface RouteDef {
  id: RouteId;
  match: RegExp;
  chunk: () => Promise<unknown>;
  /** the query the screen opens with — same key and fetcher, so the screen finds it warm */
  data?: (qc: QueryClient, m: RegExpMatchArray) => Promise<unknown>;
}

const q = (qc: QueryClient, queryKey: readonly unknown[], queryFn: () => Promise<unknown>) =>
  qc.prefetchQuery({ queryKey, queryFn });

// a plan without the kitchen (or the Copilot) gets its locked page, not a 403 warm-up
const has = (qc: QueryClient, f: PlanFeature) => {
  const s = qc.getQueryData<Session>(qk.session);
  return !s || featureOpen(s, f);
};
const kds = (qc: QueryClient) => has(qc, 'kds');
const pdv = (qc: QueryClient) => has(qc, 'pdv');

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
    id: 'pickup',
    match: /^\/cozinha\/painel$/,
    chunk: chunks.pickup,
    data: (qc) => (kds(qc) ? q(qc, qk.kitchen, api.kitchen) : Promise.resolve()),
  },
  {
    id: 'kitchen',
    match: /^\/cozinha$/,
    chunk: chunks.kitchen,
    data: (qc) => (kds(qc) ? q(qc, qk.kitchen, api.kitchen) : Promise.resolve()),
  },
  {
    id: 'pdv',
    match: /^\/pdv$/,
    chunk: chunks.pdv,
    data: (qc) =>
      pdv(qc)
        ? Promise.all([q(qc, qk.pdv.state, api.pdv.state), q(qc, qk.catalog, api.catalog)])
        : Promise.resolve(),
  },
  {
    id: 'pdvMesas',
    match: /^\/pdv\/mesas$/,
    chunk: chunks.pdvMesas,
    data: (qc) => (pdv(qc) ? q(qc, qk.pdv.state, api.pdv.state) : Promise.resolve()),
  },
  {
    id: 'pdvQr',
    match: /^\/pdv\/mesas\/qr$/,
    chunk: chunks.pdvQr,
    data: (qc) => (pdv(qc) ? q(qc, qk.pdv.state, api.pdv.state) : Promise.resolve()),
  },
  {
    id: 'pdvComanda',
    match: /^\/pdv\/comanda\/([^/]+)$/,
    chunk: chunks.pdvComanda,
    data: (qc, m) =>
      pdv(qc) ? q(qc, qk.pdv.tab(m[1]!), () => api.pdv.tab(m[1]!)) : Promise.resolve(),
  },
  {
    id: 'pdvReport',
    match: /^\/pdv\/caixa\/([^/]+)$/,
    chunk: chunks.pdvReport,
    data: (qc, m) =>
      pdv(qc) ? q(qc, qk.pdv.session(m[1]!), () => api.pdv.session(m[1]!)) : Promise.resolve(),
  },
  {
    id: 'pdvCaixa',
    match: /^\/pdv\/caixa$/,
    chunk: chunks.pdvCaixa,
    data: (qc) => (pdv(qc) ? q(qc, qk.pdv.caixa, api.pdv.caixa) : Promise.resolve()),
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
    id: 'printers',
    match: /^\/impressoras(\/parear)?$/,
    chunk: chunks.printers,
    data: (qc) => q(qc, qk.printers, api.printers),
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
      const r = reportsQuery(DEFAULT_PERIOD);
      return q(qc, r.key, () => api.reports(r.params));
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
  {
    id: 'vendedorHome',
    match: /^\/vendedor$/,
    chunk: chunks.vendedorHome,
    data: (qc) => q(qc, qk.vendedor.home, api.vendedor.home),
  },
  {
    id: 'vendedorTrain',
    match: /^\/vendedor\/comecar$/,
    chunk: chunks.vendedorTrain,
    data: (qc) => q(qc, qk.vendedor.onboarding, api.vendedor.onboarding),
  },
  {
    id: 'vendedorConversation',
    match: /^\/vendedor\/conversas\/([^/]+)$/,
    chunk: chunks.vendedorConversation,
    data: (qc, m) => q(qc, qk.vendedor.thread(m[1]!), () => api.vendedor.thread(m[1]!)),
  },
  {
    // pages of the list: the screen reads it with useInfiniteQuery on the same key
    id: 'vendedorConversations',
    match: /^\/vendedor\/conversas$/,
    chunk: chunks.vendedorConversations,
    data: (qc) =>
      qc.prefetchInfiniteQuery({
        queryKey: qk.vendedor.threads('all', ''),
        queryFn: ({ pageParam }) =>
          api.vendedor.threads({ filter: 'all', ...(pageParam ? { before: pageParam } : {}) }),
        initialPageParam: '',
      }),
  },
  {
    id: 'vendedorTeach',
    match: /^\/vendedor\/ensinar$/,
    chunk: chunks.vendedorTeach,
    data: (qc) => q(qc, qk.vendedor.knowledge, api.vendedor.knowledge),
  },
  {
    id: 'vendedorEnsaio',
    match: /^\/vendedor\/ensaio$/,
    chunk: chunks.vendedorEnsaio,
    data: (qc) => q(qc, qk.vendedor.ensaio, api.vendedor.ensaio),
  },
  {
    id: 'vendedorClienteOculto',
    match: /^\/vendedor\/cliente-oculto$/,
    chunk: chunks.vendedorClienteOculto,
    data: (qc) => q(qc, qk.vendedor.clienteOculto, api.vendedor.clienteOculto),
  },
  {
    id: 'vendedorResults',
    match: /^\/vendedor\/resultados$/,
    chunk: chunks.vendedorResults,
    data: (qc) => q(qc, qk.vendedor.results('7d'), () => api.vendedor.results('7d')),
  },
  {
    id: 'vendedorSettings',
    match: /^\/vendedor\/configurar$/,
    chunk: chunks.vendedorSettings,
    data: (qc) => q(qc, qk.vendedor.settings, api.vendedor.settings),
  },
  {
    id: 'vendedorTest',
    match: /^\/vendedor\/testar$/,
    chunk: chunks.vendedorTest,
    data: (qc) => q(qc, qk.vendedor.testChat, api.vendedor.testChat),
  },
  {
    id: 'copilot',
    match: /^\/copiloto$/,
    chunk: chunks.copilot,
    data: (qc) => (has(qc, 'copilot') ? q(qc, qk.copilot, api.copilot.view) : Promise.resolve()),
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
