import { haptic } from '../../lib/haptics.ts';
import { cn } from '../../ui/cn.ts';
import { SEGMENTS, type SegmentId } from './segments.ts';

/** Ten big tiles, one tap: what the store sells. A tap answers the question by itself. On
 *  phones they're rows of two (icon beside the name), so all ten fit without scrolling far. */
export function SegmentPicker({
  value,
  onPick,
  busy,
}: {
  value: string | null;
  onPick: (id: SegmentId) => void;
  busy?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="o que a loja vende"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      {SEGMENTS.map((s) => {
        const on = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={busy}
            onClick={() => {
              haptic.tick();
              onPick(s.id);
            }}
            className={cn(
              'press flex min-h-16 items-center gap-2.5 rounded-lg py-2.5 pl-2.5 pr-3 text-left transition-[background-color,box-shadow] duration-(--duration-quick) disabled:opacity-60 sm:min-h-24 sm:flex-col sm:items-start sm:justify-between sm:p-4',
              on
                ? 'bg-spark-soft ring-2 ring-inset ring-primary'
                : 'bg-surface ring-1 ring-inset ring-line-strong hover:bg-hover',
            )}
          >
            <span
              className={cn(
                'grid size-10 shrink-0 place-items-center rounded-full sm:size-11',
                on ? 'bg-primary text-on-primary' : 'bg-sunken',
              )}
            >
              <s.Icon weight="duotone" className="size-6" aria-hidden />
            </span>
            <span className="min-w-0 text-[0.9375rem] font-semibold leading-tight sm:text-base">
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
