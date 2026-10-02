import type { ReactNode } from 'react';

const pct = (v: number, of: number) => (of ? `${Math.round((v / of) * 100)}%` : '—');

/** Ranked horizontal bars with a count and its share of `total`. */
export function ShareBars({
  rows,
  total,
  unit,
}: {
  rows: { key: string; label: ReactNode; value: number }[];
  total: number;
  unit: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="grid grid-cols-[minmax(5rem,10rem)_minmax(0,1fr)_auto_2.75rem] items-center gap-x-2.5 gap-y-1.5 text-sm">
      <span />
      <span />
      <span className="text-right text-[11px] text-muted-foreground">{unit}</span>
      <span className="text-right text-[11px] text-muted-foreground">%</span>
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <span className="truncate">{r.label}</span>
          <span className="h-3 overflow-hidden">
            <span
              className="block h-full rounded-r-[4px] bg-primary/75"
              style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }}
            />
          </span>
          <span className="text-right text-[13px] tnum">{r.value.toLocaleString('pt-BR')}</span>
          <span className="text-right text-[13px] text-muted-foreground tnum">
            {pct(r.value, total)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Funnel steps, each bar against the first step, with the step-to-step rate. */
export function FunnelBars({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 0);
  return (
    <ol className="flex flex-col gap-2.5">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1]!.value : 0;
        return (
          <li key={s.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span>{s.label}</span>
              <span className="tnum">
                {s.value.toLocaleString('pt-BR')}
                {i > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {pct(s.value, prev)} do passo anterior
                  </span>
                )}
              </span>
            </div>
            <span className="h-2 overflow-hidden rounded-full bg-secondary">
              <span
                className="block h-full rounded-full bg-primary/75"
                style={{ width: `${Math.max(s.value ? 1.5 : 0, (s.value / top) * 100)}%` }}
              />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
