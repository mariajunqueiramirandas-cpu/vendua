import { ArrowLeft, ArrowRight, X } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SummaryCardData, ThreadMessage } from '../../lib/api.ts';
import { clock } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { ActionReceipt, Bubble, CoreReceipt } from '../../ui/vendedor/index.ts';

/**
 * One question per screen, like the store's journey (StepFrame), but not a form: some screens
 * hold their own (the interview's answer, the test chat's composer). The main button rides at
 * the bottom on phones; "voltar" and the quiet way around share a row under it.
 */
export function TrainFrame({
  eyebrow,
  title,
  hint,
  children,
  next,
  nextLabel = 'continuar',
  busy,
  disabled,
  back,
  aside,
  footer = true,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  next?: (() => void) | undefined;
  nextLabel?: ReactNode;
  busy?: boolean | undefined;
  disabled?: boolean | undefined;
  back?: (() => void) | null | undefined;
  /** "pular", "pedir de novo" */
  aside?: ReactNode;
  footer?: boolean;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => head.current?.focus({ preventScroll: true }), []);
  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <p className="t-label tnum mb-2 text-muted">{eyebrow}</p>
        <h1
          ref={head}
          tabIndex={-1}
          className="t-title-1 outline-none focus-visible:shadow-none md:text-[2rem] md:leading-[2.5rem]"
        >
          {title}
        </h1>
        {hint ? <p className="t-body-lg mt-2 text-muted">{hint}</p> : null}
      </div>
      {children}
      {footer ? (
        <div
          data-kb-reveal
          className="sticky bottom-0 z-20 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-bg/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm sm:flex-row sm:items-center sm:gap-3 md:-mx-8 md:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:backdrop-blur-none kb:static kb:border-0 kb:bg-transparent kb:pb-2 kb:backdrop-blur-none"
        >
          {back || aside ? (
            <div className="flex items-center gap-2 sm:flex-1 sm:gap-3 [&>*]:flex-1 sm:[&>*]:flex-none">
              {back ? (
                <Button variant="ghost" size="lg" icon={<ArrowLeft />} onClick={back}>
                  voltar
                </Button>
              ) : null}
              <div className="hidden sm:block sm:!flex-1" />
              {aside}
            </div>
          ) : null}
          {next ? (
            <Button size="lg" loading={!!busy} disabled={disabled} onClick={next}>
              {nextLabel} <ArrowRight />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "continuar depois" (or "ir ao painel" at the end): back to Duá's home */
export function Exit({ done }: { done?: boolean }) {
  return (
    <Link
      to="/vendedor"
      className="t-label inline-flex min-h-12 shrink-0 items-center gap-1 rounded-md px-3 text-muted hover:bg-hover"
      aria-label={done ? 'ir ao painel do Duá' : 'sair e continuar depois'}
    >
      <X className="size-5" aria-hidden />
      <span className="hidden sm:inline">{done ? 'ir ao painel' : 'continuar depois'}</span>
    </Link>
  );
}

/** Three dots where his words will be: still under reduced motion (the dots just don't pulse). */
export function Dots() {
  return (
    <span role="status" className="inline-flex h-6 items-center gap-1.5">
      <span className="sr-only">Duá está escrevendo</span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden
          className="animate-pulse-dot size-2 rounded-full bg-ink opacity-60"
          style={{ animationDelay: `${i * 180}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * A test conversation (Peça para mim, the interview) as the owner sees it: they are the
 * customer on the right in forest, Duá answers on the left; Core's receipt sits in his column.
 */
export function TestLines({
  messages,
  owner = 'você, como cliente',
}: {
  messages: ThreadMessage[];
  owner?: string;
}) {
  return (
    <>
      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const text = m.body ?? m.transcript ?? '';
        const time = clock(m.at);
        if (m.card === 'summary' && m.data)
          return (
            <CoreReceipt
              key={m.id}
              data={m.data as SummaryCardData}
              title="Pedido de teste"
              align="start"
            />
          );
        if (m.author === 'core')
          return text ? <ActionReceipt key={m.id}>{text}</ActionReceipt> : null;
        if (!text) return null;
        if (m.author === 'agent')
          return (
            <Bubble
              key={m.id}
              voice="seller"
              align="start"
              time={time}
              signed={prev?.author !== 'agent'}
            >
              {text}
            </Bubble>
          );
        return (
          <Bubble key={m.id} voice="you" author={owner} align="end" time={time}>
            {text}
          </Bubble>
        );
      })}
    </>
  );
}
