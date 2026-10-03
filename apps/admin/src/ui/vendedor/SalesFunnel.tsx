import { num } from '../../lib/format.ts';
import { cn } from '../cn.ts';

/**
 * Da conversa ao pedido (sales-agent-ux §3.8): each stage a centred bar narrowing to the
 * orders, with its count. `ui/charts.tsx` has the site's funnel; this one reads as a funnel at
 * a glance and gives screen readers one sentence instead of bars.
 */
export function SalesFunnel({
  steps,
  className,
}: {
  steps: { label: string; value: number }[];
  className?: string | undefined;
}) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  const first = steps[0];
  const last = steps[steps.length - 1];
  const summary =
    first && last
      ? `${steps.map((s) => `${s.label}: ${num(s.value)}`).join(', ')}. ${
          first.value ? Math.round((last.value / first.value) * 100) : 0
        }% chegaram ao fim.`
      : '';
  return (
    <div className={className}>
      <p className="sr-only">{summary}</p>
      <ol aria-hidden className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.label}>
            <div className="t-body flex items-baseline justify-between gap-3">
              <span>{s.label}</span>
              <span className="tnum font-semibold">{num(s.value)}</span>
            </div>
            <div className="mt-1 flex h-3 justify-center rounded-full bg-sunken noite:bg-line">
              <span
                className={cn(
                  'block h-3 rounded-full',
                  i === steps.length - 1 ? 'bg-(--chart-now)' : 'bg-(--chart)',
                )}
                style={{ width: `${Math.max(s.value ? 4 : 0, (s.value / top) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
