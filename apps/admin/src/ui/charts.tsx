import { Table } from '@phosphor-icons/react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { NoPhoto } from './illustrations.tsx';

// Chart family (§7): single-series marks in one forest hue (--chart), the current
// period in --chart-now. Every chart carries a one-sentence text summary for
// screen readers and a "ver tabela" view. Thin marks, recessive hairline grid,
// hover tooltip on every mark (hit targets wider than the mark).

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}

export function Sparkline({
  values,
  className,
  label,
}: {
  values: number[];
  className?: string;
  label: string;
}) {
  const w = 120;
  const h = 36;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [
    values.length === 1 ? w : (i / (values.length - 1)) * (w - 6) + 3,
    h - 4 - (v / max) * (h - 10),
  ]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]!.toFixed(1)} ${p[1]!.toFixed(1)}`).join(' ');
  const last = pts.at(-1);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn('h-9 w-30', className)}
      role="img"
      aria-label={label}
    >
      <path d={`${d} L${last?.[0] ?? w} ${h} L3 ${h} Z`} fill="var(--chart-soft)" />
      <path
        d={d}
        fill="none"
        stroke="var(--chart)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last ? (
        <>
          <circle
            cx={last[0]}
            cy={last[1]}
            r="6"
            fill="var(--chart-now)"
            opacity=".25"
            className="animate-pulse-dot"
            style={{ transformOrigin: `${last[0]}px ${last[1]}px` }}
          />
          <circle
            cx={last[0]}
            cy={last[1]}
            r="4"
            fill="var(--chart-now)"
            stroke="var(--surface)"
            strokeWidth="2"
          />
        </>
      ) : null}
    </svg>
  );
}

function ChartFrame({
  title,
  summary,
  table,
  children,
  action,
}: {
  title: ReactNode;
  summary: string;
  table: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  action?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const id = useId();
  return (
    <figure className="m-0" aria-labelledby={`${id}-t`}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <figcaption id={`${id}-t`} className="t-label">
            {title}
          </figcaption>
          <p className="t-caption mt-0.5 text-muted">{summary}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {action}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            className="t-caption inline-flex min-h-10 items-center gap-1.5 rounded-sm px-2 text-muted hover:bg-hover hover:text-ink"
          >
            <Table className="size-4" aria-hidden /> {asTable ? 'ver gráfico' : 'ver tabela'}
          </button>
        </div>
      </div>
      {asTable ? (
        <div className="max-h-80 overflow-auto rounded-sm ring-1 ring-line">
          <table className="t-body w-full text-left">
            <thead className="sticky top-0 bg-sunken">
              <tr>
                {table.head.map((h) => (
                  <th key={h} className="t-caption px-3 py-2 font-semibold text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={cn('px-3 py-2', j > 0 && 'tnum')}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div aria-hidden>{children}</div>
      )}
    </figure>
  );
}

/** Columns over time (one series). The last column is "now" when `highlightLast`. */
export function ColumnChart({
  title,
  summary,
  data,
  format,
  formatTick,
  highlightLast,
  height = 180,
  action,
}: {
  title: ReactNode;
  summary: string;
  data: { label: string; short: string; value: number }[];
  format: (v: number) => string;
  formatTick?: (v: number) => string;
  highlightLast?: boolean;
  height?: number;
  action?: ReactNode;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(data.length / 8));
  return (
    <ChartFrame
      title={title}
      summary={summary}
      action={action}
      table={{ head: ['dia', 'valor'], rows: data.map((d) => [d.label, format(d.value)]) }}
    >
      <div className="relative flex gap-2" style={{ height }}>
        <div className="t-caption tnum flex w-14 shrink-0 flex-col-reverse justify-between pb-6 text-right text-muted">
          {ticks.map((t) => (
            <span key={t} className="-translate-y-2 leading-none">
              {(formatTick ?? format)(t)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-x-0 bottom-6 top-0">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 h-px bg-[var(--chart-grid)]"
                style={{ bottom: `${(t / max) * 100}%` }}
              />
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-6 top-0 flex items-end gap-[2px]">
            {data.map((d, i) => {
              const now = highlightLast && i === data.length - 1;
              return (
                <div
                  key={d.label}
                  className="relative flex h-full flex-1 items-end justify-center"
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                >
                  <div
                    className="w-full max-w-6 rounded-t-[4px] transition-[height,opacity] duration-(--duration-smooth)"
                    style={{
                      height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%`,
                      background: now ? 'var(--chart-now)' : 'var(--chart)',
                      opacity: hover === null || hover === i ? 1 : 0.55,
                    }}
                  />
                  {hover === i ? (
                    <div className="t-caption pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-sm bg-ink px-2.5 py-1.5 text-bg depth-2 noite:bg-raised noite:text-ink">
                      <span className="block text-[0.75rem] opacity-75">{d.label}</span>
                      <span className="tnum font-semibold">{format(d.value)}</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="t-caption absolute inset-x-0 bottom-0 flex h-5 gap-[2px] text-muted">
            {data.map((d, i) => (
              <span key={d.label} className="flex-1 truncate text-center">
                {i % every === 0 || i === data.length - 1 ? d.short : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </ChartFrame>
  );
}

/** Weekday × hour, one hue light → dark (sequential). */
export function Heatmap({
  title,
  summary,
  cells,
  days,
}: {
  title: ReactNode;
  summary: string;
  cells: { dow: number; hour: number; value: number }[];
  days: string[];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...cells.map((c) => c.value));
  const grid = useMemo(() => {
    const m = new Map(cells.map((c) => [`${c.dow}-${c.hour}`, c.value]));
    return m;
  }, [cells]);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  // trim to hours that ever had an order (± 1) so phones get wide cells
  const used = hours.filter((h) => days.some((_, d) => (grid.get(`${d}-${h}`) ?? 0) > 0));
  const lo = Math.max(0, (used[0] ?? 8) - 1);
  const hi = Math.min(23, (used.at(-1) ?? 20) + 1);
  const shown = hours.filter((h) => h >= lo && h <= hi);
  return (
    <ChartFrame
      title={title}
      summary={summary}
      table={{
        head: ['dia', ...shown.map((h) => `${h}h`)],
        rows: days.map((d, i) => [d, ...shown.map((h) => grid.get(`${i}-${h}`) ?? 0)]),
      }}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[420px]">
          {days.map((d, di) => (
            <div key={d} className="flex items-center gap-[2px] py-[1px]">
              <span className="t-caption w-9 shrink-0 text-muted">{d}</span>
              {shown.map((h) => {
                const v = grid.get(`${di}-${h}`) ?? 0;
                const k = `${di}-${h}`;
                return (
                  <div
                    key={h}
                    onPointerEnter={() => setHover(k)}
                    onPointerLeave={() => setHover(null)}
                    className="relative h-7 flex-1 rounded-[4px]"
                    style={{
                      background:
                        v === 0
                          ? 'var(--surface-sunken)'
                          : `color-mix(in oklab, var(--chart) ${Math.round(18 + (v / max) * 82)}%, var(--surface))`,
                      outline: hover === k ? '2px solid var(--ink)' : undefined,
                    }}
                  >
                    {hover === k ? (
                      <div className="t-caption pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink px-2 py-1 text-bg noite:bg-raised noite:text-ink">
                        {d}, {h}h: <span className="tnum font-semibold">{v}</span>{' '}
                        {v === 1 ? 'pedido' : 'pedidos'}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="flex gap-[2px] pl-9">
            {shown.map((h, i) => (
              <span key={h} className="t-caption flex-1 whitespace-nowrap text-center text-muted">
                {h % 3 === 0 && i < shown.length - 1 ? `${h}h` : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </ChartFrame>
  );
}

/** Ordered stages as horizontal bars with step-to-step conversion. */
export function Funnel({
  title,
  summary,
  steps,
}: {
  title: ReactNode;
  summary: string;
  steps: { label: string; value: number }[];
}) {
  const top = Math.max(1, steps[0]?.value ?? 1);
  return (
    <ChartFrame
      title={title}
      summary={summary}
      table={{ head: ['etapa', 'pessoas'], rows: steps.map((s) => [s.label, s.value]) }}
    >
      <ol className="space-y-2.5">
        {steps.map((s, i) => {
          const prev = i ? steps[i - 1]!.value : null;
          const rate = prev ? Math.round((s.value / Math.max(1, prev)) * 100) : null;
          return (
            <li key={s.label}>
              <div className="t-body mb-1 flex items-baseline justify-between gap-3">
                <span>{s.label}</span>
                <span className="tnum">
                  <span className="font-semibold">{s.value.toLocaleString('pt-BR')}</span>
                  {rate !== null ? (
                    <span className="t-caption ml-2 text-muted">{rate}% da etapa anterior</span>
                  ) : null}
                </span>
              </div>
              <div className="h-3 rounded-full bg-sunken">
                <div
                  className="h-3 rounded-full"
                  style={{
                    width: `${Math.max(s.value ? 2 : 0, (s.value / top) * 100)}%`,
                    background: i === steps.length - 1 ? 'var(--chart-now)' : 'var(--chart)',
                  }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </ChartFrame>
  );
}

/** Ranked horizontal bars with an optional thumbnail (top products, zones). */
export function RankBars({
  title,
  summary,
  rows,
  format,
  valueHead = 'valor',
}: {
  title: ReactNode;
  summary: string;
  rows: { key: string; label: string; value: number; detail?: string; image?: string | null }[];
  format: (v: number) => string;
  valueHead?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ChartFrame
      title={title}
      summary={summary}
      table={{ head: ['', valueHead], rows: rows.map((r) => [r.label, format(r.value)]) }}
    >
      <ol className="space-y-3">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-3">
            {r.image !== undefined ? (
              <span className="size-11 shrink-0 overflow-hidden rounded-sm bg-sunken">
                {r.image ? (
                  <img src={r.image} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <NoPhoto />
                )}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="t-body flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{r.label}</span>
                <span className="tnum shrink-0 font-semibold">{format(r.value)}</span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-sunken">
                <div
                  className="h-2 rounded-full bg-[var(--chart)]"
                  style={{ width: `${(r.value / max) * 100}%` }}
                />
              </div>
              {r.detail ? <p className="t-caption mt-1 text-muted">{r.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </ChartFrame>
  );
}
