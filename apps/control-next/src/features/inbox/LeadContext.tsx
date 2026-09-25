import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, Bot, Pause } from 'lucide-react';
import { api, type ThreadView } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime, fmtMoney, relDue, isLate } from '@/lib/format.ts';
import { AGENT_GOAL_LABEL, AGENT_MODE_LABEL } from '@/lib/labels.ts';
import { qk } from '@/lib/query.ts';
import { Avatar, Fact, StateChip } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/controls.tsx';
import { CH_ICON, CH_LABEL } from './channel.ts';

const SEND_MODE_LABEL: Record<string, string> = {
  auto: 'envia sozinho',
  draft: 'só rascunhos',
  blocked: 'bloqueado',
};

/** Lead side panel: who this is, what it's worth, what the agent knows and may do. */
export function LeadContext({
  view,
  className,
}: {
  view: ThreadView;
  className?: string | undefined;
}) {
  const { lead, thread } = view;
  const facts = useQuery({
    queryKey: qk.leadFacts(lead.id),
    queryFn: () => api.leadFacts(lead.id),
  });
  const autonomy = useQuery({
    queryKey: qk.leadAutonomy(lead.id),
    queryFn: () => api.leadAutonomy(lead.id),
  });
  const threads = useQuery({
    queryKey: qk.leadThreads(lead.id),
    queryFn: () => api.leadThreads(lead.id),
  });
  const others = (threads.data?.threads ?? []).filter((t) => t.id !== thread.id);
  const sub = lead.businessName && lead.businessName !== lead.name ? lead.businessName : null;

  return (
    <div className={cn('flex flex-col gap-4 text-sm', className)}>
      <div className="flex items-start gap-2.5">
        <Avatar name={lead.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{lead.name}</div>
          {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
          <div className="mt-1 flex flex-wrap gap-1">
            <StateChip state={lead.state} />
            {lead.segment && <Badge>{lead.segment}</Badge>}
            {lead.archivedAt && <Badge variant="outline">arquivado</Badge>}
            {lead.unsubscribedAt && <Badge variant="bad">descadastrado</Badge>}
          </div>
        </div>
      </div>

      <Button asChild variant="outline" size="sm" className="w-full">
        <Link to={`/pipeline/${lead.id}`}>
          abrir lead <ArrowUpRight />
        </Link>
      </Button>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Fact label="valor">
          <span className="tnum">{fmtMoney(lead.dealValueCents)}</span>
        </Fact>
        <Fact label="próxima ação">
          <span className={cn('tnum', isLate(lead.nextActionAt) && 'text-warning-foreground')}>
            {lead.nextActionAt ? relDue(lead.nextActionAt) : '—'}
          </span>
        </Fact>
        <Fact label="cidade">{lead.city ?? '—'}</Fact>
        <Fact label="origem">{lead.source ?? '—'}</Fact>
        {lead.whatsapp && (
          <Fact label={lead.whatsappVerified ? 'whatsapp' : 'whatsapp (não verificado)'}>
            <span className="tnum">{lead.whatsapp}</span>
          </Fact>
        )}
        {lead.email && (
          <Fact label={lead.emailBouncedAt ? 'email (bounce)' : 'email'}>{lead.email}</Fact>
        )}
        {lead.fitScore != null && (
          <Fact label="fit">
            <span className="tnum">{lead.fitScore}</span>
          </Fact>
        )}
        {lead.intentScore != null && (
          <Fact label="intenção">
            <span className="tnum">{lead.intentScore}</span>
          </Fact>
        )}
      </div>

      <Section title="agente">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={lead.agentMode === 'off' ? 'default' : 'agent-soft'}>
              <Bot /> {AGENT_MODE_LABEL[lead.agentMode] ?? lead.agentMode}
            </Badge>
            <Badge>{AGENT_GOAL_LABEL[lead.agentGoal] ?? lead.agentGoal}</Badge>
            {!thread.agentEnabled && (
              <Badge variant="outline">
                <Pause /> off nesta conversa
              </Badge>
            )}
          </div>
          {lead.agentPausedAt && (
            <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              pausado (handoff) desde {fmtDateTime(lead.agentPausedAt)} — reative o agente na
              conversa para retomar
            </p>
          )}
          {autonomy.isPending ? (
            <Skeleton className="h-4 w-3/4" />
          ) : autonomy.data ? (
            <p className="text-xs text-muted-foreground">
              {SEND_MODE_LABEL[autonomy.data.sendMode] ?? autonomy.data.sendMode}
              {autonomy.data.reasons[0] && ` · ${autonomy.data.reasons[0].message}`}
            </p>
          ) : null}
          {lead.agentPlan.length > 0 && (
            <ol className="mt-1 flex flex-col gap-0.5 text-xs">
              {lead.agentPlan.slice(0, 5).map((s, i) => (
                <li
                  key={i}
                  className={cn(
                    'flex gap-1.5',
                    s.status !== 'todo' && 'text-muted-foreground line-through',
                  )}
                >
                  <span className="tnum text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0">{s.step}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Section>

      <Section title="fatos">
        {facts.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : facts.data?.facts.length ? (
          <dl className="flex flex-col gap-1.5">
            {facts.data.facts.slice(0, 10).map((f) => (
              <div key={f.key} className="flex min-w-0 flex-col">
                <dt className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {f.key}
                  {f.source === 'agent' && <Bot className="size-3" aria-label="do agente" />}
                </dt>
                <dd className="text-[13px] break-words">{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">nenhum fato registrado</p>
        )}
      </Section>

      {others.length > 0 && (
        <Section title="outras conversas">
          <div className="flex flex-col gap-0.5">
            {others.map((t) => {
              const Icon = CH_ICON[t.channel] ?? Bot;
              return (
                <Link
                  key={t.id}
                  to={`/inbox/${t.id}`}
                  className="-mx-1.5 flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-hover"
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                  {CH_LABEL[t.channel] ?? t.channel}
                  {t.agentEnabled && <Bot className="ml-auto size-3.5 text-muted-foreground" />}
                </Link>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5 border-t pt-3">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
