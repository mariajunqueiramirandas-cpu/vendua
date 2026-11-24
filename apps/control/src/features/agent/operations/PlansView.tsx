import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Circle, ListChecks, Search, SkipForward } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { isLate, relDue } from '@/lib/format.ts';
import { AGENT_GOAL_LABEL, AGENT_GOALS } from '@/lib/labels.ts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { ProgressSliver } from '@/components/ProgressSliver.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { Segmented } from '@/components/ui/controls.tsx';
import { Input } from '@/components/ui/input.tsx';
import { planProgress } from '../queue.ts';

function PlanRow({ lead }: { lead: LeadListItem }) {
  const [open, setOpen] = useState(false);
  const { resolved, total } = planProgress(lead);
  const nextStep = lead.agentPlan.find((s) => s.status === 'todo');

  return (
    <li className="flex flex-col">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              to={`/pipeline/${lead.id}`}
              className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
            >
              {lead.name}
            </Link>
            {lead.businessName && lead.businessName !== lead.name && (
              <span className="truncate text-xs text-muted-foreground">{lead.businessName}</span>
            )}
            <Badge variant="agent-soft" title="objetivo atual do agente">
              {AGENT_GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}
            </Badge>
            {lead.nextActionAt && (
              <span
                className={cn(
                  'ml-auto text-xs whitespace-nowrap text-muted-foreground tnum',
                  isLate(lead.nextActionAt) && 'font-medium text-destructive-foreground',
                )}
              >
                próximo disparo {relDue(lead.nextActionAt)}
              </span>
            )}
          </div>
          {nextStep && !open && (
            <p className="truncate text-xs text-muted-foreground">próxima etapa: {nextStep.step}</p>
          )}
          {total > 0 && (
            <div className="flex items-center gap-2">
              <ProgressSliver
                value={resolved}
                max={total}
                className="max-w-56 flex-1"
                label={`${resolved} de ${total} etapas concluídas`}
              />
              <span className="text-xs text-muted-foreground tnum">
                {resolved}/{total} etapas
              </span>
            </div>
          )}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`etapas do plano de ${lead.name}`}
        >
          <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      {open && (
        <ol className="flex flex-col gap-1.5 border-t bg-muted/40 px-3 py-2.5">
          {lead.agentPlan.map((s, i) => (
            <li key={s.key ?? i} className="flex gap-2 text-sm">
              {s.status === 'done' ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              ) : s.status === 'skip' ? (
                <SkipForward className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              ) : (
                <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0">
                <span
                  className={cn(
                    s.status === 'skip' && 'text-muted-foreground line-through',
                    s.status === 'done' && 'text-muted-foreground',
                  )}
                >
                  {s.step}
                </span>
                {s.note && <span className="block text-xs text-muted-foreground">{s.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/** Dedicated view for per-lead multi-step negotiation plans tracked by the agent. */
export function PlansView({
  planned,
  ready,
  error,
  onRetry,
}: {
  planned: LeadListItem[];
  ready: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const [q, setQ] = useState('');
  const [goal, setGoal] = useState<'all' | 'negotiation' | 'meeting'>('all');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return planned.filter((l) => {
      if (goal !== 'all' && l.agentGoal !== goal) return false;
      if (!term) return true;
      return (
        l.name.toLowerCase().includes(term) ||
        (l.businessName ?? '').toLowerCase().includes(term) ||
        l.agentPlan.some((s) => s.step.toLowerCase().includes(term))
      );
    });
  }, [planned, q, goal]);

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!ready) return <LoadingRows />;

  if (!planned.length) {
    return (
      <Panel>
        <EmptyState
          icon={ListChecks}
          title="nenhum plano ativo ainda"
          hint="o agente cria um checklist interno por lead (situação, necessidade, valor e próximo passo) — diferente das tarefas da equipe"
        />
      </Panel>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filtrar por lead ou etapa…"
            aria-label="filtrar planos"
            className="pl-8"
          />
        </div>
        <Segmented
          size="sm"
          value={goal}
          onChange={setGoal}
          options={[['all', 'todos'], ...AGENT_GOALS]}
        />
      </div>

      <Panel
        title="planos dos leads"
        aside="checklist interno que o agente acompanha entre conversas (distinto das tarefas da equipe)"
        flush
      >
        {filtered.length ? (
          <ul className="divide-y">
            {filtered.map((l) => (
              <PlanRow key={l.id} lead={l} />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="nenhum plano com esse filtro"
            hint="limpe a busca ou troque o objetivo"
          />
        )}
      </Panel>
    </div>
  );
}
