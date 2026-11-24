import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, CalendarClock } from 'lucide-react';
import type { LeadListItem, Wakeup } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, fmtUsd, rel } from '@/lib/format.ts';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { useStats } from '@/lib/queries.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import {
  ConfirmButton,
  EmptyState,
  ErrorState,
  KpiStrip,
  LoadingRows,
} from '@/components/common.tsx';
import { ProgressSliver } from '@/components/ProgressSliver.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { useAgentMetrics } from '../activity/Metrics.tsx';
import { useCancelRun } from '../activity/queries.ts';
import { RunKind } from '../activity/run-bits.tsx';
import {
  planProgress,
  tMinus,
  useCancelWakeup,
  useRunningRuns,
  useWakeups,
  type QueueItem,
} from '../queue.ts';

function Countdown({ at, now, late }: { at: string; now: number; late: boolean }) {
  return (
    <span
      className={cn(
        'text-[13px] font-medium whitespace-nowrap tnum',
        late ? 'text-destructive-foreground' : 'text-foreground',
      )}
    >
      {tMinus(at, now)}
    </span>
  );
}

function ProgressCell({ lead }: { lead: LeadListItem | undefined }) {
  if (!lead?.agentPlan.length) return null;
  const { resolved, total } = planProgress(lead);
  if (!total) return null;
  return (
    <span className="flex items-center gap-1.5">
      <ProgressSliver
        value={resolved}
        max={total}
        className="w-12"
        label={`${resolved} de ${total} etapas concluídas`}
      />
      <span className="text-[11px] text-muted-foreground tnum">
        {resolved}/{total}
      </span>
    </span>
  );
}

const ORIGIN_LABEL: Record<QueueItem['origin'], string> = {
  lead: 'pedido do lead',
  staff: 'equipe',
  agent: 'agente',
};

