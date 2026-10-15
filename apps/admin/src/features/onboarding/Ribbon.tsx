import { CaretDown } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../../ui/cn.ts';

// The onboarding's header: the wordmark, where the merchant is ("A cara da loja, 3 de 6": a tap
// opens the map of questions below 1200 px) and the way out, with a hairline under it that fills
// part by part. Signup is behind the merchant and the finale is this screen's own end, so neither
// is spelled out here; the hairline is the whole journey.

/** The page's columns from 1200 px (the map, the question, the window): the header uses the
 *  same tracks, so the wordmark sits over the map and the place over the question. */
export const TRACKS =
  'lg:grid lg:grid-cols-[13rem_minmax(0,34rem)_minmax(22rem,1fr)] lg:gap-10 xl:grid-cols-[14rem_minmax(0,34rem)_minmax(22rem,1fr)] xl:gap-14';

export function Ribbon({
  parts,
  place,
  count,
  onPlace,
  exit,
  done,
}: {
  /** each part of the store and how much of it is answered (0..1) */
  parts: { id: string; label: string; fill: number }[];
  /** the part the open question belongs to ("A cara da loja"), or where the screen is */
  place: string;
  /** "3 de 6" beside the place, while inside a part */
  count?: string | undefined;
  /** opens the map of questions (phones and tablets; the map is beside the question from 1200 px) */
  onPlace?: (() => void) | undefined;
  exit?: ReactNode;
  /** the finale: every segment full, in the colour of things that are done */
  done?: boolean;
}) {
  const total = parts.length || 1;
  const overall = Math.round((parts.reduce((a, p) => a + p.fill, 0) / total) * 100);
  const label = (
    <>
      <span className="truncate font-semibold text-ink">{place}</span>
      {count ? <span className="tnum shrink-0 font-medium text-muted">{count}</span> : null}
    </>
  );
  return (
    <header className="sticky top-0 z-30 bg-bg/95 pt-[env(safe-area-inset-top)] backdrop-blur-sm kb:static">
      <div
        className={cn(
          'mx-auto flex min-h-14 max-w-[84rem] items-center gap-3 px-4 md:px-8',
          TRACKS,
          'lg:min-h-16',
        )}
      >
        <p className="font-display text-[1.125rem] font-semibold leading-none tracking-[-0.01em]">
          venduá
        </p>
        <div className="flex min-w-0 flex-1 justify-center lg:justify-start">
          {onPlace ? (
            <>
              <button
                type="button"
                onClick={onPlace}
                aria-label={`${place}${count ? `, ${count}` : ''}. Ver todas as perguntas`}
                className="press t-label inline-flex min-h-10 min-w-0 max-w-full items-center gap-1.5 rounded-full bg-sunken py-1 pl-3.5 pr-2.5 lg:hidden"
              >
                {label}
                <CaretDown weight="bold" className="size-3.5 shrink-0 text-muted" aria-hidden />
              </button>
              <span className="t-label hidden min-w-0 items-center gap-1.5 lg:inline-flex">
                {label}
              </span>
            </>
          ) : (
            <span className="t-label inline-flex min-w-0 items-center gap-1.5">{label}</span>
          )}
        </div>
        <div className="flex shrink-0 justify-end">
          {exit ?? <span className="block w-11" aria-hidden />}
        </div>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={done ? 100 : overall}
        aria-valuetext={`${place}${count ? `, ${count}` : ''}`}
        aria-label="andamento da loja"
        className="grid gap-[3px] px-[3px]"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
      >
        {parts.map((p) => (
          <span key={p.id} className="block h-[3px] overflow-hidden rounded-full bg-line-strong">
            <span
              className={cn(
                'block h-full rounded-full transition-[width] duration-(--duration-smooth) ease-(--ease-soft)',
                done ? 'bg-success' : 'bg-primary',
              )}
              style={{ width: `${(done ? 1 : Math.min(1, Math.max(0, p.fill))) * 100}%` }}
            />
          </span>
        ))}
      </div>
    </header>
  );
}
