// booking: idempotent (lead,slot) insert + post-commit room/gcal/confirm; reminders are system messages, not agent runs
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '../platform/db.ts';
import { HttpError, str, UUID_RE } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { addDays, hhmmToMinutes, localDateOf, localParts, zonedInstant } from '../platform/tz.ts';
import { claimControl, controlTx } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { getSettingTx, type Guardrails } from './integrations.ts';
import type { LeadRow } from './leads.ts';
import * as gcal from './gcal.ts';
import * as rooms from './rooms.ts';

const mlog = log.child({ mod: 'meetings' });

/** Per-day windows as minutes-of-day pairs, indexed 0 (Sun) … 6 (Sat). */
export type WeeklyWindows = [number, number][][];

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export interface MeetingConfig {
  /** legacy static link — the agent prompt falls back to it if mint fails */
  bookingUrl: string | null;
  /** static room URL — used when Daily isn't configured (or errors) */
  roomUrl: string | null;
  publicBaseUrl: string;
  tz: string;
  slotMinutes: number;
  bufferMinutes: number;
  horizonDays: number;
  weekly: WeeklyWindows;
}

const WORKWEEK: WeeklyWindows = [
  [], // sun
  ...([0, 0, 0, 0, 0].map(() => [
    [9 * 60, 12 * 60],
    [14 * 60, 18 * 60],
  ]) as [number, number][][]),
  [], // sat
];

export const MEETING_DEFAULTS: Record<string, unknown> = {
  roomUrl: null,
  publicBaseUrl: 'https://crm.vendua.com.br',
  tz: 'America/Sao_Paulo',
  slotMinutes: 30,
  bufferMinutes: 15,
  horizonDays: 14,
  weekly: {
    sun: [],
    mon: [
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ],
    tue: [
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ],
    wed: [
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ],
    thu: [
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ],
    fri: [
      ['09:00', '12:00'],
      ['14:00', '18:00'],
    ],
    sat: [],
  },
};

/** malformed pieces fall back to defaults — tolerates rows written before validation existed */
export function normalizeMeetingConfig(raw: Record<string, unknown>): MeetingConfig {
  const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const int = (v: unknown, dflt: number, lo: number, hi: number): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
  };
  const rawWeekly = raw.weekly;
  let weekly: WeeklyWindows = structuredClone(WORKWEEK);
  if (rawWeekly && typeof rawWeekly === 'object') {
    weekly = DAY_KEYS.map(() => [] as [number, number][]);
    DAY_KEYS.forEach((key, idx) => {
      const list = (rawWeekly as Record<string, unknown>)[key];
      if (!Array.isArray(list)) return;
      for (const w of list) {
        if (!Array.isArray(w) || w.length < 2) continue;
        const open = hhmmToMinutes(String(w[0]));
        const close = hhmmToMinutes(String(w[1]));
        if (open === null || close === null || open >= close) continue;
        weekly[idx]!.push([open, close]);
      }
      weekly[idx]!.sort((a, b) => a[0] - b[0]);
    });
  }
  let tz = s(raw.tz) ?? String(MEETING_DEFAULTS.tz);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    tz = String(MEETING_DEFAULTS.tz);
  }
  return {
    bookingUrl: s(raw.bookingUrl),
    roomUrl: s(raw.roomUrl),
    publicBaseUrl: (s(raw.publicBaseUrl) ?? String(MEETING_DEFAULTS.publicBaseUrl)).replace(
      /\/+$/,
      '',
    ),
    tz,
    slotMinutes: int(raw.slotMinutes, MEETING_DEFAULTS.slotMinutes as number, 5, 120),
    bufferMinutes: int(raw.bufferMinutes, MEETING_DEFAULTS.bufferMinutes as number, 0, 180),
    horizonDays: int(raw.horizonDays, MEETING_DEFAULTS.horizonDays as number, 1, 60),
    weekly,
  };
}

export async function meetingConfigTx(tx: Sql): Promise<MeetingConfig> {
  const raw = await getSettingTx<Record<string, unknown>>(tx, 'meeting', {});
  return normalizeMeetingConfig(raw ?? {});
}

export function weeklyToJson(weekly: WeeklyWindows): Record<DayKey, [string, string][]> {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const out = {} as Record<DayKey, [string, string][]>;
  DAY_KEYS.forEach((key, idx) => {
    out[key] = (weekly[idx] ?? []).map(([o, c]) => [hhmm(o), hhmm(c)] as [string, string]);
  });
  return out;
}

export interface Slot {
  start: Date;
  end: Date;
}

export interface BusyWindow {
  start: Date;
  end: Date;
}

