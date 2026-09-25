import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, History, Plus, XCircle } from 'lucide-react';
import type { AgentRun } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { errorMessage } from '@/lib/query.ts';
import { fmtUsdCents } from '@/lib/format.ts';
import { ProgressSliver } from '@/components/ProgressSliver.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { isActive, useCanceledRuns, useCancelRun, useLiveRun } from '../activity/queries.ts';
import { RunStatus, runError, shortId } from '../activity/run-bits.tsx';
import {
  STAGE_TITLE,
  TOOL_LABEL,
  argHint,
  callNames,
  fmtClock,
  foundLeads,
  isToolError,
  outHint,
  type FoundLead,
  type Step,
} from './journal.ts';

function useTick(on: boolean, ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return now;
}

function LiveDot({ on }: { on: boolean }) {
  return (
    <span className="relative inline-flex size-2.5 shrink-0" aria-hidden>
      {on && <span className="absolute inset-0 animate-ping rounded-full bg-agent opacity-60" />}
      <span
        className={cn('relative size-2.5 rounded-full', on ? 'bg-agent' : 'bg-sidebar-muted/50')}
      />
    </span>
  );
}

/**
 * The dark "stage" for one discovery run: streaming journal on the left,
 * leads landing on the right, the result summary once it ends. Lives inside
 * a normal Panel — `dark` scopes the dark tokens to the block.
 */
