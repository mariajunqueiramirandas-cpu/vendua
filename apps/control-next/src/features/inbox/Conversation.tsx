import { Link } from 'react-router-dom';
import { Bot, BotOff, PanelRight } from 'lucide-react';
import type { ThreadView } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { Avatar, ErrorState, LoadingRows, StateChip } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Switch, Tooltip } from '@/components/ui/controls.tsx';
import { CH_LABEL } from './channel.ts';
import { Composer } from './Composer.tsx';
import { MessageList } from './MessageList.tsx';
import { useThread, useThreadAgent } from './queries.ts';

export const threadSubtitle = (v: ThreadView) =>
  v.thread.subject ??
  [CH_LABEL[v.thread.channel] ?? v.thread.channel, v.lead.businessName].filter(Boolean).join(' · ');

/** Messages + composer for one thread; the header is optional (phones use the Page header). */
export function Conversation({
  threadId,
  header,
  onContext,
}: {
  threadId: string;
  /** render the in-pane header line (desktop) */
  header?: boolean | undefined;
  /** show the "contexto" button — when the lead panel isn't docked */
  onContext?: (() => void) | undefined;
}) {
  const q = useThread(threadId);
  // placeholder-free: a previous thread's data never renders under this id
  const view = q.data?.thread.id === threadId ? q.data : undefined;

  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!view) return <LoadingRows className="p-4" />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header && (
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b px-4">
          <Avatar name={view.lead.name} />
          <div className="flex min-w-0 flex-col">
            <Link
              to={`/pipeline/${view.lead.id}`}
              className="truncate leading-tight font-medium hover:underline"
            >
              {view.lead.name}
            </Link>
            <span className="truncate text-xs leading-tight text-muted-foreground">
              {threadSubtitle(view)}
            </span>
          </div>
          <StateChip state={view.lead.state} />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <AgentSwitch view={view} />
            {onContext && (
              <Button size="sm" variant="outline" onClick={onContext}>
                <PanelRight /> contexto
              </Button>
            )}
          </div>
        </div>
      )}
      <MessageList view={view} />
      <Composer key={view.thread.id} view={view} />
    </div>
  );
}

/** Labeled switch — desktop header and the context sheet. */
export function AgentSwitch({ view, className }: { view: ThreadView; className?: string }) {
  const agent = useThreadAgent();
  const id = `agent-${view.thread.id}`;
  return (
    <label htmlFor={id} className={cn('inline-flex items-center gap-2 text-sm', className)}>
      <Switch
        id={id}
        checked={view.thread.agentEnabled}
        onCheckedChange={(enabled) => agent.mutate({ threadId: view.thread.id, enabled })}
      />
      agente
    </label>
  );
}

/** Compact icon toggle for the phone header. */
export function AgentToggleButton({ view }: { view: ThreadView }) {
  const agent = useThreadAgent();
  const on = view.thread.agentEnabled;
  return (
    <Tooltip content={on ? 'agente ligado nesta conversa' : 'agente desligado nesta conversa'}>
      <Button
        size="icon"
        variant={on ? 'agent' : 'ghost'}
        aria-pressed={on}
        aria-label={on ? 'desligar agente nesta conversa' : 'ligar agente nesta conversa'}
        onClick={() => agent.mutate({ threadId: view.thread.id, enabled: !on })}
      >
        {on ? <Bot /> : <BotOff />}
      </Button>
    </Tooltip>
  );
}
