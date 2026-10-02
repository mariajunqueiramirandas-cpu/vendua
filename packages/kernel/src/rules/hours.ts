import type { StoreProfile } from '../api.ts';
import { formatTime, formatWhen, localNow } from './format.ts';

// Opening hours and the open/closed line. Whether the store is open, and until or from
// when, is Core's answer (`status`, `closesAt`, `resumesAt`); these only lay it out.

export type StoreHours = StoreProfile['hours'];

export interface HoursWindow {
  open: string;
  close: string;
}

export interface HoursRow {
  /** weekdays in this row, 0 = Sunday, in Monday-first order */
  days: number[];
  /** `Segunda`, `Seg – Sex`, `Todos os dias` */
  label: string;
  windows: HoursWindow[];
  closed: boolean;
  /** the store's today (in its zone) is in this row */
  today: boolean;
}

const DAY = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
// Monday first — how a Brazilian storefront reads its week
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const windowsOf = (hours: StoreHours, day: number): HoursWindow[] =>
  hours.windows.filter((w) => w.days.includes(day)).map((w) => ({ open: w.open, close: w.close }));

const key = (ws: HoursWindow[]) => ws.map((w) => `${w.open}–${w.close}`).join(', ');

/** The weekly table: consecutive days with the same windows fold into one row; closed days
 *  are rows too. Special days (holidays) are `todayHours`'s, not the week's. */
export function hoursRows(hours: StoreHours, now: Date = new Date()): HoursRow[] {
  const today = localNow(hours.timezone, now).weekday;
  const rows: HoursRow[] = [];
  for (const day of WEEK) {
    const windows = windowsOf(hours, day);
    const last = rows[rows.length - 1];
    if (last && key(last.windows) === key(windows)) last.days.push(day);
    else rows.push({ days: [day], label: '', windows, closed: windows.length === 0, today: false });
  }
  for (const r of rows) {
    r.label =
      r.days.length === 7
        ? 'Todos os dias'
        : r.days.length === 1
          ? DAY[r.days[0]!]!
          : `${DAY_SHORT[r.days[0]!]} – ${DAY_SHORT[r.days[r.days.length - 1]!]}`;
    r.today = r.days.includes(today);
  }
  return rows;
}

export interface TodayHours {
  /** the store's local date, YYYY-MM-DD */
  date: string;
  windows: HoursWindow[];
  closed: boolean;
  /** today is one of the store's special days (a holiday, a short day) */
  special: { label: string | null } | null;
}

/** Today's windows in the store's zone, a special day (Core's `hours.specialDays`) first. */
export function todayHours(hours: StoreHours, now: Date = new Date()): TodayHours {
  const local = localNow(hours.timezone, now);
  const s = hours.specialDays?.find((d) => d.date === local.date);
  if (s) {
    const windows = !s.closed && s.open && s.close ? [{ open: s.open, close: s.close }] : [];
    return {
      date: local.date,
      windows,
      closed: windows.length === 0,
      special: { label: s.label ?? null },
    };
  }
  const windows = windowsOf(hours, local.weekday);
  return { date: local.date, windows, closed: windows.length === 0, special: null };
}

export interface StatusHint {
  kind: 'open-until' | 'opens' | 'paused-until' | 'open' | 'closed' | 'paused';
  /** ISO instant, exactly as Core served it */
  at?: string;
}

/** Which status line to show. A time appears only when Core served one: a manual close or an
 *  open-ended pause has none, and none is invented. */
export function statusHint(s: {
  status: 'open' | 'closed' | 'paused';
  closesAt?: string | null | undefined;
  resumesAt?: string | null | undefined;
}): StatusHint {
  if (s.status === 'open')
    return s.closesAt ? { kind: 'open-until', at: s.closesAt } : { kind: 'open' };
  if (s.status === 'paused')
    return s.resumesAt ? { kind: 'paused-until', at: s.resumesAt } : { kind: 'paused' };
  return s.resumesAt ? { kind: 'opens', at: s.resumesAt } : { kind: 'closed' };
}

/** `Aberto até 18:00` / `Abre amanhã às 09:00` / `Pausado até 14:30` / `Aberto` / `Fechado` /
 *  `Pausado`, in the store's zone. */
export function statusWords(hint: StatusHint, timeZone: string, now: Date = new Date()): string {
  switch (hint.kind) {
    case 'open-until':
      return `Aberto até ${formatTime(hint.at!, timeZone)}`;
    case 'opens':
      return `Abre ${formatWhen(hint.at!, timeZone, now)}`;
    case 'paused-until': {
      const when = formatWhen(hint.at!, timeZone, now);
      return `Pausado até ${when.startsWith('hoje às ') ? when.slice(8) : when}`;
    }
    case 'open':
      return 'Aberto';
    case 'paused':
      return 'Pausado';
    default:
      return 'Fechado';
  }
}

/** Kernel 1.16 — Core's checkout gate over the status: open takes any cart and paused none;
 *  closed takes one only when every line is an encomenda and the store allows that
 *  (`StoreProfile.preorder.whileClosed`). A Core that doesn't send the flag takes any cart. */
export function takesOrders(
  status: StoreProfile['status'],
  store: Pick<StoreProfile, 'preorder'> | null | undefined,
  items: readonly { requiresPreorder?: boolean | undefined }[],
): boolean {
  if (status === 'open') return true;
  if (status === 'paused') return false;
  const allowed = store?.preorder?.whileClosed;
  if (allowed === undefined) return true;
  return allowed && items.length > 0 && items.every((i) => i.requiresPreorder === true);
}
