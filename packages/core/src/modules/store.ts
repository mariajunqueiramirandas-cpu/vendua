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

/** A dated exception to the weekly hours: a holiday (closed) or different hours that day. */
export interface SpecialDay {
  /** local date "YYYY-MM-DD" in the store's timezone */
  date: string;
  closed: boolean;
  open?: string;
  close?: string;
  label?: string;
}

/** Stamp card: every qualifying order that reaches `delivered` earns a stamp. */
export interface LoyaltyProgram {
  stampsRequired: number;
  /** subtotal an order needs to earn a stamp */
  minOrderCents: number;
  reward: { kind: 'percent' | 'fixed' | 'free_delivery'; value: number; label: string };
  /** days the minted reward coupon stays valid */
  rewardValidDays: number;
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
  /** 'high' emits the high_demand notice (migration 0049). */
  demand_level?: 'normal' | 'high';
  // Phase 2 (migration 0051) — optional so pre-0051 fixtures still type
  preorder_payment_methods?: string[];
  preorder_max_days?: number;
  loyalty?: LoyaltyProgram | null;
  pix_key?: string | null;
  pix_key_type?: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random' | null;
  pix_beneficiary?: string | null;
  pix_city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  // merchant admin (migration 0052)
  logo_url?: string | null;
  pause_message?: string | null;
  closed_message?: string | null;
  special_days?: SpecialDay[];
  accept_target_minutes?: number;
  email?: string | null;
  payment_methods?: string[];
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
  /** While open by its hours: when the current window ends (a hint — an adjoining window
   *  may keep it open; asking again then gives the next one). */
  closesAt?: string;
}

function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Wall-clock {day, minutes, seconds} of `instant` in `tz`, via Intl (no manual TZ math). */
function localParts(
  instant: Date,
  tz: string,
): { day: number; minutes: number; seconds: number; date: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
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
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** The windows that apply on a local date: a special day replaces the weekly ones. */
function windowsOn(hours: StoreHours, day: number, date: string, special: SpecialDay[]) {
  const s = special.find((d) => d.date === date);
  if (!s) return hours.windows;
  if (s.closed || !s.open || !s.close) return [];
  return [{ days: [day], open: s.open, close: s.close }];
}

/** Today's share of a window; an overnight window's after-midnight part belongs to yesterday. */
function openPart(dayMinutes: number, w: WeeklyWindow, day: number): boolean {
  if (!w.days.includes(day)) return false;
  const open = hhmmToMinutes(w.open);
  const close = hhmmToMinutes(w.close);
  return close > open ? dayMinutes >= open && dayMinutes < close : dayMinutes >= open;
}

// next opening instant — wall-clock open converted back to an instant; one pass absorbs tz drift
function nextOpen(hours: StoreHours, now: Date, special: SpecialDay[] = []): Date | undefined {
  const tz = hours.timezone;
  let best: { t: number; openMin: number } | undefined;
  // 15 days: a two-week holiday still finds the reopening
  for (let d = 0; d <= 15; d++) {
    const probe = new Date(now.getTime() + d * 86_400_000);
    const { day, minutes, seconds, date } = localParts(probe, tz);
    for (const w of windowsOn(hours, day, date, special)) {
      if (!w.days.includes(day)) continue;
      const openMin = hhmmToMinutes(w.open);
      // candidate = probe + (open − tod) − local seconds/millis — lands on the wall-clock minute
      const t =
        probe.getTime() + (openMin - minutes) * 60_000 - seconds * 1000 - (probe.getTime() % 1000);
      if (t <= now.getTime()) continue;
      if (!best || t < best.t) best = { t, openMin };
    }
    if (best) break; // the first day with an opening is the earliest
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
  specialDays: SpecialDay[] = [],
): DerivedStatus {
  // a timed pause ends by itself; the admin sweep clears the row later
  const expired = resumesAt !== null && new Date(resumesAt).getTime() <= now.getTime();
  if (override === 'paused' && !expired) {
    return resumesAt ? { status: 'paused', resumesAt } : { status: 'paused' };
  }
  if (override === 'closed' && !expired) {
    // manual close persists until cleared — only a configured resumes_at is honest
    return resumesAt ? { status: 'closed', resumesAt } : { status: 'closed' };
  }
  const tz = hours.timezone || 'America/Sao_Paulo';
  const { day, minutes, seconds, date } = localParts(now, tz);
  const today = windowsOn(hours, day, date, specialDays);
  // yesterday's overnight window still spills into a special day
  const yesterday = localParts(new Date(now.getTime() - 86_400_000), tz);
  const prev = windowsOn(hours, yesterday.day, yesterday.date, specialDays).filter(
    (w) => hhmmToMinutes(w.close) <= hhmmToMinutes(w.open),
  );
  const open =
    today.some((w) => openPart(minutes, w, day)) ||
    prev.some((w) => w.days.includes(yesterday.day) && minutes < hhmmToMinutes(w.close));
  if (open) {
    // the start of this local minute, then whole minutes to each window's end
    const base = now.getTime() - seconds * 1000 - (now.getTime() % 1000);
    const ends: number[] = [];
    for (const w of today) {
      if (!openPart(minutes, w, day)) continue;
      const o = hhmmToMinutes(w.open);
      const c = hhmmToMinutes(w.close);
      ends.push(base + (c > o ? c - minutes : 1440 - minutes + c) * 60_000);
    }
    for (const w of prev) {
      if (w.days.includes(yesterday.day) && minutes < hhmmToMinutes(w.close))
        ends.push(base + (hhmmToMinutes(w.close) - minutes) * 60_000);
    }
    const end = Math.min(...ends);
    return Number.isFinite(end)
      ? { status: 'open', closesAt: new Date(end).toISOString() }
      : { status: 'open' };
  }
  const next = nextOpen({ ...hours, timezone: tz }, now, specialDays);
  return next ? { status: 'closed', resumesAt: next.toISOString() } : { status: 'closed' };
}
