import type { Sql } from '../platform/db.ts';
import type { FreioLevel, StoreSettingsRow } from './store.ts';

// Freio automático, the model (docs/features/freio-automatico.md §4.1, 0125). The kitchen is
// `capacity` lanes. The tickets ahead of an order take the lane that frees soonest, oldest first:
// a started ticket holds its lane for what's left of its prep, a waiting one for its whole prep.
// The new order starts when a lane frees. Dividing the total work by the capacity gets both the
// quiet and the busy kitchen wrong, so this never averages.

export interface Ticket {
  id: string;
  placedAt: Date;
  /** minutes: the prep given on accept, else the store's */
  prep: number;
  /** when the kitchen started it (the 'preparing' step); null = waiting */
  startedAt: Date | null;
}

/** a ticket nobody touched for this long is left out ("parado?"): the board stopped being used */
const STALE_MINUTES = 90;

const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

/** Minutes from `now` until a lane is free for the next order, given the tickets ahead of it. */
export function waitMinutes(ahead: readonly Ticket[], capacity: number, now: Date): number {
  const lanes: number[] = Array.from({ length: Math.max(1, capacity) }, () => 0);
  const take = (minutes: number) => {
    let i = 0;
    for (let k = 1; k < lanes.length; k++) if (lanes[k]! < lanes[i]!) i = k;
    lanes[i]! += minutes;
  };
  const started = ahead.filter((t) => t.startedAt).sort((a, b) => +a.startedAt! - +b.startedAt!);
  const waiting = ahead.filter((t) => !t.startedAt).sort((a, b) => +a.placedAt - +b.placedAt);
  for (const t of started) take(Math.max(0, t.prep - minutesBetween(t.startedAt!, now)));
  for (const t of waiting) take(t.prep);
  return Math.max(0, Math.ceil(Math.min(...lanes)));
}

/** Minutes from `now` until this ticket is ready: its lane position among the ones placed
 *  before it, never counting its own prep twice. */
export function readyInMinutes(
  ticket: Ticket,
  queue: readonly Ticket[],
  capacity: number,
  now: Date,
): number {
  if (ticket.startedAt)
    return Math.max(0, Math.ceil(ticket.prep - minutesBetween(ticket.startedAt, now)));
  const ahead = queue.filter((t) => t.id !== ticket.id && t.placedAt < ticket.placedAt);
  return waitMinutes(ahead, capacity, now) + ticket.prep;
}

/** A zone as the promise needs it: a distance quote knows its drive; a drawn zone has its ETA. */
export type PromiseZone =
  | { kind: 'distance'; driveMinutes: number }
  | { kind: 'zone'; etaMin: number; etaMax: number }
  | null;

/**
 * The delivery window, minutes from now. Distance: ready + drive + the courier's buffer, spread by
 * half the drive (at least 10). A drawn zone's ETA stays the whole promise unless the kitchen makes
 * it later (open decision 1: merchants keep reading their zones as they do today).
 */
export function deliveryWindow(
  zone: PromiseZone,
  readyMinutes: number,
  bufferMinutes: number,
): { from: number; to: number } {
  if (zone?.kind === 'distance') {
    const from = readyMinutes + zone.driveMinutes + bufferMinutes;
    return { from, to: from + Math.max(10, Math.ceil(zone.driveMinutes / 2)) };
  }
  if (zone?.kind === 'zone') {
    const from = Math.max(zone.etaMin, readyMinutes + bufferMinutes);
    return { from, to: from + Math.max(0, zone.etaMax - zone.etaMin) };
  }
  return { from: readyMinutes, to: readyMinutes };
}

