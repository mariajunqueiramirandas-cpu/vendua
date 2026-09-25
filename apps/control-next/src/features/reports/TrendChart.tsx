import { useLayoutEffect, useRef, useState } from 'react';
import type { Stats } from '@/lib/api.ts';
import { fmtDay, fmtMoney } from '@/lib/format.ts';

type Point = Stats['forecast']['trend'][number];

// compact R$ for axis labels
const fmtCompact = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: 'compact',
    maximumFractionDigits: 1,
  });

const H = 200;
const PL = 52;
const PR = 64;
const PT = 12;
const PB = 22;

/**
 * Weighted forecast (solid, area) vs raw pipeline (dashed) on one money axis.
 * Series ink comes from theme tokens (primary / muted-foreground), so both
 * themes re-step automatically; the crosshair reads every series at a date.
 */
export function TrendChart({ trend }: { trend: Point[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // drawn at the real pixel width so 11px labels stay 11px on phones
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

  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const max = Math.max(1, ...trend.flatMap((p) => [p.valueCents, p.weightedCents]));
  const x = (i: number) => PL + (trend.length === 1 ? iw / 2 : (i / (trend.length - 1)) * iw);
  const y = (v: number) => PT + ih - (v / max) * ih;
  const line = (f: (p: Point) => number) =>
    trend.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join(' ');
  const area = `${line((p) => p.weightedCents)} L${x(trend.length - 1).toFixed(1)},${PT + ih} L${x(0).toFixed(1)},${PT + ih} Z`;
  const last = trend.at(-1)!;

  const pick = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const vx = clientX - el.getBoundingClientRect().left;
    const i = trend.length === 1 ? 0 : Math.round(((vx - PL) / iw) * (trend.length - 1));
    setHover(Math.max(0, Math.min(trend.length - 1, i)));
  };

  const h = hover != null ? trend[hover] : null;
  const tipLeft = hover != null ? x(hover) : 0;

  return (
    <div className="relative">
      <div className="mb-1.5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden className="text-primary">
            <line x1="0" x2="16" y1="4" y2="4" stroke="currentColor" strokeWidth="2" />
          </svg>
          ponderado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden className="text-muted-foreground">
            <line
              x1="0"
              x2="16"
              y1="4"
              y2="4"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="4 3"
            />
          </svg>
          pipeline
        </span>
      </div>
      <div ref={wrapRef}>
        <svg
          width={W}
          height={H}
          role="img"
          aria-label="evolução do valor ponderado e do pipeline"
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
                x={PL - 8}
                y={y(max * t) + 3.5}
                textAnchor="end"
                className="fill-muted-foreground text-[11px] tnum"
              >
                {fmtCompact(max * t)}
              </text>
            </g>
          ))}
          <path d={area} className="fill-primary/10" />
          <path
            d={line((p) => p.valueCents)}
            fill="none"
            className="stroke-muted-foreground"
            strokeWidth={2}
            strokeDasharray="5 4"
            strokeLinejoin="round"
          />
          <path
            d={line((p) => p.weightedCents)}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {trend.length <= 40 &&
            trend.map((p, i) => (
              <circle
                key={p.takenOn}
                cx={x(i)}
                cy={y(p.weightedCents)}
                r={2.5}
                className="fill-primary stroke-card"
                strokeWidth={1.5}
              />
            ))}
          {/* direct end labels; the tooltip and table carry every other value */}
          <text
            x={x(trend.length - 1) + 8}
            y={y(last.weightedCents) + 4}
            className="fill-foreground text-[11px] font-medium tnum"
          >
            {fmtCompact(last.weightedCents)}
          </text>
          {Math.abs(y(last.valueCents) - y(last.weightedCents)) > 12 && (
            <text
              x={x(trend.length - 1) + 8}
              y={y(last.valueCents) + 4}
              className="fill-muted-foreground text-[11px] tnum"
            >
              {fmtCompact(last.valueCents)}
            </text>
          )}
          <text
            x={trend.length === 1 ? x(0) : PL}
            y={H - 5}
            textAnchor={trend.length === 1 ? 'middle' : 'start'}
            className="fill-muted-foreground text-[11px]"
          >
            {fmtDay(trend[0]!.takenOn)}
          </text>
          {trend.length > 1 && (
            <text
              x={W - PR}
              y={H - 5}
              textAnchor="end"
              className="fill-muted-foreground text-[11px]"
            >
              {fmtDay(last.takenOn)}
            </text>
          )}
          {h && hover != null && (
            <g pointerEvents="none">
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PT}
                y2={PT + ih}
                className="stroke-foreground/40"
                strokeWidth={1}
              />
              <circle
                cx={x(hover)}
                cy={y(h.valueCents)}
                r={4}
                className="fill-muted-foreground stroke-card"
                strokeWidth={2}
              />
              <circle
                cx={x(hover)}
                cy={y(h.weightedCents)}
                r={4.5}
                className="fill-primary stroke-card"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
      </div>
      {h && (
        <div
          className="pointer-events-none absolute top-6 z-10 w-max -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `clamp(70px, ${tipLeft}px, calc(100% - 70px))` }}
        >
          <div className="mb-0.5 text-muted-foreground">{fmtDay(h.takenOn)}</div>
          <div className="flex items-center gap-2">
            <i className="h-0.5 w-3 bg-primary" aria-hidden />
            <b className="font-semibold tnum">{fmtMoney(h.weightedCents)}</b>
            <span className="text-muted-foreground">ponderado</span>
          </div>
          <div className="flex items-center gap-2">
            <i className="h-0.5 w-3 bg-muted-foreground" aria-hidden />
            <b className="font-semibold tnum">{fmtMoney(h.valueCents)}</b>
            <span className="text-muted-foreground">pipeline</span>
          </div>
        </div>
      )}
    </div>
  );
}
