import { XCircle } from 'lucide-react';
import type { AgentRun } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtUsdCents, rel, relDue } from '@/lib/format.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Tooltip } from '@/components/ui/controls.tsx';
import { isActive, useCanceledRuns, useCancelRun, useRunList } from './queries.ts';
import {
  PausedChip,
  RunKind,
  RunStatus,
  fmtDuration,
  fmtTokens,
  isPausedRun,
  runDuration,
  runError,
  shortId,
} from './run-bits.tsx';

function StatusCell({ r, narrow }: { r: AgentRun; narrow?: boolean | undefined }) {
  const paused = isPausedRun(r);
  const err = runError(r);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <RunStatus status={r.status} />
      {paused && <PausedChip />}
      {r.status === 'queued' && r.run_at && !paused && (
        <span className="text-[11px] whitespace-nowrap text-muted-foreground">
          {relDue(r.run_at)}
        </span>
      )}
      {err && (
        <span
          className={cn(
            'min-w-0 truncate text-[11px]',
            r.status === 'failed' ? 'text-destructive-foreground' : 'text-muted-foreground',
            narrow ? 'max-w-24' : 'max-w-56',
          )}
          title={err}
        >
          {err.slice(0, 40)}
        </span>
      )}
    </span>
  );
}

export function RunList({
  params,
  view,
  selectedId,
  onOpen,
  narrow,
}: {
  params: Record<string, string>;
  view: string;
  selectedId?: string | undefined;
  onOpen: (id: string) => void;
  /** master pane — drop the columns the detail pane repeats */
  narrow?: boolean | undefined;
}) {
  const q = useRunList(params);
  const cancel = useCancelRun();
  const canceled = useCanceledRuns();
  const runs = q.data?.pages.flatMap((p) => p.runs) ?? [];
  const canCancel = (r: AgentRun) => isActive(r.status) && !canceled.has(r.id);

  const cancelBtn = (r: AgentRun) =>
    canCancel(r) ? (
      <Tooltip content="cancelar run">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="cancelar run"
          disabled={cancel.isPending && cancel.variables === r.id}
          onClick={(e) => {
            e.stopPropagation();
            cancel.mutate(r.id);
          }}
        >
          <XCircle />
        </Button>
      </Tooltip>
    ) : null;

  const columns: Column<AgentRun>[] = [
    {
      key: 'kind',
      header: 'tipo',
      className: 'w-24',
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <RunKind kind={r.kind} className="text-foreground" />
          <span className="font-mono text-[10px] text-muted-foreground">{shortId(r.id)}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: 'status',
      cell: (r) => <StatusCell r={r} narrow={narrow} />,
      className: narrow ? 'max-w-44' : 'max-w-72',
    },
    {
      key: 'lead',
      header: 'lead',
      className: narrow ? 'max-w-32' : 'max-w-44',
      cell: (r) => (
        <span className={cn('block truncate', narrow ? 'max-w-32' : 'max-w-48')}>
          {r.lead_name ?? '—'}
        </span>
      ),
    },
    {
      key: 'when',
      header: 'quando',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (r) => rel(r.created_at),
    },
    {
      key: 'dur',
      header: 'duração',
      align: 'end',
      cell: (r) => fmtDuration(runDuration(r)),
    },
    {
      key: 'tok',
      header: 'tokens',
      align: 'end',
      className: narrow ? 'hidden' : undefined,
      cell: fmtTokens,
    },
    {
      key: 'cost',
      header: 'custo',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (r) => fmtUsdCents(r.cost_cents),
    },
    { key: 'act', header: '', className: 'w-9', cell: cancelBtn },
  ];

  if (q.error && !runs.length)
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <>
      <DataList
        rows={runs}
        rowKey={(r) => r.id}
        columns={columns}
        loading={q.isPending}
        onRowClick={(r) => onOpen(r.id)}
        rowClassName={(r) => cn(r.id === selectedId && 'bg-agent-soft hover:bg-agent-soft')}
        empty={
          <EmptyState
            title="nenhum run"
            hint={
              view === 'scheduled'
                ? 'nada agendado — contatos adiados e follow-ups aparecem aqui'
                : 'runs aparecem quando o agente tria, responde ou descobre'
            }
          />
        }
        mobileRow={(r) => (
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-baseline gap-2">
              <RunKind kind={r.kind} className="font-medium text-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {r.lead_name ?? '—'}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tnum">
                {rel(r.created_at)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <StatusCell r={r} />
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tnum">
                {fmtDuration(runDuration(r))} · {fmtUsdCents(r.cost_cents)}
              </span>
            </div>
          </div>
        )}
      />
      {q.hasNextPage && (
        <div className="flex justify-center border-t p-2">
          <Button
            size="sm"
            variant="outline"
            disabled={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {q.isFetchingNextPage ? 'carregando…' : 'mais'}
          </Button>
        </div>
      )}
    </>
  );
}
