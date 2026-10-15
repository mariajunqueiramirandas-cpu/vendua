import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { cn } from './cn.ts';

/**
 * One question per screen: a big title, one plain sentence, the answer, and one obvious
 * button that rides above the keyboard on phones.
 */
export function StepFrame({
  title,
  hint,
  children,
  onSubmit,
  label = 'Continuar',
  disabled,
  busy,
  back,
  aside,
  eyebrow,
  focusTitle = true,
  solidBar,
  hidePrimary,
}: {
  title: ReactNode;
  /** a small line above the title: which part of a longer flow this is */
  eyebrow?: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  onSubmit: () => void;
  label?: ReactNode;
  disabled?: boolean | undefined;
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
}) {
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) head.current?.focus({ preventScroll: true });
    // on arrival only
  }, []);
  return (
    <form
      className="animate-fade-up space-y-6"
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
          className="t-title-1 outline-none focus-visible:shadow-none md:text-[2rem] md:leading-[2.5rem]"
        >
          {title}
        </h1>
        {hint ? <p className="t-body-lg mt-2 text-muted">{hint}</p> : null}
      </div>
      {children}
      {hidePrimary && !back && !aside ? null : (
        <div
          data-kb-reveal
          className={cn(
            'sticky bottom-0 z-20 -mx-4 flex flex-col-reverse gap-2 border-t border-line bg-bg/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm sm:flex-row sm:items-center sm:gap-3 md:-mx-8 md:px-8 kb:static kb:border-0 kb:bg-transparent kb:pb-2 kb:backdrop-blur-none',
            !solidBar &&
              'lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:backdrop-blur-none',
          )}
        >
          {/* phones: the way back and the way around share one quiet row under the main button */}
          {back || aside ? (
            <div
              className={cn(
                'flex items-center gap-2 sm:flex-1 sm:justify-end sm:gap-3',
                back ? 'justify-between' : 'justify-center',
              )}
            >
              {back ? (
                <Button
                  variant="ghost"
                  icon={<ArrowLeft />}
                  onClick={back}
                  className="-ml-3 sm:mr-auto"
                >
                  voltar
                </Button>
              ) : null}
              {aside}
            </div>
          ) : null}
          {hidePrimary ? null : (
            <Button type="submit" size="lg" loading={!!busy} disabled={disabled}>
              {label} <ArrowRight />
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
