import { CheckCircle2, Circle, SkipForward } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { AGENT_GOAL_LABEL } from '@/lib/labels.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Hint, Section } from '../Section.tsx';

export function AgentPlan({ lead }: { lead: LeadListItem }) {
  const plan = lead.agentPlan;
  const resolved = plan.filter((s) => s.status !== 'todo').length;
  return (
    <Section
      title="plano"
      actions={
        plan.length > 0 && (
          <span className="text-xs text-muted-foreground tnum">
            {resolved}/{plan.length}
          </span>
        )
      }
    >
      {plan.length > 0 ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <Badge variant="agent" title="objetivo atual">
              {AGENT_GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}
            </Badge>
            <span
              className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
              title={`${resolved} de ${plan.length} etapas resolvidas`}
            >
              <span
                className="block h-full rounded-full bg-agent"
                style={{ width: `${(resolved / plan.length) * 100}%` }}
              />
            </span>
          </div>
          <ol className="flex flex-col gap-1.5">
            {plan.map((s, i) => (
              <li key={i} className="flex gap-2">
                {s.status === 'done' ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                ) : s.status === 'skip' ? (
                  <SkipForward className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />
                )}
                <div className="min-w-0">
                  <p
                    className={cn(
                      'text-sm',
                      s.status === 'done' && 'text-muted-foreground',
                      s.status === 'skip' && 'text-muted-foreground line-through',
                    )}
                  >
                    {s.step}
                  </p>
                  {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <Hint>sem plano — o agente monta um quando o objetivo está claro</Hint>
      )}
    </Section>
  );
}
