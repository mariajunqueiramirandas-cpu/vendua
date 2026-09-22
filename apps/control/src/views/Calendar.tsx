import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Video, X } from 'lucide-react';
import { api, ApiError, type Meeting } from '../api.ts';
import { ConfirmBtn, Empty, Page } from '../components.tsx';

const DAY = 86_400_000;
const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

// Meetings live in the configured meeting tz, not the browser's — staff
// outside America/Sao_Paulo would otherwise see calls on shifted days.
// A DayKey is a calendar-day identity in that tz (not an instant).
interface DayKey {
  y: number;
  m: number;
  d: number;
  key: string;
  /** weekday 0=Sun … 6=Sat, from the tz-local date */
  wd: number;
}

const WD_IDX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function dayKeyOf(d: Date, tz: string): DayKey {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    wd: WD_IDX[get('weekday')] ?? 0,
    key: `${get('year')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`,
  };
}

/** Pure calendar-day arithmetic on the tz-local identity (no tz involved). */
function shiftDay(k: DayKey, days: number): DayKey {
  const x = new Date(Date.UTC(k.y, k.m - 1, k.d) + days * DAY);
  return {
    y: x.getUTCFullYear(),
    m: x.getUTCMonth() + 1,
    d: x.getUTCDate(),
    wd: x.getUTCDay(),
    key: `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`,
  };
}

function mondayOf(d: Date, tz: string): DayKey {
  const k = dayKeyOf(d, tz);
  return shiftDay(k, -((k.wd + 6) % 7));
}

const mkDay = (x: Date): DayKey => ({
  y: x.getUTCFullYear(),
  m: x.getUTCMonth() + 1,
  d: x.getUTCDate(),
  wd: x.getUTCDay(),
  key: `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`,
});
const firstOfMonth = (k: DayKey) => mkDay(new Date(Date.UTC(k.y, k.m - 1, 1)));
const shiftMonth = (k: DayKey, n: number) => mkDay(new Date(Date.UTC(k.y, k.m - 1 + n, 1)));
const daysInMonth = (k: DayKey) => new Date(Date.UTC(k.y, k.m, 0)).getUTCDate();
const dayInstant = (k: DayKey) => new Date(Date.UTC(k.y, k.m - 1, k.d)).toISOString();

const fmtTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });

/** Minutes since midnight in the meeting tz — the week grid's y-axis. */
const dayMinutes = (iso: string, tz: string) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Math.min(v('hour'), 23.99) * 60 + v('minute');
};

const STATUS_LABEL: Record<Meeting['status'], string> = {
  scheduled: 'marcada',
  done: 'feita',
  no_show: 'no-show',
  cancelled: 'cancelada',
};

const MOBILE_MQ = '(max-width: 760px)';

