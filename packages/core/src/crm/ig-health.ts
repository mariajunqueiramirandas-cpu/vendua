import type { Sql } from '../platform/db.ts';
import { getSettingTx } from '../modules/integrations.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';

// Instagram can keep a session open (the inbox loads, DMs arrive) while it refuses every DM the
// account sends: a session it distrusts, an action block. Three refusals in a row pause the
// agent's DMs and the follows and tell the team. A DM that goes out (staff can still send by
// hand) or a fresh login resumes them.

const KEY = 'ig_send_health';
const LOCK = 'crm:ig-send-health';
export const IG_PAUSE_AFTER = 3;
/** how long a queued agent DM waits before it checks the pause again */
export const IG_PAUSE_RECHECK_MS = 30 * 60_000;

/** About one recipient, or Core never reaching Instagram: says nothing about the account. */
const NOT_THE_ACCOUNT = new Set([
  'user_not_found',
  'bad_username',
  'bad_fbid',
  'blocking',
  'self',
  'no_recipient',
  'sidecar_unreachable',
  'not_connected',
  'no_secret',
  'timeout',
]);

interface Health {
  /** refusals in a row since the last DM that went out */
  failures: number;
  lastError: string | null;
  pausedAt: string | null;
}
const FRESH: Health = { failures: 0, lastError: null, pausedAt: null };

async function healthTx(tx: Sql, lock: boolean): Promise<Health> {
  if (lock) await tx`select pg_advisory_xact_lock(hashtext(${LOCK}))`;
  return { ...FRESH, ...(await getSettingTx<Partial<Health>>(tx, KEY, {})) };
}

async function saveTx(tx: Sql, h: Health): Promise<void> {
  await tx`
    insert into control_settings (key, value) values (${KEY}, ${tx.json(h as never)})
    on conflict (key) do update set value = excluded.value`;
}

export interface IgPause {
  since: string;
  error: string;
}

/** Set while Instagram's refusals keep automated DMs and follows paused. */
export async function igPausedTx(tx: Sql): Promise<IgPause | null> {
  const h = await healthTx(tx, false);
  return h.pausedAt ? { since: h.pausedAt, error: h.lastError ?? '' } : null;
}

export type IgSendOutcome = { ok: true } | { ok: false; code: string | null; error: string };

/** Counts one Instagram DM's outcome inside the tx that records it. `code` is the sidecar's
 *  error code; an error without one (no handle, unknown driver) never reached Instagram. */
export async function recordIgSendTx(tx: Sql, outcome: IgSendOutcome): Promise<void> {
  if (!outcome.ok && (!outcome.code || NOT_THE_ACCOUNT.has(outcome.code))) return;
  const h = await healthTx(tx, true);
  if (outcome.ok) {
    await clearTx(tx, h, 'uma DM saiu de novo');
    return;
  }
  const next: Health = {
    failures: h.failures + 1,
    lastError: outcome.error.slice(0, 300),
    pausedAt: h.pausedAt,
  };
  const pauses = !next.pausedAt && next.failures >= IG_PAUSE_AFTER;
  if (pauses) next.pausedAt = new Date().toISOString();
  await saveTx(tx, next);
  if (pauses) {
    await recordStaffEventTx(tx, 'instagram.paused', {
      failingSince: next.pausedAt!,
      count: next.failures,
      error: next.lastError ?? '',
    });
  }
}

/** A fresh login starts clean, whatever the old session was refused. */
export async function resumeIgSendsTx(tx: Sql, reason: string): Promise<void> {
  await clearTx(tx, await healthTx(tx, true), reason);
}

async function clearTx(tx: Sql, h: Health, reason: string): Promise<void> {
  if (h.failures === 0 && !h.pausedAt) return;
  await saveTx(tx, FRESH);
  if (h.pausedAt) {
    await recordStaffEventTx(tx, 'instagram.resumed', { failingSince: h.pausedAt, reason });
  }
}
