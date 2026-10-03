import { lazy, Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { awaitingCardReturn } from '../features/signup/progress.ts';
import { trackPageview } from '../lib/analytics.ts';
import { ApiError } from '../lib/api.ts';
import { clearPersisted } from '../lib/persist.ts';
import { qk } from '../lib/query.ts';
import { can, featureOpen, SessionCtx, useSessionQuery } from '../lib/session.ts';
import { LockedPage } from '../ui/PlanLocked.tsx';
import { applyTheme, type ThemePref } from '../lib/theme.ts';
import { ErrorBoundary } from '../ui/ErrorBoundary.tsx';
import { ErrorState, Splash } from '../ui/feedback.tsx';
import { toast } from '../ui/Toast.tsx';
import { chunks, screen } from './routes.ts';
import { Shell } from './Shell.tsx';

const Login = screen(chunks.login, (m) => m.Login);
const Home = screen(chunks.home, (m) => m.default);
const Orders = screen(chunks.orders, (m) => m.default);
const OrderHistory = screen(chunks.history, (m) => m.default);
const Scheduled = screen(chunks.scheduled, (m) => m.default);
const OrderPage = screen(chunks.order, (m) => m.default);
const Kitchen = screen(chunks.kitchen, (m) => m.default);
const Pickup = screen(chunks.pickup, (m) => m.default);
const Menu = screen(chunks.menu, (m) => m.default);
const ProductPage = screen(chunks.product, (m) => m.default);
const ImportPage = screen(chunks.importMenu, (m) => m.default);
const Stock = screen(chunks.stock, (m) => m.default);
const Store = screen(chunks.store, (m) => m.default);
const Payments = screen(chunks.payments, (m) => m.default);
const Whatsapp = screen(chunks.whatsapp, (m) => m.default);
const Printers = screen(chunks.printers, (m) => m.default);
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
const Signup = screen(chunks.signup, (m) => m.default);
const NotFound = screen(chunks.notFound, (m) => m.default);
const VendedorHome = screen(chunks.vendedorHome, (m) => m.default);
const VendedorTrain = screen(chunks.vendedorTrain, (m) => m.default);
const VendedorConversations = screen(chunks.vendedorConversations, (m) => m.default);
const VendedorConversation = screen(chunks.vendedorConversation, (m) => m.default);
const VendedorTeach = screen(chunks.vendedorTeach, (m) => m.default);
const VendedorEnsaio = screen(chunks.vendedorEnsaio, (m) => m.default);
const VendedorClienteOculto = screen(chunks.vendedorClienteOculto, (m) => m.default);
const VendedorResults = screen(chunks.vendedorResults, (m) => m.default);
const VendedorSettings = screen(chunks.vendedorSettings, (m) => m.default);
const VendedorTest = screen(chunks.vendedorTest, (m) => m.default);
const UiReference = lazy(() => import('../features/dev/UiReference.tsx'));

export default function App() {
  const q = useSessionQuery();
  const qc = useQueryClient();
  const loc = useLocation();
  const nav = useNavigate();
  // once signed out, a background re-check keeps the sign-in on screen (its step lives there)
  const signedOut = useRef(false);
  useEffect(() => {
    const on = () => void qc.invalidateQueries({ queryKey: qk.session });
    window.addEventListener('vendua:unauthenticated', on);
    return () => window.removeEventListener('vendua:unauthenticated', on);
  }, [qc]);
  useEffect(() => trackPageview(loc.pathname), [loc.pathname]);
  useEffect(() => {
    const t = q.data?.user.prefs.theme as ThemePref | undefined;
    if (t) applyTheme(t);
  }, [q.data?.user.prefs.theme]);

  // Mercado Pago sends the card authorization back to /admin/?assinatura=retorno
  const retorno = new URLSearchParams(loc.search).get('assinatura') === 'retorno';
  const toSignup = retorno && loc.pathname !== '/comecar' && awaitingCardReturn();
  const hasSession = !!q.data;
  useEffect(() => {
    if (!retorno || toSignup || loc.pathname === '/comecar' || !hasSession) return;
    for (const k of [qk.account, qk.store, qk.home]) void qc.invalidateQueries({ queryKey: k });
    toast(
      'De volta do Mercado Pago. Quando ele confirmar, a assinatura aparece em Conta e plano.',
      {
        tone: 'info',
        ms: 8000,
        action: { label: 'ver', run: () => nav('/conta') },
      },
    );
    const u = new URL(window.location.href);
    u.searchParams.delete('assinatura');
    window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
  }, [retorno, toSignup, hasSession, loc.pathname, qc, nav]);

  const unauth =
    (q.error instanceof ApiError && q.error.status === 401) || (q.isPending && signedOut.current);
  signedOut.current = unauth || (signedOut.current && !q.data);
  // Signed out from under us (expired, revoked, a redeploy with a fresh database): nothing of
  // that session may leak into the next sign-in — not its screens' data, not a write queued
  // offline, which would otherwise replay into whichever store signs in next.
  // A query still watched here belongs to a screen shown signed out (the signup's plans and slug
  // check): removing it mid-fetch strands its observer on a skeleton forever, so it stays.
  useEffect(() => {
    if (!unauth) return;
    qc.getMutationCache().clear();
    qc.removeQueries({
      predicate: (x) => x.queryKey[0] !== qk.session[0] && x.getObserversCount() === 0,
    });
    void clearPersisted();
  }, [unauth, qc]);

  // the style reference renders without a session (CI screenshots it)
  if (loc.pathname === '/_ui')
    return (
      <Suspense fallback={null}>
        <UiReference />
      </Suspense>
    );
  // the card hand-off of a signup: its confirmation screen lives in the signup flow
  if (toSignup) return <Navigate to="/comecar?assinatura=retorno" replace />;
  // self-serve signup: before the session check, since it's mostly used signed out
  if (loc.pathname === '/comecar')
    return (
      <ErrorBoundary>
        <Suspense fallback={<Splash text="Preparando o seu cadastro…" />}>
          <Signup signedIn={!!q.data && !unauth} />
        </Suspense>
      </ErrorBoundary>
    );
  // an e-mail link opened while signed in still signs in with it (it may be another store)
  const emailLink = loc.pathname === '/entrar' && new URLSearchParams(loc.search).has('link');
  if (q.isPending && !unauth) return <Splash />;
  if (unauth || loc.pathname === '/entrar')
    return q.data && !unauth && !emailLink ? (
      <Navigate to="/" replace />
    ) : (
      // a Login chunk that fails or crawls on mobile data must not leave a bare background
      <ErrorBoundary>
        <Suspense fallback={<Splash text="Carregando…" />}>
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
  // a screen above this person's role isn't there for them (NotFound), like its nav entry
  const manager = can(q.data.user.role, 'manager');
  const owner = can(q.data.user.role, 'owner');
  // a plan without the Vendedor shows its screens as the upsell (ADR 0032)
  const vendedorOpen = featureOpen(q.data, 'vendedor');
  return (
    <SessionCtx.Provider value={q.data}>
      <ErrorBoundary>
        <Routes>
          <Route
            path="/bem-vindo"
            element={
              <ErrorBoundary>
                <Suspense fallback={<Splash text="Preparando seu passo a passo…" />}>
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
                  <Route path="cozinha" element={<Kitchen />} />
                  <Route path="cozinha/painel" element={<Pickup />} />
                  <Route path="cardapio" element={<Menu />} />
                  <Route path="cardapio/produto/:id" element={<ProductPage />} />
                  <Route path="cardapio/importar" element={<ImportPage />} />
                  <Route path="cardapio/estoque" element={<Stock />} />
                  <Route path="loja" element={<Store />} />
                  <Route path="pagamentos" element={<Payments />} />
                  <Route path="whatsapp" element={<Whatsapp />} />
                  <Route path="impressoras" element={<Printers />} />
                  <Route path="impressoras/parear" element={<Printers />} />
                  <Route path="clientes" element={<Customers />} />
                  <Route path="clientes/:phone" element={<CustomerPage />} />
                  <Route path="marketing" element={<Marketing />} />
                  <Route path="aparencia" element={<Appearance />} />
                  <Route path="relatorios" element={<Reports />} />
                  <Route path="equipe" element={<Team />} />
                  <Route path="conta" element={<Account />} />
                  <Route path="perfil" element={<Profile />} />
                  <Route path="ajuda" element={<Help />} />
                  {/* conversations stay open on any plan: threads handed to the store live there */}
                  <Route path="vendedor/conversas" element={<VendedorConversations />} />
                  <Route path="vendedor/conversas/:id" element={<VendedorConversation />} />
                  {!vendedorOpen ? (
                    <Route
                      path="vendedor/*"
                      element={<LockedPage title="Vendedor" feature="vendedor" />}
                    />
                  ) : null}
                  <Route
                    path="vendedor"
                    element={
                      vendedorOpen ? (
                        <VendedorHome />
                      ) : (
                        <LockedPage title="Vendedor" feature="vendedor" />
                      )
                    }
                  />
                  {owner && vendedorOpen ? (
                    <Route path="vendedor/comecar" element={<VendedorTrain />} />
                  ) : null}
                  {manager && vendedorOpen ? (
                    <>
                      <Route path="vendedor/ensinar" element={<VendedorTeach />} />
                      <Route path="vendedor/ensaio" element={<VendedorEnsaio />} />
                      <Route path="vendedor/cliente-oculto" element={<VendedorClienteOculto />} />
                      <Route path="vendedor/resultados" element={<VendedorResults />} />
                      <Route path="vendedor/configurar" element={<VendedorSettings />} />
                      <Route path="vendedor/testar" element={<VendedorTest />} />
                    </>
                  ) : null}
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
