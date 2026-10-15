import { ArrowLeft, ArrowRight, Info } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { haptic } from '../lib/haptics.ts';
import { BOUNCY, reducedMotion, springEasing } from '../lib/spring.ts';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';
import { TEXT_FIELD } from './keyboard.ts';

/**
 * One question per screen: a big title, one plain sentence, the answer, and one obvious
 * button that rides above the keyboard on phones.
 */
export function StepFrame({
  title,
  hint,
  lead,
  children,
  onSubmit,
  label = 'Continuar',
  disabled,
  why,
  busy,
  back,
  aside,
  eyebrow,
  focusTitle = true,
  solidBar,
  hidePrimary,
  enter = true,
  big,
}: {
  title: ReactNode;
  /** a small line above the title: which part of a longer flow this is */
  eyebrow?: ReactNode;
  hint?: ReactNode;
  /** under the title in the hint's place, as a block (someone speaking the hint, say) */
  lead?: ReactNode;
  children?: ReactNode;
  onSubmit: () => void;
  label?: ReactNode;
  disabled?: boolean | undefined;
  /** what's still missing while `disabled`: the button stays tappable and says it, instead of
   *  greying out without a word */
  why?: ReactNode;
  busy?: boolean | undefined;
  back?: (() => void) | null | undefined;
  /** a secondary way out beside the primary button */
  aside?: ReactNode;
  /** off when a field should take the focus instead (the code boxes, for autofill) */
  focusTitle?: boolean;
  /** a long answer (cards side by side): the bar keeps its backdrop on a desktop too */
  solidBar?: boolean;
  /** the answer itself moves on (one tap on a tile): no main button, only the way back */
  hidePrimary?: boolean;
  /** off when the screen around it already animates the change of step */
  enter?: boolean;
  /** the question is the whole screen (the onboarding): a larger title */
  big?: boolean;
}) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) head.current?.focus({ preventScroll: true });
    // on arrival only
  }, []);
  return (
    <form
      // a big question fills the screen, so its bar can sit at the bottom (ActionBar `pinned`)
      className={cn('space-y-6', enter && 'animate-fade-up', big && 'flex flex-1 flex-col')}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!disabled && !busy) onSubmit();
      }}
    >
      <div>
        {eyebrow ? <p className="t-label tnum mb-2 text-muted">{eyebrow}</p> : null}
        <h1
          ref={head}
          tabIndex={-1}
          className={cn(
            't-title-1 text-balance outline-none focus-visible:shadow-none',
            big
              ? 'text-[1.875rem] leading-[2.25rem] tracking-[-0.03em] md:text-[2.5rem] md:leading-[2.875rem] xl:text-[2.75rem] xl:leading-[3.125rem]'
              : 'md:text-[2rem] md:leading-[2.5rem]',
          )}
        >
          {title}
        </h1>
        {hint ? (
          <p
            className={cn('t-body-lg text-pretty text-muted', big ? 'mt-3 max-w-[34rem]' : 'mt-2')}
          >
            {hint}
          </p>
        ) : null}
        {lead ? <div className={big ? 'mt-4' : 'mt-3'}>{lead}</div> : null}
      </div>
      {children}
      {hidePrimary && !back && !aside ? null : (
        <ActionBar
          label={label}
          disabled={disabled}
          why={why}
          busy={busy}
          back={back}
          aside={aside}
          solidBar={solidBar}
          hidePrimary={hidePrimary}
          pinned={big}
        />
      )}
    </form>
  );
}

/**
 * The bottom of a step: one main button that submits its form, riding above the keyboard on
 * phones, with "voltar" and a way around in a quiet row. A button that isn't ready yet stays
 * tappable and says what's missing (on Enter too), with a little shake; once the answer is
 * there it lights up with a small bounce.
 *
 * `pinned` (the onboarding): below 1200 px the bar holds the bottom of the screen on every
 * question (its form is a flex column, so `mt-auto` takes the slack), its backdrop spans the
 * screen's width while the buttons keep the column's edges. "Voltar" is a square arrow on the
 * main button's left.
 */
