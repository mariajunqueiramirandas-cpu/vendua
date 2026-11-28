import { HttpError } from '../platform/http.ts';
import { isCalendarDate, localParts } from '../platform/tz.ts';
import { deriveStatus, specialDayOn, type SpecialDay, type StoreHours } from './store.ts';

// Encomendas: products that must be ordered N days ahead. Core owns the calendar —
// which dates are bookable (lead time, open weekdays, special days, blocked dates, horizon) — the
// Kernel renders it.
// A product can also be an encomenda only past its stock (0158, `preorder_when_sold_out`): an
// order without a date takes it from stock while the stock covers the cart; with a date, short of
// stock, or with the store closed, it is made for the date and draws no stock.

/** 0158: sold from stock, and by encomenda once the stock can't cover it */
export const preorderPastStock = (p: {
  requires_preorder: boolean;
  preorder_when_sold_out?: boolean | null;
}) => !p.requires_preorder && p.preorder_when_sold_out === true;

export interface ScheduleView {
  /** a line in the cart requires a scheduled date */
  required: boolean;
  leadDays: number;
  /** bookable local dates (YYYY-MM-DD), earliest first */
  dates: string[];
  /** payment methods allowed when the order is an encomenda */
  paymentMethods: string[];
}

function localDate(now: Date, tz: string): { y: number; m: number; d: number } {
  const p = localParts(now, tz);
  return { y: p.year, m: p.month, d: p.day };
}

const iso = (dt: Date) => dt.toISOString().slice(0, 10);

/** the store's local date (YYYY-MM-DD) at `now` */
export function storeToday(now: Date, tz: string): string {
  const { y, m, d } = localDate(now, tz || 'America/Sao_Paulo');
  return iso(new Date(Date.UTC(y, m - 1, d, 12)));
}

export function bookableDates(
  hours: StoreHours,
  leadDays: number,
  maxDays: number,
  now: Date,
  special: readonly SpecialDay[] = [],
  /** dates the store blocked for scheduled orders (0158) */
  blocked: readonly string[] = [],
): string[] {
  const tz = hours.timezone || 'America/Sao_Paulo';
  const { y, m, d } = localDate(now, tz);
  const openDays = new Set(hours.windows.flatMap((w) => w.days));
  const skip = new Set(blocked);
  const out: string[] = [];
  for (let off = Math.max(0, leadDays); off <= maxDays; off++) {
    // pure calendar arithmetic on the store's local date — UTC noon avoids DST edges
    const dt = new Date(Date.UTC(y, m - 1, d + off, 12));
    const date = iso(dt);
    if (skip.has(date)) continue;
    // today (no lead time) only while the store still works today: open now, or opening later
    if (off === 0 && hours.windows.length > 0) {
      const s = deriveStatus({ ...hours, timezone: tz }, null, null, now, [...special]);
      const back =
        s.status === 'closed' && s.resumesAt ? localDate(new Date(s.resumesAt), tz) : null;
      const later =
        back !== null && iso(new Date(Date.UTC(back.y, back.m - 1, back.d, 12))) === date;
      if (s.status !== 'open' && !later) continue;
    }
    // a special day replaces the weekly hours, as deriveStatus reads them
    const s = specialDayOn(special, date);
    if (s) {
      if (s.closed || !s.open || !s.close) continue;
    } else if (openDays.size > 0 && !openDays.has(dt.getUTCDay())) continue;
    out.push(date);
  }
  return out;
}

export function scheduleView(
  items: { requiresPreorder: boolean; preorderLeadDays: number; preorderWhenSoldOut?: boolean }[],
  settings: {
    hours: StoreHours;
    preorder_payment_methods?: string[] | null;
    preorder_max_days?: number | null;
    special_days?: SpecialDay[] | null;
    blocked_dates?: string[] | null;
  },
  now: Date,
): ScheduleView {
  // a line sold past its stock needs no date while stock covers it, but a dated order makes it
  // an encomenda, so its lead time still bounds the dates
  const lead = items.filter((i) => i.requiresPreorder || i.preorderWhenSoldOut);
  const leadDays = lead.reduce((max, i) => Math.max(max, i.preorderLeadDays), 0);
  return {
    required: items.some((i) => i.requiresPreorder),
    leadDays,
    dates: bookableDates(
      settings.hours,
      leadDays,
      settings.preorder_max_days ?? 30,
      now,
      settings.special_days ?? [],
      settings.blocked_dates ?? [],
    ),
    paymentMethods: settings.preorder_payment_methods ?? ['pix'],
  };
}

/** Checkout gate: a required date must be present, bookable, and paid with an allowed method. */
export function validateSchedule(
  view: ScheduleView,
  scheduledFor: string | undefined,
  method: string,
): string | null {
  if (scheduledFor === undefined) {
    if (view.required)
      throw new HttpError(422, 'SCHEDULE_REQUIRED', 'this order has encomendas — pick a date', {
        field: 'scheduledFor',
        earliest: view.dates[0] ?? null,
      });
    return null;
  }
  if (!view.dates.includes(scheduledFor))
    throw new HttpError(422, 'INVALID_SCHEDULE', 'that date is not available', {
      field: 'scheduledFor',
      earliest: view.dates[0] ?? null,
    });
  if (view.required && !view.paymentMethods.includes(method))
    throw new HttpError(422, 'PAYMENT_NOT_ALLOWED', 'encomendas accept only some payment methods', {
      field: 'payment.method',
      allowed: view.paymentMethods,
    });
  return scheduledFor;
}

/** Admin input for `blocked_dates`: calendar dates from the store's today on, deduplicated and
 *  sorted. Past dates are dropped, so the list never fills with days gone by. */
export function parseBlockedDates(v: unknown, today: string): string[] {
  if (!Array.isArray(v) || v.length > BLOCKED_DATES_MAX || !v.every(isCalendarDate))
    throw new HttpError(
      422,
      'BAD_REQUEST',
      `blockedDates: up to ${BLOCKED_DATES_MAX} YYYY-MM-DD dates`,
      {
        field: 'blockedDates',
      },
    );
  return [...new Set(v as string[])].filter((d) => d >= today).sort();
}

export const BLOCKED_DATES_MAX = 120;
