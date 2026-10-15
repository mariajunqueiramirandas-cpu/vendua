import { CheckCircle, Circle, Lock, type Icon } from '@phosphor-icons/react';
import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { haptic } from '../lib/haptics.ts';
import { cn } from './cn.ts';
import { toast } from './Toast.tsx';

export interface Choice<T extends string> {
  value: T;
  title: ReactNode;
  /** what picking it does, in one line */
  hint?: ReactNode;
  Icon?: Icon;
  /** why it can't be picked yet: shown on the card, and said again on a tap */
  locked?: string | null;
}

/**
 * One of a few ways to work (cobrar por área · pela distância), each saying what it does, so the
 * choice is made by reading, not by trying. Arrow keys move between them, like any radio group.
 */
export function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  options,
  columns = 1,
  readOnly,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Choice<T>[];
  /** side by side from tablets up */
  columns?: 1 | 2 | 3;
  /** shown, not changeable (a manager looking at the owner's choice) */
  readOnly?: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  const pick = (o: Choice<T>) => {
    if (readOnly) return;
    if (o.locked) return toast(o.locked);
    if (o.value === value) return;
    haptic.tick();
    onChange(o.value);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (!step || readOnly) return;
    e.preventDefault();
    const open = options.filter((o) => !o.locked);
    const at = open.findIndex((o) => o.value === value);
    const next = open[(at + step + open.length) % open.length];
    if (!next) return;
    pick(next);
    group.current?.querySelector<HTMLElement>(`[data-choice="${next.value}"]`)?.focus();
  };
  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label={label}
      aria-readonly={readOnly || undefined}
      onKeyDown={onKey}
      className={cn(
        'grid gap-3',
        columns === 2 && 'md:grid-cols-2',
        columns === 3 && 'md:grid-cols-3',
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={readOnly || !!o.locked || undefined}
            tabIndex={on ? 0 : -1}
            data-choice={o.value}
            onClick={() => pick(o)}
            className={cn(
              'press-row flex min-h-18 w-full items-start gap-3 rounded-md px-4 py-3.5 text-left transition-[background-color,box-shadow] duration-(--duration-quick)',
              on ? 'bg-spark-soft ring-2 ring-primary' : 'bg-surface ring-1 ring-line',
              !on && !readOnly && !o.locked && 'hover:bg-hover',
              (readOnly || o.locked) && !on && 'cursor-default',
            )}
          >
            {o.Icon ? (
              <o.Icon
                weight="duotone"
                className={cn('mt-0.5 size-6 shrink-0', o.locked ? 'text-faint' : 'text-ink')}
                aria-hidden
              />
            ) : null}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'flex items-center gap-1.5 font-semibold',
                  o.locked && !on && 'text-muted',
                )}
              >
                {o.title}
                {o.locked ? (
                  <Lock weight="fill" className="size-3.5 text-faint" aria-hidden />
                ) : null}
              </span>
              {o.hint ? <span className="t-caption mt-0.5 block text-muted">{o.hint}</span> : null}
              {o.locked && !on ? (
                <span className="t-caption mt-1 block text-muted">{o.locked}</span>
              ) : null}
            </span>
            {on ? (
              <CheckCircle
                weight="fill"
                className="mt-0.5 size-6 shrink-0 text-primary"
                aria-hidden
              />
            ) : (
              <Circle className="mt-0.5 size-6 shrink-0 text-faint" aria-hidden />
            )}
          </button>
        );
      })}
    </div>
  );
}
