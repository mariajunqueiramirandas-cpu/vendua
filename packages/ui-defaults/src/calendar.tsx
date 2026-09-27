import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

// Month calendar over store-local dates (YYYY-MM-DD strings — no timezone math:
// Core already answered which days are bookable). One tab stop; arrows move by
// day/week, Home/End to the week's ends, PageUp/PageDown by month, Enter/Space
// picks. Only `available` days are selectable; everything else is shown dimmed.

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const parse = (d: string) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
const monthKey = (d: string) => d.slice(0, 7);
const addMonths = (key: string, n: number) => {
  const [y, m] = key.split('-').map(Number);
  const x = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return iso(x).slice(0, 7);
};
/** Same day-of-month n months away, clamped to that month's length (31 jan → 28 fev). */
const sameDayInMonth = (d: string, n: number) => {
  const key = addMonths(monthKey(d), n);
  const [y, m] = key.split('-').map(Number);
  const len = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${key}-${String(Math.min(Number(d.slice(8)), len)).padStart(2, '0')}`;
};
const monthLabel = (key: string) => {
  const label = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(parse(`${key}-01`));
  // "Setembro de 2026" — only the first letter; CSS capitalize would give "De"
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const longLabel = (d: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(parse(d));

export interface CalendarProps {
  /** selectable YYYY-MM-DD dates (e.g. Core's bookable encomenda days) */
  available: string[];
  value: string | undefined;
  onChange: (date: string) => void;
  /** accessible name of the grid */
  label?: string;
  /** e.g. "2026-09-27" — marked as today; defaults to the first available day's month */
  today?: string;
}

export function Calendar({
  available,
  value,
  onChange,
  label = 'Calendário',
  today,
}: CalendarProps) {
  const set = useMemo(() => new Set(available), [available]);
  const sorted = useMemo(() => [...available].sort(), [available]);
  const first = sorted[0];
  const last = sorted.at(-1);
  const [month, setMonth] = useState(() => monthKey(value ?? first ?? today ?? iso(new Date())));
  const [focus, setFocus] = useState<string | undefined>(value ?? first);
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  // keep the view on the selection when it changes from outside
  useEffect(() => {
    if (value) {
      setMonth(monthKey(value));
      setFocus(value);
    }
  }, [value]);

  // after keyboard navigation, move DOM focus to the roving day
  useEffect(() => {
    if (!moved.current || !focus) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focus}"]`)?.focus();
  }, [focus, month]);

  const minMonth = first ? monthKey(first) : month;
  const maxMonth = last ? monthKey(last) : month;

  const weeks = useMemo(() => {
    const start = parse(`${month}-01`);
    const lead = start.getUTCDay();
    const days: (string | null)[] = Array.from({ length: lead }, () => null);
    for (let d = new Date(start); iso(d).startsWith(month); d.setUTCDate(d.getUTCDate() + 1))
      days.push(iso(d));
    while (days.length % 7) days.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [month]);

  // the one tab stop: the focused day if it's in view, else the first selectable one
  const inView = (d?: string) => d !== undefined && monthKey(d) === month;
  const tabStop = inView(focus)
    ? focus
    : (weeks.flat().find((d) => d && set.has(d)) ?? weeks.flat().find(Boolean) ?? undefined);

  const go = (next: string) => {
    if (first && next < first) next = first;
    if (last && next > last) next = last;
    moved.current = true;
    setFocus(next);
    setMonth(monthKey(next));
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, d: string) => {
    const dow = parse(d).getUTCDay();
    const step: Record<string, () => string> = {
      ArrowLeft: () => addDays(d, -1),
      ArrowRight: () => addDays(d, 1),
      ArrowUp: () => addDays(d, -7),
      ArrowDown: () => addDays(d, 7),
      Home: () => addDays(d, -dow),
      End: () => addDays(d, 6 - dow),
      PageUp: () => sameDayInMonth(d, -1),
      PageDown: () => sameDayInMonth(d, 1),
    };
    const fn = step[e.key];
    if (!fn) return;
    e.preventDefault();
    go(fn());
  };

  return (
    <div className="v-calendar" data-vendua="calendar" data-part="calendar">
      <div className="v-calendar-head" data-part="calendar-head">
        <button
          type="button"
          className="v-calendar-nav"
          aria-label="Mês anterior"
          disabled={month <= minMonth}
          onClick={() => setMonth(addMonths(month, -1))}
        >
          ‹
        </button>
        <p className="v-calendar-month" aria-live="polite" id={`v-cal-${month}`}>
          {monthLabel(month)}
        </p>
        <button
          type="button"
          className="v-calendar-nav"
          aria-label="Próximo mês"
          disabled={month >= maxMonth}
          onClick={() => setMonth(addMonths(month, 1))}
        >
          ›
        </button>
      </div>
      <table
        ref={grid}
        className="v-calendar-grid"
        role="grid"
        aria-label={`${label}, ${monthLabel(month)}`}
      >
        <thead>
          <tr>
            {WEEKDAYS.map((w, i) => (
              <th key={w} scope="col" abbr={WEEKDAYS_LONG[i]}>
                {w}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((d, di) =>
                d ? (
                  <td key={d} role="gridcell" aria-selected={d === value}>
                    <button
                      type="button"
                      className="v-calendar-day"
                      data-date={d}
                      data-selected={d === value || undefined}
                      data-today={d === today || undefined}
                      // aria-disabled, not disabled: keyboard focus must be able to pass through
                      aria-disabled={!set.has(d) || undefined}
                      aria-label={`${longLabel(d)}${set.has(d) ? '' : ', indisponível'}`}
                      aria-pressed={d === value}
                      tabIndex={d === tabStop ? 0 : -1}
                      onClick={() => {
                        setFocus(d);
                        if (set.has(d)) onChange(d);
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && set.has(d)) {
                          e.preventDefault();
                          onChange(d);
                          return;
                        }
                        onKey(e, d);
                      }}
                    >
                      {Number(d.slice(8))}
                    </button>
                  </td>
                ) : (
                  <td key={`e${wi}-${di}`} aria-hidden="true" />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
