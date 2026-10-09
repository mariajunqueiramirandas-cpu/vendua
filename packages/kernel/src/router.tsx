import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { useKernel, useQuery } from './provider.tsx';
import { KERNEL_PATHS, resolvePaths } from './config.ts';
import { Slot } from './slot.tsx';
import { ScrollManager } from './scroll.tsx';
import { emit } from './telemetry.ts';
import { useStore } from './hooks.ts';
import { storeDescription, storeTitle, useDocumentMeta } from './head.ts';
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

/** Kernel 1.21 — a new page takes focus on its main heading (`#main h1`, else `#main` itself)
 *  and its title is announced: a screen reader would otherwise stay on the link that was tapped,
 *  now gone. The first load, a same-page change (?query, a checkout step), a #hash and the bag
 *  sheet leave focus alone. */
function RouteFocus() {
  const location = useLocation();
  const page = backgroundOf(location) ?? location;
  const { pathname, hash } = page;
  const [said, setSaid] = useState('');
  const prev = useRef<string | null>(null);
  useEffect(() => {
    const was = prev.current;
    prev.current = pathname;
    if (was === null || was === pathname || hash) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const land = () => {
      const main = document.getElementById('main');
      const heading = main?.querySelector<HTMLElement>('h1');
      // the page's data is still on its way: its heading comes with it (≤ 2 s)
      if (!heading && main?.querySelector('[aria-busy="true"]') && tries++ < 20) {
        timer = setTimeout(land, 100);
        return;
      }
      const target = heading ?? main;
      if (!target) return;
      // something inside the new page already has focus (an autofocus, the shopper): keep it
      const active = document.activeElement;
      if (active && active !== document.body && main?.contains(active)) return;
      if (!target.hasAttribute('tabindex')) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
      target.focus({ preventScroll: true });
      setSaid(document.title);
    };
    timer = setTimeout(land, 0);
    return () => clearTimeout(timer);
  }, [pathname, hash]);
  return (
    <p className="v-sr" data-vendua="route-announcer" aria-live="polite" aria-atomic="true">
      {said}
    </p>
  );
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

/** A template page's title and description: the store's, or the product's on its page. */
function StoreMeta() {
  const { store } = useStore();
  useDocumentMeta(store ? { title: storeTitle(store), description: storeDescription(store) } : {});
  return null;
}

function ProductMeta({ slug }: { slug: string }) {
  const { api } = useKernel();
  const { store } = useStore();
  // useProduct's read (same key, no second fetch) without a second product_view
  const q = useQuery(`product:${slug}`, () => api.product(slug));
  const product = q.data?.product;
  useDocumentMeta(
    !store
      ? {}
      : product
        ? {
            title: `${product.name} · ${store.name}`,
            description: product.description || storeDescription(store),
          }
        : q.error
          ? { title: storeTitle(store), description: storeDescription(store) }
          : {},
  );
  return null;
}

function TemplatePage({ page }: { page: PageId }) {
  const template = useTemplate(page);
  const params = useParams();
  if (!template) return <NotFoundPage />;
  const content = (
    <PageContextProvider value={{ page, params }}>
      <TemplateView template={template} only={(s) => s.type !== PAGE_CONTENT} />
    </PageContextProvider>
  );
  // brand pages own their own <main>; the skip-link target must exist either way
  return (
    <main id="main" data-page={page}>
      {page === 'product' ? <ProductMeta slug={params.slug ?? ''} /> : <StoreMeta />}
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
        <RouteFocus />
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
