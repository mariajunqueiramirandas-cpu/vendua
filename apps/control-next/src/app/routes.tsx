import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { LoadingRows } from '@/components/common.tsx';

const HomePage = lazy(() => import('@/features/home/HomePage.tsx'));
const PipelinePage = lazy(() => import('@/features/pipeline/PipelinePage.tsx'));
const LeadPage = lazy(() => import('@/features/lead/LeadPage.tsx'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage.tsx'));
const InboxPage = lazy(() => import('@/features/inbox/InboxPage.tsx'));
const AgendaPage = lazy(() => import('@/features/agenda/AgendaPage.tsx'));
const ActivityPage = lazy(() => import('@/features/agent/activity/ActivityPage.tsx'));
const PlansPage = lazy(() => import('@/features/agent/plans/PlansPage.tsx'));
const DiscoveryPage = lazy(() => import('@/features/agent/discovery/DiscoveryPage.tsx'));
const StudioPage = lazy(() => import('@/features/agent/studio/StudioPage.tsx'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage.tsx'));

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

const Lazy = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<LoadingRows className="p-4" />}>{children}</Suspense>
);

export function AppRoutes() {
  return (
    <Lazy>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/pipeline/relatorios" element={<ReportsPage />} />
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
        <Route path="/config" element={<SettingsPage />} />

        <Route path="/funil" element={<Legacy to="/pipeline?v=board" />} />
        <Route path="/leads" element={<Legacy to="/pipeline" />} />
        <Route path="/leads/:id" element={<Legacy to={(p) => `/pipeline/${p.id}`} />} />
        <Route path="/aprovacoes" element={<Legacy to="/inbox?f=rascunhos" />} />
        <Route path="/tarefas" element={<Legacy to="/?t=tarefas" />} />
        <Route path="/descoberta" element={<Legacy to="/agente/descoberta" />} />
        <Route path="/lancar" element={<Legacy to="/agente/descoberta" />} />
        <Route path="/estudio" element={<Legacy to="/agente/estudio" />} />
        <Route path="/plano" element={<Legacy to="/agente/planos" />} />
        <Route path="/relatorios" element={<Legacy to="/pipeline/relatorios" />} />
        <Route
          path="/agente/runs/:id"
          element={<Legacy to={(p) => `/agente/atividade/${p.id}`} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Lazy>
  );
}
