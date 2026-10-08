import { lazy as reactLazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { LoadingRows } from '@/components/common.tsx';
import { Page, type PageTab } from '@/components/Page.tsx';
import { AGENT_TABS } from '@/features/agent/tabs.ts';
import { AI_TABS } from '@/features/ai/tabs.ts';
import { PIPELINE_TABS } from '@/features/pipeline/tabs.ts';
import { STORES_TABS } from '@/features/stores/tabs.ts';

// Route chunks are content-hashed and a deploy replaces them — a tab opened before
// the deploy would 404 on its next lazy import. Reload once to pick up the new build;
// the sessionStorage flag stops a genuinely broken chunk from looping.
const RELOAD_KEY = 'vendua-control-chunk-reload';
const loaders: (() => Promise<unknown>)[] = [];
function lazy<T extends ComponentType>(load: () => Promise<{ default: T }>) {
  loaders.push(load);
  return reactLazy(() =>
    load().then(
      (m) => {
        try {
          sessionStorage.removeItem(RELOAD_KEY);
        } catch {
          /* storage blocked */
        }
        return m;
      },
      (err: unknown) => {
        let reloaded = false;
        try {
          reloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
          if (!reloaded) sessionStorage.setItem(RELOAD_KEY, '1');
        } catch {
          reloaded = true; // can't guard against a loop — surface the error instead
        }
        if (reloaded) throw err;
        window.location.reload();
        return new Promise<never>(() => undefined);
      },
    ),
  );
}

const OverviewPage = lazy(() => import('@/features/overview/OverviewPage.tsx'));
const HomePage = lazy(() => import('@/features/home/HomePage.tsx'));
const PipelinePage = lazy(() => import('@/features/pipeline/PipelinePage.tsx'));
const LeadPage = lazy(() => import('@/features/lead/LeadPage.tsx'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage.tsx'));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage.tsx'));
const InboxPage = lazy(() => import('@/features/inbox/InboxPage.tsx'));
const AgendaPage = lazy(() => import('@/features/agenda/AgendaPage.tsx'));
const ActivityPage = lazy(() => import('@/features/agent/activity/ActivityPage.tsx'));
const PlansPage = lazy(() => import('@/features/agent/plans/PlansPage.tsx'));
const DiscoveryPage = lazy(() => import('@/features/agent/discovery/DiscoveryPage.tsx'));
const StudioPage = lazy(() => import('@/features/agent/studio/StudioPage.tsx'));
const StoresPage = lazy(() => import('@/features/stores/StoresPage.tsx'));
const StorePage = lazy(() => import('@/features/stores/StorePage.tsx'));
const AiUsagePage = lazy(() => import('@/features/ai/UsagePage.tsx'));
const AiModelsPage = lazy(() => import('@/features/ai/ModelsPage.tsx'));
const AiVoicePage = lazy(() => import('@/features/ai/VoicePage.tsx'));
const BillingPlansPage = lazy(() => import('@/features/stores/PlansPage.tsx'));
const IncidentsPage = lazy(() => import('@/features/stores/IncidentsPage.tsx'));
const SiteTasksPage = lazy(() => import('@/features/sites/SiteTasksPage.tsx'));
const SiteTaskPage = lazy(() => import('@/features/sites/SiteTaskPage.tsx'));
const FleetPage = lazy(() => import('@/features/fleet/FleetPage.tsx'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage.tsx'));
const NotFoundPage = lazy(() => import('@/features/notfound/NotFoundPage.tsx'));
const UiPreview = lazy(() => import('@/features/dev/UiPreview.tsx'));

/** Old (pre-redesign) URL → new URL, carrying the query string plus `extra` params. */
function Legacy({
  to,
  extra,
}: {
  to: string | ((p: Record<string, string>) => string);
  extra?: Record<string, string>;
}) {
  const loc = useLocation();
  const params = useParams() as Record<string, string>;
  const [path, fixed = ''] = (typeof to === 'string' ? to : to(params)).split('?');
  const qs = new URLSearchParams(fixed);
  new URLSearchParams(loc.search).forEach((v, k) => qs.set(k, v));
  for (const [k, v] of Object.entries(extra ?? {})) qs.set(k, v);
  const s = qs.toString();
  return <Navigate to={`${path}${s ? `?${s}` : ''}`} replace />;
}

/** Header of the page being loaded, so only its content area shows a skeleton. */
function chrome(path: string): { title: string; tabs?: PageTab[]; back?: string } {
  if (path.startsWith('/pipeline/relatorios') || path.startsWith('/pipeline/analytics'))
    return { title: 'Pipeline', tabs: PIPELINE_TABS };
  if (path.startsWith('/pipeline/')) return { title: 'Lead', back: '/pipeline' };
  if (path.startsWith('/pipeline')) return { title: 'Pipeline', tabs: PIPELINE_TABS };
  if (path.startsWith('/inbox/')) return { title: 'conversa', back: '/inbox' };
  if (path.startsWith('/inbox')) return { title: 'Inbox' };
  if (path.startsWith('/agenda')) return { title: 'Agenda' };
  if (path.startsWith('/agente')) return { title: 'Agente', tabs: AGENT_TABS };
  if (path.startsWith('/lojas/sites/')) return { title: 'Site sob medida', back: '/lojas/sites' };
  if (/^\/lojas\/[0-9a-f-]{36}/.test(path)) return { title: 'Loja', back: '/lojas' };
  if (path.startsWith('/lojas')) return { title: 'Lojas', tabs: STORES_TABS };
  if (path.startsWith('/ia')) return { title: 'IA', tabs: AI_TABS };
  if (path.startsWith('/vendas')) return { title: 'Vendas' };
  if (path.startsWith('/config')) return { title: 'Config' };
  return { title: 'Visão' };
}

function RouteFallback() {
  const { pathname } = useLocation();
  return (
    <Page {...chrome(pathname)}>
      <LoadingRows />
    </Page>
  );
}

// Fetch the other hubs' chunks once the first screen is up, so switching hubs
// renders immediately instead of falling back to a skeleton.
function usePreloadRoutes() {
  useEffect(() => {
    const run = () => loaders.forEach((l) => void l().catch(() => undefined));
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(run, 1500);
    return () => clearTimeout(t);
  }, []);
}

const Lazy = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<RouteFallback />}>{children}</Suspense>
);

export function AppRoutes() {
  usePreloadRoutes();
  return (
    <Lazy>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/vendas" element={<HomePage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/pipeline/relatorios" element={<ReportsPage />} />
        <Route path="/pipeline/analytics" element={<AnalyticsPage />} />
        <Route path="/pipeline/:id" element={<LeadPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:threadId" element={<InboxPage />} />
        <Route path="/agenda" element={<AgendaPage />} />
        <Route path="/agente" element={<Navigate to="/agente/atividade" replace />} />
        <Route path="/agente/atividade" element={<ActivityPage />} />
        <Route path="/agente/atividade/:id" element={<ActivityPage />} />
        <Route path="/agente/planos" element={<PlansPage />} />
        <Route path="/agente/descoberta" element={<DiscoveryPage />} />
        <Route path="/agente/estudio" element={<StudioPage />} />
        <Route path="/lojas" element={<StoresPage />} />
        <Route path="/lojas/planos" element={<BillingPlansPage />} />
        <Route path="/lojas/incidentes" element={<IncidentsPage />} />
        <Route path="/lojas/frota" element={<FleetPage />} />
        <Route path="/lojas/sites" element={<SiteTasksPage />} />
        <Route path="/lojas/sites/:id" element={<SiteTaskPage />} />
        <Route path="/lojas/:id" element={<StorePage />} />
        <Route path="/ia" element={<AiUsagePage />} />
        <Route path="/ia/modelos" element={<AiModelsPage />} />
        <Route path="/ia/voz" element={<AiVoicePage />} />
        <Route path="/config" element={<SettingsPage />} />
        <Route path="/_ui" element={<UiPreview />} />

        <Route path="/funil" element={<Legacy to="/pipeline?v=board" />} />
        <Route path="/leads" element={<Legacy to="/pipeline" />} />
        <Route path="/leads/:id" element={<Legacy to={(p) => `/pipeline/${p.id}`} />} />
        <Route path="/aprovacoes" element={<Legacy to="/inbox?f=rascunhos" />} />
        <Route path="/tarefas" element={<Legacy to="/vendas?t=tarefas" />} />
        <Route path="/descoberta" element={<Legacy to="/agente/descoberta" />} />
        <Route path="/lancar" element={<Legacy to="/agente/descoberta" />} />
        <Route path="/estudio" element={<Legacy to="/agente/estudio" />} />
        <Route path="/plano" element={<Legacy to="/agente/planos" />} />
        <Route path="/relatorios" element={<Legacy to="/pipeline/relatorios" />} />
        <Route
          path="/agente/runs/:id"
          element={<Legacy to={(p) => `/agente/atividade/${p.id}`} />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Lazy>
  );
}
