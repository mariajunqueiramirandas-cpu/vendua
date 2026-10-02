import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Store } from 'lucide-react';
import { api, type AnalyticsDays, type StorefrontReport } from '@/lib/api.ts';
import { fmtMoney } from '@/lib/format.ts';
import { qk } from '@/lib/query.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, KpiStrip, LoadingRows } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { FunnelBars } from './Bars.tsx';
import { DailyChart } from './DailyChart.tsx';

const rate = (orders: number, sessions: number) =>
  sessions ? `${((orders / sessions) * 100).toFixed(1).replace('.', ',')}%` : '—';

type Row = StorefrontReport['stores'][number];
const storeLink = (r: Row) => `/lojas/frota?loja=${encodeURIComponent(r.slug)}`;

const COLS: Column<Row>[] = [
  {
    key: 'store',
    header: 'loja',
    className: 'max-w-0 w-full truncate',
    cell: (r) => (
      <Link to={storeLink(r)} className="hover:underline">
        {r.name}
        <span className="ml-1.5 text-xs text-muted-foreground">{r.slug}</span>
      </Link>
    ),
  },
  { key: 'sessions', header: 'sessões', align: 'end', cell: (r) => r.sessions },
  { key: 'pageviews', header: 'views', align: 'end', cell: (r) => r.pageviews },
  { key: 'carts', header: 'carrinho', align: 'end', cell: (r) => r.carts },
  { key: 'checkouts', header: 'checkout', align: 'end', cell: (r) => r.checkouts },
  { key: 'orders', header: 'pedidos', align: 'end', cell: (r) => r.orders },
  { key: 'rate', header: 'conversão', align: 'end', cell: (r) => rate(r.ordered, r.sessions) },
  { key: 'revenue', header: 'vendas', align: 'end', cell: (r) => fmtMoney(r.revenueCents) },
];

export function StoresView({ days }: { days: AnalyticsDays }) {
  const q = useQuery({
    queryKey: qk.storefrontAnalytics(days),
    queryFn: () => api.storefrontAnalytics(days),
  });
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const r = q.data;
  const t = r.totals;
  if (!t.sessions && !t.orders)
    return (
      <EmptyState
        icon={Store}
        title={`nenhuma visita às lojas nos últimos ${days}d`}
        hint="cada loja publicada manda as visitas e o funil sozinha"
      />
    );

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip
        items={[
          {
            label: 'sessões',
            value: t.sessions,
            hint: `${t.stores} loja${t.stores === 1 ? '' : 's'}`,
          },
          { label: 'pedidos', value: t.orders },
          {
            label: 'conversão',
            value: rate(t.ordered, t.sessions),
            hint: 'pedidos da loja / sessões',
          },
          { label: 'vendas', value: fmtMoney(t.revenueCents) },
          {
            label: 'ticket médio',
            value: fmtMoney(t.avgTicketCents),
          },
        ]}
      />

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="por dia" aside="todas as lojas">
          <DailyChart
            points={r.series.map((d) => ({ day: d.day, value: d.sessions, extra: d.orders }))}
            label="sessões"
            extraLabel="pedidos"
          />
        </Panel>
        <Panel title="funil" aside="sessões que chegaram a cada passo">
          <FunnelBars
            steps={[
              { label: 'visitaram', value: t.sessions },
              { label: 'puseram no carrinho', value: t.carts },
              { label: 'abriram o checkout', value: t.checkouts },
              { label: 'pediram', value: t.ordered },
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="por loja"
        aside={r.stores.length >= 100 ? 'top 100 por sessões' : undefined}
        flush
      >
        <DataList
          rows={r.stores}
          rowKey={(s) => s.tenantId}
          columns={COLS}
          mobileRow={(s) => (
            <Link to={storeLink(s)} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate font-medium">{s.name}</span>
              <span className="shrink-0 text-right text-xs text-muted-foreground tnum">
                {s.sessions} sessões · {s.orders} pedidos ·{' '}
                <b className="font-medium text-foreground">{rate(s.ordered, s.sessions)}</b>
              </span>
            </Link>
          )}
        />
      </Panel>
    </div>
  );
}
