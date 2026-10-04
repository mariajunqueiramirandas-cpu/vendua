import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { fmtDay } from '@/lib/format.ts';

const H = 64;
const PT = 4;
const PB = 18;

/**
 * One bar per day, no axis: the panel title names the series and its total, the
 * crosshair reads a day. Ink is the `primary` token so both themes follow.
 */
export function Spark({
  days,
  values,
  label,
  format,
  detail,
  empty,
}: {
  days: string[];
  values: number[];
  label: string;
  format: (v: number) => string;
  /** extra tooltip line for day i */
  detail?: ((i: number) => ReactNode) | undefined;
  /** shown over a flat chart when every value is 0 */
  empty: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([e]) => e && setW(Math.max(160, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = values.length;
  const max = Math.max(0, ...values);
  const ih = H - PT - PB;
  const slot = W / Math.max(1, n);
  // 2px surface gap between bars, never thinner than 2px
  const bw = Math.max(2, slot - 2);
  const x = (i: number) => slot * i + (slot - bw) / 2;
  const h = (v: number) => (max ? Math.max(v > 0 ? 2 : 0, (v / max) * ih) : 0);

  const pick = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || !n) return;
    const i = Math.floor((clientX - el.getBoundingClientRect().left) / slot);
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div ref={wrapRef} className="relative">
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={`${label} por dia, últimos ${n} dias; máximo ${format(max)}`}
        className="block touch-pan-y select-none"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <line
          x1={0}
          x2={W}
          y1={PT + ih + 0.5}
          y2={PT + ih + 0.5}
          className="stroke-border-strong"
          strokeWidth={1}
        />
        {values.map((v, i) => (
          <rect
            key={days[i] ?? i}
            x={x(i)}
            y={PT + ih - h(v)}
            width={bw}
            height={h(v)}
            rx={Math.min(2, bw / 2)}
            className={hover === i ? 'fill-primary' : 'fill-primary/60'}
          />
        ))}
        {n > 0 && (
          <>
            <text x={0} y={H - 4} className="fill-muted-foreground text-[11px]">
              {fmtDay(days[0])}
            </text>
            <text x={W} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {fmtDay(days[n - 1])}
            </text>
          </>
        )}
      </svg>
      {max === 0 && (
        <p className="pointer-events-none absolute inset-x-0 top-3 text-center text-xs text-muted-foreground">
          {empty}
        </p>
      )}
      {hover != null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 -translate-y-full rounded-md border bg-popover px-2 py-1.5 text-xs whitespace-nowrap shadow-card"
          style={{ left: Math.min(Math.max(x(hover) + bw / 2 - 64, 0), W - 128) }}
        >
          <div className="font-medium">{fmtDay(days[hover])}</div>
          <div className="tnum">
            {format(values[hover] ?? 0)} <span className="text-muted-foreground">{label}</span>
          </div>
          {detail?.(hover)}
        </div>
      )}
    </div>
  );
}
