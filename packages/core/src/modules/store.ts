export interface WeeklyWindow {
  /** Days of week, 0=Sunday .. 6=Saturday. */
  days: number[];
  /** Local open "HH:MM". */
  open: string;
  /** Local close "HH:MM". May be earlier than `open` for overnight windows. */
  close: string;
}

export interface StoreHours {
  timezone: string;
  windows: WeeklyWindow[];
}

export interface StoreSettingsRow {
  tenant_id: string;
  tagline: string | null;
  description: string | null;
  whatsapp: string | null;
  instagram: string | null;
  city: string | null;
  address: string | null;
  hours: StoreHours;
  status_override: 'paused' | 'closed' | null;
  resumes_at: string | null;
  prep_time_minutes: number;
  min_order_cents: number;
  pickup_enabled: boolean;
  delivery_enabled: boolean;
  promo: { title: string; body?: string } | null;
  currency: string;
  vocabulary: {
    itemSingular?: string;
    itemPlural?: string;
    bag?: string;
    cta?: string;
    [k: string]: string | undefined;
  };
}

export type StoreStatus = 'open' | 'closed' | 'paused';

export interface DerivedStatus {
  status: StoreStatus;
  /** ISO instant when the store next opens/resumes, if it isn't open now. */
  resumesAt?: string;
}

function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Wall-clock {day, minutes, seconds} of `instant` in `tz`, via Intl (no manual TZ math). */
function localParts(instant: Date, tz: string): { day: number; minutes: number; seconds: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = dayMap[get('weekday')] ?? 0;
  return {
    day,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    seconds: Number(get('second')),
  };
}

function withinWindow(dayMinutes: number, w: WeeklyWindow, day: number): boolean {
  const open = hhmmToMinutes(w.open);
  const close = hhmmToMinutes(w.close);
  if (close > open) return w.days.includes(day) && dayMinutes >= open && dayMinutes < close;
  // overnight window: close lands day+1, so early-morning counts as the previous day's window
  const inOpenPart = w.days.includes(day) && dayMinutes >= open;
  const prevDay = (day + 6) % 7;
  const inClosePart = w.days.includes(prevDay) && dayMinutes < close;
  return inOpenPart || inClosePart;
}

// next opening instant — wall-clock open converted back to an instant; one pass absorbs tz drift
function nextOpen(hours: StoreHours, now: Date): Date | undefined {
  const tz = hours.timezone;
  let best: { t: number; openMin: number } | undefined;
  for (let d = 0; d <= 8; d++) {
    const probe = new Date(now.getTime() + d * 86_400_000);
    const { day, minutes, seconds } = localParts(probe, tz);
    for (const w of hours.windows) {
      if (!w.days.includes(day)) continue;
      const openMin = hhmmToMinutes(w.open);
      // candidate = probe + (open − tod) − local seconds/millis — lands on the wall-clock minute
      const t =
        probe.getTime() + (openMin - minutes) * 60_000 - seconds * 1000 - (probe.getTime() % 1000);
      if (t <= now.getTime()) continue;
      if (!best || t < best.t) best = { t, openMin };
    }
    if (best && d === 0) break; // a same-day open is the earliest possible
  }
  if (!best) return undefined;
  // Correct once for any offset change between now and the candidate.
  const at = localParts(new Date(best.t), tz);
  const drift = best.openMin - at.minutes;
  return new Date(best.t + drift * 60_000);
}

export function deriveStatus(
  hours: StoreHours,
  override: 'paused' | 'closed' | null,
  resumesAt: string | null,
  now: Date,
): DerivedStatus {
  if (override === 'paused') {
    return resumesAt ? { status: 'paused', resumesAt } : { status: 'paused' };
  }
  if (override === 'closed') {
    // manual close persists until cleared — only a configured resumes_at is honest
    return resumesAt ? { status: 'closed', resumesAt } : { status: 'closed' };
  }
  const tz = hours.timezone || 'America/Sao_Paulo';
  const { day, minutes } = localParts(now, tz);
  const open = hours.windows.some((w) => withinWindow(minutes, w, day));
  if (open) return { status: 'open' };
  const next = nextOpen(hours, now);
  return next ? { status: 'closed', resumesAt: next.toISOString() } : { status: 'closed' };
}
