const DAY = 86_400_000;

export const WD = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
export const DEFAULT_TZ = 'America/Sao_Paulo';

/** Calendar-day identity in the meeting tz, not the browser's (off-tz staff would see shifted days). */
export interface DayKey {
  y: number;
  m: number;
  d: number;
  key: string;
  /** weekday 0=Sun … 6=Sat */
  wd: number;
}

const WD_IDX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const pad2 = (n: number) => String(n).padStart(2, '0');

export function dayKeyOf(d: Date, tz: string): DayKey {
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

const mkDay = (x: Date): DayKey => ({
  y: x.getUTCFullYear(),
  m: x.getUTCMonth() + 1,
  d: x.getUTCDate(),
  wd: x.getUTCDay(),
  key: `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`,
});

export const shiftDay = (k: DayKey, days: number): DayKey =>
  mkDay(new Date(Date.UTC(k.y, k.m - 1, k.d) + days * DAY));

export const mondayOfKey = (k: DayKey) => shiftDay(k, -((k.wd + 6) % 7));

/** 'YYYY-MM-DD' → DayKey, or null when malformed. */
export function parseDayKey(s: string | null): DayKey | null {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const x = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return Number.isNaN(x.getTime()) ? null : mkDay(x);
}

/** UTC midnight of the day-key — the fetch window is padded a day each side, so tz slop is fine. */
export const dayInstant = (k: DayKey) => new Date(Date.UTC(k.y, k.m - 1, k.d)).toISOString();

export const fmtTime = (iso: string, tz: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });

/** Minutes since midnight in `tz`. */
export const dayMinutes = (iso: string, tz: string) => {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Math.min(v('hour'), 23.99) * 60 + v('minute');
};

/** Format the day-key in UTC — tz formatting would shift boundary days. */
export const dayLabel = (k: DayKey, opts: Intl.DateTimeFormatOptions) =>
  new Date(Date.UTC(k.y, k.m - 1, k.d, 12)).toLocaleDateString('pt-BR', {
    ...opts,
    timeZone: 'UTC',
  });

/** Wall-clock HH:MM in `tz` for an instant. */
export const wallTime = (iso: string, tz: string) => {
  const m = dayMinutes(iso, tz);
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};

/** Wall-clock date + time in `tz` → UTC instant (two-pass offset fix covers DST edges). */
export function zonedToUtc(day: string, time: string, tz: string): Date | null {
  const dm = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = time.match(/^(\d{2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const wall = Date.UTC(+dm[1]!, +dm[2]! - 1, +dm[3]!, +tm[1]!, +tm[2]!);
  const offsetAt = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    }).formatToParts(new Date(t));
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value ?? 0);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute')) - t;
  };
  let t = wall - offsetAt(wall);
  t = wall - offsetAt(t);
  return new Date(t);
}
