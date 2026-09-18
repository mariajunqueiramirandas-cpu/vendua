/**
 * store module — store profile, hours, status.
 *
 * `status` is derived from `hours` unless manually overridden, per
 * docs/architecture/01-core.md#key-domain-behaviors. This is the logic that
 * drives blocking UI fleet-wide, so it is a pure, unit-tested function.
 */

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

/** Wall-clock {day, minutes} of `instant` in `tz`, via Intl (no manual TZ math). */
function localParts(instant: Date, tz: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
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
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function withinWindow(dayMinutes: number, w: WeeklyWindow, day: number): boolean {
  const open = hhmmToMinutes(w.open);
  const close = hhmmToMinutes(w.close);
  if (close > open) return w.days.includes(day) && dayMinutes >= open && dayMinutes < close;
  // Overnight window (e.g. 18:00–02:00): open portion on `day`, close lands
  // on day+1, so a 01:00 visit counts as the *previous* day's window.
  const inOpenPart = w.days.includes(day) && dayMinutes >= open;
  const prevDay = (day + 6) % 7;
  const inClosePart = w.days.includes(prevDay) && dayMinutes < close;
  return inOpenPart || inClosePart;
}

/**
 * Next instant the store opens — exact window boundary, not a probe grid.
 * For each day offset (0–8) and each window, the candidate is that day's local
 * `open` wall time converted back to an instant; one correction pass absorbs
 * tz-offset drift between now and the candidate.
 */
function nextOpen(hours: StoreHours, now: Date): Date | undefined {
  const tz = hours.timezone;
  let best: { t: number; openMin: number } | undefined;
  for (let d = 0; d <= 8; d++) {
    const probe = new Date(now.getTime() + d * 86_400_000);
    const { day, minutes } = localParts(probe, tz);
    for (const w of hours.windows) {
      if (!w.days.includes(day)) continue;
      const openMin = hhmmToMinutes(w.open);
      const delta = openMin - minutes;
      if (delta <= 0) continue; // opening already passed on that local day
      const t = probe.getTime() + delta * 60_000;
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
  const tz = hours.timezone || 'America/Sao_Paulo';
  const { day, minutes } = localParts(now, tz);
  const open = hours.windows.some((w) => withinWindow(minutes, w, day));
  if (open && override !== 'closed') return { status: 'open' };
  const next = nextOpen(hours, now);
  return next
    ? { status: 'closed', resumesAt: next.toISOString() }
    : { status: 'closed' };
}
