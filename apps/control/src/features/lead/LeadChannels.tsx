import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Link2, Plus, Video } from 'lucide-react';
import { toast } from 'sonner';
import { api, type Meeting } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtDateTime } from '@/lib/format.ts';
import { MEETING_STATUS_LABEL } from '@/lib/labels.ts';
import { errorMessage, qk } from '@/lib/query.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { meetingsKey, useLeadMeetings, useLeadThreads } from './queries.ts';
import { Hint, Row, Section } from './Section.tsx';

export const CHANNELS = ['whatsapp', 'instagram', 'email', 'manual'] as const;

export function useNewThread(leadId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (ch: string) => api.newThread(leadId, ch),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.leadThreads(leadId) });
      void client.invalidateQueries({ queryKey: ['threads'] });
    },
  });
}

/** "+ canal" buttons for every channel the lead has no thread on yet. */
export function NewThreadButtons({
  leadId,
  have,
  className,
}: {
  leadId: string;
  have: readonly string[];
  className?: string;
}) {
  const create = useNewThread(leadId);
  const missing = CHANNELS.filter((ch) => !have.includes(ch));
  if (!missing.length) return null;
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {missing.map((ch) => (
        <Button
          key={ch}
          size="sm"
          variant="ghost"
          disabled={create.isPending}
          onClick={() => create.mutate(ch)}
          title={`abrir conversa por ${ch}`}
        >
          <Plus /> {ch}
        </Button>
      ))}
    </div>
  );
}

/** Compact thread list for the facts rail — the full previews live in the "conversas" tab. */
export function LeadChannels({ leadId }: { leadId: string }) {
  const { data: threads = [], isPending } = useLeadThreads(leadId);
  return (
    <Section title="conversas">
      {threads.map((t) => (
        <Row key={t.id}>
          <Badge>{t.channel}</Badge>
          <span className="flex-1 truncate text-xs text-muted-foreground">
            {t.agentEnabled ? 'agente ativo' : 'agente fora'}
          </span>
          <Button asChild size="sm" variant="ghost">
            <Link to={`/inbox/${t.id}`}>abrir</Link>
          </Button>
        </Row>
      ))}
      {!threads.length && !isPending && (
        <Hint>nenhuma conversa ainda — o agente cria uma ao primeiro contato</Hint>
      )}
      <NewThreadButtons leadId={leadId} have={threads.map((t) => t.channel)} className="mt-1" />
    </Section>
  );
}

// per-lead booking link, copied — token is signed server-side
function CopyLinkButton({ leadId }: { leadId: string }) {
  const [copied, setCopied] = useState(false);
  const link = useMutation({
    mutationFn: () => api.bookingLink(leadId),
    onSuccess: async (r) => {
      try {
        await navigator.clipboard.writeText(r.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        window.prompt('copie o link:', r.url);
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Button
      size="sm"
      variant="ghost"
      title="link de agendamento do lead (válido por 30 dias)"
      disabled={link.isPending}
      onClick={() => link.mutate()}
    >
      {copied ? <Check /> : <Link2 />} {copied ? 'copiado!' : 'copiar link'}
    </Button>
  );
}

const MEETING_VARIANT: Record<Meeting['status'], 'agent-soft' | 'default' | 'bad' | 'warn'> = {
  scheduled: 'agent-soft',
  done: 'default',
  no_show: 'warn',
  cancelled: 'bad',
};

export function LeadCalls({ leadId }: { leadId: string }) {
  const client = useQueryClient();
  const { data: meetings = [], isPending } = useLeadMeetings(leadId);
  const cancel = useMutation({
    mutationFn: (id: string) => api.patchMeeting(id, { status: 'cancelled' }),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: meetingsKey(leadId) });
      void client.invalidateQueries({ queryKey: ['meetings'] });
    },
  });
  return (
    <Section title="calls" actions={<CopyLinkButton leadId={leadId} />}>
      {meetings.map((m) => (
        <Row key={m.id}>
          <span className="text-xs tnum">{fmtDateTime(m.startsAt)}</span>
          <Badge variant={MEETING_VARIANT[m.status]}>{MEETING_STATUS_LABEL[m.status]}</Badge>
          <span className="flex-1" />
          {m.roomUrl && m.status === 'scheduled' && (
            <Button asChild size="icon-sm" variant="ghost">
              <a
                href={m.roomUrl}
                target="_blank"
                rel="noopener"
                title="abrir sala"
                aria-label="abrir sala"
              >
                <Video />
              </a>
            </Button>
          )}
          {m.status === 'scheduled' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={cancel.isPending && cancel.variables === m.id}
              onClick={() => cancel.mutate(m.id)}
            >
              cancelar
            </Button>
          )}
        </Row>
      ))}
      {!meetings.length && !isPending && (
        <Hint>nenhuma call ainda — copie o link e mande pro lead</Hint>
      )}
    </Section>
  );
}