/** The open tickets the kitchen is working through, stale ones left out. */
export async function queueTx(
  tx: Sql,
  tenantId: string,
  now: Date,
  defaultPrep: number,
  tz: string,
): Promise<Ticket[]> {
  const rows = await tx<
    {
      id: string;
      placed_at: Date;
      promised_to: string | null;
      prep: number | null;
      started_at: Date | null;
      touched_at: Date;
    }[]
  >`
    select o.id, o.placed_at, o.delivery ->> 'promisedTo' as promised_to,
           (select case when (e.meta ->> 'prepMinutes') ~ '^\\d{1,3}$'
                        then (e.meta ->> 'prepMinutes')::int end
              from order_events e
              where e.order_id = o.id and e.to_state = 'confirmed' order by e.at limit 1) as prep,
           (select min(e.at) from order_events e
              where e.order_id = o.id and e.to_state = 'preparing') as started_at,
           greatest(o.placed_at, (select max(e.at) from order_events e where e.order_id = o.id))
             as touched_at
    from orders o
    where o.tenant_id = ${tenantId} and o.state in ('placed', 'confirmed', 'preparing')
      and (o.scheduled_for is null
           or o.scheduled_for <= (${now}::timestamptz at time zone ${tz})::date)
    order by o.placed_at
    limit 300`;
  return rows
    .filter((r) => {
      if (minutesBetween(r.touched_at, now) > STALE_MINUTES) return false;
      // older than twice its own promise: nobody is going to mark it
      const promised = r.promised_to ? new Date(r.promised_to) : null;
      if (
        promised &&
        minutesBetween(r.placed_at, now) > 2 * Math.max(15, minutesBetween(r.placed_at, promised))
      )
        return false;
      return true;
    })
    .map((r) => ({
      id: r.id,
      placedAt: r.placed_at,
      prep: r.prep && r.prep >= 1 && r.prep <= 240 ? r.prep : defaultPrep,
      startedAt: r.started_at,
    }));
}

export interface FreioConfig {
  prep: number;
  capacity: number;
  buffer: number;
  maxPromise: number;
}

export function freioConfig(s: StoreSettingsRow | null | undefined): FreioConfig {
  return {
    prep: s?.prep_time_minutes ?? 30,
    capacity: s?.kitchen_capacity ?? 3,
    buffer: s?.dispatch_buffer_minutes ?? 5,
    maxPromise: s?.max_promise_minutes ?? 90,
  };
}

export interface KitchenNow {
  /** open tickets counted */
  queue: number;
  /** minutes until a lane frees for a new order */
  backlogMinutes: number;
  /** a new pickup's wait, prep included */
  pickupMinutes: number;
  /** minutes beyond a normal promise (the brake's input) */
  extraMinutes: number;
}

export async function kitchenNowTx(
  tx: Sql,
  tenantId: string,
  cfg: FreioConfig,
  tz: string,
  now = new Date(),
): Promise<KitchenNow> {
  const q = await queueTx(tx, tenantId, now, cfg.prep, tz);
  const backlog = waitMinutes(q, cfg.capacity, now);
  return {
    queue: q.length,
    backlogMinutes: backlog,
    pickupMinutes: backlog + cfg.prep,
    extraMinutes: backlog,
  };
}

// ── the brake's levels (§4.2) ───────────────────────────────────────────────

export const LEVEL_RANK: Record<FreioLevel, number> = {
  normal: 0,
  busy: 1,
  full: 2,
  pickup_only: 3,
};

/** entry thresholds, minutes beyond a normal promise */
export const BUSY_AT = 10;
export const FULL_AT = 30;
/** a level steps down only this far below its entry */
const STEP_DOWN_MARGIN = 5;
/** a level holds at least this long */
export const HOLD_MINUTES = 10;
/** Cheio this long without recovering → Só retirada */
export const PICKUP_ONLY_AFTER = 20;
export const MAX_CHANGES_PER_HOUR = 4;

/** The level the kitchen alone calls for, without memory. */
export function rawLevel(k: KitchenNow, cfg: FreioConfig): FreioLevel {
  const longest = k.pickupMinutes + cfg.buffer;
  if (k.extraMinutes >= FULL_AT || longest > cfg.maxPromise) return 'full';
  if (k.extraMinutes >= BUSY_AT) return 'busy';
  return 'normal';
}

/**
 * The next level with hysteresis: up at once (after the hold), down only once `extra` is
 * STEP_DOWN_MARGIN below the current level's entry; Cheio that lasts becomes Só retirada.
 */