export default function Calendar() {
  const [tz, setTz] = useState('America/Sao_Paulo');
  const [mobile, setMobile] = useState(() => matchMedia(MOBILE_MQ).matches);
  useEffect(() => {
    const mq = matchMedia(MOBILE_MQ);
    const f = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  useEffect(() => {
    api
      .meetingsStatus()
      .then((s) => {
        setTz(s.cfg.tz);
        // Re-anchor only if the user hasn't navigated yet.
        setWeekStart((w) =>
          w.key === mondayOf(new Date(), tz).key ? mondayOf(new Date(), s.cfg.tz) : w,
        );
        setMonthStart((m) =>
          m.key === firstOfMonth(dayKeyOf(new Date(), tz)).key
            ? firstOfMonth(dayKeyOf(new Date(), s.cfg.tz))
            : m,
        );
        setSel((d) =>
          d.key === dayKeyOf(new Date(), tz).key ? dayKeyOf(new Date(), s.cfg.tz) : d,
        );
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date(), tz));
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(dayKeyOf(new Date(), tz)));
  const [sel, setSel] = useState<DayKey>(() => dayKeyOf(new Date(), tz));
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Ignore late responses from superseded week requests — a slow previous
  // week must not overwrite the current one.
  const reqSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    setLoading(true);
    // Fetch what the current mode renders: the week strip on desktop, the
    // whole visible month grid on phones. Pad the bounds by a day on each
    // side — grouping renders tz-local days, so extra rows land off-grid.
    const pad = (monthStart.wd + 6) % 7;
    const gridStart = shiftDay(monthStart, -pad);
    const gridDays = Math.ceil((pad + daysInMonth(monthStart)) / 7) * 7;
    const from = mobile ? shiftDay(gridStart, -1) : shiftDay(weekStart, -1);
    const to = mobile ? shiftDay(gridStart, gridDays + 1) : shiftDay(weekStart, 8);
    api
      .meetings({
        scope: 'all',
        from: dayInstant(from),
        to: dayInstant(to),
      })
      .then((r) => {
        if (seq !== reqSeq.current) return;
        setMeetings(r.meetings);
        setErr('');
      })
      .catch((e) => {
        if (seq !== reqSeq.current) return;
        setErr(e instanceof ApiError ? e.message : 'falha ao carregar');
      })
      .finally(() => {
        if (seq !== reqSeq.current) return;
        setLoading(false);
      });
  }, [weekStart, monthStart, mobile]);
  useEffect(load, [load]);
  // patch() runs after the PATCH resolves — possibly after the user has
  // navigated away. Calling the captured `load` would refetch the OLD
  // window and (with a newer reqSeq) overwrite the current view. Always
  // refresh through the ref so the reload targets the displayed period.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Meeting[]>();
    for (const mt of meetings) {
      const k = dayKeyOf(new Date(mt.startsAt), tz).key;
      m.set(k, [...(m.get(k) ?? []), mt]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return m;
  }, [meetings, tz]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftDay(weekStart, i)),
    [weekStart],
  );
  // Month-grid cells: Monday-leading rows covering the whole month, padded
  // with the neighboring months' days so the grid stays rectangular.
  const cells = useMemo(() => {
    const pad = (monthStart.wd + 6) % 7;
    const n = Math.ceil((pad + daysInMonth(monthStart)) / 7) * 7;
    const start = shiftDay(monthStart, -pad);
    return Array.from({ length: n }, (_, i) => shiftDay(start, i));
  }, [monthStart]);
  const todayKey = dayKeyOf(new Date(), tz).key;

  // ---- week grid geometry (desktop): shared hour ruler + positioned lanes ----
  const HOUR_PX = 54;
  const PX_PER_MIN = HOUR_PX / 60;
  const span = useMemo(() => {
    let s = 8 * 60;
    let e = 19 * 60;
    for (const d of days) {
      for (const m of byDay.get(d.key) ?? []) {
        s = Math.min(s, dayMinutes(m.startsAt, tz) - 30);
        e = Math.max(e, dayMinutes(m.endsAt, tz) + 30);
      }
    }
    // Snap to whole hours — the ruler labels each hour row, so a partial
    // start would offset every label below it.
    s = Math.max(0, Math.floor(Math.min(s, 20 * 60) / 60) * 60);
    e = Math.min(24 * 60, Math.ceil(Math.max(e, s + 4 * 60) / 60) * 60);
    return { s, e, hours: (e - s) / 60 };
  }, [days, byDay, tz]);
  // Greedy lane assignment per day: overlapping calls sit side by side —
  // every card keeps its own full lane instead of stacking illegibly.
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
  // Anchor the pane on the interesting part of the day: 'now' when viewing
  // the live week, otherwise the first call — so a 22:00 booking doesn't
  // leave staff staring at an empty morning.
  useEffect(() => {
    if (mobile || loading) return;
    const el = scrollRef.current;
    if (!el) return;
    const inWeek = days.some((d) => d.key === todayKey);
    const now = new Date();
    const nowMin = dayMinutes(now.toISOString(), tz);
    const upcoming = days
      .flatMap((d) => byDay.get(d.key) ?? [])
      .filter((m) => m.status === 'scheduled' && new Date(m.endsAt).getTime() > now.getTime())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    // 'now' normally anchors; an upcoming call earlier pulls the anchor up
    // so it lands on screen too.
    let target = inWeek ? nowMin - 90 : 0;
    if (upcoming) target = Math.min(target, dayMinutes(upcoming.startsAt, tz) - 60);
    el.scrollTop = Math.max(0, (target - span.s) * PX_PER_MIN);
  }, [mobile, loading, days, byDay, tz, span.s, todayKey]);

  const patch = (id: string, body: { status?: string }) =>
    api
      .patchMeeting(id, body)
      .then(() => loadRef.current())
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'falha ao atualizar'));

  // Day-key → pt-BR label. The key is a calendar-day identity, not an
  // instant — format in UTC or UTC+13/+14 browsers would read a month-
  // boundary cell as the next day ("31 de fevereiro").
  const dayLabel = (k: DayKey, opts: Intl.DateTimeFormatOptions) =>
    new Date(Date.UTC(k.y, k.m - 1, k.d, 12)).toLocaleDateString('pt-BR', {
      ...opts,
      timeZone: 'UTC',
    });
  const weekLabel = `${days[0]!.d} ${dayLabel(days[0]!, { month: 'short' })} – ${days[6]!.d} ${dayLabel(days[6]!, { month: 'short' })}`;
  const monthLabel = dayLabel(monthStart, { month: 'long', year: 'numeric' });
  // Count only calls whose tz-local day has a visible cell — the fetch
  // window is padded beyond the grid, so raw-length counts inflate.
  const visibleKeys = useMemo(
    () => new Set((mobile ? cells : days).map((d) => d.key)),
    [mobile, cells, days],
  );
  const scheduledCount = meetings.filter(
    (m) => m.status === 'scheduled' && visibleKeys.has(dayKeyOf(new Date(m.startsAt), tz).key),
  ).length;
  const sub = `${scheduledCount} calls · ${mobile ? monthLabel : weekLabel}`;

  const gotoToday = () => {
    const t = dayKeyOf(new Date(), tz);
    setWeekStart(mondayOf(new Date(), tz));
    setMonthStart(firstOfMonth(t));
    setSel(t);
  };
  const gotoMonth = (n: number) => {
    const m = shiftMonth(monthStart, n);
    setMonthStart(m);
    // Keep the selected day in view — same day-of-month in the new month.
    setSel((s) => mkDay(new Date(Date.UTC(m.y, m.m - 1, Math.min(s.d, daysInMonth(m))))));
  };
  const navBack = () => (mobile ? gotoMonth(-1) : setWeekStart((w) => shiftDay(w, -7)));
  const navFwd = () => (mobile ? gotoMonth(1) : setWeekStart((w) => shiftDay(w, 7)));

  const mtgActs = (m: Meeting) => (
    <>
      {m.roomUrl && m.status === 'scheduled' && (
        <a
          className="icon-btn"
          href={m.roomUrl}
          target="_blank"
          rel="noopener"
          title="abrir sala"
          aria-label="abrir sala"
        >
          <Video size={13} />
        </a>
      )}
      {m.status === 'scheduled' && (
        <>
          <button
            className="icon-btn"
            title="marcar como feita"
            aria-label="marcar como feita"
            onClick={() => void patch(m.id, { status: 'done' })}
          >
            <Check size={13} />
          </button>
          <button
            className="icon-btn"
            title="no-show"
            aria-label="no-show"
            onClick={() => void patch(m.id, { status: 'no_show' })}
          >
            <X size={13} />
          </button>
          <ConfirmBtn
            className="icon-btn"
            confirm="cancelar?"
            onConfirm={() => void patch(m.id, { status: 'cancelled' })}
          >
            ✕
          </ConfirmBtn>
        </>
      )}
      {m.status === 'done' && (
        <button
          className="icon-btn"
          title="foi no-show"
          aria-label="corrigir: foi no-show"
          onClick={() => void patch(m.id, { status: 'no_show' })}
        >
          <X size={13} />
        </button>
      )}
      {m.status === 'no_show' && (
        <button
          className="icon-btn"
          title="foi realizada"
          aria-label="corrigir: foi realizada"
          onClick={() => void patch(m.id, { status: 'done' })}
        >
          <Check size={13} />
        </button>
      )}
    </>
  );

  const mtgCard = (m: Meeting) => (
    <article key={m.id} className={`mtg st-${m.status}`}>
      <div className="mtg-time">
        {fmtTime(m.startsAt, tz)}–{fmtTime(m.endsAt, tz)}
      </div>
      <div className="mtg-lead">
        {m.leadId ? (
          <Link to={`/leads/${m.leadId}`}>{m.leadName ?? m.bookerName ?? 'lead'}</Link>
        ) : (
          (m.bookerName ?? '—')
        )}
        <span className={`chip stc-${m.status}`}>{STATUS_LABEL[m.status]}</span>
      </div>
      {m.bookerContact && <div className="mtg-meta">{m.bookerContact}</div>}
      <div className="mtg-acts">{mtgActs(m)}</div>
    </article>
  );

  const dayCard = (d: DayKey, wdLabel: string, cls = '') => {
    const list = byDay.get(d.key) ?? [];
    const isToday = d.key === todayKey;
    return (
      <section key={d.key} className={`aday${isToday ? ' today' : ''}${cls}`}>
        <header>
          <span className="dow">{wdLabel}</span>
          <span className="dnum">{d.d}</span>
        </header>
        {list.map(mtgCard)}
        {!list.length && (isToday || cls === ' msel') && (
          <p className="aday-free">livre{isToday ? ' hoje' : ''}</p>
        )}
      </section>
    );
  };

  return (
    <Page
      title="Agenda"
      sub={sub}
      actions={
        <div className="cal-nav">
          <button
            className="btn"
            onClick={navBack}
            aria-label={mobile ? 'mês anterior' : 'semana anterior'}
          >
            <ChevronLeft size={14} />
          </button>
          <button className="btn" onClick={gotoToday}>
            hoje
          </button>
          <button
            className="btn"
            onClick={navFwd}
            aria-label={mobile ? 'próximo mês' : 'próxima semana'}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      }
    >
      {err && <div className="notice err">{err}</div>}
      {!loading && !meetings.length && !mobile && (
        <Empty
          title="semana vazia"
          hint="calls marcadas pelo link de agendamento ou pelo agente aparecem aqui"
        />
      )}
      {mobile ? (
        <div className="mwrap">
          <div className="mgrid">
            {WD.map((w) => (
              <span key={w} className="mgdow">
                {w}
              </span>
            ))}
            {cells.map((c) => {
              const list = (byDay.get(c.key) ?? []).filter((m) => m.status !== 'cancelled');
              const isSel = c.key === sel.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  className={`mcell${c.m !== monthStart.m ? ' out' : ''}${c.key === todayKey ? ' today' : ''}${isSel ? ' sel' : ''}`}
                  onClick={() => setSel(c)}
                  aria-pressed={isSel}
                  aria-label={`${c.d} de ${dayLabel(c, { month: 'long', year: 'numeric' })} — ${list.length ? `${list.length} call${list.length > 1 ? 's' : ''}` : 'livre'}`}
                >
                  <span className="mnum">{c.d}</span>
                  {!!list.length && (
                    <span className="mdots" aria-hidden>
                      {list.slice(0, 3).map((m) => (
                        <i key={m.id} className={`st-${m.status}`} />
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {dayCard(sel, WD[(sel.wd + 6) % 7] ?? '', ' msel')}
        </div>
      ) : (
        <div className="cal-scroll" ref={scrollRef}>
          <div className="aggrid" style={{ ['--hh' as string]: `${HOUR_PX}px` }}>
            <div className="ag-corner" aria-hidden />
            {days.map((d, i) => (
              <header key={d.key} className={`ag-dayhead${d.key === todayKey ? ' today' : ''}`}>
                <span className="dow">{WD[i]}</span>
                <span className="dnum">{d.d}</span>
              </header>
            ))}
            <div className="ag-times" aria-hidden>
              {Array.from({ length: span.hours }, (_, i) => (
                <span key={i} style={{ top: `${i * HOUR_PX}px` }}>
                  {`${String(Math.floor(span.s / 60) + i).padStart(2, '0')}:00`}
                </span>
              ))}
            </div>
            {days.map((d) => {
              const { laid, lanes } = laneLayout(byDay.get(d.key) ?? []);
              const isToday = d.key === todayKey;
              const nowMin = isToday ? dayMinutes(new Date().toISOString(), tz) : null;
              return (
                <div
                  key={d.key}
                  className={`ag-day${isToday ? ' today' : ''}`}
                  style={{ height: `${span.hours * HOUR_PX}px` }}
                >
                  {nowMin !== null && nowMin >= span.s && nowMin <= span.e && (
                    <div
                      className="ag-now"
                      style={{ top: `${(nowMin - span.s) * PX_PER_MIN}px` }}
                    />
                  )}
                  {laid.map(({ m, st, en, lane }) => (
                    <article
                      key={m.id}
                      className={`ag-mtg st-${m.status}`}
                      style={{
                        top: `${(st - span.s) * PX_PER_MIN}px`,
                        height: `${Math.max((en - st) * PX_PER_MIN, 22)}px`,
                        insetInlineStart: `${(lane * 100) / lanes}%`,
                        width: `${100 / lanes}%`,
                      }}
                    >
                      <div className="mtg-time">
                        {fmtTime(m.startsAt, tz)}–{fmtTime(m.endsAt, tz)}
                      </div>
                      <div className="mtg-lead">
                        {m.leadId ? (
                          <Link to={`/leads/${m.leadId}`}>
                            {m.leadName ?? m.bookerName ?? 'lead'}
                          </Link>
                        ) : (
                          (m.bookerName ?? '—')
                        )}
                        <span className={`chip stc-${m.status}`}>{STATUS_LABEL[m.status]}</span>
                      </div>
                      {m.bookerContact && <div className="mtg-meta">{m.bookerContact}</div>}
                      <div className="mtg-acts">{mtgActs(m)}</div>
                    </article>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Page>
  );
}
