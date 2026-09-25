import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SearchX, X, XCircle } from 'lucide-react';
import type { AgentRun } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, fmtUsdCents } from '@/lib/format.ts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { isActive, useCanceledRuns, useCancelRun, useLiveRun } from './queries.ts';
import { RunSteps, type Step } from './RunSteps.tsx';
import {
  PausedChip,
  RunKind,
  RunStatus,
  fmtDuration,
  isPausedRun,
  runDuration,
  runError,
  shortId,
} from './run-bits.tsx';

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-baseline gap-3 border-b py-1 text-sm last:border-b-0">
      <dt className="w-24 shrink-0 text-xs text-muted-foreground">{k}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

/** Ticks once a second while the run is live so the duration counts up. */
function useNowWhile(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

export function RunDetail({
  id,
  onClose,
}: {
  id: string;
  /** desktop pane close; phones use the page back chevron */
  onClose?: (() => void) | undefined;
}) {
  const { run, missing, error, isPending, refetch } = useLiveRun(id);
  const cancel = useCancelRun();
  const canceled = useCanceledRuns();

  if (isPending) return <LoadingRows className="p-3" />;
  if (missing)
    return <EmptyState icon={SearchX} title="run não encontrado" hint={`id ${shortId(id)}`} />;
  if (!run) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const active = isActive(run.status) && !canceled.has(run.id);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">
          <RunKind kind={run.kind} className="text-sm text-foreground" />
        </h2>
        <span className="font-mono text-xs text-muted-foreground">run {shortId(run.id)}</span>
        <RunStatus status={run.status} />
        {isPausedRun(run) && <PausedChip />}
        <div className="ml-auto flex items-center gap-1">
          {active && (
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(run.id)}
            >
              <XCircle /> cancelar
            </Button>
          )}
          {onClose && (
            <Button size="icon-sm" variant="ghost" aria-label="fechar" onClick={onClose}>
              <X />
            </Button>
          )}
        </div>
      </div>

      {runError(run) && (
        <p
          className={cn(
            'rounded-md border px-3 py-2 text-sm break-words',
            run.status === 'failed'
              ? 'border-destructive/30 bg-destructive-soft text-destructive-foreground'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {runError(run)}
        </p>
      )}

      <RunFacts run={run} />

      <Panel title="trajetória" aside={`${(run.steps ?? []).length} passos`}>
        <RunSteps steps={(run.steps ?? []) as Step[]} />
      </Panel>
    </div>
  );
}

function RunFacts({ run }: { run: AgentRun }) {
  const now = useNowWhile(isActive(run.status));
  const params = Object.entries(run.params ?? {});
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="detalhes" bodyClassName="py-1">
        <dl>
          <Row k="lead">
            {run.lead_id ? (
              <Link to={`/pipeline/${run.lead_id}`} className="underline-offset-4 hover:underline">
                {run.lead_name ?? shortId(run.lead_id)}
              </Link>
            ) : (
              '—'
            )}
          </Row>
          <Row k="conversa">
            {run.thread_id ? (
              <Link to={`/inbox/${run.thread_id}`} className="underline-offset-4 hover:underline">
                abrir thread
              </Link>
            ) : (
              '—'
            )}
          </Row>
          <Row k="tokens">
            <span className="tnum">
              {run.tokens_in.toLocaleString('pt-BR')} in · {run.tokens_out.toLocaleString('pt-BR')}{' '}
              out
            </span>
          </Row>
          <Row k="custo">
            <span className="tnum">{fmtUsdCents(run.cost_cents)}</span>
          </Row>
          {run.run_at && <Row k="agendado p/">{fmtDateTime(run.run_at)}</Row>}
          <Row k="criado">{fmtDateTime(run.created_at)}</Row>
          <Row k="início">{fmtDateTime(run.started_at)}</Row>
          <Row k="fim">{fmtDateTime(run.finished_at)}</Row>
          <Row k="duração">
            <span className="tnum">{fmtDuration(runDuration(run, now))}</span>
          </Row>
        </dl>
      </Panel>
      {params.length > 0 && (
        <Panel title="parâmetros" bodyClassName="py-1">
          <dl>
            {params.map(([k, v]) => (
              <Row key={k} k={k}>
                <span className="block max-h-40 overflow-auto font-mono text-xs [overflow-wrap:anywhere]">
                  {typeof v === 'string' ? v : JSON.stringify(v)}
                </span>
              </Row>
            ))}
          </dl>
        </Panel>
      )}
    </div>
  );
}
