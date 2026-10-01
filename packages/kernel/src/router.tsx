import { useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  matchPath,
  Navigate,
  Route,
  Routes,
  UNSAFE_LocationContext,
  useLocation,
  useNavigationType,
  useParams,
  type NavigationType,
} from 'react-router-dom';
import { contentHandle, PAGE_CONTENT, type PageId } from '@vendua/templates';
import { useKernel } from './provider.tsx';
import { KERNEL_PATHS, resolvePaths } from './config.ts';
import { Slot } from './slot.tsx';
import { ScrollManager } from './scroll.tsx';
import { emit } from './telemetry.ts';
import { useStore } from './hooks.ts';
import {
  PageContextProvider,
  RegistryProvider,
  TemplateView,
  useTemplate,
  useTemplateSet,
} from './composition/runtime.tsx';
import { SDK_COMPONENTS } from './sdk/index.ts';
import { CartPage } from './pages/cart.tsx';
import { CheckoutPage } from './pages/checkout.tsx';
import { OrderHistoryPage, OrderPage } from './pages/order.tsx';
import { backgroundOf, NativeNavigation } from './transitions.tsx';
import { CartSheet } from './sheet.tsx';

// The storefront's route table is data (Contract v2): brand pages come from
// templates, Kernel pages live in the reserved (vendua) group, all inside the
// store's layout template. Mount inside the storefront's router:
//   <BrowserRouter><StorefrontRoutes /></BrowserRouter>

/** Kernel-owned routes — the reserved `(vendua)` group (S07 visits each). */
export const KERNEL_ROUTES = [
  { path: KERNEL_PATHS.cart, page: 'cart' },
  { path: KERNEL_PATHS.checkout, page: 'checkout' },
  { path: KERNEL_PATHS.order, page: 'order' },
  { path: KERNEL_PATHS.orders, page: 'orders' },
] as const;

function PageViews() {
  const { pathname } = useLocation();
  useEffect(() => {
    emit('page_view', {
      path: pathname,
      referrer: document.referrer ? new URL(document.referrer).host : '',
    });
  }, [pathname]);
  return null;
}

// <Routes location> hands the pages a fresh location object and a POP type on every render;
// they keep seeing the real type and a location that only changes when the page does (the
// sheet opening over it is not a page change)
function RealNavigationType({ type, children }: { type: NavigationType; children: ReactNode }) {
  const { location } = useContext(UNSAFE_LocationContext);
  const same = useRef(location);
  const prev = same.current;
  if (
    prev.key !== location.key ||
    prev.pathname !== location.pathname ||
    prev.search !== location.search ||
    prev.hash !== location.hash
  )
    same.current = location;
  const stable = same.current;
  const value = useMemo(() => ({ location: stable, navigationType: type }), [stable, type]);
  return (
    <UNSAFE_LocationContext.Provider value={value}>{children}</UNSAFE_LocationContext.Provider>
  );
}

function Layout({ type }: { type: NavigationType }) {
  const layout = useTemplate('layout');
  if (!layout) return null;
  return (
    <RealNavigationType type={type}>
      <PageContextProvider value={{ page: 'layout', params: {} }}>
        <TemplateView template={layout} />
      </PageContextProvider>
    </RealNavigationType>
  );
}

function TemplatePage({ page }: { page: PageId }) {
  const template = useTemplate(page);
  const params = useParams();
  const { store } = useStore();
  useEffect(() => {
    if (store && page !== 'product') document.title = store.name;
  }, [store, page]);
  if (!template) return <NotFoundPage />;
  const content = (
    <PageContextProvider value={{ page, params }}>
      <TemplateView template={template} only={(s) => s.type !== PAGE_CONTENT} />
    </PageContextProvider>
  );
  // brand pages own their own <main>; the skip-link target must exist either way
  return (
    <main id="main" data-page={page}>
      {content}
    </main>
  );
}

export function NotFoundPage() {
  const { pathname } = useLocation();
  // the SPA answers 200 for every path; noindex keeps typo URLs out of search results
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  return <Slot name="system.NotFound" path={pathname} homeHref="/" />;
}

export function StorefrontRoutes() {
  const { config } = useKernel();
  const paths = resolvePaths(config);
  // transition direction: browsing (0) → product, sacola, pedidos (1) → checkout, pedido (2)
  const depth = useMemo(() => {
    const levels: [string, number][] = [
      [paths.product, 1],
      [KERNEL_PATHS.cart, 1],
      [KERNEL_PATHS.orders, 1],
      [KERNEL_PATHS.checkout, 2],
      [KERNEL_PATHS.order, 2],
    ];
    return (pathname: string) =>
      levels.find(([p]) => matchPath({ path: p, end: true }, pathname))?.[1] ?? 0;
  }, [paths.product]);
  return (
    <RegistryProvider sdk={SDK_COMPONENTS}>
      <NativeNavigation depth={depth}>
        <PageViews />
        <ScrollManager />
        <PageRoutes />
      </NativeNavigation>
    </RegistryProvider>
  );
}

/** The page table; a modal route (the bag sheet) keeps its background page rendered. */
function PageRoutes() {
  const { config } = useKernel();
  const paths = resolvePaths(config);
  const location = useLocation();
  const type = useNavigationType();
  const templates = useTemplateSet();
  const handles = useMemo(
    () =>
      Object.keys(templates)
        .map((p) => contentHandle(p as PageId))
        .filter((h): h is string => Boolean(h)),
    [templates],
  );
  const bg = backgroundOf(location);
  const sheet = bg && location.pathname === KERNEL_PATHS.cart ? bg : null;
  const taken = new Set<string>([paths.home, paths.catalog, ...Object.values(KERNEL_PATHS)]);
  return (
    <>
      {/* first in document order: the open sheet's controls come before the inert page's */}
      {sheet ? <CartSheet key={location.key} background={sheet} /> : null}
      {/* always given a location, so opening the sheet never remounts the page under it */}
      <Routes location={sheet ?? location}>
        {Object.entries(config.redirects ?? {}).map(([from, to]) => (
          <Route key={`r:${from}`} path={from} element={<Navigate to={to} replace />} />
        ))}
        <Route element={<Layout type={type} />}>
          <Route index element={<TemplatePage page="home" />} />
          <Route path={paths.catalog} element={<TemplatePage page="catalog" />} />
          <Route path={paths.product} element={<TemplatePage page="product" />} />
          <Route path={KERNEL_PATHS.cart} element={<CartPage />} />
          <Route path={KERNEL_PATHS.checkout} element={<CheckoutPage />} />
          <Route path={KERNEL_PATHS.order} element={<OrderPage />} />
          <Route path={KERNEL_PATHS.orders} element={<OrderHistoryPage />} />
          {handles
            .filter((h) => !taken.has(`/${h}`))
            .map((h) => (
              <Route key={`p:${h}`} path={`/${h}`} element={<TemplatePage page={`page:${h}`} />} />
            ))}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </>
  );
}
