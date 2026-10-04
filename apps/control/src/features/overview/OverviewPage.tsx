import { Navigate, useSearchParams } from 'react-router-dom';
import type { CustomersOverview } from '@/lib/api.ts';
import { fmtMoney, fmtUsd } from '@/lib/format.ts';
import { Page } from '@/components/Page.tsx';
import { ErrorState, KpiStrip, type Kpi } from '@/components/common.tsx';
import { Skeleton } from '@/components/ui/controls.tsx';
import { ActivityPanel } from './ActivityPanel.tsx';
import { AiPanel } from './AiPanel.tsx';
import { AtRiskPanel } from './AtRiskPanel.tsx';
import { fmtN } from './bits.tsx';
import { useCustomersOverview } from './queries.ts';
import { RevenuePanel } from './RevenuePanel.tsx';

function kpis(o: CustomersOverview): Kpi[] {
  const r = o.revenue;
  return [
    {
      label: 'MRR',
      value: fmtMoney(r.mrrCents),
      to: '/lojas',
      hint: `+${fmtN(r.newStores30d)} lojas em 30 dias`,
    },
    {
      label: 'lojas pagantes',
      value: fmtN(r.payingStores),
      to: '/lojas',
      hint: `de ${fmtN(o.totals.stores)} cadastradas`,
    },
    {
      label: 'em teste',
      value: fmtN(r.trialing),
      to: '/lojas?f=teste',
      hint: r.trialsEndingSoon.length
        ? `${fmtN(r.trialsEndingSoon.length)} acabam em 7 dias`
        : 'nenhum acaba em 7 dias',
    },
    {
      label: 'inadimplentes',
      value: fmtN(r.pastDue),
      to: '/lojas?f=inadimplentes',
      tone: r.pastDue ? 'bad' : undefined,
      hint: `${fmtMoney(r.openInvoices.amountCents)} em aberto`,
    },
    {
      label: 'GMV 30d',
      value: fmtMoney(o.activity.gmv30dCents),
      hint: `${fmtN(o.activity.orders30d)} pedidos`,
    },
    {
      label: 'gasto IA 30d',
      value: fmtUsd(o.ai.spend30dUsd),
      to: '/ia',
      hint: `${fmtN(o.ai.conversationsThisMonth)} conversas no mês`,
    },
  ];
}

/** Visão: how the fleet is doing — revenue first, then Duá, activity, and who needs a call. */
export default function OverviewPage() {
  const [sp] = useSearchParams();
  const q = useCustomersOverview();
  // `/?t=tarefas` was the task list before the sales hub moved to /vendas
  if (sp.get('t') === 'tarefas') return <Navigate to={`/vendas?${sp.toString()}`} replace />;
  const o = q.data;

  return (
    <Page
      title="Visão"
      actions={
        o && (
          <span className="hidden text-xs text-muted-foreground md:inline">
            {fmtN(o.totals.active)} lojas ativas
            {o.totals.suspended ? `, ${fmtN(o.totals.suspended)} suspensas` : ''}
          </span>
        )
      }
    >
      {o ? (
        <div className="flex flex-col gap-3">
          <KpiStrip items={kpis(o)} />
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
            {/* two columns on desktop; on phones the panels interleave in priority order */}
            <div className="contents lg:flex lg:flex-col lg:gap-3">
              <div className="order-1 min-w-0 lg:order-none">
                <RevenuePanel r={o.revenue} />
              </div>
              <div className="order-3 min-w-0 lg:order-none">
                <ActivityPanel a={o.activity} activeStores={o.totals.active} />
              </div>
            </div>
            <div className="contents lg:flex lg:flex-col lg:gap-3">
              <div className="order-2 min-w-0 lg:order-none">
                <AiPanel ai={o.ai} />
              </div>
              <div className="order-4 min-w-0 lg:order-none">
                <AtRiskPanel rows={o.atRisk} />
              </div>
            </div>
          </div>
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-[78px] w-full" />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
          </div>
        </div>
      )}
    </Page>
  );
}
