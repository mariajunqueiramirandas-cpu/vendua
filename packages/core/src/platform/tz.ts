// wall-clock ↔ instant helpers for one IANA zone via Intl — one correction
// pass absorbs offset drift so a DST-transitioning zone still lands right

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number; // day of month
  weekday: number; // 0=Sun … 6=Sat
}

export interface LocalParts extends LocalDate {
  hour: number;
  minute: number;
  second: number;
  /** minutes since local midnight */
  minutes: number;
}

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function assertTz(tz: string): string {
  // Intl throws RangeError on unknown zones — normalize to our error shape.
  try {
    dtf(tz).format(new Date());
  } catch {
    throw new Error(`unknown timezone: ${tz}`);
  }
  return tz;
}

export function localParts(instant: Date, tz: string): LocalParts {
  const parts = dtf(tz).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY[get('weekday')] ?? 0,
    hour,
    minute,
    second: Number(get('second')),
    minutes: hour * 60 + minute,
  };
}

// ms the zone's wall clock leads UTC at `instant` (seconds resolution is enough)
function tzOffsetMs(instant: Date, tz: string): number {
  const p = localParts(instant, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant.getTime() / 1000) * 1000;
}

// instant for wall time `minutes`-after-midnight on `date` in `tz` — one
// correction pass lands slots straddling a DST jump on the right minute
export function zonedInstant(tz: string, date: LocalDate, minutes: number): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, 0, minutes);
  let t = guess - tzOffsetMs(new Date(guess), tz);
  const second = tzOffsetMs(new Date(t), tz);
  const corrected = guess - second;
  if (corrected !== t) t = corrected;
  return new Date(t);
}

export function localDateOf(instant: Date, tz: string): LocalDate {
  const p = localParts(instant, tz);
  return { year: p.year, month: p.month, day: p.day, weekday: p.weekday };
}

// `n` days after `date` — epoch arithmetic so DST can't skip/double a day
export function addDays(date: LocalDate, n: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + n));
  const local = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  return { ...local, weekday: d.getUTCDay() };
}

export function hhmmToMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
