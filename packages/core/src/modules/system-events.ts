import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { controlTx } from './control.ts';
import { recordStaffEvent, recordStaffEventTx, type StaffEventMap } from './staff-events.ts';

// ADR 0023 events about Core itself: a boot (several in an hour is a crash loop), an unhandled
// error (throttled per route) and a channel that dropped or came back.

const sysLog = log.child({ mod: 'system-events' });

/** The deployed commit, short; null when the deploy doesn't say. */
export function bootVersion(env: Record<string, string | undefined> = process.env): string | null {
  const v = (env.GIT_COMMIT || env.SOURCE_COMMIT || '').trim();
  if (!v) return null;
  return /^[0-9a-f]{12,}$/i.test(v) ? v.slice(0, 7) : v.slice(0, 40);
}

/** `system.boot` once the server listens; the count includes this boot. Never throws. */
export async function recordBoot(sql: Sql, version = bootVersion()): Promise<number | null> {
  try {
    return await controlTx(sql, async (tx) => {
      const n = (
        await tx<{ n: number }[]>`
          select count(*)::int as n from staff_events
          where kind = 'system.boot' and created_at > now() - interval '1 hour'
        `
      )[0]!.n;
      await recordStaffEventTx(tx, 'system.boot', { bootsLastHour: n + 1, version });
      return n + 1;
    });
  } catch (err) {
    sysLog.warn({ err }, 'boot event not recorded');
    return null;
  }
}

const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|.{40,})$/i;

/** The route a path is on: ids (uuids, numbers, hashes, long tokens) become `:id`. */
export function routeOf(path: string): string {
  return path
    .split('/')
    .map((s) => (ID_SEGMENT.test(s) ? ':id' : s))
    .join('/')
    .slice(0, 200);
}

const ERROR_WINDOW_MS = 10 * 60_000;
const ERROR_KEYS_MAX = 200;

/** errorJson's hook (`onUnhandledError`): one `system.error` per method + route + message per
 *  10 min; the next one carries how many happened since the last. Never throws; the returned
 *  promise (a report going out) is only for tests. */
export function unhandledErrorReporter(
  sql: Sql,
  o: { now?: () => number; windowMs?: number; maxKeys?: number } = {},
): (err: unknown, info: { method: string; path: string }) => Promise<void> | undefined {
  const now = o.now ?? Date.now;
  const windowMs = o.windowMs ?? ERROR_WINDOW_MS;
  const maxKeys = o.maxKeys ?? ERROR_KEYS_MAX;
  // fingerprint → last report, occurrences since; insertion order = oldest report first
  const seen = new Map<string, { at: number; since: number }>();
  return (err, info) => {
    try {
      const path = routeOf(info.path);
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 120);
      const key = `${info.method} ${path} ${message}`;
      const t = now();
      const hit = seen.get(key);
      if (hit && t - hit.at < windowMs) {
        hit.since++;
        return undefined;
      }
      seen.delete(key);
      seen.set(key, { at: t, since: 0 });
      for (const k of seen.keys()) {
        if (seen.size <= maxKeys) break;
        seen.delete(k);
      }
      return recordStaffEvent(sql, 'system.error', {
        method: info.method,
        path,
        message,
        count: (hit?.since ?? 0) + 1,
      });
    } catch {
      return undefined;
    }
  };
}

type Channel = StaffEventMap['channel.down']['channel'];

// callers fire and forget: one at a time per channel keeps a quick down → up in order
const channelTail = new Map<Channel, Promise<boolean>>();

/** A channel dropped or came back. Debounced on the log itself, so reconnect churn and restarts
 *  add nothing: `down` only when the channel's last word isn't already down, `up` only after
 *  a down. Never throws; true when an event was recorded. */
export function recordChannelState(
  sql: Sql,
  channel: Channel,
  state: 'down' | 'up',
  detail: string | null,
): Promise<boolean> {
  const run = (channelTail.get(channel) ?? Promise.resolve(false)).then(() =>
    channelStateOnce(sql, channel, state, detail),
  );
  channelTail.set(channel, run);
  return run;
}

async function channelStateOnce(
  sql: Sql,
  channel: Channel,
  state: 'down' | 'up',
  detail: string | null,
): Promise<boolean> {
  const anchor = `channel:${channel}`;
  try {
    return await controlTx(sql, async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${anchor}, 0))`;
      const last = (
        await tx<{ kind: string }[]>`
          select kind from staff_events
          where anchor = ${anchor} and kind in ('channel.down', 'channel.up')
          order by id desc limit 1
        `
      )[0]?.kind;
      const down = last === 'channel.down';
      if (state === 'down' ? down : !down) return false;
      if (state === 'down')
        await recordStaffEventTx(tx, 'channel.down', { channel, detail: detail ?? '' });
      else await recordStaffEventTx(tx, 'channel.up', { channel, detail });
      return true;
    });
  } catch (err) {
    sysLog.warn({ err, channel, state }, 'channel event not recorded');
    return false;
  }
}
