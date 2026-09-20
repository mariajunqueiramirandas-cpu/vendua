import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, Video, X } from 'lucide-react';
import { api, ApiError, type Meeting } from '../api.ts';
import { ConfirmBtn, Empty, Page } from '../components.tsx';

const DAY = 86_400_000;
const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  // JS getDay: 0=Sun — our grid starts Monday, so Sunday belongs to the
  // previous week (-6), Mon→0, …, Sat→5.
  return new Date(x.getTime() - ((x.getDay() + 6) % 7) * DAY);
}
function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const STATUS_LABEL: Record<Meeting['status'], string> = {
  scheduled: 'marcada',
  done: 'feita',
  no_show: 'no-show',
  cancelled: 'cancelada',
};

export default function Calendar() {
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api
      .meetings({
        scope: 'all',
        from: weekStart.toISOString(),
        to: new Date(weekStart.getTime() + 7 * DAY).toISOString(),
      })
      .then((r) => {
        setMeetings(r.meetings);
        setErr('');
      })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'falha ao carregar'))
      .finally(() => setLoading(false));
  }, [weekStart]);
  useEffect(load, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, Meeting[]>();
    for (const mt of meetings) {
      const k = localDayKey(new Date(mt.startsAt));
      m.set(k, [...(m.get(k) ?? []), mt]);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return m;
  }, [meetings]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(weekStart.getTime() + i * DAY)),
    [weekStart],
  );
  const todayKey = localDayKey(new Date());

  const patch = (id: string, body: { status?: string }) =>
    api
      .patchMeeting(id, body)
      .then(load)
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'falha ao atualizar'));

  const weekLabel = `${days[0]!.getDate()} ${days[0]!.toLocaleDateString('pt-BR', { month: 'short' })} – ${days[6]!.getDate()} ${days[6]!.toLocaleDateString('pt-BR', { month: 'short' })}`;

  return (
    <Page
      title="Agenda"
      sub={`${meetings.filter((m) => m.status === 'scheduled').length} calls · ${weekLabel}`}
      actions={
        <>
          <button
            className="btn"
            onClick={() => setWeekStart((w) => new Date(w.getTime() - 7 * DAY))}
            aria-label="semana anterior"
          >
            <ChevronLeft size={14} />
          </button>
          <button className="btn" onClick={() => setWeekStart(mondayOf(new Date()))}>
            hoje
          </button>
          <button
            className="btn"
            onClick={() => setWeekStart((w) => new Date(w.getTime() + 7 * DAY))}
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
          const list = byDay.get(localDayKey(d)) ?? [];
          const isToday = localDayKey(d) === todayKey;
          return (
            <section key={d.toISOString()} className={`aday${isToday ? ' today' : ''}`}>
              <header>
                <span className="dow">{WD[i]}</span>
                <span className="dnum">{d.getDate()}</span>
              </header>
              {list.map((m) => (
                <article key={m.id} className={`mtg st-${m.status}`}>
                  <div className="mtg-time">
                    {fmtTime(m.startsAt)}–{fmtTime(m.endsAt)}
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
