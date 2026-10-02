import { useLayoutEffect, useRef, useState } from 'react';
import { fmtDay } from '@/lib/format.ts';

export interface DailyPoint {
  day: string;
  /** the bar */
  value: number;
  /** drawn as a line on the same axis */
  line?: number | undefined;
  /** shown in the tooltip only */
  extra?: number | undefined;
}

const H = 180;
const PL = 36;
const PR = 8;
const PT = 10;
const PB = 22;

const fmtN = (n: number) => n.toLocaleString('pt-BR');
const compact = (n: number) =>
  n.toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * One bar per day, optionally a line on the same axis. Ink is theme tokens (primary,
 * muted-foreground) so both themes follow; the crosshair reads a day's numbers.
 */
export function DailyChart({
  points,
  label,
  lineLabel,
  extraLabel,
}: {
  points: DailyPoint[];
  label: string;
  lineLabel?: string | undefined;
  extraLabel?: string | undefined;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(640);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(
      ([e]) => e && setW(Math.max(240, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const max = Math.max(1, ...points.flatMap((p) => [p.value, p.line ?? 0]));
  const slot = iw / Math.max(1, n);
  const bw = Math.max(2, Math.min(28, slot * 0.68));
  const cx = (i: number) => PL + slot * (i + 0.5);
  const y = (v: number) => PT + ih - (v / max) * ih;
  const hasLine = points.some((p) => p.line != null);
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${y(p.line ?? 0).toFixed(1)}`)
    .join(' ');
  // one date label per ~72px, whatever the range
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 72))));

  const pick = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || !n) return;
    const i = Math.floor((clientX - el.getBoundingClientRect().left - PL) / slot);
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const h = hover != null ? points[hover] : null;

  return (
    <div className="relative">
      <div className="mb-1.5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-primary/70" aria-hidden />
          {label}
        </span>
        {hasLine && lineLabel && (
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden className="text-muted-foreground">
              <line x1="0" x2="16" y1="4" y2="4" stroke="currentColor" strokeWidth="2" />
            </svg>
            {lineLabel}
          </span>
        )}
      </div>
      <div ref={wrapRef}>
        <svg
          width={W}
          height={H}
          role="img"
          aria-label={`${label} por dia`}
          className="block touch-pan-y overflow-visible select-none"
          onPointerMove={(e) => pick(e.clientX)}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.5, 1].map((t) => (
            <g key={t} className="text-border-strong">
              <line
                x1={PL}
                x2={W - PR}
                y1={y(max * t)}
                y2={y(max * t)}
                stroke="currentColor"
                strokeWidth={1}
                strokeDasharray={t ? '2 4' : undefined}
              />
              <text
                x={PL - 6}
                y={y(max * t) + 3.5}
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tnum"
              >
                {compact(Math.round(max * t))}
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
              className={hover === i ? 'fill-primary' : 'fill-primary/70'}
            />
          ))}
          {hasLine && (
            <path
              d={line}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          )}
          {points.map((p, i) =>
            i % every === 0 || i === n - 1 ? (
              <text
                key={p.day}
                x={cx(i)}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[11px]"
              >
                {i === n - 1 || n - 1 - i >= every / 2 ? fmtDay(p.day) : ''}
              </text>
            ) : null,
          )}
          {hover != null && (
            <line
              x1={cx(hover)}
              x2={cx(hover)}
              y1={PT}
              y2={PT + ih}
              className="stroke-border-strong"
              strokeWidth={1}
            />
          )}
        </svg>
      </div>
      {h && (
        <div
          className="pointer-events-none absolute top-6 z-10 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-card"
          style={{
            left: Math.min(Math.max(cx(hover!) - 70, 0), W - 140),
          }}
        >
          <div className="font-medium">{fmtDay(h.day)}</div>
          <div className="tnum">
            {fmtN(h.value)} <span className="text-muted-foreground">{label}</span>
          </div>
          {h.line != null && lineLabel && (
            <div className="tnum">
              {fmtN(h.line)} <span className="text-muted-foreground">{lineLabel}</span>
            </div>
          )}
          {h.extra != null && extraLabel && (
            <div className="tnum">
              {fmtN(h.extra)} <span className="text-muted-foreground">{extraLabel}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
