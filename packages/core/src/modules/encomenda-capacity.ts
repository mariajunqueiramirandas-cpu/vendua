import type { Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';
import { isCalendarDate } from '../platform/tz.ts';

// Festa calculada F0 (0126, docs/features/festa-calculada.md §4.2): a ceiling on a day's
// encomendas, per weekday or per date, and on each party group's pieces a day. The cart leaves a
// full day out of its dates; checkout decides under its tenant lock.

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
      if (!isCalendarDate(d)) bad('dates are YYYY-MM-DD');
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

/** At placement: the units each group of the cart's profile holds in the final lines. */
export async function orderPartyTx(
  tx: Sql,
  tenantId: string,
  party: CartParty,
  lines: readonly { productId: string; qty: number }[],
): Promise<OrderParty> {
  const map = await tx<{ product_id: string; group_id: string; units_per_sale: number }[]>`
    select product_id, group_id, units_per_sale from party_group_products
    where tenant_id = ${tenantId} and profile_id = ${party.profileId}`;
  const units = new Map<string, number>();
  for (const l of lines) {
    const m = map.find((x) => x.product_id === l.productId);
    if (m) units.set(m.group_id, (units.get(m.group_id) ?? 0) + l.qty * m.units_per_sale);
  }
  return {
    profileId: party.profileId,
    adults: party.adults,
    children: party.children,
    groups: [...units].map(([groupId, u]) => ({ groupId, units: u })),
  };
}

/** each capped party group's units already taken, by date then group */
async function groupUnitsTx(
  tx: Sql,
  tenantId: string,
  party: OrderParty,
  dates: readonly string[],
): Promise<{ caps: { id: string; cap: number }[]; used: Map<string, number> }> {
  const caps = await tx<{ id: string; cap: number }[]>`
    select id, daily_cap_units as cap from party_groups
    where tenant_id = ${tenantId} and id = any(${party.groups.map((g) => g.groupId)}::uuid[])
      and daily_cap_units is not null`;
  if (!caps.length) return { caps, used: new Map() };
  const rows = await tx<{ day: string; group_id: string; units: number }[]>`
    select o.scheduled_for::text as day, g ->> 'groupId' as group_id,
           coalesce(sum((g ->> 'units')::int), 0)::int as units
    from orders o, jsonb_array_elements(o.party -> 'groups') g
    where o.tenant_id = ${tenantId} and o.scheduled_for = any(${dates as string[]}::date[])
      and o.party is not null and o.state not in ('cancelled', 'refunded')
    group by 1, 2`;
  return { caps, used: new Map(rows.map((r) => [`${r.day}|${r.group_id}`, r.units])) };
}

/** a capped group this party would take past its day's ceiling, if any */
function fullGroup(
  g: { caps: { id: string; cap: number }[]; used: Map<string, number> },
  party: OrderParty,
  date: string,
): string | null {
  for (const c of g.caps) {
    const want = party.groups.find((x) => x.groupId === c.id)?.units ?? 0;
    if ((g.used.get(`${date}|${c.id}`) ?? 0) + want > c.cap) return c.id;
  }
  return null;
}

/**
 * The bookable dates still under their ceiling: a full day isn't offered, nor one where the
 * party's kitchen groups would pass their pieces a day (checkout's DATE_FULL, said up front).
 */
export async function datesWithRoomTx(
  tx: Sql,
  tenantId: string,
  cap: EncomendaCapacity | null | undefined,
  dates: string[],
  party: OrderParty | null = null,
): Promise<string[]> {
  if (!dates.length) return dates;
  let out = dates;
  const capped = cap ? dates.filter((d) => capacityOn(cap, d) !== null) : [];
  if (capped.length) {
    const booked = await bookedOnTx(tx, tenantId, capped);
    out = out.filter((d) => {
      const c = capacityOn(cap, d);
      return c === null || (booked.get(d) ?? 0) < c;
    });
  }
  if (party?.groups.length && out.length) {
    const g = await groupUnitsTx(tx, tenantId, party, out);
    if (g.caps.length) out = out.filter((d) => fullGroup(g, party, d) === null);
  }
  return out;
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
  const full = fullGroup(await groupUnitsTx(tx, tenantId, party, [date]), party, date);
  if (full)
    throw new HttpError(409, 'DATE_FULL', 'the kitchen is full for this date', {
      date,
      groupId: full,
    });
}
