import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlarmClock, Check, CheckCircle2, FileText, MessageCircle } from 'lucide-react';
import type { Draft, Task, ThreadItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { rel } from '@/lib/format.ts';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { useApprovals, useApprove, useTasks, useThreads } from './queries.ts';
import { bucket } from './tasks.ts';
import { TaskCheck, TaskDue, TaskLead } from './TasksView.tsx';

type Item =
  | { kind: 'task-late'; at: number; task: Task }
  | { kind: 'draft'; at: number; draft: Draft }
  | { kind: 'reply'; at: number; thread: ThreadItem }
  | { kind: 'task-today'; at: number; task: Task };

// what goes stale fastest first: promises already broken, then a lead waiting on us
const RANK: Record<Item['kind'], number> = { 'task-late': 0, draft: 1, reply: 2, 'task-today': 3 };
const LIMIT = 14;
const LIMIT_PHONE = 8;

const ts = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);
const who = (name: string, biz: string | null | undefined) =>
  biz && biz !== name ? `${name} · ${biz}` : name;

function Row({
  icon,
  tone,
  lead,
  children,
  aside,
}: {
  icon: ReactNode;
  tone?: 'bad' | 'warn' | 'agent' | undefined;
  lead: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-hover">
      <span
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center [&_svg]:size-4',
          tone === 'bad' && 'text-destructive-foreground',
          tone === 'warn' && 'text-warning-foreground',
          (!tone || tone === 'agent') && 'text-muted-foreground',
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {children}
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {lead}
        </div>
      </div>
      {aside && <div className="flex shrink-0 items-center gap-1">{aside}</div>}
    </li>
  );
}

/** One prioritized list: late + due-today tasks, drafts to approve, threads waiting on a reply. */
export function NeedsYou() {
  const tasks = useTasks(false);
  const approvals = useApprovals();
  const threads = useThreads();
  const approve = useApprove();
  const limit = useIsMobile() ? LIMIT_PHONE : LIMIT;

  const now = Date.now();
  const items: Item[] = [];
  for (const t of tasks.data?.tasks ?? []) {
    const b = bucket(t, now);
    if (b === 'atrasadas') items.push({ kind: 'task-late', at: ts(t.dueAt), task: t });
    else if (b === 'hoje') items.push({ kind: 'task-today', at: ts(t.dueAt), task: t });
  }
  for (const d of approvals.data?.drafts ?? [])
    items.push({ kind: 'draft', at: ts(d.createdAt), draft: d });
  // threads with a pending draft are already covered by the draft row
  for (const th of threads.data?.threads ?? [])
    if (th.needsReply && !th.pendingDrafts)
      items.push({ kind: 'reply', at: ts(th.lastMessageAt), thread: th });
  items.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.at - b.at);

  const pending = tasks.isPending || approvals.isPending || threads.isPending;
  const failed = [tasks, approvals, threads].find((q) => q.isError && !q.data);
  const counts = {
    late: items.filter((i) => i.kind === 'task-late').length,
    drafts: approvals.data?.drafts.length ?? 0,
    replies: items.filter((i) => i.kind === 'reply').length,
  };

  const render = (it: Item) => {
    switch (it.kind) {
      case 'task-late':
      case 'task-today': {
        const t = it.task;
        return (
          <Row
            key={`t-${t.id}`}
            icon={<TaskCheck t={t} />}
            lead={<TaskLead t={t} />}
            aside={<TaskDue t={t} b={bucket(t, now)} />}
          >
            <span className={cn('text-sm', t.doneAt && 'text-muted-foreground line-through')}>
              {t.title}
            </span>
          </Row>
        );
      }
      case 'draft': {
        const d = it.draft;
        const busy = approve.isPending && approve.variables === d.id;
        return (
          <Row
            key={`d-${d.id}`}
            tone="warn"
            icon={<FileText />}
            lead={
              <span className="truncate">
                rascunho · {d.channel} · {rel(d.createdAt)}
              </span>
            }
            aside={
              <>
                <Button asChild variant="ghost" size="sm" className="max-sm:hidden">
                  <Link to={`/inbox/${d.threadId}`}>abrir</Link>
                </Button>
                <Button
                  size="sm"
                  variant="agent"
                  disabled={busy}
                  onClick={() => approve.mutate(d.id)}
                >
                  <Check /> {busy ? 'enviando…' : 'aprovar'}
                </Button>
              </>
            }
          >
            <Link to={`/inbox/${d.threadId}`} className="min-w-0 text-sm hover:underline">
              <span className="font-medium">{who(d.leadName, d.businessName)}</span>
              <span className="line-clamp-2 text-muted-foreground md:line-clamp-1">{d.body}</span>
            </Link>
          </Row>
        );
      }
      case 'reply': {
        const th = it.thread;
        return (
          <Row
            key={`r-${th.id}`}
            icon={<MessageCircle />}
            lead={
              <span className="truncate">
                aguarda resposta · {th.channel} · {rel(th.lastMessageAt)}
              </span>
            }
            aside={
              <Button asChild variant="outline" size="sm">
                <Link to={`/inbox/${th.id}`}>responder</Link>
              </Button>
            }
          >
            <Link to={`/inbox/${th.id}`} className="min-w-0 text-sm hover:underline">
              <span className="font-medium">{who(th.leadName, th.businessName)}</span>
              {th.lastBody && (
                <span className="line-clamp-1 text-muted-foreground">“{th.lastBody}”</span>
              )}
            </Link>
          </Row>
        );
      }
    }
  };

  return (
    <Panel
      flush
      title="precisa de você"
      aside={items.length ? `${items.length}` : undefined}
      actions={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {counts.late > 0 && (
            <Link to="/?t=tarefas" className="text-destructive-foreground hover:underline">
              <AlarmClock className="mr-0.5 inline size-3.5 align-[-3px]" />
              {counts.late} atrasada{counts.late > 1 ? 's' : ''}
            </Link>
          )}
          {counts.drafts > 0 && (
            <Link to="/inbox?f=rascunhos" className="hover:text-foreground hover:underline">
              {counts.drafts} rascunho{counts.drafts > 1 ? 's' : ''}
            </Link>
          )}
        </div>
      }
    >
      {failed ? (
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      ) : pending && !items.length ? (
        <LoadingRows rows={5} className="p-3" />
      ) : !items.length ? (
        <EmptyState
          icon={CheckCircle2}
          title="nada pendente"
          hint="sem tarefas atrasadas, rascunhos ou conversas esperando resposta"
        />
      ) : (
        <>
          <ul className="divide-y">{items.slice(0, limit).map(render)}</ul>
          {items.length > limit && (
            <div className="flex gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
              + {items.length - limit}
              <Link to="/?t=tarefas" className="hover:text-foreground hover:underline">
                tarefas →
              </Link>
              <Link to="/inbox" className="hover:text-foreground hover:underline">
                inbox →
              </Link>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
