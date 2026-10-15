import { CaretDown, Check } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../../ui/cn.ts';

// Signup and the onboarding are one journey in three parts, and both screens wear the same
// header: what's done, where the merchant is, what's left. Inside "Sua loja" the bar splits into
// the onboarding's chapters, and on phones those chapters are all it shows.

export type Phase = 'conta' | 'loja' | 'abrir';

const PHASES: { id: Phase; label: string }[] = [
  { id: 'conta', label: 'Cadastro' },
  { id: 'loja', label: 'Sua loja' },
  { id: 'abrir', label: 'No ar' },
];

const Fill = ({ value, className }: { value: number; className?: string }) => (
  <span className={cn('block h-2 overflow-hidden rounded-full bg-line-strong', className)}>
    <span
      className="block h-full rounded-full bg-[var(--chart)] transition-[width] duration-(--duration-smooth) ease-(--ease-soft)"
      style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }}
    />
  </span>
);

export function JourneyBar({
  phase,
  progress,
  status,
  exit,
  parts,
  onStatus,
  wide,
}: {
  phase: Phase;
  /** 0..1 inside the current part */
  progress: number;
  /** "3 de 5", "pronto!", or where in the chapters the merchant is */
  status: string;
  exit?: ReactNode;
  /** the current part split into chapters, each one's own 0..1 */
  parts?: { label: string; fill: number }[] | undefined;
  /** the status opens the map of questions */
  onStatus?: (() => void) | undefined;
  /** the onboarding's three columns (map, question, preview) */
  wide?: boolean;
}) {
  const at = PHASES.findIndex((p) => p.id === phase);
  const fill = Math.min(1, Math.max(0, progress));
  const overall = Math.round(((at + fill) / PHASES.length) * 100);
  const split = !!parts?.length;
  const cols = split ? 'grid-cols-1 sm:grid-cols-[1fr_2.6fr_1fr]' : 'grid-cols-3';
  const label = onStatus ? (
    <button
      type="button"
      onClick={onStatus}
      // a small line, but a whole thumb to hit
      className="press relative inline-flex min-w-0 items-center gap-1 rounded-full font-semibold text-ink after:absolute after:-inset-x-2 after:-inset-y-3 hover:underline hover:underline-offset-2"
      aria-label={`${status}. Ver todas as perguntas`}
    >
      <span className="truncate">{status}</span>
      <CaretDown weight="bold" className="size-3.5 shrink-0" aria-hidden />
    </button>
  ) : (
    <span className="tnum truncate font-normal text-muted">{status}</span>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-sm kb:static">
      <div
        className={cn(
          'mx-auto flex items-center gap-3 px-4 py-2.5 sm:py-3 md:px-8',
          wide ? 'max-w-7xl' : 'max-w-6xl',
        )}
      >
        <p className="font-display text-lg font-semibold">venduá</p>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          {/* the bars are the progressbar; the labels under them stay outside it, since one
              of them is a button */}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={overall}
            aria-valuetext={`${PHASES[at]!.label}: ${status}`}
            aria-label="andamento"
            className={cn('grid w-full max-w-xl gap-1.5', cols)}
          >
            {PHASES.map((p, i) => {
              const now = i === at;
              return (
                <span key={p.id} className={cn('min-w-0', split && !now && 'hidden sm:block')}>
                  {now && split ? (
                    <span className="grid grid-flow-col gap-1">
                      {parts!.map((c) => (
                        <Fill key={c.label} value={c.fill} />
                      ))}
                    </span>
                  ) : (
                    <Fill value={i < at ? 1 : now ? Math.max(fill, 0.06) : 0} />
                  )}
                </span>
              );
            })}
          </div>
          <div className={cn('mt-1 grid w-full max-w-xl gap-1.5', cols)}>
            {PHASES.map((p, i) => {
              const done = i < at || (i === at && fill >= 1);
              const now = i === at;
              const chapters = now && split;
              return (
                <span
                  key={p.id}
                  className={cn(
                    't-caption min-w-0 items-center gap-1',
                    chapters ? 'flex justify-center sm:justify-start' : 'hidden sm:flex',
                    now ? 'font-semibold text-ink' : 'text-muted',
                  )}
                >
                  {done ? <Check weight="bold" className="size-3.5 shrink-0 text-success" /> : null}
                  {chapters ? null : <span className="truncate">{p.label}</span>}
                  {now && !done ? (
                    chapters ? (
                      label
                    ) : (
                      <span className="tnum truncate font-normal text-muted">· {status}</span>
                    )
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>
        {exit ?? <span className="w-11" aria-hidden />}
      </div>
    </header>
  );
}
