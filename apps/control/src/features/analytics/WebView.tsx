import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import { api, type AnalyticsDays, type WebProperty, type WebReport } from '@/lib/api.ts';
import { qk } from '@/lib/query.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, KpiStrip, LoadingRows } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { ShareBars } from './Bars.tsx';
import { DailyChart } from './DailyChart.tsx';

const DEVICE_LABEL: Record<string, string> = {
  mobile: 'celular',
  tablet: 'tablet',
  desktop: 'computador',
};

/** "+12%" against the previous window of the same length. */
function delta(now: number, before: number) {
  if (!before) return now ? 'sem período anterior' : undefined;
  const d = Math.round(((now - before) / before) * 100);
  return `${d > 0 ? '+' : ''}${d}% vs anterior`;
}

type PageRow = WebReport['pages'][number];
const PAGE_COLS: Column<PageRow>[] = [
  {
    key: 'path',
    header: 'página',
    cell: (r) => <span className="font-mono text-xs">{r.path}</span>,
    className: 'max-w-0 w-full truncate',
  },
  { key: 'visitors', header: 'visitantes', align: 'end', cell: (r) => r.visitors },
  { key: 'pageviews', header: 'views', align: 'end', cell: (r) => r.pageviews },
];

type CampaignRow = WebReport['campaigns'][number];
const CAMPAIGN_COLS: Column<CampaignRow>[] = [
  { key: 'source', header: 'origem', cell: (r) => r.source },
  { key: 'medium', header: 'meio', cell: (r) => r.medium || '—' },
  { key: 'campaign', header: 'campanha', cell: (r) => r.campaign || '—' },
  { key: 'visitors', header: 'visitantes', align: 'end', cell: (r) => r.visitors },
];

export function WebView({ property, days }: { property: WebProperty; days: AnalyticsDays }) {
  const q = useQuery({
    queryKey: qk.webAnalytics(property, days),
    queryFn: () => api.webAnalytics(property, days),
  });
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const r = q.data;
  const t = r.totals;
  if (!t.pageviews && !t.prevPageviews)
    return (
      <EmptyState
        icon={BarChart3}
        title={`nenhuma visita ${property === 'site' ? 'no site' : 'no painel'} nos últimos ${days}d`}
        hint="as visitas aparecem aqui assim que alguém abre uma página"
      />
    );
  const mobile = r.devices.find((d) => d.device === 'mobile')?.visitors ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        items={[
          { label: 'visitantes', value: t.visitors, hint: delta(t.visitors, t.prevVisitors) },
          { label: 'visualizações', value: t.pageviews, hint: delta(t.pageviews, t.prevPageviews) },
          {
            label: 'páginas por visitante',
            value: t.visitors ? (t.pageviews / t.visitors).toFixed(1).replace('.', ',') : '—',
          },
          {
            label: 'no celular',
            value: t.visitors ? `${Math.round((mobile / t.visitors) * 100)}%` : '—',
          },
        ]}
      />

      <Panel title="por dia" aside="visitante único por dia">
        <DailyChart
          points={r.series.map((d) => ({ day: d.day, value: d.visitors, line: d.pageviews }))}
          label="visitantes"
          lineLabel="visualizações"
        />
      </Panel>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="páginas" aside="top 10" flush>
          <DataList
            rows={r.pages}
            rowKey={(p) => p.path}
            columns={PAGE_COLS}
            empty={<p className="p-3 text-sm text-muted-foreground">sem páginas no período</p>}
            mobileRow={(p) => (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate font-mono text-xs">{p.path}</span>
                <span className="shrink-0 tnum">
                  {p.visitors}
                  <span className="text-muted-foreground"> · {p.pageviews} views</span>
                </span>
              </div>
            )}
          />
        </Panel>
        <Panel title="de onde vêm" aside="só o domínio">
          {r.referrers.length ? (
            <ShareBars
              unit="visitantes"
              total={t.visitors}
              rows={r.referrers.map((x) => ({
                key: x.referrer,
                label: x.referrer || <span className="text-muted-foreground">direto</span>,
                value: x.visitors,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">sem dados no período</p>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="campanhas" aside="utm_source · utm_medium · utm_campaign" flush>
          <DataList
            rows={r.campaigns}
            rowKey={(c) => `${c.source}|${c.medium}|${c.campaign}`}
            columns={CAMPAIGN_COLS}
            empty={
              <p className="p-3 text-sm text-muted-foreground">nenhum link com utm no período</p>
            }
            mobileRow={(c) => (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {c.source}
                  <span className="text-muted-foreground">
                    {[c.medium, c.campaign].filter(Boolean).map((v) => ` · ${v}`)}
                  </span>
                </span>
                <span className="shrink-0 tnum">{c.visitors}</span>
              </div>
            )}
          />
        </Panel>
        <Panel title="dispositivos" aside="pela largura da tela">
          {r.devices.length ? (
            <ShareBars
              unit="visitantes"
              total={t.visitors}
              rows={r.devices.map((d) => ({
                key: d.device,
                label: DEVICE_LABEL[d.device] ?? d.device,
                value: d.visitors,
              }))}
            />
          ) : (
            <p className="text-sm text-muted-foreground">sem dados no período</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
