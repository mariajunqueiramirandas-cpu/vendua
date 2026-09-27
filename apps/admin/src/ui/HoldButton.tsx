import { useRef, useState, type ReactNode } from 'react';
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
  const [p, setP] = useState(0);
  const raf = useRef<number>();
  const start = useRef(0);
  const done = useRef(false);
  const begin = () => {
    if (disabled) return;
    done.current = false;
    start.current = performance.now();
    const step = (t: number) => {
      const v = Math.min(1, (t - start.current) / ms);
      setP(v);
      if (v >= 1) {
        done.current = true;
        haptic.commit();
        onConfirm();
        setP(0);
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };
  const end = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (!done.current) setP(0);
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
        'relative isolate h-14 w-full select-none overflow-hidden rounded-lg t-label ring-1 transition-transform active:scale-[0.99] disabled:opacity-45',
        tone === 'danger'
          ? 'text-danger ring-danger/40 bg-danger-soft'
          : 'text-ink ring-line-strong bg-sunken',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 -z-10',
          tone === 'danger' ? 'bg-danger/20' : 'bg-spark',
        )}
        style={{ width: `${p * 100}%` }}
      />
      {children}
      <span className="sr-only"> — mantenha pressionado para confirmar</span>
    </button>
  );
}
