import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Stats } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { fmtMoney } from '@/lib/format.ts';
import { LEAD_STATES, LEAD_STATE_LABEL } from '@/lib/labels.ts';
import { Panel } from '@/components/ui/card.tsx';

const STAGE_FILL: Record<string, string> = {
  lead: 'bg-stage-lead text-stage-lead-fg',
  contacted: 'bg-stage-contacted text-stage-contacted-fg',
  invited: 'bg-stage-invited text-stage-invited-fg',
  live: 'bg-stage-live text-stage-live-fg',
};

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

/** Current distribution as one stacked bar; "alcançaram" (ever reached) + step conversion under it. */
export function FunnelBar({ s }: { s: Stats }) {
  const counts = LEAD_STATES.map(([st]) => s.byState[st]?.count ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <Panel
      title="funil"
      aside={`${total} leads · distribuição atual`}
      actions={
        <Link
          to="/pipeline/relatorios"
          className="text-xs whitespace-nowrap text-muted-foreground hover:text-foreground"
        >
          previsão{' '}
          <span className="text-foreground tnum">{fmtMoney(s.forecast.weightedCents)}</span> →
        </Link>
      }
    >
      <div
        className="flex h-8 gap-0.5 overflow-hidden rounded-md"
        role="img"
        aria-label={LEAD_STATES.map(([, l], i) => `${l}: ${counts[i]}`).join(', ')}
      >
        {total === 0 && <div className="flex-1 rounded-md bg-muted" />}
        {LEAD_STATES.map(([st, label], i) => {
          const n = counts[i]!;
          if (!n) return null;
          const w = (n / total) * 100;
          return (
            <Link
              key={st}
              to="/pipeline?v=board"
              title={`${label}: ${n} · ${fmtMoney(s.byState[st]?.valueCents)}`}
              className={cn(
                'flex min-w-1 items-center overflow-hidden px-2 text-xs font-medium whitespace-nowrap transition-[filter] first:rounded-l-md last:rounded-r-md hover:brightness-95',
                STAGE_FILL[st],
              )}
              style={{ width: `${w}%` }}
            >
              {w >= 12 && (
                <>
                  {label} <span className="ml-1 tnum opacity-80">{n}</span>
                </>
              )}
            </Link>
          );
        })}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {LEAD_STATES.map(([st, label], i) => {
          const reached = s.everReached[st] ?? 0;
          const prev = i ? (s.everReached[LEAD_STATES[i - 1]![0]] ?? 0) : 0;
          return (
            <div key={st} className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <i className={cn('size-2 rounded-[2px]', STAGE_FILL[st])} aria-hidden />
                {label}
                <span className="font-medium text-foreground tnum">{counts[i]}</span>
              </span>
              <span className="text-[11px] text-muted-foreground tnum">
                {reached} alcançaram{i > 0 && ` · ${pct(reached, prev)}`}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function MiniTable({
  title,
  rows,
  empty,
  compact,
  className,
}: {
  title: string;
  rows: { key: ReactNode; id: string; count: number; valueCents: number }[];
  empty: string;
  /** phones: drop the value column so two tables fit side by side */
  compact?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <Panel title={title} flush className={className}>
      {rows.length ? (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="h-8 border-b last:border-b-0">
                <td className="max-w-0 truncate pl-3">{r.key}</td>
                <td className={cn('w-10 px-2 text-right tnum', compact && 'max-sm:pr-3')}>
                  {r.count}
                </td>
                <td
                  className={cn(
                    'w-28 pr-3 text-right text-muted-foreground tnum',
                    compact && 'max-sm:hidden',
                  )}
                >
                  {fmtMoney(r.valueCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-3 py-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </Panel>
  );
}

/** Dense by-segment / by-source / by-stage tables, side by side from md up. */
export function BreakdownTables({ s }: { s: Stats }) {
  const top = (rows: Stats['bySource']) =>
    rows.slice(0, 8).map((r) => ({ ...r, id: r.key, key: r.key || '—' }));
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      <MiniTable compact title="por segmento" rows={top(s.bySegment)} empty="sem segmentos ainda" />
      <MiniTable compact title="por origem" rows={top(s.bySource)} empty="sem origens ainda" />
      <MiniTable
        className="col-span-2 md:col-span-1"
        title="valor por estágio"
        empty="—"
        rows={LEAD_STATES.map(([st]) => ({
          id: st,
          key: (
            <Link to="/pipeline?v=board" className="hover:underline">
              {LEAD_STATE_LABEL[st]}
            </Link>
          ),
          count: s.byState[st]?.count ?? 0,
          valueCents: s.byState[st]?.valueCents ?? 0,
        }))}
      />
    </div>
  );
}
