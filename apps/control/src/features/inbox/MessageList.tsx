import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { AlertTriangle, Bot, Check, CheckCheck, Clock } from 'lucide-react';
import type { Message, ThreadView } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { EmptyState } from '@/components/common.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { DraftActions } from './DraftActions.tsx';

const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'ontem';
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
};
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * The conversation's only scroller. Opens at the newest message and follows
 * new ones while the reader is at the bottom (also when the keyboard resizes it).
 */
export function MessageList({ view }: { view: ThreadView }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const msgs = view.messages;
  const last = msgs[msgs.length - 1];

  const toBottom = (smooth: boolean) => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  useLayoutEffect(() => {
    stick.current = true;
    toBottom(false);
  }, [view.thread.id]);

  useEffect(() => {
    if (stick.current || last?.author === 'staff') toBottom(true);
  }, [last?.id, last?.status, msgs.length, last?.author]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    const ro = new ResizeObserver(() => stick.current && toBottom(false));
    el.addEventListener('scroll', onScroll, { passive: true });
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex max-w-3xl flex-col gap-1.5 px-3 py-3 md:px-4">
        {!msgs.length && (
          <EmptyState
            title="nenhuma mensagem ainda"
            hint="escreva abaixo ou peça uma sugestão ao agente"
          />
        )}
        {msgs.map((m, i) => (
          <Fragment key={m.id}>
            {(i === 0 || dayKey(m.createdAt) !== dayKey(msgs[i - 1]!.createdAt)) && (
              <div className="my-2 flex items-center gap-3 text-[11px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                {dayLabel(m.createdAt)}
              </div>
            )}
            <Bubble m={m} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Message }) {
  const out = m.direction === 'out';
  const draft = m.status === 'draft';
  const bad = m.status === 'failed' || m.status === 'rejected';

  const meta = (
    <div
      className={cn(
        'mt-1 flex flex-wrap items-center justify-end gap-1.5 text-[11px]',
        out && !draft && !bad ? 'text-primary-foreground/70' : 'text-muted-foreground',
      )}
    >
      {m.author === 'agent' && (
        <Badge variant="agent" className="px-1.5">
          <Bot /> agente
        </Badge>
      )}
      {draft && <Badge variant="warn">rascunho</Badge>}
      {m.status === 'failed' && <Badge variant="bad">falhou</Badge>}
      {m.status === 'rejected' && <Badge>rejeitado</Badge>}
      {m.subject && out && <span className="min-w-0 truncate">{m.subject}</span>}
      <span className="tnum">{time(m.createdAt)}</span>
      {out && <StatusIcon status={m.status} />}
    </div>
  );
  const error = bad && m.error && (
    <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive-foreground">
      <AlertTriangle className="mt-px size-3 shrink-0" />
      {m.error}
    </p>
  );

  return (
    <div className={cn('flex', out ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] min-w-0 rounded-2xl px-3 py-2 text-sm leading-snug break-words md:max-w-[75%]',
          !out && 'rounded-bl-md border bg-card',
          out && !draft && !bad && 'rounded-br-md bg-primary text-primary-foreground',
          draft && 'w-full rounded-br-md border border-warning bg-card sm:w-auto sm:min-w-80',
          bad && 'rounded-br-md border border-dashed bg-muted text-muted-foreground',
        )}
      >
        {draft ? (
          <DraftActions
            draft={{ id: m.id, threadId: m.threadId, subject: m.subject }}
            body={m.body}
          >
            <div>
              <p className="whitespace-pre-line">{m.body}</p>
              {meta}
            </div>
          </DraftActions>
        ) : (
          <>
            <p className="whitespace-pre-line">{m.body}</p>
            {meta}
            {error}
          </>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  const Icon =
    status === 'delivered'
      ? CheckCheck
      : status === 'sent'
        ? Check
        : status === 'queued' || status === 'sending'
          ? Clock
          : null;
  if (!Icon) return null;
  const label = status === 'delivered' ? 'entregue' : status === 'sent' ? 'enviado' : 'na fila';
  return <Icon className="size-3" aria-label={label} />;
}
