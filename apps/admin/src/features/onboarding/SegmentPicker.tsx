import { haptic } from '../../lib/haptics.ts';
import { cn } from '../../ui/cn.ts';
import { SEGMENTS, type SegmentId } from './segments.ts';

/** Ten big tiles, one tap: what the store sells. A tap answers the question by itself. */
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
              'press flex min-h-24 flex-col items-start justify-between gap-3 rounded-lg p-4 text-left transition-[background-color,box-shadow] duration-(--duration-quick) disabled:opacity-60',
              on
                ? 'bg-spark-soft ring-2 ring-primary'
                : 'bg-surface ring-1 ring-line-strong hover:bg-hover',
            )}
          >
            <span
              className={cn(
                'grid size-11 place-items-center rounded-full',
                on ? 'bg-primary text-on-primary' : 'bg-sunken',
              )}
            >
              <s.Icon weight="duotone" className="size-6" aria-hidden />
            </span>
            <span className="font-semibold leading-tight">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
