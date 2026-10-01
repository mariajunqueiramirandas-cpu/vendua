import { localParts as zonedParts } from '../platform/tz.ts';

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
  // distance pricing (migration 0073, ADR 0024)
  distance_pricing?: boolean;
  delivery_base_fee_cents?: number;
  delivery_fee_per_km_cents?: number;
  delivery_min_fee_cents?: number;
  /** numeric — postgres.js reads it as a string */
  delivery_max_km?: string | number;
  delivery_free_over_cents?: number | null;
  // merchant admin (migration 0052)
  logo_url?: string | null;
  pause_message?: string | null;
  closed_message?: string | null;
  special_days?: SpecialDay[];
  accept_target_minutes?: number;
  email?: string | null;
  payment_methods?: string[];
  /** migration 0067: { method: { percentBps?, fixedCents? } } — read via payment-adjustments.ts */
  payment_adjustments?: unknown;
  // Phase 3 (migration 0054)
  billing_hold?: boolean;
  pickup_address?: string | null;
  pickup_instructions?: string | null;
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
  const p = zonedParts(instant, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    day: p.weekday,
    minutes: p.minutes,
    seconds: p.second,
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The special days a storefront can still show: today (store time) on, sorted, at most `max`. */
export function upcomingSpecialDays(
  days: readonly SpecialDay[] | null | undefined,
  timezone: string,
  now: Date,
  max = 60,
): SpecialDay[] {
  if (!Array.isArray(days)) return [];
  const today = localParts(now, timezone || 'America/Sao_Paulo').date;
  return days
    .filter((d) => typeof d?.date === 'string' && DATE_RE.test(d.date) && d.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, max)
    .map((d) => ({
      date: d.date,
      closed: d.closed === true,
      ...(typeof d.open === 'string' ? { open: d.open } : {}),
      ...(typeof d.close === 'string' ? { close: d.close } : {}),
      ...(typeof d.label === 'string' && d.label ? { label: d.label } : {}),
    }));
}

/**
 * WhatsApp as Core stores and serves it: digits with the country code (55 + DDD + number), so
 * every client builds the same wa.me link. null = not a Brazilian number. Migration 0072 ran
 * the same rule over older rows; the Kernel's `whatsappDigits` mirrors it.
 */
export function whatsappDigits(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const d = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d : null;
}

/** Instagram as Core stores and serves it: the bare handle — no `@`, no link (migration 0072). */
export function instagramHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const h = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, '')
    .replace(/\/?(?:[?#].*)?$/, '')
    .replace(/^@+/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : null;
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
