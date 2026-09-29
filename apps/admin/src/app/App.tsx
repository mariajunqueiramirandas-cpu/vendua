import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../lib/api.ts';
import { clearPersisted } from '../lib/persist.ts';
import { qk } from '../lib/query.ts';
import { SessionCtx, useSessionQuery } from '../lib/session.ts';
import { applyTheme, type ThemePref } from '../lib/theme.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { ErrorState, Loading } from '../ui/feedback.tsx';
import { chunks, screen } from './routes.ts';
import { Shell } from './Shell.tsx';

const Login = screen(chunks.login, (m) => m.Login);
const Home = screen(chunks.home, (m) => m.default);
const Orders = screen(chunks.orders, (m) => m.default);
const OrderHistory = screen(chunks.history, (m) => m.default);
const Scheduled = screen(chunks.scheduled, (m) => m.default);
const OrderPage = screen(chunks.order, (m) => m.default);
const Menu = screen(chunks.menu, (m) => m.default);
const ProductPage = screen(chunks.product, (m) => m.default);
const Store = screen(chunks.store, (m) => m.default);
const Payments = screen(chunks.payments, (m) => m.default);
const Customers = screen(chunks.customers, (m) => m.default);
const CustomerPage = screen(chunks.customer, (m) => m.default);
const Marketing = screen(chunks.marketing, (m) => m.default);
const Appearance = screen(chunks.appearance, (m) => m.default);
const Reports = screen(chunks.reports, (m) => m.default);
const Team = screen(chunks.team, (m) => m.default);
const Account = screen(chunks.account, (m) => m.default);
const Profile = screen(chunks.profile, (m) => m.default);
const Help = screen(chunks.help, (m) => m.default);
const Onboarding = screen(chunks.onboarding, (m) => m.default);
const NotFound = screen(chunks.notFound, (m) => m.default);
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

  const unauth =
    (q.error instanceof ApiError && q.error.status === 401) || (q.isPending && signedOut.current);
  signedOut.current = unauth || (signedOut.current && !q.data);
  // Signed out from under us (expired, revoked, a redeploy with a fresh database): nothing of
  // that session may leak into the next sign-in — not its screens' data, not a write queued
  // offline, which would otherwise replay into whichever store signs in next.
  useEffect(() => {
    if (!unauth) return;
    qc.getMutationCache().clear();
    qc.removeQueries({ predicate: (x) => x.queryKey[0] !== qk.session[0] });
    void clearPersisted();
  }, [unauth, qc]);

  // the style reference renders without a session (CI screenshots it)
  if (loc.pathname === '/_ui')
    return (
      <Suspense fallback={null}>
        <UiReference />
      </Suspense>
    );
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
      // a Login chunk that fails or crawls on mobile data must not leave a bare background
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="mx-auto max-w-lg p-6" aria-busy>
              <Loading />
            </div>
          }
        >
          <Login />
        </Suspense>
      </ErrorBoundary>
    );
  // a failed re-check (Core mid-deploy, a 502, offline) keeps the app on its last session;
  // only a 401 signs out, and the error screen is for a first load with nothing to show
  if (!q.data)
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
