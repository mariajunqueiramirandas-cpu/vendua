import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

export const fmtN = (n: number) => n.toLocaleString('pt-BR');

/** Small heading inside a panel, for its second and third blocks. */
export function SubHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">{children}</h3>
      {aside && <span className="ml-auto text-xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

/** One number with its label, the panel-level sibling of a KPI tile. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode | undefined;
  tone?: 'warn' | 'bad' | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs leading-tight text-muted-foreground">{label}</span>
      <span
        className={cn(
          'truncate text-base leading-tight font-semibold tracking-[-0.01em] tnum',
          tone === 'warn' && 'text-warning-foreground',
          tone === 'bad' && 'text-destructive-foreground',
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span>}
    </div>
  );
}

/**
 * Ranked horizontal bars against the largest row. `ink` picks the series ink:
 * primary for money we bill, agent-ink for what Duá spent.
 */
export function RankBars({
  rows,
  ink = 'primary',
  cols,
}: {
  rows: { key: string; label: ReactNode; value: number; cells: [ReactNode, ReactNode] }[];
  ink?: 'primary' | 'agent' | undefined;
  /** column headers for `cells`, right-aligned */
  cols: [string, string];
}) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <div className="grid grid-cols-[minmax(0,13rem)_minmax(3rem,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5 text-sm">
      <span />
      <span />
      {cols.map((c) => (
        <span key={c} className="text-right text-[11px] text-muted-foreground">
          {c}
        </span>
      ))}
      {rows.map((r) => (
        <div key={r.key} className="contents">
          <span className="min-w-0 truncate">{r.label}</span>
          <span className="flex h-2.5 items-center" aria-hidden>
            <span
              className={cn(
                'block h-full rounded-r-[4px]',
                ink === 'agent' ? 'bg-agent-ink' : 'bg-primary/75',
              )}
              style={{ width: `${r.value > 0 ? Math.max(2, (r.value / max) * 100) : 0}%` }}
            />
          </span>
          {r.cells.map((c, i) => (
            <span
              key={i}
              className={cn(
                'text-right text-[13px] whitespace-nowrap tnum',
                i < r.cells.length - 1 && 'text-muted-foreground',
              )}
            >
              {c}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** used / limit as a sliver; full turns red because the store has stopped answering. */
export function Allowance({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : used > 0 ? 100 : 0;
  const full = limit > 0 ? used >= limit : used > 0;
  return (
    <span className="inline-flex items-center gap-1.5" title={`${used} de ${limit} conversas`}>
      <span className="h-1 w-12 overflow-hidden rounded-full bg-secondary">
        <span
          className={cn('block h-full rounded-full', full ? 'bg-destructive' : 'bg-agent-ink')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground tnum">
        {fmtN(used)}/{fmtN(limit)}
      </span>
    </span>
  );
}
