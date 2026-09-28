import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api.ts';
import { qk } from '../lib/query.ts';
import { SessionCtx, useSessionQuery } from '../lib/session.ts';
import { applyTheme, type ThemePref } from '../lib/theme.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { ErrorState, Loading } from '../ui/feedback.tsx';
import { Shell } from './Shell.tsx';

const Login = lazy(() => import('../features/auth/Login.tsx').then((m) => ({ default: m.Login })));
const Home = lazy(() => import('../features/home/Home.tsx'));
const Orders = lazy(() => import('../features/orders/Orders.tsx'));
const OrderHistory = lazy(() => import('../features/orders/History.tsx'));
const Scheduled = lazy(() => import('../features/orders/Scheduled.tsx'));
const OrderPage = lazy(() => import('../features/orders/OrderPage.tsx'));
const Menu = lazy(() => import('../features/menu/Menu.tsx'));
const ProductPage = lazy(() => import('../features/menu/ProductPage.tsx'));
const Store = lazy(() => import('../features/store/Store.tsx'));
const Payments = lazy(() => import('../features/payments/Payments.tsx'));
const Customers = lazy(() => import('../features/customers/Customers.tsx'));
const CustomerPage = lazy(() => import('../features/customers/CustomerPage.tsx'));
const Marketing = lazy(() => import('../features/marketing/Marketing.tsx'));
const Appearance = lazy(() => import('../features/appearance/Appearance.tsx'));
const Reports = lazy(() => import('../features/reports/Reports.tsx'));
const Team = lazy(() => import('../features/team/Team.tsx'));
const Account = lazy(() => import('../features/account/Account.tsx'));
const Profile = lazy(() => import('../features/account/Profile.tsx'));
const Help = lazy(() => import('../features/help/Help.tsx'));
const Onboarding = lazy(() => import('../features/onboarding/Onboarding.tsx'));
const NotFound = lazy(() => import('../features/notfound/NotFound.tsx'));
const UiReference = lazy(() => import('../features/dev/UiReference.tsx'));

export default function App() {
  const q = useSessionQuery();
  const qc = useQueryClient();
  const loc = useLocation();
  // once signed out, a background re-check keeps the sign-in on screen (its step lives there)
  const signedOut = useRef(false);
  useEffect(() => {
    const on = () => void qc.invalidateQueries({ queryKey: qk.session });
    window.addEventListener('vendua:unauthenticated', on);
    return () => window.removeEventListener('vendua:unauthenticated', on);
  }, [qc]);
  useEffect(() => {
    const t = q.data?.user.prefs.theme as ThemePref | undefined;
    if (t) applyTheme(t);
  }, [q.data?.user.prefs.theme]);

  // the style reference renders without a session (CI screenshots it)
  if (loc.pathname === '/_ui')
    return (
      <Suspense fallback={null}>
        <UiReference />
      </Suspense>
    );
  const unauth =
    (q.error instanceof ApiError && q.error.status === 401) || (q.isPending && signedOut.current);
  signedOut.current = unauth || (signedOut.current && !q.data);
  if (q.isPending && !unauth)
    return (
      <div className="mx-auto max-w-lg p-6" aria-busy>
        <Loading />
      </div>
    );
  if (unauth || loc.pathname === '/entrar')
    return q.data && !unauth ? (
      <Navigate to="/" replace />
    ) : (
      <Suspense fallback={null}>
        <Login />
      </Suspense>
    );
  if (q.error || !q.data)
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={q.error} retry={() => void q.refetch()} />
      </div>
    );
  return (
    <SessionCtx.Provider value={q.data}>
      <ErrorBoundary>
        <Routes>
          <Route
            path="/bem-vindo"
            element={
              <ErrorBoundary>
                <Suspense
                  fallback={
                    <div className="mx-auto max-w-lg p-6" aria-busy>
                      <Loading />
                    </div>
                  }
                >
                  <Onboarding />
                </Suspense>
              </ErrorBoundary>
            }
          />
          <Route
            path="*"
            element={
              <Shell>
                <Routes>
                  <Route index element={<Home />} />
                  <Route path="pedidos" element={<Orders />} />
                  <Route path="pedidos/historico" element={<OrderHistory />} />
                  <Route path="pedidos/agendados" element={<Scheduled />} />
                  <Route path="pedidos/:id" element={<OrderPage />} />
                  <Route path="cardapio" element={<Menu />} />
                  <Route path="cardapio/produto/:id" element={<ProductPage />} />
                  <Route path="loja" element={<Store />} />
                  <Route path="pagamentos" element={<Payments />} />
                  <Route path="clientes" element={<Customers />} />
                  <Route path="clientes/:phone" element={<CustomerPage />} />
                  <Route path="marketing" element={<Marketing />} />
                  <Route path="aparencia" element={<Appearance />} />
                  <Route path="relatorios" element={<Reports />} />
                  <Route path="equipe" element={<Team />} />
                  <Route path="conta" element={<Account />} />
                  <Route path="perfil" element={<Profile />} />
                  <Route path="ajuda" element={<Help />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Shell>
            }
          />
        </Routes>
      </ErrorBoundary>
    </SessionCtx.Provider>
  );
}
