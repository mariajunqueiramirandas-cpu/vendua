import { Instagram, Mail, MessageCircle, PencilLine } from 'lucide-react';
import type { LeadListItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { isLate, relDue } from '@/lib/format.ts';
import { AGENT_GOAL_LABEL, AGENT_MODE_LABEL } from '@/lib/labels.ts';
import { Badge } from '@/components/ui/badge.tsx';

/** Reachability glyph: lit = channel exists, warn = suspect, bad = failed, dim = missing. */
function Chan({
  on,
  tone,
  title,
  icon: Icon,
}: {
  on: boolean;
  tone?: 'warn' | 'bad' | undefined;
  title: string;
  icon: typeof Mail;
}) {
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex p-0.5',
        !on && 'text-muted-foreground/35',
        on && !tone && 'text-foreground',
        tone === 'warn' && 'text-warning',
        tone === 'bad' && 'text-destructive',
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}

export function Channels({ lead: l }: { lead: LeadListItem }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap">
      <Chan
        on={!!l.whatsapp}
        tone={l.whatsapp && !l.whatsappVerified ? 'warn' : undefined}
        title={
          l.whatsapp
            ? `whatsapp ${l.whatsapp}${l.whatsappVerified ? '' : ' — não verificado'}`
            : 'sem whatsapp'
        }
        icon={MessageCircle}
      />
      <Chan
        on={!!l.email}
        tone={l.emailBouncedAt ? 'bad' : undefined}
        title={
          l.emailBouncedAt
            ? `email ${l.email} — bounce`
            : l.email
              ? `email ${l.email}`
              : 'sem email'
        }
        icon={Mail}
      />
      <Chan
        on={!!l.instagram}
        title={l.instagram ? `instagram ${l.instagram}` : 'sem instagram'}
        icon={Instagram}
      />
    </span>
  );
}

export function AgentMode({ lead: l }: { lead: LeadListItem }) {
  if (l.agentPausedAt)
    return (
      <Badge variant="warn" title="agente pausado — handoff da equipe">
        pausado
      </Badge>
    );
  if (l.agentMode === 'off') return <Badge>off</Badge>;
  return (
    <Badge
      variant="agent"
      title={`agente ${AGENT_MODE_LABEL[l.agentMode]} · ${AGENT_GOAL_LABEL[l.agentGoal] ?? ''}`}
    >
      {AGENT_MODE_LABEL[l.agentMode]}
    </Badge>
  );
}

export function Drafts({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <Badge variant="warn" title="rascunhos aguardando aprovação no inbox">
      <PencilLine />
      {n}
    </Badge>
  );
}

export function NextAction({ lead: l }: { lead: LeadListItem }) {
  return (
    <span className="whitespace-nowrap">
      <span className={cn(isLate(l.nextActionAt) && 'text-destructive-foreground')}>
        {relDue(l.nextActionAt)}
      </span>
      {l.openTasks > 0 && (
        <span className="text-muted-foreground" title={`${l.openTasks} tarefa(s) aberta(s)`}>
          {' '}
          · {l.openTasks} tar.
        </span>
      )}
    </span>
  );
}

export function FitIntent({ lead: l }: { lead: LeadListItem }) {
  return (
    <span className="text-xs whitespace-nowrap tnum" title={l.fitReason ?? undefined}>
      {l.fitScore != null ? `${l.fitScore}/10` : '—'}
      {l.intentScore != null && (
        <span className="text-muted-foreground" title={l.intentReason ?? undefined}>
          {' '}
          · i{l.intentScore}
        </span>
      )}
    </span>
  );
}