export function QueueView({
  queue,
  byId,
  plannedCount,
  now,
  ready,
  error,
  onRetry,
}: {
  queue: QueueItem[];
  byId: Map<string, LeadListItem>;
  plannedCount: number;
  now: number;
  ready: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const nav = useNavigate();
  const [mode, setMode] = useState<'pending' | 'fired'>('pending');
  const stats = useStats().data;
  const metrics7d = useAgentMetrics(7).data;
  const running = useRunningRuns().data ?? [];
  const firedQ = useWakeups('fired', 200, mode === 'fired');
  const cancelWakeup = useCancelWakeup();
  const cancelRun = useCancelRun();

  const late = queue.filter((p) => p.late).length;
  const next = queue[0];
  const runs7d = metrics7d?.byKind.reduce((n, k) => n + k.done, 0);
  const cost7d = metrics7d?.byKind.reduce((n, k) => n + k.costUsd, 0);

  const onCancel = (p: QueueItem) => {
    if (!p.cancel) return;
    if (p.cancel.kind === 'wakeup') cancelWakeup.mutate(p.cancel.id);
    else cancelRun.mutate(p.cancel.id);
  };
  const canceling = (p: QueueItem) =>
    p.cancel
      ? p.cancel.kind === 'wakeup'
        ? cancelWakeup.isPending && cancelWakeup.variables === p.cancel.id
        : cancelRun.isPending && cancelRun.variables === p.cancel.id
      : false;

  const pendingCols: Column<QueueItem>[] = [
    {
      key: 'when',
      header: 'quando',
      className: 'w-32 whitespace-nowrap',
      cell: (p) => (
        <div className="flex flex-col leading-tight">
          <Countdown at={p.at} now={now} late={p.late} />
          <span className="text-[11px] text-muted-foreground tnum">{fmtDateTime(p.at)}</span>
        </div>
      ),
    },
    {
      key: 'lead',
      header: 'lead',
      className: 'w-44 max-w-44',
      cell: (p) =>
        p.leadId ? (
          <Link
            to={`/pipeline/${p.leadId}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium underline-offset-4 hover:underline"
          >
            {p.leadName}
          </Link>
        ) : (
          <span className="text-muted-foreground">workspace</span>
        ),
    },
    {
      key: 'what',
      header: 'ação e foco',
      cell: (p) => (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{p.what}</span>
            {p.promised && <Badge variant="agent">promessa</Badge>}
          </span>
          {p.detail && (
            <span className="line-clamp-1 text-xs text-muted-foreground" title={p.detail}>
              {p.detail}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'origin',
      header: 'origem',
      className: 'w-28 whitespace-nowrap text-xs text-muted-foreground max-lg:hidden',
      cell: (p) => ORIGIN_LABEL[p.origin],
    },
    {
      key: 'plan',
      header: 'plano',
      className: 'w-24 max-xl:hidden',
      cell: (p) => <ProgressCell lead={p.leadId ? byId.get(p.leadId) : undefined} />,
    },
    {
      key: 'act',
      header: '',
      align: 'end',
      className: 'w-24',
      cell: (p) =>
        p.cancel ? (
          <span onClick={(e) => e.stopPropagation()}>
            <ConfirmButton
              size="sm"
              variant="ghost"
              confirm="desmarcar?"
              disabled={canceling(p)}
              onConfirm={() => onCancel(p)}
            >
              cancelar
            </ConfirmButton>
          </span>
        ) : null,
    },
  ];

  const firedCols: Column<Wakeup>[] = [
    {
      key: 'at',
      header: 'disparou',
      className: 'w-32 whitespace-nowrap',
      cell: (w) => (
        <div className="flex flex-col leading-tight">
          <span className="text-sm tnum">{rel(w.at)}</span>
          <span className="text-[11px] text-muted-foreground tnum">{fmtDateTime(w.at)}</span>
        </div>
      ),
    },
    {
      key: 'lead',
      header: 'lead',
      className: 'w-44 max-w-44',
      cell: (w) =>
        w.leadId ? (
          <Link
            to={`/pipeline/${w.leadId}`}
            onClick={(e) => e.stopPropagation()}
            className="block truncate font-medium underline-offset-4 hover:underline"
          >
            {w.leadName ?? w.leadId.slice(0, 8)}
          </Link>
        ) : (
          <span className="text-muted-foreground">workspace</span>
        ),
    },
    {
      key: 'focus',
      header: 'foco',
      cell: (w) => (
        <div className="min-w-0">
          <span className="line-clamp-2 text-sm">
            {w.focus || RUN_KIND_LABEL[w.kind] || w.kind}
          </span>
        </div>
      ),
    },
    {
      key: 'origin',
      header: 'origem',
      className: 'w-32 whitespace-nowrap text-xs text-muted-foreground max-lg:hidden',
      cell: (w) => (
        <span className="inline-flex items-center gap-1.5">
          {w.createdBy === 'staff' ? 'equipe' : w.requested ? 'pedido do lead' : 'agente'}
          {(w.requested || w.createdBy === 'staff') && <Badge variant="agent-soft">promessa</Badge>}
        </span>
      ),
    },
    {
      key: 'run',
      header: '',
      align: 'end',
      className: 'w-32',
      cell: (w) =>
        w.firedRunId ? (
          <Button asChild size="sm" variant="ghost" onClick={(e) => e.stopPropagation()}>
            <Link to={`/agente/operacao/${w.firedRunId}`}>
              execução <ArrowUpRight />
            </Link>
          </Button>
        ) : null,
    },
  ];

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!ready) return <LoadingRows />;

  const kpis = [
    {
      label: 'próximo disparo',
      value: next ? tMinus(next.at, now) : '—',
      tone: next?.late ? ('bad' as const) : undefined,
      hint: next ? `${next.what} · ${next.leadName ?? 'workspace'}` : 'fila livre',
      to: next?.leadId ? `/pipeline/${next.leadId}` : undefined,
    },
    {
      label: 'na fila',
      value: queue.length,
      tone: late ? ('bad' as const) : undefined,
      hint: late ? `${late} atrasado${late === 1 ? '' : 's'}` : 'sem atrasos',
    },
    ...(stats
      ? [
          {
            label: 'rascunhos p/ aprovar',
            value: stats.pendingDrafts,
            tone: stats.pendingDrafts ? ('warn' as const) : undefined,
            hint: stats.pendingDrafts ? 'aguardando equipe' : 'tudo revisado',
            to: '/inbox?f=rascunhos',
          },
        ]
      : []),
    {
      label: 'planos ativos',
      value: plannedCount,
      hint: 'leads com estratégia',
      to: '/agente/operacao?v=planos',
    },
    ...(runs7d != null
      ? [
          {
            label: 'execuções · 7d',
            value: runs7d,
            hint: cost7d != null ? fmtUsd(cost7d) : undefined,
            to: '/agente/operacao?v=execucoes',
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3">
      <KpiStrip items={kpis} />

      {running.length > 0 && (
        <Panel title="rodando agora" aside={`${running.length}`} flush className="border-agent/40">
          <ul className="divide-y">
            {running.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                <span className="relative inline-flex size-2 shrink-0" aria-hidden>
                  <span className="absolute inset-0 animate-ping rounded-full bg-agent opacity-70" />
                  <span className="relative size-2 rounded-full bg-agent" />
                </span>
                <RunKind kind={r.kind} source={r.source} className="font-medium text-foreground" />
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {r.lead_name ?? 'workspace'}
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/agente/operacao/${r.id}`}>
                    acompanhar <ArrowUpRight />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title={mode === 'pending' ? 'próximos disparos' : 'retornos já disparados'}
        aside={
          mode === 'pending'
            ? 'follow-ups, promessas de retorno e envios adiados — 1 linha por disparo'
            : 'histórico recente de retornos executados'
        }
        actions={
          <Segmented
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              ['pending', `próximos${queue.length ? ` · ${queue.length}` : ''}`],
              ['fired', 'já disparados'],
            ]}
          />
        }
        flush
      >
        {mode === 'pending' ? (
          <DataList
            rows={queue}
            rowKey={(p) => p.key}
            columns={pendingCols}
            onRowClick={(p) => {
              if (p.leadId) nav(`/pipeline/${p.leadId}`);
            }}
            empty={
              <EmptyState
                icon={CalendarClock}
                title="nada agendado"
                hint="follow-ups do agente, retornos pedidos por leads e datas marcadas pela equipe aparecem aqui"
              />
            }
            mobileRow={(p) => (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                  <Countdown at={p.at} now={now} late={p.late} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {p.leadName ?? 'workspace'}
                  </span>
                  {p.promised && <Badge variant="agent">promessa</Badge>}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{p.what}</span>
                  {p.detail ? ` · ${p.detail}` : ''}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="tnum">{fmtDateTime(p.at)}</span>
                  <span>· {ORIGIN_LABEL[p.origin]}</span>
                  {p.cancel && (
                    <span className="ml-auto" onClick={(e) => e.stopPropagation()}>
                      <ConfirmButton
                        size="sm"
                        variant="ghost"
                        confirm="desmarcar?"
                        disabled={canceling(p)}
                        onConfirm={() => onCancel(p)}
                      >
                        cancelar
                      </ConfirmButton>
                    </span>
                  )}
                </div>
              </div>
            )}
          />
        ) : firedQ.error && !firedQ.data ? (
          <ErrorState error={firedQ.error} onRetry={() => void firedQ.refetch()} />
        ) : (
          <DataList
            rows={firedQ.data ?? []}
            rowKey={(w) => w.id}
            loading={firedQ.isPending}
            columns={firedCols}
            onRowClick={(w) => {
              if (w.firedRunId) nav(`/agente/operacao/${w.firedRunId}`);
              else if (w.leadId) nav(`/pipeline/${w.leadId}`);
            }}
            empty={
              <EmptyState
                icon={CalendarClock}
                title="nenhum retorno disparado"
                hint="retornos executados pelo agente aparecem aqui com link para a trajetória"
              />
            }
            mobileRow={(w) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {w.leadName ?? 'workspace'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tnum">{rel(w.at)}</span>
                </div>
                {w.focus && <p className="line-clamp-2 text-xs text-muted-foreground">{w.focus}</p>}
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="tnum">{fmtDateTime(w.at)}</span>
                  {w.firedRunId && (
                    <Link
                      to={`/agente/operacao/${w.firedRunId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      ver execução →
                    </Link>
                  )}
                </div>
              </div>
            )}
          />
        )}
      </Panel>
    </div>
  );
}
