import { useRef, type ReactNode } from 'react';
import { haptic } from '../lib/haptics.ts';
import { cn } from './cn.ts';

/**
 * Hold-to-confirm for what can't be undone (refunds, cancelling a paid order,
 * removing someone): a plain "OK" is never the confirmation (§2.2.1).
 * Keyboard: hold Space/Enter the same way.
 */
export function HoldButton({
  onConfirm,
  children,
  ms = 1200,
  tone = 'danger',
  disabled,
  className,
}: {
  onConfirm: () => void;
  children: ReactNode;
  ms?: number;
  tone?: 'danger' | 'primary';
  disabled?: boolean;
  className?: string;
}) {
  const fill = useRef<HTMLSpanElement>(null);
  const run = useRef<Animation | null>(null);
  const begin = () => {
    if (disabled || run.current) return;
    const el = fill.current!;
    // resume from wherever a let-go left the bar
    const from = new DOMMatrixReadOnly(getComputedStyle(el).transform).a;
    el.getAnimations().forEach((a) => a.cancel());
    const a = el.animate([{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }], {
      duration: ms * (1 - from),
      easing: 'linear',
    });
    run.current = a;
    a.onfinish = () => {
      run.current = null;
      haptic.commit();
      onConfirm();
    };
  };
  const end = () => {
    const a = run.current;
    if (!a) return;
    run.current = null;
    const el = fill.current!;
    const at = new DOMMatrixReadOnly(getComputedStyle(el).transform).a;
    a.cancel();
    el.animate([{ transform: `scaleX(${at})` }, { transform: 'scaleX(0)' }], {
      duration: 180,
      easing: 'cubic-bezier(.2,.8,.2,1)',
    });
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          begin();
        }
      }}
      onKeyUp={end}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'press relative isolate h-14 w-full select-none overflow-hidden rounded-lg t-label ring-1 [-webkit-touch-callout:none] disabled:opacity-45',
        tone === 'danger'
          ? 'text-danger ring-danger/40 bg-danger-soft'
          : 'text-ink ring-line-strong bg-sunken',
        className,
      )}
    >
      <span
        aria-hidden
        ref={fill}
        className={cn(
          'absolute inset-0 -z-10 origin-left',
          tone === 'danger' ? 'bg-danger/20' : 'bg-spark',
        )}
        style={{ transform: 'scaleX(0)' }}
      />
      {children}
      <span className="sr-only"> — mantenha pressionado para confirmar</span>
    </button>
  );
}
