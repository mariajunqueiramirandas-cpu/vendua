import { useQuery } from '@tanstack/react-query';
import { api, type AgentMetrics } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtUsd } from '@/lib/format.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { qk } from '@/lib/query.ts';
import { ErrorState, KpiStrip, type Kpi } from '@/components/common.tsx';
import { Skeleton } from '@/components/ui/controls.tsx';

const pct = (v: number) => `${Math.round(v * 100)}%`;

// ops readout (ADR-0014)
export function useAgentMetrics(days: 7 | 30) {
  return useQuery({ queryKey: qk.agentMetrics(days), queryFn: () => api.agentMetrics(days) });
}

function totals(m: AgentMetrics) {
  const runs = m.byKind.reduce((a, k) => a + k.runs, 0);
  const done = m.byKind.reduce((a, k) => a + k.done, 0);
  const acted = m.byKind.reduce((a, k) => a + Math.round(k.actedRate * k.done), 0);
  const cost = m.byKind.reduce((a, k) => a + k.costUsd, 0);
  const empty =
    runs === 0 &&
    !m.outbound.sent &&
    !m.outbound.drafted &&
    !m.outbound.rejected &&
    !m.replies.leadsContacted &&
    !(m.wakeups?.pending || m.wakeups?.fired);
  return { runs, done, acted, cost, empty };
}

export function MetricsStrip({ days }: { days: 7 | 30 }) {
  const q = useAgentMetrics(days);
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-[58px]" />;
  const m = q.data;
  const t = totals(m);
  if (t.empty)
    return (
      <p className={cn('rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground')}>
        nenhum run nos últimos {days}d — o agente ainda não trabalhou
      </p>
    );
  const items: Kpi[] = [
    { label: 'runs feitos', value: t.done, hint: `${t.runs} total` },
    { label: 'agiram', value: t.done ? pct(t.acted / t.done) : '—' },
    {
      label: 'rascunhos',
      value: m.outbound.drafted,
      hint: 'p/ aprovar',
      tone: m.outbound.drafted ? 'warn' : undefined,
      to: m.outbound.drafted ? '/inbox?f=rascunhos' : undefined,
    },
    {
      label: 'responderam',
      value: m.replies.leadsContacted ? pct(m.replies.replyRate) : '—',
      hint: `${m.replies.leadsReplied}/${m.replies.leadsContacted}`,
    },
    { label: 'custo', value: fmtUsd(t.cost) },
    ...(m.wakeups
      ? [
          {
            label: 'wakeups',
            value: m.wakeups.pending,
            hint: `pendentes · ${m.wakeups.fired} disp.`,
            to: '/agente/planos',
          },
        ]
      : []),
  ];
  return <KpiStrip items={items} />;
}

export function ByKindTable({ days }: { days: 7 | 30 }) {
  const { data: m } = useAgentMetrics(days);
  if (!m) return null;
  const rows = m.byKind.filter((k) => k.runs > 0);
  if (!rows.length)
    return <p className="px-3 py-2.5 text-xs text-muted-foreground">sem runs no período</p>;
  const num = 'px-2 text-right tnum';
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-[11px] text-muted-foreground">
            <th className="h-8 pl-3 text-left font-medium">tipo</th>
            <th className="px-2 text-right font-medium">runs</th>
            <th className="px-2 text-right font-medium">feitos</th>
            <th className="px-2 text-right font-medium">falhas</th>
            <th className="px-2 text-right font-medium">cancel.</th>
            <th className="px-2 text-right font-medium">agiu</th>
            <th className="px-2 text-right font-medium">passos</th>
            <th className="pr-3 pl-2 text-right font-medium">custo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k.kind} className="h-9 border-b last:border-b-0">
              <td className="pl-3">{RUN_KIND_LABEL[k.kind] ?? k.kind}</td>
              <td className={num}>{k.runs}</td>
              <td className={num}>{k.done}</td>
              <td className={num}>{k.failed || '—'}</td>
              <td className={num}>{k.canceled || '—'}</td>
              <td className={num}>{k.done ? pct(k.actedRate) : '—'}</td>
              <td className={num}>{k.avgSteps || '—'}</td>
              <td className={cn(num, 'pr-3')}>{fmtUsd(k.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
