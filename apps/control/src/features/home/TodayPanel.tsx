import { Link, useNavigate } from 'react-router-dom';
import { AlarmClockCheck, CalendarDays } from 'lucide-react';
import { RUN_KIND_LABEL } from '@/lib/labels.ts';
import { fmtDateTime, relDue } from '@/lib/format.ts';
import { Badge } from '@/components/ui/badge.tsx';
import { Panel } from '@/components/ui/card.tsx';
import { ErrorState, LoadingRows } from '@/components/common.tsx';
import { MeetingRow } from '@/features/agenda/meeting-ui.tsx';
import { useTodayMeetings } from '@/features/agenda/queries.ts';
import { usePendingWakeups } from './queries.ts';

const WAKEUP_LIMIT = 6;

/** Right column: today's calls and the agent's next scheduled wakeups. */
export function TodayPanel() {
  const nav = useNavigate();
  const mt = useTodayMeetings();
  const wk = usePendingWakeups();
  const wakeups = [...(wk.data?.wakeups ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const live = mt.list.filter((m) => m.status !== 'cancelled');

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Panel
        title="calls de hoje"
        aside={live.length ? String(live.length) : undefined}
        actions={
          <Link to="/agenda" className="text-xs text-muted-foreground hover:text-foreground">
            agenda →
          </Link>
        }
      >
        {mt.isError && !mt.data ? (
          <ErrorState error={mt.error} onRetry={() => void mt.refetch()} className="py-4" />
        ) : mt.isPending ? (
          <LoadingRows rows={2} />
        ) : mt.list.length ? (
          <div className="flex flex-col gap-1.5">
            {mt.list.map((m) => (
              <MeetingRow key={m.id} m={m} tz={mt.tz} onOpen={() => nav(`/agenda?m=${m.id}`)} />
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="size-4" /> nenhuma call hoje
          </p>
        )}
      </Panel>

      <Panel
        flush
        title="próximos passos do agente"
        aside={wakeups.length ? String(wakeups.length) : undefined}
        actions={
          <Link to="/agente/planos" className="text-xs text-muted-foreground hover:text-foreground">
            planos →
          </Link>
        }
      >
        {wk.isError && !wk.data ? (
          <ErrorState error={wk.error} onRetry={() => void wk.refetch()} className="py-4" />
        ) : wk.isPending ? (
          <LoadingRows rows={2} className="p-3" />
        ) : wakeups.length ? (
          <ul className="divide-y">
            {wakeups.slice(0, WAKEUP_LIMIT).map((w) => (
              <li key={w.id} className="flex items-start gap-2.5 px-3 py-2">
                <AlarmClockCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex min-w-0 items-center gap-1.5 text-sm">
                    <Badge variant="agent-soft">{RUN_KIND_LABEL[w.kind] ?? w.kind}</Badge>
                    {w.leadId ? (
                      <Link to={`/pipeline/${w.leadId}`} className="truncate hover:underline">
                        {w.leadName ?? 'lead'}
                      </Link>
                    ) : (
                      <span className="truncate text-muted-foreground">workspace</span>
                    )}
                  </div>
                  {w.focus && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">{w.focus}</p>
                  )}
                </div>
                <span
                  className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tnum"
                  title={fmtDateTime(w.at)}
                >
                  {relDue(w.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-3 py-3 text-sm text-muted-foreground">nenhum wakeup agendado</p>
        )}
      </Panel>
    </div>
  );
}
