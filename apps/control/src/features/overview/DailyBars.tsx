import { useLayoutEffect, useRef, useState } from 'react';
import { fmtDay } from '@/lib/format.ts';

const H = 136;
const PL = 44;
const PR = 4;
const PT = 8;
const PB = 20;

/**
 * One bar per day, one measure at a time (orders or GMV never share an axis).
 * Drawn at the real pixel width so 11px labels stay 11px on phones.
 */
export function DailyBars({
  points,
  label,
  fmt,
  fmtAxis,
}: {
  points: { day: string; value: number }[];
  label: string;
  fmt: (v: number) => string;
  fmtAxis: (v: number) => string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(560);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([e]) => e && setW(Math.max(220, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = iw / Math.max(1, n);
  const bw = Math.max(2, Math.min(18, slot - 2));
  const cx = (i: number) => PL + slot * (i + 0.5);
  const y = (v: number) => PT + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 84))));

  const pick = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || !n) return;
    const i = Math.floor((clientX - el.getBoundingClientRect().left - PL) / slot);
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const h = hover != null ? points[hover] : null;

  return (
    <div ref={wrapRef} className="relative">
      <svg
        width={W}
        height={H}
        role="img"
        aria-label={`${label} por dia, últimos ${n} dias`}
        className="block touch-pan-y overflow-visible select-none"
        onPointerMove={(e) => pick(e.clientX)}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 1].map((t) => (
          <g key={t} className="text-border-strong">
            <line
              x1={PL}
              x2={W - PR}
              y1={y(max * t)}
              y2={y(max * t)}
              stroke="currentColor"
              strokeDasharray={t ? '2 4' : undefined}
            />
            <text
              x={PL - 6}
              y={y(max * t) + 3.5}
              textAnchor="end"
              className="fill-muted-foreground text-[11px] tnum"
            >
              {fmtAxis(max * t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={cx(i) - bw / 2}
            y={y(p.value)}
            width={bw}
            height={Math.max(0, PT + ih - y(p.value))}
            rx={Math.min(3, bw / 3)}
            className={hover === i ? 'fill-primary' : 'fill-primary/65'}
          />
        ))}
        {points.map((p, i) =>
          (n - 1 - i) % every === 0 ? (
            <text
              key={p.day}
              x={i === n - 1 ? W - PR : cx(i)}
              y={H - 5}
              textAnchor={i === n - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground text-[11px]"
            >
              {fmtDay(p.day)}
            </text>
          ) : null,
        )}
      </svg>
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-pop"
          style={{ left: Math.min(Math.max(cx(hover) - 60, 0), W - 120) }}
        >
          <div className="text-muted-foreground">{fmtDay(h.day)}</div>
          <div className="font-medium tnum">
            {fmt(h.value)} <span className="font-normal text-muted-foreground">{label}</span>
          </div>
        </div>
      )}
    </div>
  );
}
