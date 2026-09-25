import { Crosshair, XCircle } from 'lucide-react';
import type { AgentRun } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtUsdCents, rel } from '@/lib/format.ts';
import { DataList, type Column } from '@/components/DataList.tsx';
import { EmptyState, ErrorState } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Tooltip } from '@/components/ui/controls.tsx';
import { isActive, useCanceledRuns, useCancelRun } from '../activity/queries.ts';
import { RunStatus, fmtDuration, fmtTokens, runDuration, shortId } from '../activity/run-bits.tsx';
import { useDiscoveryRuns } from './queries.ts';

const queryOf = (r: AgentRun) => {
  const p = r.params ?? {};
  return typeof p.query === 'string' ? p.query : '';
};

export function RecentHunts({
  selected,
  onOpen,
}: {
  selected: string | null;
  onOpen: (id: string) => void;
}) {
  const q = useDiscoveryRuns();
  const cancel = useCancelRun();
  const canceled = useCanceledRuns();
  const runs = q.data ?? [];

  const cancelBtn = (r: AgentRun) =>
    isActive(r.status) && !canceled.has(r.id) ? (
      <Tooltip content="cancelar caçada">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="cancelar caçada"
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
      key: 'q',
      header: 'caçada',
      className: 'max-w-64',
      cell: (r) => (
        <span className="flex min-w-0 flex-col leading-tight">
          {queryOf(r) && <span className="truncate">{queryOf(r)}</span>}
          <span className="font-mono text-[11px] text-muted-foreground">run {shortId(r.id)}</span>
        </span>
      ),
    },
    { key: 's', header: 'status', cell: (r) => <RunStatus status={r.status} /> },
    {
      key: 'w',
      header: 'quando',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (r) => rel(r.created_at),
    },
    {
      key: 'd',
      header: 'duração',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (r) => fmtDuration(runDuration(r)),
    },
    { key: 't', header: 'tokens', align: 'end', className: 'whitespace-nowrap', cell: fmtTokens },
    {
      key: 'c',
      header: 'custo',
      align: 'end',
      className: 'whitespace-nowrap',
      cell: (r) => fmtUsdCents(r.cost_cents),
    },
    { key: 'x', header: '', className: 'w-9', cell: cancelBtn },
  ];

  return (
    <Panel title="caçadas recentes" aside={runs.length ? `${runs.length}` : undefined} flush>
      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DataList
          rows={runs}
          rowKey={(r) => r.id}
          columns={columns}
          loading={q.isPending}
          onRowClick={(r) => onOpen(r.id)}
          rowClassName={(r) => cn(r.id === selected && 'bg-agent-soft hover:bg-agent-soft')}
          empty={
            <EmptyState
              icon={Crosshair}
              title="nenhuma caçada ainda"
              hint="lance uma acima ou deixe a rotina diária rodar"
            />
          }
          mobileRow={(r) => (
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {queryOf(r) || `run ${shortId(r.id)}`}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tnum">
                  {rel(r.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <RunStatus status={r.status} />
                <span className="ml-auto text-xs text-muted-foreground tnum">
                  {fmtTokens(r)} tok · {fmtUsdCents(r.cost_cents)}
                </span>
              </div>
            </div>
          )}
        />
      )}
    </Panel>
  );
}