export function ActionBar({
  label = 'Continuar',
  disabled,
  why,
  busy,
  back,
  aside,
  solidBar,
  hidePrimary,
  pinned,
}: {
  label?: ReactNode;
  disabled?: boolean | undefined;
  why?: ReactNode;
  busy?: boolean | undefined;
  back?: (() => void) | null | undefined;
  aside?: ReactNode;
  solidBar?: boolean | undefined;
  hidePrimary?: boolean | undefined;
  pinned?: boolean | undefined;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [told, setTold] = useState(0);
  // a question answered by typing: with a mouse and keyboard, Enter is the quicker way on
  const [typed, setTyped] = useState(false);
  const now = useRef({ disabled, why });
  now.current = { disabled, why };
  // the form decides whether to submit; the bar only listens, to say why it didn't
  useEffect(() => {
    const form = bar.current?.closest('form');
    if (!form) return;
    setTyped(!!form.querySelector(TEXT_FIELD));
    const onSubmit = () => {
      if (!now.current.disabled || !now.current.why) return;
      haptic.tick();
      setTold((n) => n + 1);
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);
  const was = useRef(disabled);
  useEffect(() => {
    if (was.current && !disabled && !reducedMotion())
      button.current?.animate({ scale: [0.94, 1] }, springEasing(BOUNCY, 2));
    was.current = disabled;
    if (!disabled) setTold(0);
  }, [disabled]);
  useEffect(() => {
    if (told && !reducedMotion())
      button.current?.animate(
        { translate: ['0', '-6px', '5px', '-3px', '0'] },
        { duration: 320, easing: 'ease-out' },
      );
  }, [told]);
  const waiting = !!disabled && !!why;
  const side = back || aside;
  const primary = hidePrimary ? null : (
    <Button
      ref={button}
      type="submit"
      size="lg"
      // not ready yet: a quiet button that can still say why (a plain disabled one without)
      variant={waiting ? 'quiet' : 'primary'}
      loading={!!busy}
      disabled={!!disabled && !why}
      aria-disabled={waiting || undefined}
      className={cn(
        pinned ? 'flex-1 md:flex-none md:min-w-52' : 'order-1 sm:order-2 sm:min-w-44',
        waiting && 'text-muted',
      )}
    >
      {label} <ArrowRight />
    </Button>
  );
  const whyLine =
    told && waiting ? (
      <p
        key={told}
        role="status"
        className={cn(
          'animate-fade-up t-body flex items-start gap-2 text-ink',
          !pinned && 'sm:justify-end',
        )}
      >
        <Info weight="fill" className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
        <span>{why}</span>
      </p>
    ) : null;
  if (pinned) {
    return (
      <div
        ref={bar}
        data-kb-reveal
        className={cn(
          'sticky bottom-0 z-20 mt-auto space-y-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3',
          'before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-screen before:-translate-x-1/2 before:border-t before:border-line before:bg-bg/95 before:backdrop-blur-sm',
          'kb:static kb:pb-2 kb:before:hidden lg:static lg:mt-0 lg:pb-0 lg:pt-2 lg:before:hidden',
        )}
      >
        {whyLine}
        {/* the way around sits above the main button on phones, so that button keeps the same
            spot on every question; from 768 px it ends the row, on the column's right edge */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-3">
          <div className="flex items-center gap-2 md:gap-3">
            {back ? (
              hidePrimary ? (
                // alone (a tap answers), "voltar" keeps its word, starting on the column's edge
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowLeft />}
                  onClick={back}
                  className="-ml-3.5"
                >
                  voltar
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  size="lg"
                  onClick={back}
                  aria-label="voltar"
                  className="w-14 shrink-0 px-0"
                >
                  <ArrowLeft />
                </Button>
              )
            ) : null}
            {primary}
            {primary && typed ? (
              <span className="t-caption hidden items-center gap-1.5 text-muted lg:pointer-fine:inline-flex">
                ou
                <kbd className="rounded-sm bg-sunken px-1.5 py-0.5 font-sans text-[0.75rem] font-semibold text-ink">
                  Enter ↵
                </kbd>
              </span>
            ) : null}
          </div>
          {aside ? <div className="order-first flex justify-end md:order-none">{aside}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <div
      ref={bar}
      data-kb-reveal
      className={cn(
        'sticky bottom-0 z-20 -mx-4 space-y-2 border-t border-line bg-bg/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm md:-mx-8 md:px-8 kb:static kb:border-0 kb:bg-transparent kb:pb-2 kb:backdrop-blur-none',
        !solidBar && 'lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:backdrop-blur-none',
      )}
    >
      {whyLine}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        {/* phones: the way back and the way around share one quiet row under the main
            button; from sm the row sits to its left, so the main button is always last */}
        {side ? (
          <div
            className={cn(
              'order-2 flex items-center gap-2 sm:order-1 sm:flex-1 sm:gap-3',
              back ? 'justify-between' : 'justify-center sm:justify-end',
            )}
          >
            {back ? (
              <Button variant="ghost" icon={<ArrowLeft />} onClick={back} className="-ml-3">
                voltar
              </Button>
            ) : null}
            {aside}
          </div>
        ) : null}
        {primary}
      </div>
    </div>
  );
}