export function nextLevel(
  current: FreioLevel,
  since: Date | null,
  k: KitchenNow,
  cfg: FreioConfig,
  now: Date,
): FreioLevel {
  const held = since ? minutesBetween(since, now) : Infinity;
  const raw = rawLevel(k, cfg);
  if (held < HOLD_MINUTES) return current;
  if (LEVEL_RANK[raw] > LEVEL_RANK[current] && current !== 'pickup_only') return raw;
  if (current === 'full' && raw === 'full' && held >= PICKUP_ONLY_AFTER) return 'pickup_only';
  const longest = k.pickupMinutes + cfg.buffer;
  const fullCleared = k.extraMinutes < FULL_AT - STEP_DOWN_MARGIN && longest <= cfg.maxPromise;
  const busyCleared = k.extraMinutes < BUSY_AT - STEP_DOWN_MARGIN;
  switch (current) {
    case 'pickup_only':
      // the delivery pause lasts until the backlog is back under Movimentado
      return busyCleared ? 'normal' : 'pickup_only';
    case 'full':
      return busyCleared ? 'normal' : fullCleared ? 'busy' : 'full';
    case 'busy':
      return busyCleared ? 'normal' : 'busy';
    default:
      return raw;
  }
}

/** Delivery is braked at Cheio and above: until when, by the queue's own clock. */
export function pauseUntil(level: FreioLevel, k: KitchenNow, now: Date): Date | null {
  if (LEVEL_RANK[level] < LEVEL_RANK.full) return null;
  // the moment the queue's extra drops under Movimentado's entry, at least 15 minutes out
  const minutes = Math.max(15, k.extraMinutes - BUSY_AT + 5);
  return new Date(now.getTime() + minutes * 60_000);
}

/** Delivery braked right now (the brake, not the owner's delivery_enabled). */
export function deliveryPaused(
  s: StoreSettingsRow | null | undefined,
  now = new Date(),
): Date | null {
  const until = s?.delivery_paused_until ? new Date(s.delivery_paused_until) : null;
  return until && until > now ? until : null;
}

/** What the promise needs from a matched zone (a zone row, or a distance quote). */
export function promiseZoneOf(
  z:
    | {
        kind?: string;
        eta_min_minutes?: number | null;
        eta_max_minutes?: number | null;
        drive_minutes?: number;
      }
    | null
    | undefined,
): PromiseZone {
  if (!z) return null;
  if (z.kind === 'distance' && typeof z.drive_minutes === 'number')
    return { kind: 'distance', driveMinutes: z.drive_minutes };
  if (z.eta_min_minutes == null) return null;
  return {
    kind: 'zone',
    etaMin: z.eta_min_minutes,
    etaMax: z.eta_max_minutes ?? z.eta_min_minutes,
  };
}

// ── the sweep (§4.2): measure, step the level, and brake or suggest ─────────

const LEVEL_WORD: Record<FreioLevel, string> = {
  normal: 'normal',
  busy: 'movimentado',
  full: 'cheio',
  pickup_only: 'só retirada',
};
export const FREIO_ACTOR = { name: 'Freio automático', userId: null };

const hhmm = (d: Date, tz: string) =>
  d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: tz });

export interface FreioPush {
  key: string;
  title: string;
  body: string;
}

/**
 * Once a minute per store (admin sweep). Persists the queue's wait (rounded to 5, written only
 * when it moves) and the level; in Automático it pauses and resumes delivery itself, in Sugerir
 * it leaves a suggestion for a tap. A pause someone applied is kept up to date in either mode.
 * Returns the push to send, if any (sent by the caller, outside the transaction).
 */
