import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtUsd } from '@/lib/format.ts';
import { qk } from '@/lib/query.ts';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { fmtDuration } from '@/features/agent/activity/run-bits.tsx';

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-lg leading-tight font-medium tnum">{value}</span>
      <span className="truncate text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * Sales impact of the CRM agent + conversion by source. Detailed execution breakdown,
 * segment scoreboard, and channel health live in their own single homes (Agente & Config).
 */
export function AgentImpactPanel({ days, onDays }: { days: 7 | 30; onDays: (d: 7 | 30) => void }) {
  const q = useQuery({
    queryKey: qk.agentMetrics(days),
    queryFn: () => api.agentMetrics(days),
    placeholderData: (prev) => prev,
  });
  const m = q.data;
  const totalRuns = m?.byKind.reduce((a, k) => a + k.runs, 0) ?? 0;
  const cost = m?.byKind.reduce((a, k) => a + k.costUsd, 0) ?? 0;
  const sales = m?.sales;
  const empty =
    !!m &&
    totalRuns === 0 &&
    !m.outbound.sent &&
    !m.outbound.drafted &&
    !m.replies.leadsContacted &&
    !sales?.bySource.length;

  return (
    <Panel
      title="impacto do agente e conversão por origem"
      aside={`últimos ${days} dias`}
      flush
      actions={
        <Segmented
          size="sm"
          value={String(days) as '7' | '30'}
          onChange={(v) => onDays(v === '30' ? 30 : 7)}
          options={[
            ['7', '7d'],
            ['30', '30d'],
          ]}
        />
      }
    >
      {q.isError && !m ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : !m ? (
        <LoadingRows rows={3} className="p-3" />
      ) : empty ? (
        <p className="p-3 text-sm text-muted-foreground">
          nenhuma atividade do agente nos últimos {days} dias
        </p>
      ) : (
        <div className={cn('transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="mensagens enviadas" value={m.outbound.sent} />
            <Stat
              label={`responderam · ${m.replies.leadsReplied}/${m.replies.leadsContacted}`}
              value={m.replies.leadsContacted ? pct(m.replies.replyRate) : '—'}
            />
            <Stat
              label="tempo resposta (mediana)"
              value={
                sales?.medianResponseSeconds != null
                  ? fmtDuration(sales.medianResponseSeconds * 1000)
                  : '—'
              }
            />
            <Stat label="aguardam resposta" value={sales ? sales.awaitingReply : '—'} />
            <Stat label="encaminhamentos" value={sales ? sales.handoffs : '—'} />
            <Stat label="custo do agente" value={fmtUsd(cost)} />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              rascunhos criados ({days}d){' '}
              <b className="font-medium text-foreground tnum">{m.outbound.drafted}</b>
            </span>
            <span>
              aprovados <b className="font-medium text-foreground tnum">{m.outbound.approved}</b>
            </span>
            <span>
              descartados <b className="font-medium text-foreground tnum">{m.outbound.rejected}</b>
            </span>
            <div className="ml-auto flex flex-wrap gap-3">
              <Link
                to="/agente/operacao?v=execucoes"
                className="inline-flex items-center gap-0.5 hover:text-foreground"
              >
                execuções <ArrowUpRight className="size-3" />
              </Link>
              <Link
                to="/agente/descoberta"
                className="inline-flex items-center gap-0.5 hover:text-foreground"
              >
                segmentos <ArrowUpRight className="size-3" />
              </Link>
              <Link to="/config" className="inline-flex items-center gap-0.5 hover:text-foreground">
                saúde dos canais <ArrowUpRight className="size-3" />
              </Link>
            </div>
          </div>

          {sales && sales.bySource.length > 0 && (
            <div className="overflow-x-auto border-t">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[11px] text-muted-foreground">
                    <th scope="col" className="h-8 pl-3 text-left font-medium">
                      origem
                    </th>
                    <th scope="col" className="px-2 text-right font-medium">
                      leads
                    </th>
                    <th scope="col" className="px-2 text-right font-medium">
                      cadastros
                    </th>
                    <th scope="col" className="px-2 text-right font-medium">
                      lojas no ar
                    </th>
                    <th scope="col" className="px-2 text-right font-medium">
                      pagantes
                    </th>
                    <th scope="col" className="pr-3 pl-2 text-right font-medium">
                      descadastros
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sales.bySource.map((row) => (
                    <tr key={row.source} className="h-9 border-b last:border-b-0">
                      <th scope="row" className="pl-3 text-left font-medium">
                        {row.source}
                      </th>
                      <td className="px-2 text-right tnum">{row.leads}</td>
                      <td className="px-2 text-right tnum">{row.signups}</td>
                      <td className="px-2 text-right tnum">{row.activated}</td>
                      <td className="px-2 text-right tnum">{row.paid}</td>
                      <td className="pr-3 pl-2 text-right tnum">{row.optedOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
