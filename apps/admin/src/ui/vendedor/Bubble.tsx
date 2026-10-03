import { Checks, Check, Sparkle, WarningCircle, CheckCircle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '../cn.ts';
import { PersonaAvatar } from './PersonaAvatar.tsx';
import { IN, SELLER, YOU } from './tones.ts';

export type Voice = 'in' | 'seller' | 'you';

/** the delivery ticks under a sent bubble; 'failed' says it in words */
export type BubbleStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

const DRAFT =
  'bg-spark-soft text-ink border-2 border-dashed border-[color:color-mix(in_srgb,var(--spark)_60%,var(--ink-muted))] noite:border-[color:color-mix(in_srgb,var(--spark)_45%,transparent)]';

const STATUS_WORD: Record<BubbleStatus, string> = {
  queued: 'enviando',
  sent: 'enviada',
  delivered: 'entregue',
  read: 'lida',
  failed: 'não enviada',
};

/**
 * One message in a conversation, in one of three voices (sales-agent-ux §1): the shopper on
 * paper, Duá on spark-soft and signed "Duá · IA", the owner in forest. The
 * author is always in text (the signature, or a screen-reader name), never colour alone. A
 * draft is Ensaio's: dashed, "não enviado · ensaio".
 */
export function Bubble({
  voice,
  children,
  author,
  time,
  status,
  tag,
  draft,
  signed,
  align,
  className,
}: {
  voice: Voice;
  children: ReactNode;
  /** who wrote it, for screen readers ("Carla", "você"); the seller's is its signature */
  author?: string | undefined;
  /** "19:42" */
  time?: string | undefined;
  status?: BubbleStatus | undefined;
  /** an offer: "sugestão" */
  tag?: ReactNode | undefined;
  /** Ensaio: written, never sent */
  draft?: boolean | undefined;
  /** the seller's signature above the bubble (default on); off for a run of its bubbles */
  signed?: boolean | undefined;
  /** which side: the shopper's on the left by default, the store's voices on the right */
  align?: 'start' | 'end' | undefined;
  className?: string | undefined;
}) {
  const side = align ?? (voice === 'in' ? 'start' : 'end');
  const sign = voice === 'seller' && (signed ?? true);
  const who = voice === 'seller' ? 'Duá · IA' : (author ?? (voice === 'you' ? 'você' : 'cliente'));
  return (
    <div
      className={cn(
        'flex max-w-[84%] flex-col gap-1',
        side === 'end' ? 'items-end self-end' : 'items-start self-start',
        className,
      )}
    >
      {sign ? (
        <p className="t-caption mt-1.5 flex items-center gap-1.5 font-semibold text-muted">
          <PersonaAvatar size="xs" />
          {who}
        </p>
      ) : null}
      <div
        className={cn(
          'flex min-w-0 max-w-full flex-col gap-0.5 rounded-[18px] px-3 pb-1.5 pt-2',
          voice === 'in' && IN,
          voice === 'you' && YOU,
          // a draft trades the seller's solid edge for a dashed one
          voice === 'seller' && (draft ? DRAFT : SELLER),
          side === 'end' ? 'rounded-br-md' : 'rounded-bl-md',
        )}
      >
        {sign ? null : <span className="sr-only">{who}: </span>}
        {tag ? (
          <span className="t-caption mb-1 inline-flex items-center gap-1 self-start rounded-full bg-surface px-2 py-px font-semibold text-muted">
            <Sparkle weight="bold" className="size-3.5" aria-hidden />
            {tag}
          </span>
        ) : null}
        <div className="t-body-lg whitespace-pre-line [overflow-wrap:anywhere]">{children}</div>
        {time || status || draft ? (
          <p
            className={cn(
              'flex items-center justify-end gap-1 text-[0.75rem] font-medium leading-4',
              voice === 'you' ? 'opacity-80' : 'text-muted',
            )}
          >
            {draft ? <span className="font-semibold">não enviado · ensaio</span> : null}
            {draft && time ? <span aria-hidden>·</span> : null}
            {time ? <time>{time}</time> : null}
            {status && status !== 'failed' && !draft ? <Ticks status={status} /> : null}
          </p>
        ) : null}
      </div>
      {status === 'failed' ? (
        // under the bubble, on the page: red reads on paper, not on forest
        <p className="t-caption flex items-center gap-1 font-semibold text-danger">
          <WarningCircle weight="bold" className="size-4" aria-hidden />
          {STATUS_WORD.failed}
        </p>
      ) : null}
    </div>
  );
}

function Ticks({ status }: { status: BubbleStatus }) {
  const label = STATUS_WORD[status];
  const Icon = status === 'delivered' || status === 'read' ? Checks : Check;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex">
      <Icon weight="bold" className="size-3.5" aria-hidden />
    </span>
  );
}

/** "hoje", "ontem": where a day starts in a conversation */
export function DayMark({ children }: { children: ReactNode }) {
  return (
    <p className="my-1 self-center rounded-full bg-sunken px-2.5 py-1 text-[0.75rem] font-semibold leading-4 text-muted">
      {children}
    </p>
  );
}

/** "Pedido #1284 feito · Pix enviado · aguardando pagamento": links to the order when it can */
export function EventChip({ children, to }: { children: ReactNode; to?: string }) {
  const body = (
    <>
      <CheckCircle weight="bold" className="size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </>
  );
  const cls =
    't-caption my-1 inline-flex max-w-[94%] items-center gap-2 self-center rounded-md bg-success-soft px-3 py-2 text-left font-semibold text-success';
  return to ? (
    <Link to={to} className={cn(cls, 'press min-h-12 underline-offset-2 hover:underline')}>
      {body}
    </Link>
  ) : (
    <p className={cls}>{body}</p>
  );
}
