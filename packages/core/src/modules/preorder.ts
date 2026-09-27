import { HttpError } from '../platform/http.ts';
import type { StoreHours } from './store.ts';

// Encomendas: products that must be ordered N days ahead. Core owns the calendar —
// which dates are bookable (lead time, open weekdays, horizon) — the Kernel renders it.

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
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const iso = (dt: Date) => dt.toISOString().slice(0, 10);

export function bookableDates(
  hours: StoreHours,
  leadDays: number,
  maxDays: number,
  now: Date,
): string[] {
  const { y, m, d } = localDate(now, hours.timezone || 'America/Sao_Paulo');
  const openDays = new Set(hours.windows.flatMap((w) => w.days));
  const out: string[] = [];
  for (let off = Math.max(0, leadDays); off <= maxDays; off++) {
    // pure calendar arithmetic on the store's local date — UTC noon avoids DST edges
    const dt = new Date(Date.UTC(y, m - 1, d + off, 12));
    if (openDays.size > 0 && !openDays.has(dt.getUTCDay())) continue;
    out.push(iso(dt));
  }
  return out;
}

export function scheduleView(
  items: { requiresPreorder: boolean; preorderLeadDays: number }[],
  settings: {
    hours: StoreHours;
    preorder_payment_methods?: string[] | null;
    preorder_max_days?: number | null;
  },
  now: Date,
): ScheduleView {
  const pre = items.filter((i) => i.requiresPreorder);
  const leadDays = pre.reduce((max, i) => Math.max(max, i.preorderLeadDays), 0);
  return {
    required: pre.length > 0,
    leadDays,
    dates: bookableDates(settings.hours, leadDays, settings.preorder_max_days ?? 30, now),
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
