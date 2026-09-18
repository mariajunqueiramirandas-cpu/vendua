import { useStore, StoreStatusBadge } from '@vendua/kernel';
import { hhmm, localDayNow, localMinutesNow, resumeLabel, toMinutes } from './format.ts';

/**
 * The fornada strip — the storefront's spine. A 24h bar with the bake window
 * lit and a needle at "now"; the closed state reads natively here.
 */
export function DayClock({ compact = false }: { compact?: boolean }) {
  const { store, status, resumesAt } = useStore();
  const tz = store?.hours.timezone ?? 'America/Sao_Paulo';

  const nowMin = localMinutesNow(tz);
  const day = localDayNow(tz);
  const windows = (store?.hours.windows ?? []).filter((w) => w.days.includes(day));

  const spans = windows.flatMap((w) => {
    const o = toMinutes(w.open);
    const c = toMinutes(w.close);
    return c > o
      ? [{ left: (o / 1440) * 100, width: ((c - o) / 1440) * 100 }]
      : [
          { left: (o / 1440) * 100, width: ((1440 - o) / 1440) * 100 },
          { left: 0, width: (c / 1440) * 100 },
        ];
  });

  const statusLine =
    status === 'open'
      ? `no balcão até ${hhmm(windows[0]?.close ?? '') || '—'}`
      : status === 'paused'
        ? 'pausada — a fornada espera'
        : resumesAt
          ? `a forn dorme · volta ${resumeLabel(resumesAt, tz)}`
          : 'a forn dorme';

  return (
    <div className={compact ? 'dial' : 'dial'} aria-label="horário da fornada">
      <div className="dial-track-wrap">
        <div className="dial-track" role="img" aria-label={statusLine}>
          {spans.map((s, i) => (
            <span key={i} className="dial-window" style={{ left: `${s.left}%`, width: `${s.width}%` }} />
          ))}
          <span className="dial-needle" style={{ left: `${(nowMin / 1440) * 100}%` }} />
        </div>
        <div className="dial-hours microcaps" aria-hidden="true">
          <span>00h</span>
          <span>06h</span>
          <span>12h</span>
          <span>18h</span>
          <span>24h</span>
        </div>
      </div>
      <div className="dial-foot">
        <span className="dial-status">
          <StoreStatusBadge />
          <span>{statusLine}</span>
        </span>
        <span className="dial-next mono">
          {windows.map((w) => `fornada ${hhmm(w.open)}–${hhmm(w.close)}`).join(' + ')}
        </span>
      </div>
    </div>
  );
}
