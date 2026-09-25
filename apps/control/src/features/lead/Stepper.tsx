import { cn } from '@/lib/cn.ts';
import { LEAD_STATES, LEAD_STATE_LABEL } from '@/lib/labels.ts';

const stageIndex = (state: string) =>
  Math.max(
    0,
    LEAD_STATES.findIndex(([v]) => v === state),
  );

/** Pipeline stage picker — every stage is a tap target that moves the lead there. */
export function Stepper({ state, onChange }: { state: string; onChange: (state: string) => void }) {
  const idx = stageIndex(state);
  return (
    <div role="group" aria-label="estágio do lead" className="grid grid-cols-4 gap-1">
      {LEAD_STATES.map(([v, l], i) => (
        <button
          key={v}
          type="button"
          title={`mover para ${LEAD_STATE_LABEL[v]}`}
          aria-pressed={state === v}
          onClick={() => state !== v && onChange(v)}
          className="group flex min-w-0 flex-col gap-1 rounded-md px-1 pt-1.5 pb-1 text-left transition-colors hover:bg-hover pointer-coarse:pb-2"
        >
          <span
            className={cn(
              'h-1 rounded-full bg-muted transition-colors',
              i <= idx && 'bg-success dark:bg-agent/80',
              i === idx && 'bg-primary dark:bg-agent',
            )}
          />
          <span
            className={cn(
              'truncate text-[11px] text-muted-foreground',
              i === idx && 'font-semibold text-foreground',
            )}
          >
            {l}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Read-only progress sliver for the phone summary bar. */
export function StageProgress({ state, className }: { state: string; className?: string }) {
  const idx = stageIndex(state);
  return (
    <span
      className={cn('flex items-center gap-2', className)}
      title={`estágio: ${LEAD_STATE_LABEL[state] ?? state}`}
    >
      <span className="flex w-20 gap-0.5" aria-hidden>
        {LEAD_STATES.map(([v], i) => (
          <span
            key={v}
            className={cn(
              'h-1.5 flex-1 rounded-full bg-muted',
              i <= idx && 'bg-success dark:bg-agent/80',
              i === idx && 'bg-primary dark:bg-agent',
            )}
          />
        ))}
      </span>
      <span className="text-xs font-medium">{LEAD_STATE_LABEL[state] ?? state}</span>
    </span>
  );
}
