import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

// Festa calculada F0 (0126, docs/features/festa-calculada.md §4.2): a ceiling on a day's
// encomendas, per weekday or per date, and on each party group's pieces a day. The cart leaves a
// full day out of its dates; checkout decides under its tenant lock.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CartParty {
  profileId: string;
  adults: number;
  children: number;
}

/** the order's frozen party: what capacity counts, whatever the profile becomes later */
export interface OrderParty extends CartParty {
  groups: { groupId: string; units: number }[];
}

// ── capacity (F0) ─────────────────────────────────────────────────────────────

/** `store_settings.encomenda_capacity`: orders a day per weekday (0 = Sunday), and per date */
export interface EncomendaCapacity {
  days?: (number | null)[];
  dates?: Record<string, number | null>;
}

/** a date's ceiling on encomendas; null = none. A date's own entry wins over its weekday. */
export function capacityOn(cap: EncomendaCapacity | null | undefined, date: string): number | null {
  if (!cap) return null;
  if (cap.dates && Object.prototype.hasOwnProperty.call(cap.dates, date))
    return cap.dates[date] ?? null;
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  return cap.days?.[wd] ?? null;
}

export function parseCapacity(v: unknown): EncomendaCapacity | null {
  if (v === null) return null;
  const bad = (msg: string): never => {
    throw new HttpError(422, 'BAD_REQUEST', msg, { field: 'capacity' });
  };
  if (typeof v !== 'object' || Array.isArray(v)) bad('capacity must be an object');
  const o = v as Record<string, unknown>;
  const n = (x: unknown) =>
    x === null || (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 500)
      ? (x as number | null)
      : bad('a day takes 0..500 orders, or null');
  const out: EncomendaCapacity = {};
  if (o.days !== undefined) {
    if (!Array.isArray(o.days) || o.days.length !== 7) bad('days: seven entries, Sunday first');
    out.days = (o.days as unknown[]).map(n);
  }
  if (o.dates !== undefined) {
    if (typeof o.dates !== 'object' || o.dates === null || Array.isArray(o.dates))
      bad('dates must be an object');
    const entries = Object.entries(o.dates as Record<string, unknown>);
    if (entries.length > 60) bad('at most 60 dates');
    out.dates = {};
    for (const [d, c] of entries) {
      if (!DATE_RE.test(d)) bad('dates are YYYY-MM-DD');
      out.dates[d] = n(c);
    }
  }
  return out;
}

/** Encomendas already on these dates (cancelled and refunded don't hold a date). */
export async function bookedOnTx(
  tx: Sql,
  tenantId: string,
  dates: readonly string[],
): Promise<Map<string, number>> {
  if (!dates.length) return new Map();
  const rows = await tx<{ day: string; n: number }[]>`
    select scheduled_for::text as day, count(*)::int as n from orders
    where tenant_id = ${tenantId} and scheduled_for = any(${dates as string[]}::date[])
      and state not in ('cancelled', 'refunded')
    group by 1`;
  return new Map(rows.map((r) => [r.day, r.n]));
}

/** The bookable dates still under their ceiling: a full day isn't offered. */
export async function datesWithRoomTx(
  tx: Sql,
  tenantId: string,
  cap: EncomendaCapacity | null | undefined,
  dates: string[],
): Promise<string[]> {
  if (!cap || !dates.length) return dates;
  const capped = dates.filter((d) => capacityOn(cap, d) !== null);
  if (!capped.length) return dates;
  const booked = await bookedOnTx(tx, tenantId, capped);
  return dates.filter((d) => {
    const c = capacityOn(cap, d);
    return c === null || (booked.get(d) ?? 0) < c;
  });
}

/**
 * Checkout's word on a date, under placeOrderTx's tenant lock: the day's ceiling, and each party
 * group's pieces a day. Throws 409 DATE_FULL.
 */
export async function assertDateRoomTx(
  tx: Sql,
  tenantId: string,
  cap: EncomendaCapacity | null | undefined,
  date: string,
  party: OrderParty | null,
): Promise<void> {
  const c = capacityOn(cap, date);
  if (c !== null) {
    const booked = (await bookedOnTx(tx, tenantId, [date])).get(date) ?? 0;
    if (booked >= c)
      throw new HttpError(409, 'DATE_FULL', 'this date takes no more encomendas', { date });
  }
  if (!party?.groups.length) return;
  const caps = await tx<{ id: string; cap: number }[]>`
    select id, daily_cap_units as cap from party_groups
    where tenant_id = ${tenantId} and id = any(${party.groups.map((g) => g.groupId)}::uuid[])
      and daily_cap_units is not null`;
  if (!caps.length) return;
  const used = await tx<{ group_id: string; units: number }[]>`
    select g ->> 'groupId' as group_id, coalesce(sum((g ->> 'units')::int), 0)::int as units
    from orders o, jsonb_array_elements(o.party -> 'groups') g
    where o.tenant_id = ${tenantId} and o.scheduled_for = ${date}::date and o.party is not null
      and o.state not in ('cancelled', 'refunded')
    group by 1`;
  const usedOf = new Map(used.map((u) => [u.group_id, u.units]));
  for (const g of caps) {
    const want = party.groups.find((x) => x.groupId === g.id)?.units ?? 0;
    if ((usedOf.get(g.id) ?? 0) + want > g.cap)
      throw new HttpError(409, 'DATE_FULL', 'the kitchen is full for this date', {
        date,
        groupId: g.id,
      });
  }
}
