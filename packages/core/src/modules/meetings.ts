/**
 * modules/meetings — CRM-native meeting booking.
 *
 * The lead-facing flow: agent (or staff) mints an HMAC booking link → the
 * public `/agendar` page reads slots from `/book/v1/slots?t=` →
 * `/book/v1/book` validates the slot is still on the grid and free, inserts
 * the meeting (the unique (lead_id, starts_at) partial index makes replays
 * return the same row), provisions a video room (Daily.co per-meeting room
 * when DAILY_API_KEY is set, else the configured static roomUrl), syncs to
 * Google Calendar when configured, and queues a confirmation message.
 *
 * Availability is rules-first: weekly windows × horizon, minus a buffer
 * around existing meetings, minus gcal busy windows when the calendar envs
 * are present. All wall-clock math runs in the configured meeting tz via
 * platform/tz.ts — no manual offset arithmetic.
 *
 * Reminders piggyback on the agent worker tick (runner.ts calls
 * sweepMeetingReminders next to the discovery-briefs sweep). They are NOT
 * agent runs — system-authored messages that still obey the send guardrails.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Sql } from '../platform/db.ts';
import { HttpError, str, UUID_RE } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import { addDays, hhmmToMinutes, localDateOf, localParts, zonedInstant } from '../platform/tz.ts';
import { claimControl, controlTx } from './control.ts';
import { getSettingTx, type Guardrails } from './integrations.ts';
import type { LeadRow } from './leads.ts';
import * as gcal from './gcal.ts';
import * as rooms from './rooms.ts';

const mlog = log.child({ mod: 'meetings' });

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

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

/** The JSON shape stored in control_settings.meeting — day-name keys. */
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

/** Stored settings JSON → normalized config. Malformed pieces fall back to
 *  defaults rather than breaking booking (validateSetting guards writes;
 *  this tolerates rows written before validation existed). */
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

