import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect, useState } from 'react';
import { api, type StoreView } from '../../lib/api.ts';
import { clock, dateShort, isoDate } from '../../lib/format.ts';
import { qk } from '../../lib/query.ts';
import { cn } from '../../ui/cn.ts';

// the sheet (vaul + radix) loads on first tap, not with every screen
const LazyStatusSheet = lazy(() =>
  import('./StatusSheet.tsx').then((m) => ({ default: m.StatusSheet })),
);

export function statusWords(
  s: StoreView['status'],
  tz?: string,
): { label: string; tone: 'open' | 'paused' | 'closed' } {
  if (s.status === 'open') return { label: 'Aberta', tone: 'open' };
  if (s.status === 'paused')
    return {
      label: s.resumesAt ? `Pausada até ${clock(s.resumesAt, tz)}` : 'Pausada',
      tone: 'paused',
    };
  if (s.resumesAt) {
    const sameDay = isoDate(new Date(s.resumesAt), tz) === isoDate(new Date(), tz);
    return {
      label: sameDay
        ? `Abre às ${clock(s.resumesAt, tz)}`
        : `Abre ${dateShort(s.resumesAt, tz)}, ${clock(s.resumesAt, tz)}`,
      tone: 'closed',
    };
  }
  return { label: 'Fechada', tone: 'closed' };
}

export function useStoreQuery() {
  return useQuery({ queryKey: qk.store, queryFn: api.store, refetchInterval: 60_000 });
}

/** The live state, always present (§3.2). Tapping opens the status sheet. */
export function StatusPill({ className, block }: { className?: string; block?: boolean }) {
  const { data } = useStoreQuery();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (open) setSeen(true);
  }, [open]);
  if (!data)
    return <div className={cn('skeleton h-11 w-32 rounded-full', className)} aria-hidden />;
  const w = statusWords(data.status, data.hours.timezone);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={cn(
          't-label inline-flex min-h-11 items-center gap-2 rounded-full px-4 ring-1 transition-colors',
          w.tone === 'open' && 'bg-spark-soft ring-spark text-ink',
          w.tone === 'paused' && 'bg-warning-soft ring-warning/40 text-warning',
          w.tone === 'closed' && 'bg-sunken ring-line-strong text-muted',
          block && 'w-full justify-center',
          className,
        )}
      >
        <span className="relative flex size-2.5">
          {w.tone === 'open' ? (
            <span className="animate-pulse-dot absolute inline-flex size-full rounded-full bg-success opacity-60" />
          ) : null}
          <span
            className={cn(
              'relative inline-flex size-2.5 rounded-full',
              w.tone === 'open' ? 'bg-success' : w.tone === 'paused' ? 'bg-warning' : 'bg-faint',
            )}
          />
        </span>
        <span className="truncate">{w.label}</span>
      </button>
      {open || seen ? (
        <Suspense fallback={null}>
          <LazyStatusSheet open={open} onOpenChange={setOpen} store={data} />
        </Suspense>
      ) : null}
    </>
  );
}