function dayDiff(a: ReturnType<typeof localDateOf>, b: ReturnType<typeof localDateOf>): number {
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/** lands on the grid: weekly window, slot-aligned, within horizon, in the future */
export function onGrid(cfg: MeetingConfig, start: Date, durationMin: number, now: Date): boolean {
  if (Number.isNaN(start.getTime()) || start.getTime() <= now.getTime()) return false;
  const date = localDateOf(start, cfg.tz);
  const today = localDateOf(now, cfg.tz);
  const diff = dayDiff(today, date);
  if (diff < 0 || diff >= cfg.horizonDays) return false;
  const lp = localParts(start, cfg.tz);
  if (lp.second !== 0) return false;
  return (cfg.weekly[date.weekday] ?? []).some(
    ([open, close]) =>
      lp.minutes >= open &&
      lp.minutes + durationMin <= close &&
      (lp.minutes - open) % cfg.slotMinutes === 0,
  );
}

export function isFree(start: Date, end: Date, busy: BusyWindow[], bufferMinutes: number): boolean {
  const buf = bufferMinutes * 60_000;
  const s = start.getTime();
  const e = end.getTime();
  return !busy.some((b) => s < b.end.getTime() + buf && e > b.start.getTime() - buf);
}

export function slotFits(
  cfg: MeetingConfig,
  start: Date,
  durationMin: number,
  now: Date,
  busy: BusyWindow[],
): boolean {
  return (
    onGrid(cfg, start, durationMin, now) &&
    isFree(start, new Date(start.getTime() + durationMin * 60_000), busy, cfg.bufferMinutes)
  );
}

/** weekly windows × horizon stepped in slotMinutes, minus past/busy+buffer; wall-clock math in cfg.tz */
export function computeSlots(cfg: MeetingConfig, now: Date, busy: BusyWindow[]): Slot[] {
  const slots: Slot[] = [];
  const seen = new Set<number>();
  const today = localDateOf(now, cfg.tz);
  for (let d = 0; d < cfg.horizonDays; d++) {
    const date = addDays(today, d);
    for (const [openMin, closeMin] of cfg.weekly[date.weekday] ?? []) {
      for (let m = openMin; m + cfg.slotMinutes <= closeMin; m += cfg.slotMinutes) {
        const start = zonedInstant(cfg.tz, date, m);
        const end = zonedInstant(cfg.tz, date, m + cfg.slotMinutes);
        const s = start.getTime();
        if (seen.has(s)) continue;
        seen.add(s);
        if (slotFits(cfg, start, cfg.slotMinutes, now, busy)) {
          slots.push({ start, end });
        }
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

async function meetingBusyTx(
  tx: Sql,
  from: Date,
  to: Date,
  excludeId?: string,
): Promise<BusyWindow[]> {
  const rows = await tx<{ starts_at: string; ends_at: string }[]>`
    select starts_at, ends_at from meetings
    where status = 'scheduled' and starts_at < ${to.toISOString()} and ends_at > ${from.toISOString()}
      and (${excludeId ?? null}::uuid is null or id <> ${excludeId ?? null}::uuid)
  `;
  return rows.map((r) => ({ start: new Date(r.starts_at), end: new Date(r.ends_at) }));
}

/** meetings busy ∪ gcal busy; gcal queried outside any transaction */
export async function availableSlots(
  sql: Sql,
  now: Date,
): Promise<{ cfg: MeetingConfig; slots: Slot[] }> {
  const cfg = await controlTx(sql, (tx) => meetingConfigTx(tx));
  const horizonEnd = new Date(now.getTime() + cfg.horizonDays * 86_400_000);
  const [dbBusy, gcalBusy] = await Promise.all([
    controlTx(sql, (tx) => meetingBusyTx(tx, now, horizonEnd)),
    gcal.busyWindows(now, horizonEnd),
  ]);
  return { cfg, slots: computeSlots(cfg, now, [...dbBusy, ...gcalBusy]) };
}

// booking tokens: same HMAC style as mintSessionToken — <prefix>.<payload>.<sig>

const TOKEN_PREFIX = 'vbt';
const TOKEN_TTL_S = 30 * 24 * 3600; // 30d

// set once at boot with staffSecret; unset → agent links fall back to meeting.bookingUrl
let runnerBookingSecret: string | null = null;
export function setBookingSecret(secret: string): void {
  runnerBookingSecret = secret;
}

export function bookingToken(leadId: string, secret: string, now = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + TOKEN_TTL_S;
  const sig = createHmac('sha256', `${secret}:booking`)
    .update(`${TOKEN_PREFIX}|${leadId}|${exp}`)
    .digest('base64url');
  return `${TOKEN_PREFIX}.${leadId}.${exp}.${sig}`;
}

export function verifyBookingToken(token: string, secret: string, now = new Date()): string | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const leadId = parts[1]!;
  const exp = Number(parts[2]);
  const sig = parts[3]!;
  // also reject distant expiries — a token may never outlive the mint TTL
  if (!Number.isInteger(exp)) return null;
  if (exp * 1000 < now.getTime() || exp * 1000 > now.getTime() + TOKEN_TTL_S * 1000) return null;
  const expect = createHmac('sha256', `${secret}:booking`)
    .update(`${TOKEN_PREFIX}|${leadId}|${exp}`)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  return a.length === b.length && timingSafeEqual(a, b) ? leadId : null;
}

export async function bookingLink(sql: Sql, leadId: string, secret: string): Promise<string> {
  const cfg = await controlTx(sql, (tx) => meetingConfigTx(tx));
  return `${cfg.publicBaseUrl}/agendar?t=${bookingToken(leadId, secret)}`;
}

/** null when the boot secret was never set — callers fall back to the stored setting */
export async function bookingLinkForRunner(sql: Sql, leadId: string): Promise<string | null> {
  if (!runnerBookingSecret) return null;
  return bookingLink(sql, leadId, runnerBookingSecret);
}

export type MeetingStatus = 'scheduled' | 'cancelled' | 'done' | 'no_show';
export type MeetingSource = 'link' | 'staff' | 'agent';

export interface MeetingRow {
  id: string;
  lead_id: string | null;
  starts_at: string;
  ends_at: string;
  status: MeetingStatus;
  room_url: string | null;
  booker_name: string | null;
  booker_contact: string | null;
  source: MeetingSource;
  gcal_event_id: string | null;
  reminder_24h_at: string | null;
  reminder_1h_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export function meetingJson(row: MeetingRow & { lead_name?: string | null }) {
  return {
    id: row.id,
    leadId: row.lead_id,
    ...(row.lead_name !== undefined ? { leadName: row.lead_name } : {}),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    roomUrl: row.room_url,
    bookerName: row.booker_name,
    bookerContact: row.booker_contact,
    source: row.source,
    gcalEventId: row.gcal_event_id,
    reminder24hAt: row.reminder_24h_at,
    reminder1hAt: row.reminder_1h_at,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMeetings(
  sql: Sql,
  filter: { scope?: 'upcoming' | 'past' | 'all'; leadId?: string; from?: Date; to?: Date } = {},
): Promise<ReturnType<typeof meetingJson>[]> {
  const scope = filter.scope ?? 'upcoming';
  const conds: string[] = ['true'];
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  if (filter.leadId) conds.push(`m.lead_id = ${p(filter.leadId)}`);
  if (scope === 'upcoming') conds.push(`m.starts_at >= now() - interval '6 hours'`);
  if (scope === 'past') conds.push(`m.starts_at < now() - interval '6 hours'`);
  if (filter.from) conds.push(`m.ends_at > ${p(filter.from.toISOString())}`);
  if (filter.to) conds.push(`m.starts_at < ${p(filter.to.toISOString())}`);
  const rows = await controlTx(
    sql,
    (tx) =>
      tx.unsafe(
        `select m.*, l.name as lead_name from meetings m
           left join leads l on l.id = m.lead_id
           where ${conds.join(' and ')}
           order by m.starts_at ${scope === 'past' ? 'desc' : 'asc'}
           limit 500`,
        params as never[],
      ) as Promise<(MeetingRow & { lead_name: string | null })[]>,
  );
  return rows.map(meetingJson);
}

/** the booking page uses this to show "already booked" */
export async function nextMeetingForLead(
  sql: Sql,
  leadId: string,
): Promise<ReturnType<typeof meetingJson> | null> {
  const rows = await controlTx(
    sql,
    (tx) => tx<MeetingRow[]>`
      select * from meetings
      where lead_id = ${leadId} and status = 'scheduled' and starts_at > now() - interval '1 hour'
      order by starts_at asc limit 1
    `,
  );
  return rows[0] ? meetingJson(rows[0]) : null;
}

export function fmtWhen(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

async function writeActivityTx(
  tx: Sql,
  leadId: string,
  kind: 'meeting_booked' | 'meeting_done' | 'meeting_no_show' | 'meeting_cancelled',
  body: string,
  meta: Record<string, unknown>,
  createdBy: 'staff' | 'agent' | 'system',
): Promise<void> {
  await tx`
    insert into lead_activities (lead_id, kind, body, meta, created_by)
    values (${leadId}, ${kind}, ${body}, ${tx.json(meta as never)}, ${createdBy})
  `;
  await tx`update leads set updated_at = now() where id = ${leadId}`;
}

export interface BookInput {
  leadId: string;
  /** ISO-8601 instant — must be a legal grid slot start */
  start: string;
  bookerName?: string | null;
  bookerContact?: string | null;
  source: MeetingSource;
  /** staff bookings may override duration; link bookings use slotMinutes */
  durationMin?: number;
}

export interface BookResult {
  meeting: ReturnType<typeof meetingJson>;
  /** false when the same (lead, slot) was already booked — idempotent replay */
  created: boolean;
}

export interface BookTxInput {
  leadId: string;
  start: Date;
  bookerName: string | null;
  bookerContact: string | null;
  source: MeetingSource;
  durationMin?: number;
}

export function parseBookInput(input: BookInput): BookTxInput {
  const leadId = str(input.leadId, 'leadId', 64);
  if (!UUID_RE.test(leadId)) throw new HttpError(400, 'BAD_REQUEST', 'leadId must be a uuid');
  const start = new Date(str(input.start, 'start', 64));
  if (Number.isNaN(start.getTime())) {
    throw new HttpError(422, 'BAD_START', 'start must be an ISO-8601 timestamp');
  }
  return {
    leadId,
    start,
    bookerName: input.bookerName ? str(input.bookerName, 'name', 200) : null,
    bookerContact: input.bookerContact ? str(input.bookerContact, 'contact', 300) : null,
    source: input.source,
    ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
  };
}

/** fetch gcal busy BEFORE opening a tx — no network calls inside one */
export async function bookBusyWindows(start: Date, excludeEventId?: string | null | undefined) {
  return gcal.busyWindowsExceptEvent(
    new Date(start.getTime() - 24 * 3600_000),
    new Date(start.getTime() + 24 * 3600_000),
    excludeEventId,
  );
}

export interface BookTxResult {
  meeting: MeetingRow;
  created: boolean;
  cfg: MeetingConfig;
  lead: LeadRow;
}

/** runs inside the caller's claim — a nested claim per request would deadlock the 10-conn pool */
export async function bookMeetingTx(
  tx: Sql,
  input: BookTxInput,
  now: Date,
  gcalBusy: BusyWindow[],
): Promise<BookTxResult> {
  const { leadId, start, bookerName, bookerContact } = input;
  {
    const lead = (await tx<LeadRow[]>`select * from leads where id = ${leadId}`)[0];
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    if (lead.archived_at) throw new HttpError(409, 'LEAD_ARCHIVED', 'lead is archived');
    const cfg = await meetingConfigTx(tx);
    // replay first: a booked (lead, slot) is the caller's own — return it before slotFits counts it busy
    const existing = (
      await tx<MeetingRow[]>`
        select * from meetings where lead_id = ${leadId} and starts_at = ${start.toISOString()}
          and status = 'scheduled'
      `
    )[0];
    if (existing) return { meeting: existing, created: false as const, cfg, lead };
    // advisory lock turns check-then-write into a critical section (READ COMMITTED could double-book)
    await tx`select pg_advisory_xact_lock(hashtext('vendua.meetings.slot'))`;
    // a racing book may have committed while we waited — re-check so it replays
    const racedExisting = (
      await tx<MeetingRow[]>`
        select * from meetings where lead_id = ${leadId} and starts_at = ${start.toISOString()}
          and status = 'scheduled'
      `
    )[0];
    if (racedExisting) return { meeting: racedExisting, created: false as const, cfg, lead };
    // link books one call at a time; staff/agent bookings stay unrestricted
    if (input.source === 'link') {
      const other = (
        await tx<MeetingRow[]>`
          select * from meetings
          where lead_id = ${leadId} and status = 'scheduled' and starts_at > now() - interval '1 hour'
          order by starts_at asc limit 1
        `
      )[0];
      if (other) return { meeting: other, created: false as const, cfg, lead };
    }
    const durationMin =
      input.durationMin && Number.isInteger(input.durationMin) && input.durationMin >= 5
        ? Math.min(input.durationMin, 240)
        : cfg.slotMinutes;
    const end = new Date(start.getTime() + durationMin * 60_000);
    const dbBusy = await meetingBusyTx(
      tx,
      now,
      new Date(now.getTime() + cfg.horizonDays * 86_400_000),
    );
    if (!slotFits(cfg, start, durationMin, now, [...dbBusy, ...gcalBusy])) {
      throw new HttpError(409, 'SLOT_TAKEN', 'horário indisponível — escolha outro');
    }
    // ON CONFLICT DO NOTHING fires on the partial unique index too — a raced book reselects below
    const row = (
      await tx<MeetingRow[]>`
        insert into meetings
          (lead_id, starts_at, ends_at, status, room_url, booker_name, booker_contact, source)
        values
          (${leadId}, ${start.toISOString()}, ${end.toISOString()}, 'scheduled',
           ${cfg.roomUrl}, ${bookerName}, ${bookerContact}, ${input.source})
        on conflict do nothing
        returning *
      `
    )[0];
    if (!row) {
      const raced = (
        await tx<MeetingRow[]>`
          select * from meetings where lead_id = ${leadId} and starts_at = ${start.toISOString()}
            and status = 'scheduled'
        `
      )[0];
      if (raced) return { meeting: raced, created: false as const, cfg, lead };
      // conflict on a non-(lead,start) predicate shouldn't happen — treat as taken
      throw new HttpError(409, 'SLOT_TAKEN', 'horário indisponível — escolha outro');
    }
    // a booked call means the lead engaged — bump top-of-funnel leads to 'invited'
    const actor = input.source === 'staff' ? 'staff' : 'system';
    if (lead.state === 'lead' || lead.state === 'contacted') {
      await tx`update leads set state = 'invited', updated_at = now() where id = ${leadId}`;
      await tx`
        insert into lead_state_history (lead_id, from_state, to_state, actor)
        values (${leadId}, ${lead.state}, 'invited', ${actor})
      `;
      await tx`
        insert into lead_activities (lead_id, kind, body, meta, created_by)
        values (${leadId}, 'state_change', ${`${lead.state} → invited`},
                ${tx.json({ from: lead.state, to: 'invited', via: 'meeting_booked' } as never)},
                ${actor})
      `;
    }
    await writeActivityTx(
      tx,
      leadId,
      'meeting_booked',
      `Call marcada para ${fmtWhen(row.starts_at, cfg.tz)}`,
      { meetingId: row.id, startsAt: row.starts_at, endsAt: row.ends_at, source: input.source },
      actor,
    );
    return { meeting: row, created: true as const, cfg, lead };
  }
}

/** post-commit effects are best-effort — a Daily/gcal/mail outage must not lose a booked meeting */
export async function bookMeeting(sql: Sql, input: BookInput): Promise<BookResult> {
  const bookInput = parseBookInput(input);
  const now = new Date();
  const gcalBusy = await bookBusyWindows(bookInput.start);
  const txResult = await controlTx(sql, (tx) => bookMeetingTx(tx, bookInput, now, gcalBusy));
  if (txResult.created) {
    emitControlEvent('meeting.change', txResult.meeting.id);
    emitControlEvent('lead.change', txResult.lead.id);
  }
  // run effects for replays too — a crash post-commit leaves them unfinished; each step fills what's missing
  await meetingEffects(sql, txResult.meeting, txResult.cfg, txResult.lead, bookInput.bookerContact);
  return { meeting: meetingJson(txResult.meeting), created: txResult.created };
}

/** re-runnable effect completion for a committed booking whose post-commit steps didn't finish */
export async function ensureMeetingEffects(sql: Sql, meetingId: string): Promise<void> {
  const snap = await controlTx(sql, async (tx) => {
    const meeting = (await tx<MeetingRow[]>`select * from meetings where id = ${meetingId}`)[0];
    if (!meeting || meeting.status !== 'scheduled' || !meeting.lead_id) return {};
    const lead = (await tx<LeadRow[]>`select * from leads where id = ${meeting.lead_id}`)[0];
    if (!lead) return {};
    return { meeting, lead, cfg: await meetingConfigTx(tx) };
  });
  if (!snap.meeting || !snap.lead || !snap.cfg) return;
  await meetingEffects(sql, snap.meeting, snap.cfg, snap.lead, snap.meeting.booker_contact);
}

/** URL ending in vendua-<id> = per-meeting room; anything else is the static fallback */
function hasDailyRoom(roomUrl: string | null, meetingId: string): boolean {
  return (roomUrl ?? '').endsWith(`/vendua-${meetingId}`);
}

async function meetingEffects(
  sql: Sql,
  meeting: MeetingRow,
  cfg: MeetingConfig,
  lead: LeadRow,
  bookerContact: string | null,
): Promise<void> {
  const leadId = meeting.lead_id ?? lead.id;
  // serialize effects per meeting — concurrent runs would double-insert gcal
  // events; session advisory on a reserved conn spans the provider calls (a
  // tx lock can't), manual tx-local GUC can't leak to the next pool borrower
  const conn = await sql.reserve();
  // ReservedSql has no .begin() — drive the tx manually; the tx-local GUC auto-resets
  const withControl = async <T>(fn: (t: Sql) => Promise<T>): Promise<T> => {
    await conn`begin`;
    try {
      await conn`select set_config('vendua.control', '1', true)`;
      const out = await fn(conn);
      await conn`commit`;
      return out;
    } catch (e) {
      await conn`rollback`.catch(() => {});
      throw e;
    }
  };
  // re-read under the lock so the confirmation copy reflects post-commit state
  let locked: MeetingRow | null = null;
  try {
    await conn`select pg_advisory_lock(hashtext('vendua.meetings.effects'), hashtext(${meeting.id}))`;
    const cur = await withControl(
      async (t) => (await t<MeetingRow[]>`select * from meetings where id = ${meeting.id}`)[0],
    );
    if (!cur || cur.status !== 'scheduled') return;
    let roomUrl = cur.room_url;
    if (!roomUrl || (rooms.dailyConfigured() && !hasDailyRoom(roomUrl, cur.id))) {
      // the room URL must exist before gcal's description and the confirmation copy
      const room = await rooms.createRoom(cur.id, new Date(cur.ends_at), cfg.roomUrl);
      roomUrl = room.url;
    }
    let gcalEventId = cur.gcal_event_id;
    if (!gcalEventId) {
      gcalEventId = await gcal.insertEvent({
        summary: `Venduá · ${lead.name}`,
        description: [
          bookerContact ? `contato: ${bookerContact}` : null,
          roomUrl ? `sala: ${roomUrl}` : null,
          `lead: ${lead.name} (${leadId})`,
        ]
          .filter(Boolean)
          .join('\n'),
        start: cur.starts_at,
        end: cur.ends_at,
        tz: cfg.tz,
        leadId,
      });
    }
    if (roomUrl !== cur.room_url || gcalEventId !== cur.gcal_event_id) {
      await withControl(async (t) => {
        await t`
          update meetings set room_url = ${roomUrl}, gcal_event_id = coalesce(${gcalEventId}, gcal_event_id),
            updated_at = now()
          where id = ${cur.id}
        `;
      });
      emitControlEvent('meeting.change', cur.id);
    }
    meeting.room_url = roomUrl;
    meeting.gcal_event_id = gcalEventId ?? cur.gcal_event_id;
    locked = { ...cur, room_url: roomUrl, gcal_event_id: meeting.gcal_event_id };
  } finally {
    await conn`select pg_advisory_unlock(hashtext('vendua.meetings.effects'), hashtext(${meeting.id}))`.catch(
      () => {},
    );
    conn.release();
  }
  if (!locked) return;
  // compose+dispatch only after releasing conn — the 10-conn pool would deadlock under concurrent bookings
  if (lead.email && !lead.unsubscribed_at) {
    // unsubscribed lead can still book (fresh consent) but outbound honors the opt-out — don't leave a stranded queued message
    await queueMeetingMessage(sql, {
      leadId,
      channel: 'email',
      meetingId: locked.id,
      subject: 'Venduá — sua call está marcada',
      body: confirmationBody(locked.starts_at, locked.room_url, cfg),
      idemKey: `meeting-confirm:${locked.id}`,
    });
  }
}

function tzLabel(tz: string): string {
  return tz === 'America/Sao_Paulo'
    ? 'horário de Brasília'
    : `horário ${tz.split('/').pop()?.replace(/_/g, ' ') ?? tz}`;
}

function confirmationBody(startsAt: string, roomUrl: string | null, cfg: MeetingConfig): string {
  const when = fmtWhen(startsAt, cfg.tz);
  return [
    `Oi! Sua call com a Venduá está marcada para ${when} (${tzLabel(cfg.tz)}).`,
    '',
    roomUrl
      ? `Link da sala: ${roomUrl}`
      : 'A gente te manda o link da sala por aqui antes da call.',
    '',
    'Se precisar mudar o horário, é só responder esta mensagem.',
  ].join('\n');
}

/** compose + dispatch a system outbound; a dead attempt's `<key>:retry-N` claim composes a fresh row */
async function queueMeetingMessage(
  sql: Sql,
  opts: {
    leadId: string;
    channel: 'email' | 'whatsapp';
    /** dispatch suppresses the send when this meeting is no longer 'scheduled' */
    meetingId?: string;
    subject: string;
    body: string;
    idemKey: string;
  },
): Promise<{ queued: boolean; reason?: string | undefined }> {
  const { composeMessage } = await import('./threads.ts');
  const { dispatchMessage } = await import('../agent/send.ts');
  const prior = await controlTx(
    sql,
    async (tx) =>
      await tx<{ key: string; response: { message?: { id?: string } } }[]>`
        select key, response from control_idempotency_keys
        where key = ${opts.idemKey} or key like ${`${opts.idemKey}:retry-%`}
        order by length(key) desc, key desc
      `,
  );
  let key = prior[0]?.key ?? opts.idemKey;
  const lastMessageId = prior[0]?.response?.message?.id;
  if (lastMessageId) {
    const lastStatus = (
      await controlTx(
        sql,
        async (tx) =>
          await tx<
            { status: string }[]
          >`select status from lead_messages where id = ${lastMessageId}`,
      )
    )[0]?.status;
    if (lastStatus === 'failed') key = `${opts.idemKey}:retry-${prior.length}`;
  }
  const res = await composeMessage(
    sql,
    {
      leadId: opts.leadId,
      channel: opts.channel,
      body: opts.body,
      subject: opts.subject,
      author: 'system',
      status: 'queued',
      ...(opts.meetingId ? { meetingId: opts.meetingId } : {}),
    },
    key,
  );
  // dispatch even on a replayed claim — re-dispatch is the self-heal path; meeting_id drops the send if cancelled meanwhile
  const dispatch = await dispatchMessage(sql, res.body.message.id);
  return { queued: dispatch.ok, reason: dispatch.reason };
}

const CANCEL_MIN_NOTICE_MS = 12 * 3600_000;

/** only while the meeting is >12h out — inside that window staff cancels by hand */
export function selfCancelAllowed(startsAtMs: number, nowMs: number): boolean {
  return startsAtMs - nowMs > CANCEL_MIN_NOTICE_MS;
}

/** meetingId pins the target (else soonest upcoming); a retry on an already-cancelled target replays it */
export async function cancelByLead(
  sql: Sql,
  leadId: string,
  meetingId?: string,
): Promise<ReturnType<typeof meetingJson>> {
  const out = await controlTx(sql, async (tx) => {
    if (meetingId) {
      const target = (
        await tx<MeetingRow[]>`
          select * from meetings where id = ${meetingId} and lead_id = ${leadId} for update
        `
      )[0];
      if (!target) throw new HttpError(404, 'MEETING_NOT_FOUND', 'nenhuma call marcada');
      if (target.status === 'cancelled') return { row: target, fresh: false as const };
      if (target.status !== 'scheduled') {
        throw new HttpError(409, 'BAD_TRANSITION', `essa call já está ${target.status}`);
      }
      if (!selfCancelAllowed(new Date(target.starts_at).getTime(), Date.now())) {
        throw new HttpError(
          409,
          'CANCEL_WINDOW',
          'cancelamento só até 12h antes — fala com a gente',
        );
      }
      const cfg = await meetingConfigTx(tx);
      const cancelled = (
        await tx<MeetingRow[]>`
          update meetings set status = 'cancelled', cancelled_at = now(), updated_at = now()
          where id = ${target.id} returning *
        `
      )[0]!;
      await writeActivityTx(
        tx,
        leadId,
        'meeting_cancelled',
        `Call de ${fmtWhen(target.starts_at, cfg.tz)} cancelada pelo link`,
        { meetingId: target.id, startsAt: target.starts_at, via: 'booking_link' },
        'system',
      );
      return { row: cancelled, fresh: true as const };
    }
    const row = (
      await tx<MeetingRow[]>`
        select * from meetings
        where lead_id = ${leadId} and status = 'scheduled' and starts_at > now()
        order by starts_at asc limit 1
        for update
      `
    )[0];
    // already cancelled — replay the row instead of a 404
    if (!row) {
      const replay = (
        await tx<MeetingRow[]>`
          select * from meetings
          where lead_id = ${leadId} and status = 'cancelled'
          order by cancelled_at desc limit 1
        `
      )[0];
      if (replay) return { row: replay, fresh: false as const };
      throw new HttpError(404, 'MEETING_NOT_FOUND', 'nenhuma call marcada');
    }
    if (!selfCancelAllowed(new Date(row.starts_at).getTime(), Date.now())) {
      throw new HttpError(409, 'CANCEL_WINDOW', 'cancelamento só até 12h antes — fala com a gente');
    }
    const cfg = await meetingConfigTx(tx);
    const cancelled = (
      await tx<MeetingRow[]>`
        update meetings set status = 'cancelled', cancelled_at = now(), updated_at = now()
        where id = ${row.id} returning *
      `
    )[0]!;
    await writeActivityTx(
      tx,
      leadId,
      'meeting_cancelled',
      `Call de ${fmtWhen(row.starts_at, cfg.tz)} cancelada pelo link`,
      { meetingId: row.id, startsAt: row.starts_at, via: 'booking_link' },
      'system',
    );
    return { row: cancelled, fresh: true as const };
  });
  if (out.fresh) {
    emitControlEvent('meeting.change', out.row.id);
    if (out.row.lead_id) emitControlEvent('lead.change', out.row.lead_id);
  }
  // delete runs on replays too; gcal_event_id clears only on success so a failed delete stays retryable
  if (out.row.gcal_event_id) {
    if (await gcal.deleteEvent(out.row.gcal_event_id)) {
      await controlTx(
        sql,
        async (tx) =>
          await tx`update meetings set gcal_event_id = null, updated_at = now() where id = ${out.row.id} and status = 'cancelled'`,
      );
      out.row.gcal_event_id = null;
    } else {
      mlog.warn({ meetingId: out.row.id }, 'gcal delete failed — event id kept for retry');
    }
  }
  return meetingJson(out.row);
}

/** bring the tracked event to the row's window — durable retry for a mid-sync crash; PATCH when live, replace when gone, keep id when unreachable; mutates row.gcal_event_id */
async function reconcileMeetingEvent(sql: Sql, row: MeetingRow, cfg: MeetingConfig): Promise<void> {
  const wantStart = new Date(row.starts_at).getTime();
  const wantEnd = new Date(row.ends_at).getTime();
  let id = row.gcal_event_id;
  if (id) {
    const probe = await gcal.eventWindow(id);
    if (probe.state === 'unknown') return; // transient — next pass retries
    if (probe.state === 'ok') {
      if (probe.start.getTime() === wantStart && probe.end.getTime() === wantEnd) return;
      if (await gcal.updateEvent(id, { start: row.starts_at, end: row.ends_at, tz: cfg.tz })) {
        return; // synced in place — nothing to persist
      }
      if (!(await gcal.deleteEvent(id))) return; // unreachable — keep the id
    }
    // 'gone', or drifted + deleted — fall through to replace
    id = null;
  }
  const leadName = row.lead_id
    ? (
        await controlTx(
          sql,
          async (tx) =>
            await tx<{ name: string }[]>`select name from leads where id = ${row.lead_id}`,
        )
      )[0]?.name
    : null;
  const newId = await gcal.insertEvent({
    summary: `Venduá · ${leadName ?? 'call'}`,
    start: row.starts_at,
    end: row.ends_at,
    tz: cfg.tz,
    leadId: row.lead_id,
  });
  if (newId === row.gcal_event_id) return; // was already null and insert failed
  // write only when the row still matches what we read — on miss, delete the event we just made
  const wrote = await controlTx(
    sql,
    async (tx) =>
      await tx`
        update meetings set gcal_event_id = ${newId}, updated_at = now()
        where id = ${row.id} and status = 'scheduled'
          and gcal_event_id is not distinct from ${row.gcal_event_id}
          and starts_at = ${row.starts_at} and ends_at = ${row.ends_at}
      `,
  );
  if (wrote.count === 0) {
    if (newId) await gcal.deleteEvent(newId);
    mlog.warn({ meetingId: row.id }, 'gcal reconcile raced a row change — discarded new event');
    return;
  }
  row.gcal_event_id = newId;
}

export interface PatchMeetingInput {
  status?: 'cancelled' | 'done' | 'no_show';
  startsAt?: string;
  endsAt?: string;
}

/** status transitions + reschedule; timeline activity + gcal/room sync after commit */
export async function patchMeeting(
  sql: Sql,
  id: string,
  input: PatchMeetingInput,
  idemKey: string,
): Promise<{
  status: number;
  body: { meeting: ReturnType<typeof meetingJson> };
  replayed: boolean;
}> {
  // gcal busy read precedes the claim tx — freebusy can't name events, so excluding this meeting needs its own gcal_event_id via events.list
  const gcalBusy = input.startsAt
    ? await gcal.busyWindowsExceptEvent(
        new Date(new Date(input.startsAt).getTime() - 24 * 3600_000),
        new Date(new Date(input.startsAt).getTime() + 24 * 3600_000),
        (
          await controlTx(
            sql,
            async (tx) =>
              (
                await tx<
                  { gcal_event_id: string | null }[]
                >`select gcal_event_id from meetings where id = ${id}`
              )[0],
          )
        )?.gcal_event_id ?? null,
      )
    : [];
  // object-ref keeps the union — TS narrows `= null` on a local
  const committed: {
    row?: MeetingRow;
    cfg?: MeetingConfig;
    prevStart?: string;
    prevGcalId?: string | null;
  } = {};
  const res = await claimControl(sql, idemKey, async (tx) => {
    const row = (await tx<MeetingRow[]>`select * from meetings where id = ${id} for update`)[0];
    if (!row) throw new HttpError(404, 'MEETING_NOT_FOUND', 'meeting not found');
    const cfg = await meetingConfigTx(tx);
    const leadId = row.lead_id;

    const wantsStatus = input.status !== undefined;
    const wantsTime = input.startsAt !== undefined || input.endsAt !== undefined;
    if (!wantsStatus && !wantsTime) {
      throw new HttpError(422, 'BAD_REQUEST', 'nothing to update');
    }
    if (wantsStatus && wantsTime) {
      throw new HttpError(422, 'BAD_REQUEST', 'status and time change go in separate requests');
    }

    if (wantsStatus) {
      const target = input.status!;
      // allowed: scheduled → cancelled|done|no_show, done ↔ no_show
      const allowed =
        (row.status === 'scheduled' && ['cancelled', 'done', 'no_show'].includes(target)) ||
        (row.status === 'done' && target === 'no_show') ||
        (row.status === 'no_show' && target === 'done');
      if (!allowed) {
        throw new HttpError(409, 'BAD_TRANSITION', `can't move ${row.status} → ${target}`);
      }
      const updated = (
        await tx<MeetingRow[]>`
          update meetings set status = ${target}, updated_at = now(),
            cancelled_at = ${target === 'cancelled' ? new Date().toISOString() : row.cancelled_at}
          where id = ${row.id} returning *
        `
      )[0]!;
      if (leadId) {
        const kind = (
          {
            cancelled: 'meeting_cancelled',
            done: 'meeting_done',
            no_show: 'meeting_no_show',
          } as const
        )[target];
        const label = (
          {
            cancelled: 'Call cancelada',
            done: 'Call realizada',
            no_show: 'No-show na call',
          } as const
        )[target];
        await writeActivityTx(
          tx,
          leadId,
          kind,
          `${label} (${fmtWhen(row.starts_at, cfg.tz)})`,
          { meetingId: row.id, startsAt: row.starts_at },
          'staff',
        );
        if (target === 'no_show') {
          // one open re-engagement task per lead — flip-flops must not stack duplicates
          await tx`
            insert into lead_tasks (lead_id, title, due_at, created_by)
            select ${leadId}, ${`Reengajar após no-show da call de ${fmtWhen(row.starts_at, cfg.tz)}`},
                   ${new Date(Date.now() + 24 * 3600_000).toISOString()}, 'agent'
            where not exists (
              select 1 from lead_tasks
              where lead_id = ${leadId} and done_at is null and created_by = 'agent'
                and title like 'Reengajar após no-show da call%'
            )
          `;
        }
        if (target === 'done') {
          // done after no_show means the call happened — close the re-engagement task
          await tx`
            update lead_tasks set done_at = now()
            where lead_id = ${leadId} and done_at is null and created_by = 'agent'
              and title like 'Reengajar após no-show da call%'
          `;
        }
      }
      committed.row = updated;
      committed.cfg = cfg;
      return { status: 200, body: { meeting: meetingJson(updated) } };
    }

    // only a scheduled meeting moves; new slot must fit the grid, own row excluded
    if (row.status !== 'scheduled') {
      throw new HttpError(409, 'BAD_TRANSITION', `can't reschedule a ${row.status} meeting`);
    }
    const start = new Date(str(input.startsAt, 'startsAt', 64));
    if (Number.isNaN(start.getTime())) {
      throw new HttpError(422, 'BAD_START', 'startsAt must be an ISO-8601 timestamp');
    }
    const durationMin = input.endsAt
      ? Math.round((new Date(input.endsAt).getTime() - start.getTime()) / 60_000)
      : Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000);
    if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > 240) {
      throw new HttpError(422, 'BAD_END', 'endsAt must be 5–240min after startsAt');
    }
    const end = new Date(start.getTime() + durationMin * 60_000);
    const now = new Date();
    // same advisory section as bookMeeting — reschedule can't race a booking's busy check
    await tx`select pg_advisory_xact_lock(hashtext('vendua.meetings.slot'))`;
    const dbBusy = await meetingBusyTx(
      tx,
      now,
      new Date(now.getTime() + cfg.horizonDays * 86_400_000),
      row.id,
    );
    if (!slotFits(cfg, start, durationMin, now, [...dbBusy, ...gcalBusy])) {
      throw new HttpError(409, 'SLOT_TAKEN', 'horário indisponível');
    }
    const updated = (
      await tx<MeetingRow[]>`
        update meetings set starts_at = ${start.toISOString()}, ends_at = ${end.toISOString()},
          updated_at = now()
        where id = ${row.id} returning *
      `
    )[0]!;
    if (leadId) {
      await writeActivityTx(
        tx,
        leadId,
        'meeting_booked',
        `Call remarcada para ${fmtWhen(start.toISOString(), cfg.tz)}`,
        {
          meetingId: row.id,
          startsAt: start.toISOString(),
          endsAt: end.toISOString(),
          rescheduledFrom: row.starts_at,
        },
        'staff',
      );
    }
    committed.row = updated;
    committed.cfg = cfg;
    committed.prevStart = row.starts_at;
    committed.prevGcalId = row.gcal_event_id;
    return { status: 200, body: { meeting: meetingJson(updated) } };
  });
  if (committed.row) {
    emitControlEvent('meeting.change', committed.row.id);
    if (committed.row.lead_id) emitControlEvent('lead.change', committed.row.lead_id);
  }

  // post-commit gcal/room sync — runs on replayed claims too; each step fills or rewrites a stored marker
  const row =
    committed.row ??
    (await controlTx(
      sql,
      async (tx) => (await tx<MeetingRow[]>`select * from meetings where id = ${id}`)[0],
    ));
  const cfg =
    committed.cfg ?? (row ? await controlTx(sql, (tx) => meetingConfigTx(tx)) : undefined);
  if (row && cfg) {
    if (row.status === 'cancelled' && row.gcal_event_id) {
      // stored id doubles as the "sync pending" marker — a failed delete warns and keeps it (a 500 would send the retry into BAD_TRANSITION)
      if (!(await gcal.deleteEvent(row.gcal_event_id))) {
        mlog.warn({ meetingId: row.id }, 'gcal delete failed — event id kept, replay retries it');
      } else {
        await controlTx(
          sql,
          async (tx) =>
            await tx`update meetings set gcal_event_id = null, updated_at = now() where id = ${row.id} and status = 'cancelled'`,
        );
        row.gcal_event_id = null;
      }
    } else if (row.status === 'scheduled' && input.startsAt !== undefined) {
      if (committed.prevStart === undefined) {
        // claim replay — reconcile heals whatever the event still needs
        await reconcileMeetingEvent(sql, row, cfg);
        await rooms.bumpRoomExpiry(row.room_url, new Date(row.ends_at));
      } else {
        // prefer PATCH in place — a failed update leaves no untracked event; delete+insert only when the old event is gone
        let synced = false;
        let prevGone = !committed.prevGcalId;
        if (committed.prevGcalId) {
          synced = await gcal.updateEvent(committed.prevGcalId, {
            start: row.starts_at,
            end: row.ends_at,
            tz: cfg.tz,
          });
          if (!synced) prevGone = await gcal.deleteEvent(committed.prevGcalId);
          if (!synced && !prevGone) {
            // both failed — keep tracking the old id; a later PATCH heals the times
            mlog.warn(
              { meetingId: row.id, eventId: committed.prevGcalId },
              'gcal reschedule failed — stored event kept at old time for retry',
            );
          }
        }
        if (!synced && prevGone) {
          const newId = await gcal.insertEvent({
            summary: 'Venduá · call remarcada',
            start: row.starts_at,
            end: row.ends_at,
            tz: cfg.tz,
            leadId: row.lead_id,
          });
          if (newId !== committed.prevGcalId) {
            await controlTx(sql, async (tx) => {
              await tx`update meetings set gcal_event_id = ${newId}, updated_at = now() where id = ${row.id}`;
            });
            row.gcal_event_id = newId;
          }
        }
        await rooms.bumpRoomExpiry(row.room_url, new Date(row.ends_at));
      }
    }
    return { status: res.status, body: { meeting: meetingJson(row) }, replayed: res.replayed };
  }
  return { status: res.status, body: res.body, replayed: res.replayed };
}

// reminder sweep — called from the agent worker tick

const REMINDER_24H_MS = 24 * 3600_000;
const REMINDER_1H_MS = 3600_000;

// in-memory scan watermark — on restart the scan resumes from id 0
let reconcileCursor: string | null = null;

function reminderBody(kind: '24h' | '1h', meeting: MeetingRow, cfg: MeetingConfig): string {
  const when = fmtWhen(meeting.starts_at, cfg.tz);
  const room = meeting.room_url ? `\nSala: ${meeting.room_url}` : '';
  return kind === '24h'
    ? `Oi! Lembrete: temos call marcada para ${when}.${room}\nQualquer imprevisto, me avisa por aqui.`
    : `Oi! Nossa call começa daqui a ~1h (${when}).${room}`;
}

/** send due reminders; skipped (marker stays null → retried next tick) when the guardrail says no/draft or no channel is reachable */
export async function sweepMeetingReminders(sql: Sql): Promise<number> {
  const { composeMessageTx } = await import('./threads.ts');
  const { resolveChannelTx, checkSendAllowedTx } = await import('../agent/guardrails.ts');
  const { DEFAULT_GUARDRAILS, getSettingTx } = await import('./integrations.ts');
  const { dispatchMessage } = await import('../agent/send.ts');

  let sent = 0;
  const due = await controlTx(
    sql,
    (tx) => tx<MeetingRow[]>`
      select * from meetings
      where status = 'scheduled'
        and (reminder_24h_at is null or reminder_1h_at is null)
        and starts_at > now() - interval '10 minutes'
        and starts_at < now() + interval '24 hours'
      order by starts_at asc
      limit 50
    `,
  );
  for (const m of due) {
    if (!m.lead_id) continue;
    const claim = await controlTx(sql, async (tx) => {
      // lock and re-derive under the lock — a concurrent sweep or cancel can't double-send
      const cur = (await tx<MeetingRow[]>`select * from meetings where id = ${m.id} for update`)[0];
      if (!cur || cur.status !== 'scheduled' || !cur.lead_id) return null;
      const msToStart = new Date(cur.starts_at).getTime() - Date.now();
      const want1 = cur.reminder_1h_at === null && msToStart <= REMINDER_1H_MS;
      const want24 = cur.reminder_24h_at === null && msToStart <= REMINDER_24H_MS;
      if (!want1 && !want24) return null;
      const kind: '1h' | '24h' = want1 ? '1h' : '24h';
      const cfg = await meetingConfigTx(tx);
      const pick = await resolveChannelTx(tx, cur.lead_id, {});
      if (!pick.ok || pick.channel === 'manual') return null;
      const stored = await getSettingTx<Record<string, unknown>>(tx, 'guardrails', {});
      const g = { ...DEFAULT_GUARDRAILS, ...stored } as Guardrails;
      const verdict = await checkSendAllowedTx(tx, g, cur.lead_id, pick.channel);
      // draft-required or hard block → leave the marker unset for the next tick
      if (!verdict.ok || verdict.forceDraft) return null;
      const composed = await composeMessageTx(tx, {
        leadId: cur.lead_id,
        channel: pick.channel,
        body: reminderBody(kind, cur, cfg),
        ...(pick.channel === 'email' ? { subject: 'Venduá — lembrete da call' } : {}),
        author: 'system',
        status: 'queued',
        meetingId: cur.id,
      });
      const claimed24 = cur.reminder_24h_at === null;
      if (kind === '1h') {
        await tx`update meetings set reminder_1h_at = now(), reminder_24h_at = coalesce(reminder_24h_at, now()), updated_at = now() where id = ${cur.id}`;
      } else {
        await tx`update meetings set reminder_24h_at = now(), updated_at = now() where id = ${cur.id}`;
      }
      return { messageId: composed.body.message.id, kind, claimed24 };
    });
    if (!claim) continue;
    const dispatch = await dispatchMessage(sql, claim.messageId);
    if (dispatch.ok) {
      sent++;
    } else {
      // dispatch failed → release claimed markers so a later tick retries; the failed row stays as the record
      await controlTx(sql, async (tx) => {
        if (claim.kind === '1h' && claim.claimed24) {
          await tx`update meetings set reminder_1h_at = null, reminder_24h_at = null, updated_at = now() where id = ${m.id}`;
        } else if (claim.kind === '1h') {
          await tx`update meetings set reminder_1h_at = null, updated_at = now() where id = ${m.id}`;
        } else {
          await tx`update meetings set reminder_24h_at = null, updated_at = now() where id = ${m.id}`;
        }
      });
      mlog.warn({ meetingId: m.id, reason: dispatch.reason }, 'meeting reminder dispatch failed');
    }
  }
  // heal bookings whose post-commit effects never ran; scoped to artifacts a configured provider should have produced
  const wantGcal = gcal.gcalConfigured();
  const wantDaily = rooms.dailyConfigured();
  if (wantGcal || wantDaily) {
    const pending = await controlTx(
      sql,
      (tx) => tx<{ id: string }[]>`
        select id from meetings
        where status = 'scheduled'
          and starts_at > now() - interval '10 minutes'
          and ((${wantGcal} and gcal_event_id is null)
            or (${wantDaily} and room_url is null))
        order by created_at asc
        limit 20
      `,
    );
    for (const p of pending) {
      await ensureMeetingEffects(sql, p.id).catch((err) =>
        mlog.warn({ meetingId: p.id, err }, 'meeting effects heal failed'),
      );
    }
  }
  // reconcile gcal events drifted by mid-reschedule outages; the cursor keeps a static order from starving the tail
  if (wantGcal) {
    let driftCandidates: MeetingRow[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      driftCandidates = await controlTx(
        sql,
        (tx) => tx<MeetingRow[]>`
          select * from meetings
          where status = 'scheduled' and gcal_event_id is not null
            and starts_at > now() - interval '10 minutes'
            and (${reconcileCursor ?? null}::uuid is null or id > ${reconcileCursor ?? null}::uuid)
          order by id asc
          limit 20
        `,
      );
      if (driftCandidates.length) break;
      reconcileCursor = null; // wrapped past the end — rescan from the top
    }
    if (driftCandidates.length) {
      reconcileCursor = driftCandidates[driftCandidates.length - 1]!.id;
      const cfg = await controlTx(sql, (tx) => meetingConfigTx(tx));
      for (const m of driftCandidates) {
        await reconcileMeetingEvent(sql, m, cfg).catch((err) =>
          mlog.warn({ meetingId: m.id, err }, 'meeting event reconcile failed'),
        );
      }
    }
    // reap cancelled rows' gcal_event_id — a failed delete leaves it as the retry marker
    const stale = await controlTx(
      sql,
      (tx) => tx<{ id: string; gcal_event_id: string }[]>`
        select id, gcal_event_id from meetings
        where status = 'cancelled' and gcal_event_id is not null
        order by cancelled_at asc
        limit 20
      `,
    );
    for (const s of stale) {
      if (!(await gcal.deleteEvent(s.gcal_event_id))) continue;
      await controlTx(
        sql,
        async (tx) =>
          await tx`update meetings set gcal_event_id = null, updated_at = now() where id = ${s.id} and status = 'cancelled'`,
      );
    }
  }
  return sent;
}

export async function meetingsStatus(sql: Sql) {
  const cfg = await controlTx(sql, (tx) => meetingConfigTx(tx));
  return {
    cfg: {
      roomUrl: cfg.roomUrl,
      publicBaseUrl: cfg.publicBaseUrl,
      tz: cfg.tz,
      slotMinutes: cfg.slotMinutes,
      bufferMinutes: cfg.bufferMinutes,
      horizonDays: cfg.horizonDays,
      weekly: weeklyToJson(cfg.weekly),
      bookingUrl: cfg.bookingUrl,
    },
    room: {
      provider: rooms.dailyConfigured() ? ('daily' as const) : ('static' as const),
      lastError: rooms.roomLastError(),
    },
    gcal: gcal.gcalStatus(),
  };
}
