import type { StoreProfile } from '@vendua/kernel';

type Hours = StoreProfile['hours'];

const DAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const DAY_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Weekday (0 = domingo) and minutes since midnight, on the store's clock. */
function storeNow(timezone: string, at = new Date()): { day: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day: Math.max(0, day), min: Number(get('hour')) * 60 + Number(get('minute')) };
}

/**
 * What the status line adds after "aberto"/"fechado": today's closing time while open,
 * the next opening while closed. Core's `status` stays the source of truth for open/closed.
 */
export function hoursHint(
  hours: Hours | undefined,
  status: StoreProfile['status'] | undefined,
): { kind: 'until'; time: string } | { kind: 'opens'; day: string | null; time: string } | null {
  if (!hours?.windows.length || !status) return null;
  const now = storeNow(hours.timezone);
  if (status === 'open') {
    for (const w of hours.windows) {
      const open = toMin(w.open);
      const close = toMin(w.close);
      const overnight = close <= open;
      const today = w.days.includes(now.day);
      const yesterday = w.days.includes((now.day + 6) % 7);
      if (today && now.min >= open && (overnight || now.min < close))
        return { kind: 'until', time: w.close };
      if (overnight && yesterday && now.min < close) return { kind: 'until', time: w.close };
    }
    return null;
  }
  if (status === 'paused') return null;
  for (let ahead = 0; ahead < 8; ahead++) {
    const day = (now.day + ahead) % 7;
    const opens = hours.windows
      .filter((w) => w.days.includes(day) && (ahead > 0 || toMin(w.open) > now.min))
      .map((w) => w.open)
      .sort();
    if (opens[0])
      return {
        kind: 'opens',
        day: ahead === 0 ? null : ahead === 1 ? 'amanhã' : DAY_LONG[day]!,
        time: opens[0],
      };
  }
  return null;
}

/** "seg–sex", "sáb, dom", "todos os dias" for a window's days. */
export function daysLabel(days: number[], everyDay: string): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return everyDay;
  const runs: number[][] = [];
  for (const d of set) {
    const last = runs.at(-1);
    if (last && d === last.at(-1)! + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) =>
      r.length >= 3
        ? `${DAY_SHORT[r[0]!]}–${DAY_SHORT[r.at(-1)!]}`
        : r.map((d) => DAY_SHORT[d]).join(', '),
    )
    .join(', ');
}
