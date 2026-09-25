import { cn } from '@/lib/cn.ts';

/** Thin progress track — plan steps resolved, leads found vs target. */
export function ProgressSliver({
  value,
  max,
  tone = 'success',
  className,
  label,
}: {
  value: number;
  max: number;
  tone?: 'success' | 'agent' | undefined;
  className?: string | undefined;
  /** accessible text, e.g. "3 de 5 etapas resolvidas" */
  label?: string | undefined;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      title={label}
      className={cn('block h-1 overflow-hidden rounded-full bg-muted', className)}
    >
      <span
        className={cn(
          'block h-full rounded-full transition-[width] duration-500',
          tone === 'agent' ? 'bg-agent' : 'bg-success',
        )}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