export function LiveStage({
  runId,
  fallbackTarget,
  onReset,
}: {
  runId: string;
  fallbackTarget: number;
  onReset: () => void;
}) {
  const { run, missing, error, refetch } = useLiveRun(runId);
  const cancel = useCancelRun();
  const canceled = useCanceledRuns();
  const active = isActive(run?.status);

  const head = (
    <>
      <Button size="sm" variant="ghost" onClick={onReset} aria-label="nova caçada">
        <Plus /> <span className="hidden sm:inline">nova caçada</span>
      </Button>
      {run && active && !canceled.has(run.id) && (
        <Button
          size="sm"
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate(run.id)}
        >
          <XCircle /> cancelar
        </Button>
      )}
    </>
  );

  return (
    <Panel
      title="caçada"
      aside={
        <span className="flex items-center gap-2">
          <span className="hidden font-mono sm:inline">run {shortId(runId)}</span>
          {run && <RunStatus status={run.status} />}
        </span>
      }
      actions={head}
      flush
      className="overflow-hidden"
    >
      <div className="dark bg-sidebar text-sidebar-foreground">
        {run ? (
          <StageBody run={run} fallbackTarget={fallbackTarget} onReset={onReset} />
        ) : (
          <div className="flex min-h-40 items-center gap-3 px-4 py-6">
            <LiveDot on={!missing && !error} />
            <span className="text-base font-medium">
              {missing
                ? 'essa caçada não existe mais.'
                : error
                  ? `não deu pra abrir — ${errorMessage(error)}`
                  : 'abrindo a sala…'}
            </span>
            {error && !missing && (
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                tentar de novo
              </Button>
            )}
            {missing && (
              <Button size="sm" variant="outline" onClick={onReset}>
                voltar
              </Button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function StageBody({
  run,
  fallbackTarget,
  onReset,
}: {
  run: AgentRun;
  fallbackTarget: number;
  onReset: () => void;
}) {
  const active = isActive(run.status);
  const now = useTick(active, 200);
  const steps = useMemo(() => (run.steps ?? []) as Step[], [run]);
  const leads = useMemo(() => foundLeads(steps), [steps]);
  const created = leads.filter((l) => !l.duplicate).length;
  const target = Number((run.params ?? {}).target) || fallbackTarget;
  const elapsed =
    (run.finished_at ? new Date(run.finished_at).getTime() : now) -
    new Date(run.started_at ?? run.created_at).getTime();

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-3">
        <LiveDot on={active} />
        <span className="min-w-0 flex-1 truncate text-base font-medium">
          {STAGE_TITLE[run.status] ?? run.status}
        </span>
        <span className="font-mono text-sm text-sidebar-muted tnum">{fmtClock(elapsed)}</span>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(240px,34%)]">
        {active ? (
          <Stream steps={steps} queued={run.status === 'queued'} />
        ) : (
          <EndSummary run={run} created={created} elapsed={elapsed} onReset={onReset} />
        )}
        <div className="flex flex-col gap-3 border-t border-sidebar-border p-4 md:border-t-0 md:border-l">
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold tnum">{created}</span>
            <span className="text-sm text-sidebar-muted">/ {target} leads</span>
          </div>
          <ProgressSliver
            value={created}
            max={Math.max(1, target)}
            tone="agent"
            className="bg-sidebar-accent"
            label={`${created} de ${target} leads`}
          />
          <div className="flex max-h-80 flex-col gap-2 overflow-auto">
            {leads.map((l) => (
              <LeadCard key={l.key} lead={l} />
            ))}
            {!leads.length && (
              <p className="text-xs text-sidebar-muted">
                os leads caem aqui conforme a máquina os cria
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stream({ steps, queued }: { steps: Step[]; queued: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // follows the tail inside the log only — never scrolls the page
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps.length]);
  return (
    <div
      ref={ref}
      role="log"
      aria-live="polite"
      className="flex h-72 flex-col gap-1.5 overflow-auto p-4 font-mono text-xs md:h-96"
    >
      <p className="text-sidebar-muted">contexto carregado — pitch, memória, guardrails</p>
      {steps
        .filter((s) => s.type !== 'system_prompt')
        .map((s, i) =>
          s.type === 'model' ? (
            <div key={i} className="flex flex-col gap-0.5 py-0.5 font-sans">
              <span className="text-[13px] text-sidebar-foreground italic">
                {String(s.content ?? '')
                  .trim()
                  .split('\n')[0]
                  ?.slice(0, 160) || 'pensando…'}
              </span>
              {s.toolCalls?.length ? (
                <span className="font-mono text-[11px] text-sidebar-muted">
                  → {callNames(s.toolCalls)}
                </span>
              ) : null}
            </div>
          ) : (
            <div key={i} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span
                aria-hidden
                className={cn(
                  'size-1.5 shrink-0 translate-y-[-1px] rounded-full',
                  s.pending
                    ? 'animate-pulse bg-warning'
                    : isToolError(s)
                      ? 'bg-destructive'
                      : 'bg-agent',
                )}
              />
              <span className="shrink-0 font-sans text-[13px]">
                {TOOL_LABEL[s.name ?? ''] ?? s.name}
              </span>
              <span className="min-w-0 flex-1 truncate text-sidebar-muted">{argHint(s)}</span>
              <span
                className={cn(
                  'w-full pl-3.5 sm:w-auto sm:shrink-0 sm:pl-0 sm:text-right',
                  s.pending ? 'animate-pulse text-sidebar-muted' : 'text-agent',
                  isToolError(s) && 'text-destructive-foreground',
                )}
              >
                {s.pending ? '…' : outHint(s)}
              </span>
            </div>
          ),
        )}
      {queued && <p className="animate-pulse text-sidebar-muted">aguardando o worker…</p>}
    </div>
  );
}

function EndSummary({
  run,
  created,
  elapsed,
  onReset,
}: {
  run: AgentRun;
  created: number;
  elapsed: number;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col justify-center gap-2 p-4 md:min-h-60 md:p-6">
      <div className="flex items-baseline gap-3">
        <span className="text-5xl font-semibold text-agent tnum">{created}</span>
        <span className="text-lg">
          {created === 1 ? 'lead no CRM.' : created ? 'leads no CRM.' : 'nenhum lead dessa vez.'}
        </span>
      </div>
      <p className="text-xs text-sidebar-muted tnum">
        {fmtClock(elapsed)} · {run.tokens_in}↑ {run.tokens_out}↓ · {fmtUsdCents(run.cost_cents)}
      </p>
      {runError(run) && (
        <p className="rounded-md bg-destructive-soft px-2.5 py-1.5 text-xs break-words text-destructive-foreground">
          {runError(run)}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {created > 0 && (
          <Button asChild variant="agent" size="sm">
            <Link to="/pipeline">
              ver leads <ArrowRight />
            </Link>
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onReset}>
          <Plus /> nova caçada
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to={`/agente/atividade/${run.id}`}>
            <History /> trajetória completa
          </Link>
        </Button>
      </div>
    </div>
  );
}

function LeadCard({ lead: l }: { lead: FoundLead }) {
  const body = (
    <>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
        {l.fitScore != null && (
          <Badge variant="agent" className="tnum" title={`fit ${l.fitScore}`}>
            {l.fitScore}
          </Badge>
        )}
        {l.intentScore != null && (
          <Badge
            variant="outline"
            className="tnum"
            title={l.intentReason ?? `intenção ${l.intentScore}`}
          >
            i{l.intentScore}
          </Badge>
        )}
      </div>
      <div className="truncate text-xs text-sidebar-muted">
        {[l.segment, l.city].filter(Boolean).join(' · ') || '—'}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-sidebar-muted">
        <span className="min-w-0 flex-1 truncate">{l.contact.join(' · ') || 'sem contato'}</span>
        {l.duplicate && <span className="shrink-0 text-warning">já existia</span>}
      </div>
    </>
  );
  const cls = cn(
    'flex flex-col gap-0.5 rounded-md border border-sidebar-border bg-sidebar-accent px-2.5 py-2',
    l.duplicate && 'opacity-60',
  );
  return l.id ? (
    <Link to={`/pipeline/${l.id}`} className={cn(cls, 'transition-colors hover:border-agent/50')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
