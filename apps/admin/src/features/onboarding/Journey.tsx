import { Check } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../../ui/cn.ts';

// Signup and the onboarding are one journey in three parts, and both screens wear the same
// header: what's done, where the merchant is, what's left.

export type Phase = 'conta' | 'loja' | 'abrir';

const PHASES: { id: Phase; label: string }[] = [
  { id: 'conta', label: 'Cadastro' },
  { id: 'loja', label: 'Sua loja' },
  { id: 'abrir', label: 'No ar' },
];

export function JourneyBar({
  phase,
  progress,
  status,
  exit,
}: {
  phase: Phase;
  /** 0..1 inside the current part */
  progress: number;
  /** "3 de 5", "pronto!" */
  status: string;
  exit?: ReactNode;
}) {
  const at = PHASES.findIndex((p) => p.id === phase);
  const fill = Math.min(1, Math.max(0, progress));
  const overall = Math.round(((at + fill) / PHASES.length) * 100);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-sm kb:static">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 md:px-8">
        <p className="font-display text-lg font-semibold">venduá</p>
        <div
          className="flex min-w-0 flex-1 items-center justify-center"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={overall}
          aria-valuetext={`${PHASES[at]!.label}: ${status}`}
          aria-label="andamento"
        >
          <ol className="grid w-full max-w-lg grid-cols-3 gap-1.5">
            {PHASES.map((p, i) => {
              const done = i < at || (i === at && fill >= 1);
              const now = i === at;
              return (
                <li key={p.id} className="min-w-0">
                  <span className="block h-2 overflow-hidden rounded-full bg-line-strong">
                    <span
                      className="block h-full rounded-full bg-[var(--chart)] transition-[width] duration-(--duration-smooth) ease-(--ease-soft)"
                      style={{ width: `${i < at ? 100 : now ? Math.max(fill, 0.06) * 100 : 0}%` }}
                    />
                  </span>
                  <span
                    className={cn(
                      't-caption mt-1 hidden items-center gap-1 truncate sm:flex',
                      now ? 'font-semibold text-ink' : 'text-muted',
                    )}
                  >
                    {done ? (
                      <Check weight="bold" className="size-3.5 shrink-0 text-success" />
                    ) : null}
                    <span className="truncate">{p.label}</span>
                    {now && !done ? (
                      <span className="tnum font-normal text-muted">· {status}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
        {exit ?? <span className="w-11" aria-hidden />}
      </div>
    </header>
  );
}