/** Normalized config → the day-name JSON shape the Settings UI edits. */
export function weeklyToJson(weekly: WeeklyWindows): Record<DayKey, [string, string][]> {
  const hhmm = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const out = {} as Record<DayKey, [string, string][]>;
  DAY_KEYS.forEach((key, idx) => {
    out[key] = (weekly[idx] ?? []).map(([o, c]) => [hhmm(o), hhmm(c)] as [string, string]);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Slots — pure computation, testable
// ---------------------------------------------------------------------------

export interface Slot {
  start: Date;
  end: Date;
}

export interface BusyWindow {
  start: Date;
  end: Date;
}

/** Calendar-day distance a→b (both local dates in cfg.tz). */
function dayDiff(a: ReturnType<typeof localDateOf>, b: ReturnType<typeof localDateOf>): number {
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}

/** Does `start` land on the slot grid — a weekly window, aligned to
 *  slotMinutes from window open, whole duration inside the window, within
 *  the horizon, and in the future? */
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

/** Does [start,end) overlap any busy window padded by bufferMinutes? */
export function isFree(start: Date, end: Date, busy: BusyWindow[], bufferMinutes: number): boolean {
  const buf = bufferMinutes * 60_000;
  const s = start.getTime();
  const e = end.getTime();
  return !busy.some((b) => s < b.end.getTime() + buf && e > b.start.getTime() - buf);
}

/** Does [start, start+durationMin) fit the grid and stay clear of busy? */
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

/**
 * Available slots: each weekly window × horizonDays, stepped in slotMinutes,
 * minus slots already past, minus anything overlapping a busy window padded
 * by bufferMinutes on both sides (the buffer keeps meetings from butting
 * against each other). All candidate instants come from wall-clock times in
 * cfg.tz, so a São Paulo 09:00 is 09:00 regardless of server tz.
 */
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

/** Scheduled meetings as busy windows overlapping [from, to). */
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

/** Full availability for the public slots endpoint: meetings busy ∪ gcal
 *  busy (when configured). gcal is queried outside any transaction. */
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

// ---------------------------------------------------------------------------
// Booking tokens — same HMAC style as mintSessionToken (platform/http.ts):
// <prefix>.<payload>.<sig>, sig = hmac(secret, domain|payload).
// ---------------------------------------------------------------------------

const TOKEN_PREFIX = 'vbt';
const TOKEN_TTL_S = 30 * 24 * 3600; // 30d

// The worker (agent/runner) mints booking links too but never sees the app
// secrets — index.ts calls this once at boot with staffSecret. Unset →
// agent links fall back to the static `meeting.bookingUrl` setting.
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

/** Returns the lead_id for a valid token, null for malformed/expired. */
export function verifyBookingToken(token: string, secret: string, now = new Date()): string | null {
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return null;
  const leadId = parts[1]!;
  const exp = Number(parts[2]);
  const sig = parts[3]!;
  if (!Number.isInteger(exp) || exp * 1000 < now.getTime()) return null;
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

/** Runner-side mint — null when the boot secret was never set (tests,
 *  bare workers), letting callers fall back to the stored setting. */
export async function bookingLinkForRunner(sql: Sql, leadId: string): Promise<string | null> {
  if (!runnerBookingSecret) return null;
  return bookingLink(sql, leadId, runnerBookingSecret);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

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

/** The lead's next scheduled meeting — the booking page uses it to show an
 *  "already booked" state instead of offering slots. */
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

// ---------------------------------------------------------------------------
// Booking
// ---------------------------------------------------------------------------

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

/**
 * The booking pipeline shared by the public endpoint and staff POST:
 * validate slot → insert (idempotent) → state bump + activity → room + gcal
 * + confirmation after commit. Post-commit effects are best-effort — a
 * Daily/gcal/mail outage must not lose a booked meeting.
 */
export async function bookMeeting(sql: Sql, input: BookInput): Promise<BookResult> {
  const leadId = str(input.leadId, 'leadId', 64);
  if (!UUID_RE.test(leadId)) throw new HttpError(400, 'BAD_REQUEST', 'leadId must be a uuid');
  const start = new Date(str(input.start, 'start', 64));
  if (Number.isNaN(start.getTime())) {
    throw new HttpError(422, 'BAD_START', 'start must be an ISO-8601 timestamp');
  }
  const bookerName = input.bookerName ? str(input.bookerName, 'name', 200) : null;
  const bookerContact = input.bookerContact ? str(input.bookerContact, 'contact', 300) : null;
  const now = new Date();

  // gcal busy read happens BEFORE the tx — never hold a connection/lock over
  // a network call. On failure it contributes nothing (rules-only fallback).
  const gcalBusy = await gcal.busyWindows(
    new Date(start.getTime() - 24 * 3600_000),
    new Date(start.getTime() + 24 * 3600_000),
  );

  const txResult = await controlTx(sql, async (tx) => {
    const lead = (await tx<LeadRow[]>`select * from leads where id = ${leadId}`)[0];
    if (!lead) throw new HttpError(404, 'LEAD_NOT_FOUND', 'lead not found');
    if (lead.archived_at) throw new HttpError(409, 'LEAD_ARCHIVED', 'lead is archived');
    const cfg = await meetingConfigTx(tx);
    // Idempotent replay first: a booked (lead, slot) is the caller's own
    // meeting — return it before slotFits counts it as busy.
    const existing = (
      await tx<MeetingRow[]>`
        select * from meetings where lead_id = ${leadId} and starts_at = ${start.toISOString()}
          and status = 'scheduled'
      `
    )[0];
    if (existing) return { meeting: existing, created: false as const, cfg, lead };
    // Serialize the busy check + insert across concurrent bookings: at READ
    // COMMITTED two transactions could both see the slot free — the advisory
    // lock turns check-then-write into a critical section.
    await tx`select pg_advisory_xact_lock(hashtext('vendua.meetings.slot'))`;
    // A racing book for this same (lead, slot) may have committed while we
    // waited on the lock — re-check so it replays instead of 409ing.
    const racedExisting = (
      await tx<MeetingRow[]>`
        select * from meetings where lead_id = ${leadId} and starts_at = ${start.toISOString()}
          and status = 'scheduled'
      `
    )[0];
    if (racedExisting) return { meeting: racedExisting, created: false as const, cfg, lead };
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
    // No arbiter target: ON CONFLICT DO NOTHING fires on the partial unique
    // index too — a concurrent book for the same slot reselects below.
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
      // Conflict was against a non-(lead,start) predicate — shouldn't happen
      // with the single partial index; treat as taken.
      throw new HttpError(409, 'SLOT_TAKEN', 'horário indisponível — escolha outro');
    }
    // A booked call means the lead engaged — move them to 'invited' when
    // they're still at the top of the funnel (same write shape updateLead
    // uses for transitions).
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
  });

  const { meeting, cfg, lead } = txResult;
  // Post-commit effects run for replays too — a crash between the insert
  // commit and here leaves room_url/gcal/confirmation unfinished, and a
  // retried request is the natural retry point. Each step fills only what's
  // missing, so re-running is safe.
  await meetingEffects(sql, meeting, cfg, lead, bookerContact);
  return { meeting: meetingJson(meeting), created: txResult.created };
}

/** Re-runnable effect completion for a meeting whose booking committed but
 *  whose post-commit steps may not have finished (crash mid-effects, then a
 *  claim/idempotency replay that skips the work fn). Called by routes on
 *  replayed responses; no-ops when everything is already in place. */
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

/** Per-meeting room URL ends with `vendua-<meetingId>` — anything else on
 *  the row is the static fallback (or nothing), i.e. the Daily step failed
 *  or never ran. */
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
  let roomUrl = meeting.room_url;
  if (!roomUrl || (rooms.dailyConfigured() && !hasDailyRoom(roomUrl, meeting.id))) {
    // Order matters: the room URL must exist before gcal's description and
    // the confirmation copy are written.
    const room = await rooms.createRoom(meeting.id, new Date(meeting.ends_at), cfg.roomUrl);
    roomUrl = room.url;
  }
  let gcalEventId = meeting.gcal_event_id;
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
      start: meeting.starts_at,
      end: meeting.ends_at,
      tz: cfg.tz,
      leadId,
    });
  }
  if (roomUrl !== meeting.room_url || gcalEventId !== meeting.gcal_event_id) {
    await controlTx(sql, async (tx) => {
      await tx`
        update meetings set room_url = ${roomUrl}, gcal_event_id = coalesce(${gcalEventId}, gcal_event_id),
          updated_at = now()
        where id = ${meeting.id}
      `;
    });
    meeting.room_url = roomUrl;
    meeting.gcal_event_id = gcalEventId ?? meeting.gcal_event_id;
  }
  // An unsubscribed lead can still book (clicking the link is fresh consent),
  // but outbound honors the opt-out — dispatchMessage would refuse anyway, so
  // don't leave a stranded 'queued' message on the thread.
  if (lead.email && !lead.unsubscribed_at) {
    await queueMeetingMessage(sql, {
      leadId,
      channel: 'email',
      subject: 'Venduá — sua call está marcada',
      body: confirmationBody(meeting.starts_at, roomUrl, cfg),
      idemKey: `meeting-confirm:${meeting.id}`,
    });
  }
}

