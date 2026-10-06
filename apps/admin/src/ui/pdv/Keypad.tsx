import { Backspace } from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { money } from '../../lib/format.ts';
import { haptic } from '../../lib/haptics.ts';
import { cn } from '../cn.ts';

const MAX = 99_999_99;

/**
 * A cash keypad: digits fill the amount from the cents up, like a card machine ("5 0 0 0" is
 * R$ 50,00). With `keys`, a desktop keyboard types into it too (not while a field has focus).
 */
export function Keypad({
  cents,
  onChange,
  label,
  hint,
  keys,
  className,
  children,
}: {
  cents: number;
  onChange: (cents: number) => void;
  label: string;
  hint?: ReactNode;
  keys?: boolean;
  className?: string;
  /** quick amounts, under the display */
  children?: ReactNode;
}) {
  const ref = useRef({ cents, onChange });
  ref.current = { cents, onChange };
  const press = (k: string) => {
    const v = ref.current.cents;
    const next = k === 'back' ? Math.floor(v / 10) : k === '00' ? v * 100 : v * 10 + Number(k);
    haptic.tick();
    ref.current.onChange(Math.min(MAX, next));
  };
  useEffect(() => {
    if (!keys) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete') press('back');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [keys]);

  return (
    <div className={cn('rounded-lg bg-sunken p-3', className)}>
      <div className="px-2 pb-2 pt-1">
        <p className="t-caption text-muted">{label}</p>
        <output
          aria-live="polite"
          className="tnum block font-display text-[2.5rem] font-semibold leading-tight tracking-tight"
        >
          {money(cents)}
        </output>
        {hint ? <div className="t-caption mt-0.5">{hint}</div> : null}
      </div>
      {children ? <div className="mb-3 flex flex-wrap gap-2 px-1">{children}</div> : null}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={`teclado: ${label}`}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="press tnum h-14 rounded-md bg-surface font-display text-2xl font-semibold depth-1 hover:bg-hover"
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          aria-label="apagar"
          onClick={() => press('back')}
          className="press grid h-14 place-items-center rounded-md bg-surface depth-1 hover:bg-hover"
        >
          <Backspace className="size-7" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A quick amount above the keypad ("R$ 50", "exato"). */
export function QuickAmount({
  on,
  onClick,
  children,
}: {
  on?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => {
        haptic.tick();
        onClick();
      }}
      className={cn(
        'press t-label tnum min-h-11 rounded-full px-4 ring-1',
        on
          ? 'bg-primary text-on-primary ring-primary'
          : 'bg-surface text-ink ring-line-strong hover:bg-hover',
      )}
    >
      {children}
    </button>
  );
}
