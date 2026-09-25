import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LineChart, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Stats } from '@/lib/api.ts';
import { fmtDay, fmtMoney, fmtUsdCents } from '@/lib/format.ts';
import { LEAD_STATES, LEAD_STATE_LABEL } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { useStats } from '@/lib/queries.ts';
import { Page } from '@/components/Page.tsx';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, KpiStrip, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { PIPELINE_TABS } from '@/features/pipeline/tabs.ts';
import { AgentMetricsPanel, ChannelHealthPanel, SegmentsPanel } from './OpsPanels.tsx';
import { TrendChart } from './TrendChart.tsx';
import { ValueBars } from './ValueBars.tsx';

type StageRow = { st: string } & Partial<Stats['forecast']['byState'][string]>;

const STAGE_COLS: Column<StageRow>[] = [
  {
    key: 'st',
    header: 'estágio',
    cell: (r) => (
      <Link to="/pipeline?v=board" className="hover:underline">
        {LEAD_STATE_LABEL[r.st]}
      </Link>
    ),
  },
  { key: 'count', header: 'leads', align: 'end', cell: (r) => r.count ?? 0 },
  { key: 'value', header: 'valor', align: 'end', cell: (r) => fmtMoney(r.valueCents) },
  {
    key: 'prob',
    header: 'prob.',
    align: 'end',
    cell: (r) => (r.probability != null ? `${Math.round(r.probability * 100)}%` : '—'),
  },
  { key: 'weighted', header: 'ponderado', align: 'end', cell: (r) => fmtMoney(r.weightedCents) },
];

type TrendRow = Stats['forecast']['trend'][number];
const TREND_COLS: Column<TrendRow>[] = [
  { key: 'day', header: 'dia', cell: (p) => fmtDay(p.takenOn) },
  { key: 'weighted', header: 'ponderado', align: 'end', cell: (p) => fmtMoney(p.weightedCents) },
  { key: 'value', header: 'pipeline', align: 'end', cell: (p) => fmtMoney(p.valueCents) },
];

export default function ReportsPage() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const view = sp.get('trend') === 'tabela' ? 'tabela' : 'grafico';
  const days = sp.get('dias') === '30' ? 30 : 7;
  const set = (k: string, v: string | null) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v == null) n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: true },
    );

  const stats = useStats();
  const s = stats.data;
  const fc = s?.forecast;
  const pipelineTotal = s ? Object.values(s.byState).reduce((t, b) => t + b.valueCents, 0) : 0;

  const snap = useMutation({
    mutationFn: api.snapshotNow,
    onSuccess: () => toast.success('snapshot gravado'),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.stats() });
      void qc.invalidateQueries({ queryKey: qk.snapshots() });
    },
  });

  const trendAside = fc?.trend.length
    ? `${fc.trend.length} snapshots · desde ${fmtDay(fc.trend[0]!.takenOn)}`
    : 'um snapshot por dia';

  return (
    <Page
      title="Pipeline"
      tabs={PIPELINE_TABS}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => snap.mutate()}
          disabled={snap.isPending}
          aria-label="atualizar snapshot"
        >
          <RefreshCw className={snap.isPending ? 'animate-spin' : undefined} />
          <span className="max-sm:hidden">
            {snap.isPending ? 'gravando…' : 'atualizar snapshot'}
          </span>
        </Button>
      }
    >
      {stats.isError && !s ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : !s || !fc ? (
        <LoadingRows />
      ) : (
        <div className="flex flex-col gap-3">
          <KpiStrip
            items={[
              { label: 'previsão ponderada', value: fmtMoney(fc.weightedCents) },
              { label: 'pipeline total', value: fmtMoney(pipelineTotal) },
              {
                label: 'ganhos · 30d',
                value: fmtMoney(s.won30d.valueCents),
                hint: `${s.won30d.count} lead${s.won30d.count === 1 ? '' : 's'} ativado${s.won30d.count === 1 ? '' : 's'}`,
              },
              {
                label: 'custo do agente · 30d',
                value: fmtUsdCents(s.agent30d.costCents),
                hint: `${s.agent30d.runs} runs`,
              },
            ]}
          />

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel
              title="valor ponderado"
              aside={<span className="max-sm:hidden">{trendAside}</span>}
              actions={
                fc.trend.length > 0 && (
                  <Segmented
                    size="sm"
                    value={view}
                    onChange={(v) => set('trend', v === 'tabela' ? 'tabela' : null)}
                    options={[
                      ['grafico', 'gráfico'],
                      ['tabela', 'tabela'],
                    ]}
                  />
                )
              }
              flush={view === 'tabela' && fc.trend.length > 0}
            >
              {!fc.trend.length ? (
                <EmptyState
                  icon={LineChart}
                  title="sem snapshots ainda"
                  hint="o agente grava um por dia — use “atualizar snapshot” para gravar o primeiro"
                />
              ) : view === 'tabela' ? (
                <div className="max-h-72 overflow-auto">
                  <DataList
                    rows={[...fc.trend].reverse()}
                    rowKey={(p) => p.takenOn}
                    columns={TREND_COLS}
                    mobileRow={(p) => (
                      <div className="flex items-center justify-between text-sm">
                        <span>{fmtDay(p.takenOn)}</span>
                        <span className="tnum">
                          {fmtMoney(p.weightedCents)}
                          <span className="text-muted-foreground"> / {fmtMoney(p.valueCents)}</span>
                        </span>
                      </div>
                    )}
                  />
                </div>
              ) : (
                <TrendChart trend={fc.trend} />
              )}
            </Panel>

            <Panel
              title="por estágio"
              flush
              actions={
                <Link to="/config" className="text-xs text-muted-foreground hover:text-foreground">
                  probabilidades em config →
                </Link>
              }
            >
              <DataList
                rows={LEAD_STATES.map(([st]) => ({ st, ...fc.byState[st] }))}
                rowKey={(r) => r.st}
                columns={STAGE_COLS}
                mobileRow={(r) => (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{LEAD_STATE_LABEL[r.st]}</span>
                    <span className="text-right text-xs text-muted-foreground tnum">
                      {r.count ?? 0} · {fmtMoney(r.valueCents)} ×{' '}
                      {r.probability != null ? `${Math.round(r.probability * 100)}%` : '—'} ={' '}
                      <b className="font-medium text-foreground">{fmtMoney(r.weightedCents)}</b>
                    </span>
                  </div>
                )}
              />
            </Panel>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ValueBars title="valor por origem" rows={s.bySource} />
            <ValueBars title="valor por segmento" rows={s.bySegment} />
          </div>

          <AgentMetricsPanel days={days} onDays={(d) => set('dias', d === 30 ? '30' : null)} />

          <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <SegmentsPanel />
            <ChannelHealthPanel />
          </div>
        </div>
      )}
    </Page>
  );
}