export async function freioPassTx(
  tx: Sql,
  tenantId: string,
  now: Date,
  hooks: {
    audit: (summary: string) => Promise<unknown>;
    emitStore: () => Promise<unknown>;
  },
): Promise<FreioPush | null> {
  const [s] = await tx<StoreSettingsRow[]>`
    select * from store_settings where tenant_id = ${tenantId} for update`;
  if (!s) return null;
  const tz = s.hours?.timezone || 'America/Sao_Paulo';
  const cfg = freioConfig(s);
  const mode = s.freio_mode ?? 'suggest';
  const k = await kitchenNowTx(tx, tenantId, cfg, tz, now);
  const rounded = Math.min(600, Math.round(k.backlogMinutes / 5) * 5);
  const current = s.freio_level ?? 'normal';
  const since = s.freio_level_since ? new Date(s.freio_level_since) : null;
  const paused = deliveryPaused(s, now);
  const held = s.freio_hold_until && new Date(s.freio_hold_until) > now;

  let level: FreioLevel = mode === 'off' ? 'normal' : nextLevel(current, since, k, cfg, now);
  // after an undo the brake leaves the store alone for a while, and never flaps past the cap
  if (held && LEVEL_RANK[level] > LEVEL_RANK[current]) level = current;
  if (level !== current) {
    const [recent] = await tx<{ n: number }[]>`
      select count(*)::int as n from freio_events
      where tenant_id = ${tenantId} and at > ${now}::timestamptz - interval '1 hour'`;
    if ((recent?.n ?? 0) >= MAX_CHANGES_PER_HOUR) level = current;
  }

  const braking = LEVEL_RANK[level] >= LEVEL_RANK.full;
  // the pause follows the queue once it's on: extended while braking, lifted when it clears
  let nextPause: Date | null = paused;
  if (paused && braking) {
    const until = pauseUntil(level, k, now)!;
    nextPause = until > paused ? until : paused;
  } else if (paused && !braking) nextPause = null;
  else if (!paused && braking && mode === 'auto' && !held) nextPause = pauseUntil(level, k, now);

  // Sugerir: what Duá would do, until it's applied, dismissed or no longer true
  const suggest =
    mode === 'suggest' && braking && !paused && !held
      ? { level, pausedUntil: pauseUntil(level, k, now)!.toISOString(), at: now.toISOString() }
      : null;
  const hadSuggestion = !!s.freio_suggestion;

  const changedLevel = level !== current;
  const changedPause = (nextPause?.getTime() ?? null) !== (paused?.getTime() ?? null);
  const changedBacklog = rounded !== (s.freio_backlog_minutes ?? 0);
  const changedSuggestion =
    !!suggest !== hadSuggestion || (suggest && s.freio_suggestion?.level !== suggest.level);
  if (!changedLevel && !changedPause && !changedBacklog && !changedSuggestion) return null;

  await tx`
    update store_settings set
      freio_backlog_minutes = ${rounded},
      freio_level = ${level},
      freio_level_since = ${changedLevel ? now : (since ?? now)},
      delivery_paused_until = ${nextPause},
      freio_suggestion = ${suggest && changedSuggestion ? tx.json(suggest) : suggest ? tx.json(s.freio_suggestion as never) : null}
    where tenant_id = ${tenantId}`;
  if (changedLevel || changedPause)
    await tx`
      insert into freio_events (tenant_id, at, from_level, to_level, actor, paused_until)
      values (${tenantId}, ${now}, ${current}, ${level}, 'freio', ${nextPause})`;
  if (changedPause)
    await hooks.audit(
      nextPause
        ? `freio: entregas pausadas até ${hhmm(nextPause, tz)} (cozinha ${LEVEL_WORD[level]})`
        : 'freio: entregas de volta',
    );
  await hooks.emitStore();

  if (changedPause && nextPause && !paused)
    return {
      key: `freio:pause:${now.toISOString().slice(0, 16)}`,
      title: `Freio: só retirada até ${hhmm(nextPause, tz)}`,
      body: `A cozinha está cheia (~${k.pickupMinutes} min por pedido). A retirada continua. Toque para desfazer.`,
    };
  if (changedPause && !nextPause)
    return {
      key: `freio:resume:${now.toISOString().slice(0, 16)}`,
      title: 'Entregas de volta',
      body: 'A fila da cozinha baixou. A loja voltou a aceitar entregas.',
    };
  if (suggest && !hadSuggestion)
    return {
      key: `freio:suggest:${now.toISOString().slice(0, 13)}`,
      title: 'Cozinha cheia: pausar as entregas?',
      body: `Um pedido novo leva ~${k.pickupMinutes} min. Pause as entregas até ${hhmm(new Date(suggest.pausedUntil), tz)}; a retirada continua.`,
    };
  return null;
}
