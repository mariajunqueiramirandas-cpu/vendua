import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, MessagesSquare } from 'lucide-react';
import { api } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { rel } from '@/lib/format.ts';
import { qk } from '@/lib/query.ts';
import { EmptyState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useLeadThreads } from './queries.ts';
import { NewThreadButtons } from './LeadChannels.tsx';
import { ThreadAgentSwitch } from './agent/AgentControl.tsx';

const PREVIEW = 3;

function ThreadPreview({
  thread,
  leadId,
}: {
  thread: { id: string; channel: string; agentEnabled: boolean };
  leadId: string;
}) {
  const { data, isPending } = useQuery({
    queryKey: qk.thread(thread.id),
    queryFn: () => api.thread(thread.id),
  });
  const msgs = data?.messages.slice(-PREVIEW) ?? [];
  const total = data?.messages.length ?? 0;
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5">
        <Badge>{thread.channel}</Badge>
        {data?.thread.subject && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {data.thread.subject}
          </span>
        )}
        <span className="text-xs text-muted-foreground tnum">
          {total} {total === 1 ? 'mensagem' : 'mensagens'}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThreadAgentSwitch thread={thread} leadId={leadId} />
          <Button asChild size="sm" variant="outline">
            <Link to={`/inbox/${thread.id}`}>
              abrir <ArrowUpRight />
            </Link>
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        {isPending ? (
          <LoadingRows rows={2} />
        ) : !msgs.length ? (
          <p className="text-xs text-muted-foreground">sem mensagens ainda</p>
        ) : (
          <>
            {total > PREVIEW && (
              <p className="text-center text-[11px] text-muted-foreground">
                +{total - PREVIEW} anteriores
              </p>
            )}
            {msgs.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm',
                  m.direction === 'out'
                    ? 'self-end bg-secondary'
                    : 'self-start border bg-background',
                  m.status === 'draft' && 'border border-dashed border-warning bg-warning-soft',
                )}
              >
                <p className="line-clamp-4 break-words whitespace-pre-wrap">{m.body}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {m.direction === 'out' ? m.author : 'lead'}
                  {m.status === 'draft' ? ' · rascunho' : ''} · {rel(m.createdAt)}
                </p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/** "conversas" tab: every thread with its last messages, agent switch and a jump to the inbox. */
export function LeadConversations({ leadId }: { leadId: string }) {
  const { data: threads = [], isPending } = useLeadThreads(leadId);
  if (isPending) return <LoadingRows rows={3} />;
  return (
    <div className="flex flex-col gap-3">
      {threads.map((t) => (
        <ThreadPreview key={t.id} thread={t} leadId={leadId} />
      ))}
      {!threads.length && (
        <EmptyState
          icon={MessagesSquare}
          title="nenhuma conversa ainda"
          hint="o agente cria uma ao primeiro contato — ou abra uma agora"
        />
      )}
      <NewThreadButtons
        leadId={leadId}
        have={threads.map((t) => t.channel)}
        className={cn(!threads.length && 'justify-center')}
      />
    </div>
  );
}
