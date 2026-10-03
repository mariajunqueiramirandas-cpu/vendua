import { ArrowUUpLeft, HandPalm, PaperPlaneRight } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { haptic } from '../../lib/haptics.ts';
import { Button, IconButton } from '../Button.tsx';
import { cn } from '../cn.ts';
import { SELLER_EDGE } from './tones.ts';

/**
 * Who answers this conversation, always visible under it (sales-agent-ux §1.3). The agent's
 * floor: "O Duá está atendendo", "assumir" and the phone hint. The owner's: "Você está
 * atendendo", "devolver ao Duá", his suggested replies (a tap puts one in the composer), the
 * composer, and when he comes back on his own. Taking over is one tap and a light haptic.
 */
export function Floor({
  variant,
  title,
  hint,
  onTake,
  onRelease,
  busy,
  suggestions = [],
  onSend,
  sending,
  silenceMin,
  keys,
  className,
}: {
  variant: 'agent' | 'owner';
  /** replaces the first line ("O Duá está em ensaio") */
  title?: ReactNode | undefined;
  /** replaces the hint under it */
  hint?: ReactNode | undefined;
  onTake?: (() => void) | undefined;
  onRelease?: (() => void) | undefined;
  /** take/release in flight */
  busy?: boolean | undefined;
  suggestions?: string[] | undefined;
  /** the owner's reply; resolve to clear the composer */
  onSend?: ((text: string) => unknown) | undefined;
  sending?: boolean | undefined;
  /** "O Duá volta se você ficar 30 min sem responder" (the store's setting) */
  silenceMin?: number | undefined;
  /** desktop: show the keyboard shortcuts (A assumir · D devolver · J/K) */
  keys?: boolean | undefined;
  className?: string | undefined;
}) {
  const [text, setText] = useState('');
  const send = async () => {
    const t = text.trim();
    if (!t || !onSend || sending) return;
    await onSend(t);
    setText('');
  };
  return (
    <section
      aria-label="quem está atendendo"
      className={cn('glass flex flex-col gap-2.5 border-t border-line px-3.5 pb-4 pt-3', className)}
    >
      {variant === 'agent' ? (
        <>
          <div className="flex items-center gap-2.5">
            <p className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
              <span
                aria-hidden
                className={cn('size-2 shrink-0 rounded-full bg-ink', SELLER_EDGE)}
              />
              <span className="min-w-0">{title ?? 'O Duá está atendendo'}</span>
            </p>
            {onTake ? (
              <Button
                variant="secondary"
                icon={<HandPalm weight="bold" />}
                loading={!!busy}
                onClick={() => {
                  haptic.tick();
                  onTake();
                }}
              >
                assumir
              </Button>
            ) : null}
          </div>
          <p className="t-caption text-muted">
            {hint ?? 'Ou responda pelo seu celular: ele pausa sozinho nesta conversa.'}
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2.5">
            <p className="flex min-w-0 flex-1 items-center gap-2 font-semibold">
              <HandPalm weight="bold" className="size-5 shrink-0" aria-hidden />
              <span className="min-w-0">{title ?? 'Você está atendendo'}</span>
            </p>
            {onRelease ? (
              <Button
                variant="ghost"
                icon={<ArrowUUpLeft weight="bold" />}
                loading={!!busy}
                onClick={() => {
                  haptic.tick();
                  onRelease();
                }}
                className="-mr-2"
              >
                devolver ao Duá
              </Button>
            ) : null}
          </div>
          {suggestions.length ? (
            <div
              className="scroll-row -mx-3.5 flex gap-1.5 px-3.5"
              aria-label="sugestões do Duá"
              role="group"
            >
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setText(s)}
                  className={cn(
                    'press relative h-10 max-w-[18rem] shrink-0 truncate rounded-full bg-spark-soft px-3 text-[0.875rem] font-medium text-ink',
                    "after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']",
                    SELLER_EDGE,
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          {onSend ? (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="sr-only" htmlFor="floor-reply">
                sua resposta
              </label>
              <textarea
                id="floor-reply"
                rows={1}
                value={text}
                maxLength={4000}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Escreva sua resposta…"
                className="t-body-lg field-sizing-content max-h-40 min-h-12 min-w-0 flex-1 resize-none rounded-md bg-surface px-3.5 py-2.5 text-ink ring-1 ring-inset ring-line-strong placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <IconButton
                type="submit"
                label="enviar"
                variant="primary"
                disabled={!text.trim()}
                aria-busy={sending || undefined}
              >
                <PaperPlaneRight weight="fill" />
              </IconButton>
            </form>
          ) : null}
          {silenceMin ? (
            <p className="t-caption text-muted">
              O Duá volta se você ficar {silenceMin} min sem responder.
            </p>
          ) : null}
        </>
      )}
      {keys ? (
        <p className="t-caption hidden items-center gap-3 text-muted lg:flex" aria-hidden>
          <Kbd k="A" /> assumir <Kbd k="D" /> devolver <Kbd k="J" />/<Kbd k="K" /> próxima
        </p>
      ) : null}
    </section>
  );
}

function Kbd({ k }: { k: string }) {
  return (
    <kbd className="grid h-6 min-w-6 place-items-center rounded-sm bg-surface px-1 font-sans text-[0.75rem] font-bold text-ink ring-1 ring-inset ring-line-strong">
      {k}
    </kbd>
  );
}
