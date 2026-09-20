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

const fmtTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });

const STATUS_LABEL: Record<Meeting['status'], string> = {
  scheduled: 'marcada',
  done: 'feita',
  no_show: 'no-show',
  cancelled: 'cancelada',
};

export default function Calendar() {
  const [tz, setTz] = useState('America/Sao_Paulo');
  useEffect(() => {
    api
      .meetingsStatus()
      .then((s) => {
        setTz(s.cfg.tz);
        // Re-anchor the week only if the user hasn't navigated yet.
        setWeekStart((w) =>
          w.key === mondayOf(new Date(), tz).key ? mondayOf(new Date(), s.cfg.tz) : w,
        );
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date(), tz));
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  // Ignore late responses from superseded week requests — a slow previous
  // week must not overwrite the current one.
  const reqSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++reqSeq.current;
    setLoading(true);
    api
      .meetings({
        scope: 'all',
        // Pad the bounds by a day on each side — the grouping below only
        // renders tz-local days, so extra rows harmlessly land off-grid.
        from: new Date(Date.UTC(weekStart.y, weekStart.m - 1, weekStart.d) - DAY).toISOString(),
        to: new Date(Date.UTC(weekStart.y, weekStart.m - 1, weekStart.d) + 8 * DAY).toISOString(),
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
  }, [weekStart]);
  useEffect(load, [load]);

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
  const todayKey = dayKeyOf(new Date(), tz).key;

  const patch = (id: string, body: { status?: string }) =>
    api
      .patchMeeting(id, body)
      .then(load)
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'falha ao atualizar'));

  // Day-key → pt-BR label. A noon-UTC instant lands on the same calendar day
  // in every tz from UTC-12 to UTC+12, so labels never roll a day over.
  const dayLabel = (k: DayKey, opts: Intl.DateTimeFormatOptions) =>
    new Date(Date.UTC(k.y, k.m - 1, k.d, 12)).toLocaleDateString('pt-BR', opts);
  const weekLabel = `${days[0]!.d} ${dayLabel(days[0]!, { month: 'short' })} – ${days[6]!.d} ${dayLabel(days[6]!, { month: 'short' })}`;

  return (
    <Page
      title="Agenda"
      sub={`${meetings.filter((m) => m.status === 'scheduled').length} calls · ${weekLabel}`}
      actions={
        <>
          <button
            className="btn"
            onClick={() => setWeekStart((w) => shiftDay(w, -7))}
            aria-label="semana anterior"
          >
            <ChevronLeft size={14} />
          </button>
          <button className="btn" onClick={() => setWeekStart(mondayOf(new Date(), tz))}>
            hoje
          </button>
          <button
            className="btn"
            onClick={() => setWeekStart((w) => shiftDay(w, 7))}
            aria-label="próxima semana"
          >
            <ChevronRight size={14} />
          </button>
        </>
      }
    >
      {err && <div className="notice err">{err}</div>}
      {!loading && !meetings.length && (
        <Empty
          title="semana vazia"
          hint="calls marcadas pelo link de agendamento ou pelo agente aparecem aqui"
        />
      )}
      <div className="agenda">
        {days.map((d, i) => {
          const list = byDay.get(d.key) ?? [];
          const isToday = d.key === todayKey;
          return (
            <section key={d.key} className={`aday${isToday ? ' today' : ''}`}>
              <header>
                <span className="dow">{WD[i]}</span>
                <span className="dnum">{d.d}</span>
              </header>
              {list.map((m) => (
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
                  <div className="mtg-acts">
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
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </Page>
  );
}
