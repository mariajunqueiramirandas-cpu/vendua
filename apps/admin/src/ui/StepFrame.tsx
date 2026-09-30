import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './Button.tsx';

/**
 * iOS Safari (and Android without resizes-content) overlays the keyboard instead of shrinking
 * the layout: expose the covered height as --kb and keep the focused field, plus the button
 * under it, in view. (Same approach as the onboarding wizard.)
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const reveal = () => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.matches('input, textarea, select'))
        el.scrollIntoView({ block: 'center' });
    };
    const update = (e?: Event) => {
      // pinch-zoom also shrinks the visual viewport; that is not a keyboard
      const covered =
        vv.scale > 1.01
          ? 0
          : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb', `${covered}px`);
      if (covered > 0 && e?.type === 'resize') reveal();
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    document.addEventListener('focusin', reveal);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      document.removeEventListener('focusin', reveal);
      root.style.removeProperty('--kb');
    };
  }, []);
}

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
  focusTitle = true,
}: {
  title: ReactNode;
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
      <div className="sticky bottom-[var(--kb,0px)] z-20 -mx-4 flex scroll-mb-24 flex-col-reverse gap-3 border-t border-line bg-bg/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm sm:flex-row sm:items-center md:-mx-8 md:px-8 lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:pb-0 lg:backdrop-blur-none">
        {back ? (
          <Button variant="ghost" size="lg" icon={<ArrowLeft />} onClick={back}>
            voltar
          </Button>
        ) : null}
        <div className="hidden flex-1 sm:block" />
        {aside}
        <Button type="submit" size="lg" loading={!!busy} disabled={disabled}>
          {label} <ArrowRight />
        </Button>
      </div>
    </form>
  );
}
