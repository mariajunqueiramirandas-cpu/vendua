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
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
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

/** Next instant the store opens, scanning ahead up to 8 days in 30-min steps. */
function nextOpen(hours: StoreHours, now: Date): Date | undefined {
  if (hours.windows.length === 0) return undefined;
  // Candidate openings are exact window `open` times on each listed day.
  // Evaluate in the store's local tz, then convert back to instants.
  const stepMs = 30 * 60 * 1000;
  for (let i = 0; i <= 8 * 24 * 2; i++) {
    const probe = new Date(now.getTime() + i * stepMs);
    const { day, minutes } = localParts(probe, hours.timezone);
    for (const w of hours.windows) {
      const open = hhmmToMinutes(w.open);
      const close = hhmmToMinutes(w.close);
      // Only openings still ahead of probe's local time, or a window the probe
      // is already inside (then it should have been reported open).
      if (close > open) {
        if (w.days.includes(day) && minutes >= open && minutes < close) return probe;
        if (w.days.includes(day) && Math.abs(minutes - open) <= 30 && minutes < open) {
          // We're within half a step before opening — good enough resolution
          // for a human-readable "opens at".
          return probe;
        }
      }
    }
  }
  return undefined;
}

export function deriveStatus(
  hours: StoreHours,
  override: 'paused' | 'closed' | null,
  resumesAt: string | null,
  now: Date,
): DerivedStatus {
  if (override === 'paused') {
    return resumesAt
      ? { status: 'paused', resumesAt }
      : { status: 'paused' };
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