function tzLabel(tz: string): string {
  return tz === 'America/Sao_Paulo' ? 'horário de Brasília' : `horário ${tz.split('/').pop()?.replace(/_/g, ' ') ?? tz}`;
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

/** Compose a system-authored outbound and dispatch it — used for booking
 *  confirmations. The deterministic idemKey makes a retry replay instead of
 *  duplicating the message. */
async function queueMeetingMessage(
  sql: Sql,
  opts: {
    leadId: string;
    channel: 'email' | 'whatsapp';
    subject: string;
    body: string;
    idemKey: string;
  },
): Promise<{ queued: boolean; reason?: string | undefined }> {
  const { composeMessage } = await import('./threads.ts');
  const { dispatchMessage } = await import('../agent/send.ts');
  const res = await composeMessage(
    sql,
    {
      leadId: opts.leadId,
      channel: opts.channel,
      body: opts.body,
      subject: opts.subject,
      author: 'system',
      status: 'queued',
    },
    opts.idemKey,
  );
  // Dispatch even on a replayed claim: a crash between compose and dispatch
  // leaves the row 'queued' — dispatchMessage no-ops on terminal states, so
  // re-dispatch is also the self-heal path.
  const dispatch = await dispatchMessage(sql, res.body.message.id);
  return { queued: dispatch.ok, reason: dispatch.reason };
}

// ---------------------------------------------------------------------------
// Cancel / reschedule / status
// ---------------------------------------------------------------------------

const CANCEL_MIN_NOTICE_MS = 12 * 3600_000;

/** Lead-initiated cancel is only allowed while the meeting is still more
 *  than 12h out — inside that window staff cancels it by hand. */
export function selfCancelAllowed(startsAtMs: number, nowMs: number): boolean {
  return startsAtMs - nowMs > CANCEL_MIN_NOTICE_MS;
}

/**
 * Public-token cancel: the soonest upcoming scheduled meeting of the token's
 * lead, only while it's still >12h away. Returns the cancelled row.
 */
export async function cancelByLead(
  sql: Sql,
  leadId: string,
): Promise<ReturnType<typeof meetingJson>> {
  const out = await controlTx(sql, async (tx) => {
    const row = (
      await tx<MeetingRow[]>`
        select * from meetings
        where lead_id = ${leadId} and status = 'scheduled' and starts_at > now()
        order by starts_at asc limit 1
        for update
      `
    )[0];
    // Replay: the upcoming meeting was already cancelled (e.g. a retry whose
    // first response was lost) — return it instead of a 404.
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
  // Delete runs on replays too — a first attempt may have crashed before or
  // during it. gcal_event_id is only cleared on success so a failed delete
  // stays retryable on the next cancel attempt instead of leaking a busy
  // calendar event.
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

export interface PatchMeetingInput {
  status?: 'cancelled' | 'done' | 'no_show';
  startsAt?: string;
  endsAt?: string;
}

/**
 * Staff PATCH: status transitions + reschedule. Writes the matching timeline
 * activity and syncs gcal + room expiry after commit (cancel → gcal delete;
 * reschedule → gcal delete+insert, daily-room exp bump).
 */
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
  // gcal busy read for a reschedule must precede the claim tx — never hold
  // the claim transaction open over a network call.
  const gcalBusy = input.startsAt
    ? await gcal.busyWindows(
        new Date(new Date(input.startsAt).getTime() - 24 * 3600_000),
        new Date(new Date(input.startsAt).getTime() + 24 * 3600_000),
      )
    : [];
  // Object-ref instead of a narrowed local — TS narrows `= null` to null and
  // can't see the closure assignment; a property read keeps the union.
  const committed: { row?: MeetingRow; cfg?: MeetingConfig } = {};
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
      // Allowed: scheduled → cancelled|done|no_show, and done ↔ no_show
      // (marking the wrong outcome is a normal correction).
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
          // One open re-engagement task per lead — a no_show → done → no_show
          // flip-flop must not stack duplicates.
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
          // A done verdict after no_show means the call happened — the
          // re-engagement task is moot, close it instead of leaving it open.
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

    // Reschedule: only a scheduled meeting moves; the new slot must fit the
    // grid and stay clear of busy (this meeting's own row excluded).
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
    // Same advisory section as bookMeeting — reschedule can't run its busy
    // check concurrently with a booking for the same slot.
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
    return { status: 200, body: { meeting: meetingJson(updated) } };
  });

  // Post-commit gcal/room sync — runs on replayed claims too: a crash
  // between claim commit and here leaves the calendar unsynced, and the
  // retried request is the retry point. Every step fills or rewrites a
  // stored marker so re-running is safe.
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
      // The stored id doubles as the "gcal sync pending" marker — cleared only
      // on success so a replay retries a failed delete instead of orphaning
      // the event. Throwing surfaces a 500 whose retry replays the claim and
      // lands right back here.
      if (!(await gcal.deleteEvent(row.gcal_event_id))) {
        throw new Error(`gcal delete failed for meeting ${row.id} — retry the request`);
      }
      await controlTx(
        sql,
        async (tx) =>
          await tx`update meetings set gcal_event_id = null, updated_at = now() where id = ${row.id} and status = 'cancelled'`,
      );
      row.gcal_event_id = null;
    } else if (row.status === 'scheduled' && input.startsAt !== undefined) {
      // Same retry contract: a failed delete throws (claim replay retries it);
      // a replay after full success re-runs harmlessly — the stored id is the
      // live event's.
      if (row.gcal_event_id && !(await gcal.deleteEvent(row.gcal_event_id))) {
        throw new Error(`gcal delete failed for meeting ${row.id} — retry the request`);
      }
      const newId = await gcal.insertEvent({
        summary: 'Venduá · call remarcada',
        start: row.starts_at,
        end: row.ends_at,
        tz: cfg.tz,
        leadId: row.lead_id,
      });
      if (newId !== row.gcal_event_id) {
        await controlTx(sql, async (tx) => {
          await tx`update meetings set gcal_event_id = ${newId}, updated_at = now() where id = ${row.id}`;
        });
        row.gcal_event_id = newId;
      }
      await rooms.bumpRoomExpiry(row.room_url, new Date(row.ends_at));
    }
    return { status: res.status, body: { meeting: meetingJson(row) }, replayed: res.replayed };
  }
  return { status: res.status, body: res.body, replayed: res.replayed };
}

