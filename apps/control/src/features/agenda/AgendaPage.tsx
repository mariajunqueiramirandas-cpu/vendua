import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Meeting } from '@/lib/api.ts';
import { useIsMobile } from '@/lib/hooks.ts';
import { cn } from '@/lib/cn.ts';
import { Page } from '@/components/Page.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common.tsx';
import { MeetingRow, MeetingSheet, STATUS_DOT } from './meeting-ui.tsx';
import { MeetingsStatusChip } from './StatusChip.tsx';
import { useMeetingTz, useMeetingsRange } from './queries.ts';
import { WD, dayKeyOf, dayLabel, mondayOfKey, parseDayKey, shiftDay, type DayKey } from './tz.ts';
import { WeekGrid } from './WeekGrid.tsx';

/**
 * `?d=YYYY-MM-DD` is the focused day (desktop shows its week, phones select it);
 * `?m=<id>` opens a meeting. No `d` means "today in the meeting tz", so the view
 * re-anchors when the tz loads without clobbering a day the user navigated to.
 */
export default function AgendaPage() {
  const mobile = useIsMobile();
  const tz = useMeetingTz();
  const [sp, setSp] = useSearchParams();
  const today = dayKeyOf(new Date(), tz);
  const sel = parseDayKey(sp.get('d')) ?? today;
  const weekStart = mondayOfKey(sel);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftDay(weekStart, i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekStart.key],
  );
  const q = useMeetingsRange(days[0]!, shiftDay(days[6]!, 1));
  const meetings = useMemo(() => q.data?.meetings ?? [], [q.data]);

  const byDay = useMemo(() => {
    const m = new Map<string, Meeting[]>();
    for (const mt of meetings) {
      const k = dayKeyOf(new Date(mt.startsAt), tz).key;
      m.set(k, [...(m.get(k) ?? []), mt]);
    }
    for (const list of m.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return m;
  }, [meetings, tz]);

  const update = (patch: Record<string, string | null>) =>
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v == null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: 'm' in patch && patch.m === null },
    );
  const goto = (k: DayKey) => update({ d: k.key === today.key ? null : k.key });
  const open = (m: Meeting) => update({ m: m.id });
  const openId = sp.get('m');
  const opened = openId ? (meetings.find((m) => m.id === openId) ?? null) : null;

  // count only calls on visible cells — the fetch window is padded beyond the week
  const visible = new Set(days.map((d) => d.key));
  const scheduled = meetings.filter(
    (m) => m.status === 'scheduled' && visible.has(dayKeyOf(new Date(m.startsAt), tz).key),
  ).length;
  const weekLabel = `${days[0]!.d} ${dayLabel(days[0]!, { month: 'short' })} – ${days[6]!.d} ${dayLabel(days[6]!, { month: 'short' })}`;
  const inThisWeek = days.some((d) => d.key === today.key);

  const nav = (
    <div className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => goto(shiftDay(sel, -7))}
        aria-label="semana anterior"
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() => goto(today)}
        disabled={sel.key === today.key}
      >
        hoje
      </Button>
      <Button
        variant="outline"
        size="icon-sm"
        onClick={() => goto(shiftDay(sel, 7))}
        aria-label="próxima semana"
      >
        <ChevronRight />
      </Button>
    </div>
  );

  const toolbar = (
    <div className="flex items-center gap-2">
      {nav}
      <span className="truncate text-sm font-medium">{weekLabel}</span>
      <span className="text-xs text-muted-foreground tnum">
        {scheduled} call{scheduled === 1 ? '' : 's'}
      </span>
      <div className="ml-auto">
        <MeetingsStatusChip />
      </div>
    </div>
  );

  let body;
  if (q.isError && !q.data) body = <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  else if (mobile) {
    const list = byDay.get(sel.key) ?? [];
    body = (
      <div className="flex flex-col">
        <div className="grid grid-cols-7 gap-1 border-b px-2 py-2">
          {days.map((d, i) => {
            const n = (byDay.get(d.key) ?? []).filter((m) => m.status !== 'cancelled');
            const isSel = d.key === sel.key;
            return (
              <button
                key={d.key}
                type="button"
                onClick={() => goto(d)}
                aria-pressed={isSel}
                aria-label={`${dayLabel(d, { weekday: 'long', day: 'numeric', month: 'long' })} — ${n.length ? `${n.length} call${n.length > 1 ? 's' : ''}` : 'livre'}`}
                className={cn(
                  'flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-muted-foreground transition-colors',
                  isSel ? 'bg-primary text-primary-foreground' : 'active:bg-hover',
                )}
              >
                <span className="text-[11px]">{WD[i]}</span>
                <span
                  className={cn(
                    'text-base leading-none font-medium tnum',
                    !isSel && 'text-foreground',
                    !isSel && d.key === today.key && 'underline decoration-2 underline-offset-4',
                  )}
                >
                  {d.d}
                </span>
                <span className="flex h-1.5 gap-0.5" aria-hidden>
                  {n.slice(0, 3).map((m) => (
                    <i
                      key={m.id}
                      className={cn(
                        'size-1.5 rounded-full',
                        isSel ? 'bg-primary-foreground' : STATUS_DOT[m.status],
                      )}
                    />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 p-3">
          <h2 className="text-[13px] font-semibold">
            {dayLabel(sel, { weekday: 'long', day: 'numeric', month: 'long' })}
            {sel.key === today.key && (
              <span className="ml-1.5 font-normal text-muted-foreground">· hoje</span>
            )}
          </h2>
          {q.isPending ? (
            <LoadingRows rows={3} />
          ) : list.length ? (
            list.map((m) => <MeetingRow key={m.id} m={m} tz={tz} onOpen={open} />)
          ) : (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              livre{sel.key === today.key ? ' hoje' : ''}
            </p>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {!q.isPending && !scheduled && !meetings.length && (
          <EmptyState
            icon={CalendarDays}
            className="border-b py-3"
            title={inThisWeek ? 'semana livre' : 'semana vazia'}
            hint="calls marcadas pelo link de agendamento ou pelo agente aparecem aqui"
          />
        )}
        <WeekGrid
          days={days}
          byDay={byDay}
          tz={tz}
          todayKey={today.key}
          ready={!q.isPending}
          onOpen={open}
        />
      </>
    );
  }

  return (
    <Page title="Agenda" toolbar={toolbar} bleed>
      {mobile ? <div className="min-h-0 flex-1 overflow-auto">{body}</div> : body}
      <MeetingSheet meeting={opened} tz={tz} onClose={() => update({ m: null })} />
    </Page>
  );
}
