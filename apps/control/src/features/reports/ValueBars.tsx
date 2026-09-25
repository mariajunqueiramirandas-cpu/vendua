import { fmtMoney } from '@/lib/format.ts';
import { Panel } from '@/components/ui/card.tsx';

/** Horizontal value bars, ranked by value (the stats arrays arrive count-ordered). */
export function ValueBars({
  title,
  rows,
}: {
  title: string;
  rows: { key: string; count: number; valueCents: number }[];
}) {
  const ranked = [...rows].sort((a, b) => b.valueCents - a.valueCents).slice(0, 8);
  const max = Math.max(1, ...ranked.map((r) => r.valueCents));
  return (
    <Panel title={title} aside={rows.length > 8 ? `top 8 de ${rows.length}` : undefined}>
      {ranked.length ? (
        <div className="grid grid-cols-[minmax(4.5rem,8rem)_minmax(0,1fr)_auto_2rem] items-center gap-x-2.5 gap-y-1.5 text-sm">
          <span className="text-[11px] text-muted-foreground" />
          <span />
          <span className="text-right text-[11px] text-muted-foreground">valor</span>
          <span className="text-right text-[11px] text-muted-foreground">leads</span>
          {ranked.map((r) => (
            <div key={r.key} className="contents">
              <span className="truncate" title={r.key}>
                {r.key || '—'}
              </span>
              <span
                className="h-3 overflow-hidden"
                title={`${r.key || '—'}: ${fmtMoney(r.valueCents)}`}
              >
                <span
                  className="block h-full rounded-r-[4px] bg-primary/75"
                  style={{ width: `${Math.max(1.5, (r.valueCents / max) * 100)}%` }}
                />
              </span>
              <span className="text-right text-[13px] whitespace-nowrap tnum">
                {fmtMoney(r.valueCents)}
              </span>
              <span className="text-right text-[13px] text-muted-foreground tnum">{r.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">sem dados ainda</p>
      )}
    </Panel>
  );
}
