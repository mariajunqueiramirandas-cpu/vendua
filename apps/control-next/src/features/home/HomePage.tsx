import { useSearchParams } from 'react-router-dom';
import { fmtMoney, fmtUsdCents } from '@/lib/format.ts';
import { useStats } from '@/lib/queries.ts';
import { Page } from '@/components/Page.tsx';
import { ErrorState, KpiStrip, type Kpi } from '@/components/common.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Skeleton } from '@/components/ui/controls.tsx';
import type { Stats } from '@/lib/api.ts';
import { BreakdownTables, FunnelBar } from './Breakdown.tsx';
import { KPI_FIT } from './kpi.ts';
import { NeedsYou } from './NeedsYou.tsx';
import { TasksView } from './TasksView.tsx';
import { TodayPanel } from './TodayPanel.tsx';

function kpis(s: Stats): Kpi[] {
  return [
    { label: 'leads ativos', value: s.total, to: '/pipeline' },
    {
      label: 'rascunhos p/ aprovar',
      value: s.pendingDrafts,
      to: '/inbox?f=rascunhos',
      tone: s.pendingDrafts ? 'warn' : undefined,
    },
    {
      label: 'tarefas atrasadas',
      value: s.overdueTasks,
      to: '/?t=tarefas',
      tone: s.overdueTasks ? 'bad' : undefined,
      hint: `${s.openTasks} abertas`,
    },
    {
      label: 'previsão ponderada',
      value: fmtMoney(s.forecast.weightedCents),
      to: '/pipeline/relatorios',
    },
    {
      label: 'custo agente · 30d',
      value: fmtUsdCents(s.agent30d.costCents),
      to: '/agente/atividade',
      hint: `${s.agent30d.runs} runs · ${s.agent30d.tokens.toLocaleString('pt-BR')} tokens`,
    },
    { label: 'descobertos · 7d', value: s.discoveredThisWeek, to: '/agente/descoberta' },
  ];
}

/** Hoje: "what do I do now?" — `?t=tarefas` swaps the body for the full task list. */
export default function HomePage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('t') === 'tarefas' ? 'tarefas' : 'hoje';
  const stats = useStats();
  const s = stats.data;

  const setParam = (k: string, v: string | null) =>
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      if (v == null) next.delete(k);
      else next.set(k, v);
      return next;
    });

  return (
    <Page
      title="Hoje"
      actions={
        <Segmented
          size="sm"
          value={tab}
          onChange={(v) => setSp(v === 'tarefas' ? { t: 'tarefas' } : {})}
          options={[
            ['hoje', 'visão geral'],
            [
              'tarefas',
              <>
                tarefas
                {!!s?.openTasks && (
                  <span className="text-muted-foreground tnum">{s.openTasks}</span>
                )}
              </>,
            ],
          ]}
        />
      }
    >
      {tab === 'tarefas' ? (
        <TasksView
          showDone={sp.get('done') === '1'}
          onShowDone={(v) => setParam('done', v ? '1' : null)}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {s ? (
            <KpiStrip items={kpis(s)} className={KPI_FIT} />
          ) : stats.isError ? (
            <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
          ) : (
            <Skeleton className="h-[62px] w-full" />
          )}
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            <NeedsYou />
            <TodayPanel />
          </div>
          {s && (
            <>
              <FunnelBar s={s} />
              <BreakdownTables s={s} />
            </>
          )}
        </div>
      )}
    </Page>
  );
}
