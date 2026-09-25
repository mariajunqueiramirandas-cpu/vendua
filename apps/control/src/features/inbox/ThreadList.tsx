import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  CheckCheck,
  Inbox as InboxIcon,
  MessageSquareReply,
  Plus,
  Search,
} from 'lucide-react';
import type { Draft, ThreadItem } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { rel } from '@/lib/format.ts';
import { useDebounced } from '@/lib/hooks.ts';
import { Avatar, EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Segmented, Tooltip } from '@/components/ui/controls.tsx';
import { Input, Select } from '@/components/ui/input.tsx';
import { CH_ICON, CH_LABEL, CHANNELS } from './channel.ts';
import { DraftActions } from './DraftActions.tsx';
import { useInboxFilters, type InboxFilter } from './filters.ts';
import { useApprovals, useThreads } from './queries.ts';

/** Threads + drafts for the current URL filters, plus the per-view counts. */
export function useInboxList() {
  const { f, ch, q } = useInboxFilters();
  const dq = useDebounced(q.trim(), 250);
  const threads = useThreads(ch, dq);
  const approvals = useApprovals();

  const drafts = useMemo(() => {
    const needle = dq.toLowerCase();
    return (approvals.data?.drafts ?? []).filter(
      (d) =>
        (!ch || d.channel === ch) &&
        (!needle ||
          [d.leadName, d.businessName, d.body, d.subject].some((s) =>
            s?.toLowerCase().includes(needle),
          )),
    );
  }, [approvals.data, ch, dq]);
  const all = threads.data?.threads ?? [];
  const unanswered = useMemo(() => all.filter((t) => t.needsReply), [all]);

  const shown = f === 'rascunhos' ? drafts.length : (f === 'todas' ? all : unanswered).length;
  return {
    f,
    threads: f === 'nao-respondidas' ? unanswered : all,
    drafts,
    counts: { unanswered: unanswered.length, drafts: drafts.length },
    shown,
    query: f === 'rascunhos' ? approvals : threads,
  };
}

export function InboxFilters({
  counts,
  onNew,
  className,
}: {
  counts: { unanswered: number; drafts: number };
  onNew: () => void;
  className?: string | undefined;
}) {
  const { f, ch, q, set } = useInboxFilters();
  const n = (v: number) =>
    v ? <span className="text-[10px] text-muted-foreground tnum">{v}</span> : null;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center gap-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="buscar…"
            aria-label="buscar conversas"
            className="pl-8"
          />
        </div>
        <Select
          value={ch}
          onChange={(e) => set({ ch: e.target.value })}
          aria-label="canal"
          className="w-28 shrink-0"
        >
          <option value="">todos</option>
          {CHANNELS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <Tooltip content="nova conversa com um lead">
          <Button size="icon" variant="outline" onClick={onNew} aria-label="nova conversa">
            <Plus />
          </Button>
        </Tooltip>
      </div>
      <Segmented<InboxFilter>
        size="sm"
        value={f}
        onChange={(v) => set({ f: v })}
        className="w-full [&>button]:flex-1 [&>button]:justify-center"
        options={[
          ['todas', 'todas'],
          ['nao-respondidas', <>não respondidas {n(counts.unanswered)}</>],
          ['rascunhos', <>rascunhos {n(counts.drafts)}</>],
        ]}
      />
    </div>
  );
}

export function ThreadList({
  list,
  activeId,
  className,
}: {
  list: ReturnType<typeof useInboxList>;
  activeId?: string | undefined;
  className?: string | undefined;
}) {
  const { qs } = useInboxFilters();
  const { f, query } = list;

  if (query.isPending) return <LoadingRows className={cn('p-3', className)} />;
  if (query.isError)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} className={className} />
    );

  if (f === 'rascunhos') {
    if (!list.drafts.length)
      return (
        <EmptyState
          icon={CheckCheck}
          title="fila limpa"
          hint="rascunhos do agente aparecem aqui para revisão"
          className={className}
        />
      );
    return (
      <ul className={cn('divide-y', className)}>
        {list.drafts.map((d) => (
          <DraftRow
            key={d.id}
            d={d}
            active={d.threadId === activeId}
            to={`/inbox/${d.threadId}${qs}`}
          />
        ))}
      </ul>
    );
  }

  if (!list.threads.length)
    return f === 'nao-respondidas' ? (
      <EmptyState icon={MessageSquareReply} title="nada esperando resposta" className={className} />
    ) : (
      <EmptyState
        icon={InboxIcon}
        title="inbox vazia"
        hint="conversas chegam via whatsapp/email, pelo botão + acima, ou quando o agente inicia contato"
        className={className}
      />
    );

  return (
    <ul className={cn('divide-y', className)}>
      {list.threads.map((t) => (
        <ThreadRow key={t.id} t={t} active={t.id === activeId} to={`/inbox/${t.id}${qs}`} />
      ))}
    </ul>
  );
}

function ThreadRow({ t, active, to }: { t: ThreadItem; active: boolean; to: string }) {
  const Icon = CH_ICON[t.channel] ?? InboxIcon;
  return (
    <li>
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'relative flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-hover active:bg-hover',
          active &&
            'bg-hover before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
        )}
      >
        <Avatar name={t.leadName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5">
            <span
              className={cn('min-w-0 truncate', t.needsReply ? 'font-semibold' : 'font-medium')}
            >
              {t.leadName}
            </span>
            <Icon
              className="size-3 shrink-0 text-muted-foreground"
              aria-label={CH_LABEL[t.channel]}
            />
            {t.agentEnabled && (
              <Bot className="size-3 shrink-0 text-muted-foreground" aria-label="agente ativo" />
            )}
            <time className="ml-auto shrink-0 text-[11px] text-muted-foreground tnum">
              {rel(t.lastMessageAt)}
            </time>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-xs',
                t.needsReply ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {t.lastDirection === 'out' ? 'você: ' : ''}
              {t.lastBody ?? 'sem mensagens'}
            </span>
            {t.pendingDrafts > 0 && <Badge variant="warn">{t.pendingDrafts} rasc.</Badge>}
            {t.needsReply && (
              <span className="size-2 shrink-0 rounded-full bg-warning" aria-label="responder" />
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

function DraftRow({ d, active, to }: { d: Draft; active: boolean; to: string }) {
  const Icon = CH_ICON[d.channel] ?? InboxIcon;
  return (
    <li
      className={cn(
        'relative flex flex-col gap-2 px-3 py-2.5',
        active &&
          'bg-hover before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary',
      )}
    >
      <Link to={to} className="group flex min-w-0 items-center gap-2">
        <Avatar name={d.leadName} size="sm" />
        <span className="min-w-0 truncate font-medium group-hover:underline">{d.leadName}</span>
        <Icon className="size-3 shrink-0 text-muted-foreground" aria-label={CH_LABEL[d.channel]} />
        {d.author === 'agent' ? (
          <Badge variant="agent-soft">
            <Bot /> agente
          </Badge>
        ) : (
          <Badge>você</Badge>
        )}
        <time className="ml-auto shrink-0 text-[11px] text-muted-foreground tnum">
          {rel(d.createdAt)}
        </time>
      </Link>
      <DraftActions draft={d} body={d.body}>
        <Link
          to={to}
          className="block rounded-md border border-warning/60 bg-card px-2.5 py-1.5 text-[13px] leading-snug"
        >
          {d.subject && (
            <span className="mb-0.5 block truncate text-[11px] font-medium">{d.subject}</span>
          )}
          <span className="line-clamp-3 whitespace-pre-line">{d.body}</span>
        </Link>
      </DraftActions>
    </li>
  );
}
