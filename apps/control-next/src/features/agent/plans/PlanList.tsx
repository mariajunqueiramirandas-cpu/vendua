import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronDown, Circle, SkipForward } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { AGENT_GOAL_LABEL } from '@/lib/labels.ts';
import { ProgressSliver } from '@/components/ProgressSliver.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { planProgress } from './queries.ts';

function PlanRow({ lead }: { lead: LeadListItem }) {
  const [open, setOpen] = useState(false);
  const { resolved, total } = planProgress(lead);
  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              to={`/pipeline/${lead.id}`}
              className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
            >
              {lead.name}
            </Link>
            <Badge variant="agent-soft" title="objetivo atual">
              {AGENT_GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <ProgressSliver
              value={resolved}
              max={total}
              className="max-w-56 flex-1"
              label={`${resolved} de ${total} etapas resolvidas`}
            />
            <span className="text-xs text-muted-foreground tnum">
              {resolved}/{total} etapas
            </span>
          </div>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`plano de ${lead.name}`}
        >
          <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      {open && (
        <ol className="flex flex-col gap-1.5 border-t bg-muted/40 px-3 py-2">
          {lead.agentPlan.map((s, i) => (
            <li key={i} className="flex gap-2 text-sm">
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

export function PlanList({ leads }: { leads: LeadListItem[] }) {
  return (
    <ul className="divide-y">
      {leads.map((l) => (
        <PlanRow key={l.id} lead={l} />
      ))}
    </ul>
  );
}
