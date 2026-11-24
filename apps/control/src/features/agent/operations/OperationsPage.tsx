import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Page } from '@/components/Page.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Select } from '@/components/ui/input.tsx';
import { useIsDesktop, useIsMobile } from '@/lib/hooks.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { AgentStatusPill } from '../AgentStatusPill.tsx';
import { ByKindTable, MetricsStrip } from '../activity/Metrics.tsx';
import { RUN_VIEWS, runListParams } from '../activity/queries.ts';
import { RunDetail } from '../activity/RunDetail.tsx';
import { RunList } from '../activity/RunList.tsx';
import {
  buildQueue,
  isLive,
  planProgress,
  useAllLeads,
  useScheduledRuns,
  useWakeups,
} from '../queue.ts';
import { AGENT_TABS } from '../tabs.ts';
import { PlansView } from './PlansView.tsx';
import { QueueView } from './QueueView.tsx';

type OpsView = 'fila' | 'execucoes' | 'planos';

const KINDS = Object.entries(RUN_KIND_LABEL);
const DAYS = [
  ['7', '7d'],
  ['30', '30d'],
] as const;

function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/**
 * Agente → Operação: single home for the deduplicated upcoming queue, live & past
 * execution trajectories, and active per-lead agent plans.
 */
export default function OperationsPage() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const desktop = useIsDesktop();
  const mobile = useIsMobile();
  const now = useMinuteClock();

  const rawView = sp.get('v');
  const view: OpsView = id
    ? 'execucoes'
    : rawView === 'execucoes' || rawView === 'planos'
      ? rawView
      : 'fila';

  const kind = sp.get('kind') ?? '';
  const status = sp.get('status') ?? '';
  const days: 7 | 30 = sp.get('d') === '30' ? 30 : 7;

  const setParam = (k: string, v: string) =>
    setSp(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const switchView = (next: OpsView) => {
    const qs = new URLSearchParams();
    if (next !== 'fila') qs.set('v', next);
    const s = qs.toString();
    nav(`/agente/operacao${s ? `?${s}` : ''}`);
  };

  // Shared queue + plans sources — cached by TanStack Query so switching pills is instant.
  const leadsQ = useAllLeads();
  const schedQ = useScheduledRuns();
  const wakeQ = useWakeups('pending', 200, true);

  const ready = Boolean(leadsQ.data && schedQ.data && wakeQ.data);
  const leads = leadsQ.data ?? [];
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const queue = useMemo(
    () => (ready ? buildQueue(leads, schedQ.data ?? [], wakeQ.data ?? [], now) : []),
    [ready, leads, schedQ.data, wakeQ.data, now],
  );
  const planned = useMemo(
    () =>
      leads
        .filter((l) => isLive(l) && l.agentPlan.length > 0)
        .sort((a, b) => planProgress(b).ratio - planProgress(a).ratio),
    [leads],
  );
  const queueErr = !ready ? leadsQ.error || schedQ.error || wakeQ.error : null;
  const retryQueue = () => {
    void leadsQ.refetch();
    void schedQ.refetch();
    void wakeQ.refetch();
  };

  const execQs = useMemo(() => {
    const p = new URLSearchParams();
    p.set('v', 'execucoes');
    if (status) p.set('status', status);
    if (kind) p.set('kind', kind);
    if (days === 30) p.set('d', '30');
    return `?${p.toString()}`;
  }, [status, kind, days]);
  const listPath = `/agente/operacao${execQs}`;
  const openRun = (rid: string) => nav(`/agente/operacao/${rid}${execQs}`);
  const runParams = runListParams(kind, status);

  const viewSwitcher = (
    <Segmented
      size="sm"
      value={view}
      onChange={switchView}
      options={[
        [
          'fila',
          <>
            próximos
            {ready && queue.length > 0 && (
              <span className="text-muted-foreground tnum">{queue.length}</span>
            )}
          </>,
        ],
        ['execucoes', 'execuções'],
        [
          'planos',
          <>
            planos
            {ready && planned.length > 0 && (
              <span className="text-muted-foreground tnum">{planned.length}</span>
            )}
          </>,
        ],
      ]}
    />
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {viewSwitcher}
      {view === 'execucoes' && (
        <div className="flex min-w-0 flex-1 items-center gap-2 md:ml-auto md:flex-none">
          {mobile ? (
            <Select
              value={status}
              onChange={(e) => setParam('status', e.target.value)}
              aria-label="status"
              className="flex-1"
            >
              {RUN_VIEWS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          ) : (
            <Segmented
              size="sm"
              value={status}
              onChange={(v) => setParam('status', v)}
              options={RUN_VIEWS}
            />
          )}
          <Select
            value={kind}
            onChange={(e) => setParam('kind', e.target.value)}
            aria-label="tipo"
            className={mobile ? 'flex-1' : 'w-40'}
          >
            <option value="">todos os tipos</option>
            {KINDS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );

  // Phones/tablets: opening a specific execution shows its detail route with back chevron.
  if (!desktop && id) {
    return (
      <Page title="Agente" tabs={AGENT_TABS} back={listPath} actions={<AgentStatusPill />}>
        <RunDetail id={id} />
      </Page>
    );
  }

  if (view === 'fila') {
    return (
      <Page title="Agente" tabs={AGENT_TABS} actions={<AgentStatusPill />} toolbar={toolbar}>
        <QueueView
          queue={queue}
          byId={byId}
          plannedCount={planned.length}
          now={now}
          ready={ready}
          error={queueErr}
          onRetry={retryQueue}
        />
      </Page>
    );
  }

  if (view === 'planos') {
    return (
      <Page title="Agente" tabs={AGENT_TABS} actions={<AgentStatusPill />} toolbar={toolbar}>
        <PlansView
          planned={planned}
          ready={Boolean(leadsQ.data)}
          error={!leadsQ.data ? leadsQ.error : null}
          onRetry={() => void leadsQ.refetch()}
        />
      </Page>
    );
  }

  // view === 'execucoes'
  const metrics = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold">resumo operacional</h2>
        <span className="hidden truncate text-xs text-muted-foreground md:inline">
          prompt, ferramentas, tokens e custo por execução
        </span>
        <Segmented
          size="sm"
          className="ml-auto"
          value={String(days) as '7' | '30'}
          onChange={(v) => setParam('d', v === '30' ? '30' : '')}
          options={DAYS}
        />
      </div>
      <MetricsStrip days={days} />
    </div>
  );

  if (!desktop) {
    return (
      <Page title="Agente" tabs={AGENT_TABS} actions={<AgentStatusPill />} toolbar={toolbar}>
        <div className="flex flex-col gap-3">
          {metrics}
          <details className="group rounded-lg border bg-card">
            <summary className="flex h-9 cursor-pointer list-none items-center px-3 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
              por tipo de execução
            </summary>
            <div className="border-t">
              <ByKindTable days={days} />
            </div>
          </details>
          <div className="-mx-3 border-y bg-card md:mx-0 md:rounded-lg md:border-x">
            <RunList params={runParams} view={status} onOpen={openRun} />
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page title="Agente" tabs={AGENT_TABS} actions={<AgentStatusPill />} toolbar={toolbar} bleed>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[50%] max-w-[760px] min-w-[460px] shrink-0 flex-col overflow-auto border-r bg-card">
          <RunList params={runParams} view={status} selectedId={id} onOpen={openRun} narrow />
        </div>
        <div className="min-w-0 flex-1 overflow-auto p-4">
          {id ? (
            <RunDetail key={id} id={id} onClose={() => nav(listPath)} />
          ) : (
            <div className="flex flex-col gap-3">
              {metrics}
              <Panel title="por tipo de execução" flush>
                <ByKindTable days={days} />
              </Panel>
              <p className="text-center text-xs text-muted-foreground">
                escolha uma execução à esquerda para ver a trajetória completa
              </p>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
