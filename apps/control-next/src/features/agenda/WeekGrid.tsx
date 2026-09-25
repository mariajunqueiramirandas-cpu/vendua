import { useEffect, useMemo, useRef } from 'react';
import { Bot } from 'lucide-react';
import type { Meeting } from '@/lib/api.ts';
import { cn } from '@/lib/cn.ts';
import { RoomLink, STATUS_BLOCK, meetingWho } from './meeting-ui.tsx';
import { WD, dayMinutes, fmtTime, type DayKey } from './tz.ts';

const HOUR_PX = 52;
const PX_PER_MIN = HOUR_PX / 60;

/** Desktop week: hour ruler + positioned blocks; overlapping calls share the column in lanes. */
export function WeekGrid({
  days,
  byDay,
  tz,
  todayKey,
  ready,
  onOpen,
}: {
  days: DayKey[];
  byDay: Map<string, Meeting[]>;
  tz: string;
  todayKey: string;
  ready: boolean;
  onOpen: (m: Meeting) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const span = useMemo(() => {
    let s = 8 * 60;
    let e = 19 * 60;
    for (const d of days) {
      for (const m of byDay.get(d.key) ?? []) {
        s = Math.min(s, dayMinutes(m.startsAt, tz) - 30);
        e = Math.max(e, dayMinutes(m.endsAt, tz) + 30);
      }
    }
    // snap to whole hours so the ruler labels align
    s = Math.max(0, Math.floor(Math.min(s, 20 * 60) / 60) * 60);
    e = Math.min(24 * 60, Math.ceil(Math.max(e, s + 4 * 60) / 60) * 60);
    return { s, e, hours: (e - s) / 60 };
  }, [days, byDay, tz]);

  const laneLayout = (list: Meeting[]) => {
    const ends: number[] = [];
    const laid = list.map((m) => {
      const st = Math.min(Math.max(dayMinutes(m.startsAt, tz), span.s), span.e - 5);
      const en = Math.min(Math.max(dayMinutes(m.endsAt, tz), st + 15), span.e);
      let lane = ends.findIndex((x) => x <= st);
      if (lane === -1) lane = ends.length;
      ends[lane] = en;
      return { m, st, en, lane };
    });
    return { laid, lanes: Math.max(ends.length, 1) };
  };

  // scroll anchor: 'now' in the live week, else the first upcoming call
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !ready) return;
    const inWeek = days.some((d) => d.key === todayKey);
    const now = new Date();
    const nowMin = dayMinutes(now.toISOString(), tz);
    const upcoming = days
      .flatMap((d) => byDay.get(d.key) ?? [])
      .filter((m) => m.status === 'scheduled' && new Date(m.endsAt).getTime() > now.getTime())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    let target = inWeek ? nowMin - 90 : 0;
    if (upcoming) target = Math.min(target, dayMinutes(upcoming.startsAt, tz) - 60);
    el.scrollTop = Math.max(0, (target - span.s) * PX_PER_MIN);
  }, [ready, days, byDay, tz, span.s, todayKey]);

  const bodyH = span.hours * HOUR_PX;
  const nowMin = dayMinutes(new Date().toISOString(), tz);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
      <div className="grid min-w-[44rem] grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]">
        <div className="sticky top-0 z-20 border-b bg-background" aria-hidden />
        {days.map((d, i) => {
          const today = d.key === todayKey;
          const n = (byDay.get(d.key) ?? []).filter((m) => m.status === 'scheduled').length;
          return (
            <header
              key={d.key}
              className="sticky top-0 z-20 flex h-11 items-center gap-1.5 border-b border-l bg-background px-2"
            >
              <span className="text-xs text-muted-foreground">{WD[i]}</span>
              <span
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded-full text-sm font-medium tnum',
                  today && 'bg-primary text-primary-foreground',
                )}
              >
                {d.d}
              </span>
              {n > 0 && <span className="ml-auto text-[11px] text-muted-foreground tnum">{n}</span>}
            </header>
          );
        })}

        <div className="relative" style={{ height: bodyH }} aria-hidden>
          {Array.from({ length: span.hours }, (_, i) => (
            <span
              key={i}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted-foreground tnum first:translate-y-0.5"
              style={{ top: i * HOUR_PX }}
            >
              {`${String(Math.floor(span.s / 60) + i).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>

        {days.map((d) => {
          const { laid, lanes } = laneLayout(byDay.get(d.key) ?? []);
          const today = d.key === todayKey;
          return (
            <div
              key={d.key}
              className={cn('relative border-l', today && 'bg-hover')}
              style={{ height: bodyH }}
            >
              {Array.from({ length: span.hours }, (_, i) => (
                <div
                  key={i}
                  aria-hidden
                  className="absolute inset-x-0 border-t border-dashed first:border-solid"
                  style={{ top: i * HOUR_PX }}
                />
              ))}
              {today && nowMin >= span.s && nowMin <= span.e && (
                <div
                  aria-hidden
                  className="absolute inset-x-0 z-10 h-0.5 bg-destructive before:absolute before:-top-[3px] before:-left-1 before:size-2 before:rounded-full before:bg-destructive"
                  style={{ top: (nowMin - span.s) * PX_PER_MIN }}
                />
              )}
              {laid.map(({ m, st, en, lane }) => {
                const h = Math.max((en - st) * PX_PER_MIN, 22);
                return (
                  <article
                    key={m.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(m)}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(m)}
                    title={`${fmtTime(m.startsAt, tz)}–${fmtTime(m.endsAt, tz)} · ${meetingWho(m)}`}
                    className={cn(
                      'absolute flex flex-col overflow-hidden rounded-md border border-l-[3px] px-1.5 py-0.5 text-xs shadow-xs ring-2 ring-background transition-colors hover:brightness-95 dark:hover:brightness-125',
                      h < 40 && 'justify-center',
                      STATUS_BLOCK[m.status],
                    )}
                    style={{
                      top: (st - span.s) * PX_PER_MIN,
                      height: h,
                      insetInlineStart: `calc(${(lane * 100) / lanes}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                  >
                    {h < 40 ? (
                      // 30-min calls: one line, time + who
                      <div className="flex items-center gap-1.5 leading-tight">
                        <span className="shrink-0 text-[11px] tnum opacity-80">
                          {fmtTime(m.startsAt, tz)}
                        </span>
                        <span className="mtg-who min-w-0 truncate font-medium">
                          {meetingWho(m)}
                        </span>
                        {m.source === 'agent' && (
                          <Bot className="size-3 shrink-0 text-muted-foreground" />
                        )}
                      </div>
                    ) : (
                      <div className="flex items-start gap-1">
                        <div className="min-w-0 flex-1">
                          <div className="text-[11px] leading-tight tnum opacity-80">
                            {fmtTime(m.startsAt, tz)}–{fmtTime(m.endsAt, tz)}
                          </div>
                          <div className="mtg-who truncate leading-snug font-medium">
                            {meetingWho(m)}
                          </div>
                          {h > 56 && m.bookerContact && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {m.bookerContact}
                            </div>
                          )}
                        </div>
                        {m.source === 'agent' && (
                          <Bot className="mt-px size-3 shrink-0 text-muted-foreground" />
                        )}
                      </div>
                    )}
                    {h > 44 && <RoomLink m={m} className="absolute right-0.5 bottom-0.5" />}
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
