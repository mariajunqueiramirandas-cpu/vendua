import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, XCircle } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { Page } from '@/components/Page.tsx';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState, KpiStrip, LoadingRows } from '@/components/common.tsx';
import { ProgressSliver } from '@/components/ProgressSliver.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Tooltip } from '@/components/ui/controls.tsx';
import { AGENT_TABS } from '../tabs.ts';
import { PlanList } from './PlanList.tsx';
import {
  buildQueue,
  isLive,
  planProgress,
  tMinus,
  useAllLeads,
  useCancelWakeup,
  usePendingWakeups,
  useScheduledRuns,
  type QueueItem,
} from './queries.ts';

/** Countdowns re-render on a clock; the data itself refreshes through SSE + the query floor. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Countdown({ at, now, late }: { at: string; now: number; late: boolean }) {
  return (
    <span
      className={cn(
        'font-mono text-[13px] font-medium whitespace-nowrap tnum',
        late ? 'text-destructive-foreground' : 'text-foreground',
      )}
    >
      {tMinus(at, now)}
    </span>
  );
}

export default function PlansPage() {
  const nav = useNavigate();
  const now = useMinuteClock();
  const leadsQ = useAllLeads();
  const runsQ = useScheduledRuns();
  const wakeQ = usePendingWakeups();
  const cancelWakeup = useCancelWakeup();

  // all sources commit together — a missing one can't render as a complete queue
  const ready = leadsQ.data && runsQ.data && wakeQ.data;
  const leads = leadsQ.data ?? [];
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const queue = useMemo(
    () => (ready ? buildQueue(leads, runsQ.data ?? [], wakeQ.data ?? [], now) : []),
    [ready, leads, runsQ.data, wakeQ.data, now],
  );
  const planned = useMemo(
    () =>
      leads
        .filter((l) => isLive(l) && l.agentPlan.length > 0)
        .sort((a, b) => planProgress(b).ratio - planProgress(a).ratio),
    [leads],
  );

  const order = useMemo(() => new Map(queue.map((p, i) => [p.key, i + 1])), [queue]);
  const late = queue.filter((p) => p.late).length;
  const next = queue[0];
  const error = !ready && (leadsQ.error || runsQ.error || wakeQ.error);

  const planOf = (id: string | null) => (id ? byId.get(id) : undefined);
  const leadCell = (p: QueueItem) =>
    p.leadId ? (
      <Link
        to={`/pipeline/${p.leadId}`}
        onClick={(e) => e.stopPropagation()}
        className="block truncate underline-offset-4 hover:underline"
      >
        {p.leadName}
      </Link>
    ) : (
      <span className="text-muted-foreground">workspace</span>
    );
  const progressCell = (l: LeadListItem | undefined) => {
    if (!l?.agentPlan.length) return null;
    const { resolved, total } = planProgress(l);
    return (
      <span className="flex items-center gap-1.5">
        <ProgressSliver
          value={resolved}
          max={total}
          className="w-12"
          label={`${resolved} de ${total} etapas resolvidas`}
        />
        <span className="text-[11px] text-muted-foreground tnum">
          {resolved}/{total}
        </span>
      </span>
    );
  };
  const cancelCell = (p: QueueItem) =>
    p.wakeupId ? (
      <Tooltip content="cancelar wakeup">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="cancelar wakeup"
          disabled={cancelWakeup.isPending && cancelWakeup.variables === p.wakeupId}
          onClick={(e) => {
            e.stopPropagation();
            cancelWakeup.mutate(p.wakeupId!);
          }}
        >
          <XCircle />
        </Button>
      </Tooltip>
    ) : null;

  const columns: Column<QueueItem>[] = [
    {
      key: 'i',
      header: '#',
      className: 'w-8 text-muted-foreground tnum',
      cell: (p) => String(order.get(p.key) ?? 0).padStart(2, '0'),
    },
    {
      key: 't',
      header: 'em',
      className: 'w-20',
      cell: (p) => <Countdown at={p.at} now={now} late={p.late} />,
    },
    {
      key: 'abs',
      header: 'quando',
      className: 'w-28 whitespace-nowrap text-xs text-muted-foreground',
      cell: (p) => fmtDateTime(p.at),
    },
    {
      key: 'what',
      header: 'o quê',
      cell: (p) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate">{p.what}</span>
          {p.detail && (
            <span className="truncate text-xs text-muted-foreground" title={p.detail}>
              {p.detail}
            </span>
          )}
        </span>
      ),
      className: 'max-w-56',
    },
    { key: 'lead', header: 'lead', className: 'max-w-40', cell: leadCell },
    {
      key: 'plan',
      header: 'plano',
      className: 'w-24',
      cell: (p) => progressCell(planOf(p.leadId)),
    },
    { key: 'x', header: '', className: 'w-9', cell: cancelCell },
  ];

  let body;
  if (error)
    body = (
      <ErrorState
        error={error}
        onRetry={() => (void leadsQ.refetch(), void runsQ.refetch(), void wakeQ.refetch())}
      />
    );
  else if (!ready) body = <LoadingRows />;
  else if (!queue.length && !planned.length)
    body = (
      <EmptyState
        icon={ListChecks}
        title="nenhum plano ainda"
        hint="o agente monta um plano por lead no primeiro contato — metas, objeções e próxima ação aparecem aqui"
      />
    );
  else
    body = (
      <div className="flex flex-col gap-3">
        <KpiStrip
          items={[
            {
              label: 'próxima ação',
              value: next ? tMinus(next.at, now) : '—',
              tone: next?.late ? 'bad' : undefined,
              hint: next ? `${next.what} · ${next.leadName ?? 'workspace'}` : undefined,
              to: next?.leadId ? `/pipeline/${next.leadId}` : undefined,
            },
            { label: 'na fila', value: queue.length },
            { label: 'planos em curso', value: planned.length },
            { label: 'atrasadas', value: late, tone: late ? 'bad' : undefined },
          ]}
        />
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Panel title="fila" aside="o que o agente faz a seguir" flush>
            <DataList
              rows={queue}
              rowKey={(p) => p.key}
              columns={columns}
              onRowClick={(p) => {
                if (p.leadId) nav(`/pipeline/${p.leadId}`);
              }}
              empty={<EmptyState title="fila vazia" hint="nada agendado para os leads ativos" />}
              mobileRow={(p) => (
                <div className="flex items-start gap-3">
                  <span className="w-16 shrink-0 pt-px">
                    <Countdown at={p.at} now={now} late={p.late} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">
                      {p.leadName ?? 'workspace'}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {p.what}
                      {p.detail ? ` · ${p.detail}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-[11px] text-muted-foreground">{fmtDateTime(p.at)}</span>
                    {progressCell(planOf(p.leadId))}
                  </span>
                </div>
              )}
            />
          </Panel>
          <Panel title="planos em curso" aside={`${planned.length} leads`} flush>
            {planned.length ? (
              <PlanList leads={planned} />
            ) : (
              <EmptyState title="nenhum plano em curso" />
            )}
          </Panel>
        </div>
      </div>
    );

  return (
    <Page title="Agente" tabs={AGENT_TABS}>
      {body}
    </Page>
  );
}
