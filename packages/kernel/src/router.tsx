import { useEffect, useMemo } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { contentHandle, PAGE_CONTENT, type PageId } from '@vendua/templates';
import { useKernel } from './provider.tsx';
import { KERNEL_PATHS, resolvePaths } from './config.ts';
import { Slot } from './slot.tsx';
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

function Layout() {
  const layout = useTemplate('layout');
  if (!layout) return null;
  return (
    <PageContextProvider value={{ page: 'layout', params: {} }}>
      <TemplateView template={layout} />
    </PageContextProvider>
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
  return <Slot name="system.NotFound" path={pathname} homeHref="/" />;
}

export function StorefrontRoutes() {
  const { config } = useKernel();
  const paths = resolvePaths(config);
  const templates = useTemplateSet();
  const handles = useMemo(
    () =>
      Object.keys(templates)
        .map((p) => contentHandle(p as PageId))
        .filter((h): h is string => Boolean(h)),
    [templates],
  );
  const taken = new Set<string>([paths.home, paths.catalog, ...Object.values(KERNEL_PATHS)]);
  return (
    <RegistryProvider sdk={SDK_COMPONENTS}>
      <PageViews />
      <Routes>
        {Object.entries(config.redirects ?? {}).map(([from, to]) => (
          <Route key={`r:${from}`} path={from} element={<Navigate to={to} replace />} />
        ))}
        <Route element={<Layout />}>
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
    </RegistryProvider>
  );
}