// ---------------------------------------------------------------------------
// Reminder sweep — called from the agent worker tick (runner.ts)
// ---------------------------------------------------------------------------

const REMINDER_24H_MS = 24 * 3600_000;
const REMINDER_1H_MS = 3600_000;

function reminderBody(kind: '24h' | '1h', meeting: MeetingRow, cfg: MeetingConfig): string {
  const when = fmtWhen(meeting.starts_at, cfg.tz);
  const room = meeting.room_url ? `\nSala: ${meeting.room_url}` : '';
  return kind === '24h'
    ? `Oi! Lembrete: temos call marcada para ${when}.${room}\nQualquer imprevisto, me avisa por aqui.`
    : `Oi! Nossa call começa daqui a ~1h (${when}).${room}`;
}

/**
 * Send due meeting reminders. For each scheduled meeting inside a window
 * without its marker: row-lock it, re-check the marker, resolve the lead's
 * reachable channel, run the send guardrail, queue+dispatch. Skipped (marker
 * left null → retried next tick) when the guardrail says no/draft or no
 * channel is reachable — quiet hours clear on their own, and a meeting that
 * starts stops matching the query 10min in.
 * Returns how many reminders went out.
 */
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
      // Lock the row and re-derive under the lock — a concurrent sweep or a
      // cancel landing between the list read and here can't double-send.
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
      // Draft-required (first contact / draft mode) or a hard block → don't
      // send; leave the marker unset so a later tick re-evaluates.
      if (!verdict.ok || verdict.forceDraft) return null;
      const composed = await composeMessageTx(tx, {
        leadId: cur.lead_id,
        channel: pick.channel,
        body: reminderBody(kind, cur, cfg),
        ...(pick.channel === 'email' ? { subject: 'Venduá — lembrete da call' } : {}),
        author: 'system',
        status: 'queued',
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
      // Dispatch failed → release the marker(s) this tick claimed so a later
      // tick recomposes and retries; the failed message row stays on the
      // thread as the attempt's record. reminder_24h_at is only cleared when
      // a 1h claim set it as a side marker (it was null before).
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
  return sent;
}

// ---------------------------------------------------------------------------
// Status — for GET /control/v1/meetings/status
// ---------------------------------------------------------------------------

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
    room: { provider: rooms.dailyConfigured() ? ('daily' as const) : ('static' as const) },
    gcal: gcal.gcalStatus(),
  };
}
