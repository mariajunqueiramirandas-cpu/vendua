import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';
import { VENDUA_SESSION } from './transport.ts';

// What the gateway reports about a platform number, read from its row. Core reads it where it
// used to ask the socket in its own memory (waStatus, waIdentity): a cache refreshed every few
// seconds keeps those readers synchronous.

export type PlatformState =
  'off' | 'connecting' | 'pairing' | 'open' | 'logged_out' | 'banned' | 'error';

export interface PlatformSessionRow {
  name: string;
  wanted: boolean;
  state: PlatformState;
  detail: string | null;
  pair_code: string | null;
  pair_code_expires_at: Date | null;
  phone: string | null;
  account_name: string | null;
  connected_at: Date | null;
  state_changed_at: Date;
  lease_until: Date | null;
}

export async function readPlatformSession(
  sql: Sql,
  name = VENDUA_SESSION,
): Promise<PlatformSessionRow | null> {
  const [row] = await controlTx(
    sql,
    (tx) => tx<PlatformSessionRow[]>`
      select name, wanted, state, detail, pair_code, pair_code_expires_at, phone, account_name,
             connected_at, state_changed_at, lease_until
      from platform_wa_sessions where name = ${name}`,
  );
  return row ?? null;
}

let cached: PlatformSessionRow | null = null;
let refreshing: Promise<void> | null = null;

/** Re-reads the row; the inbox consumer's tick calls it, so readers stay at most a tick behind. */
export function refreshPlatformSession(sql: Sql): Promise<void> {
  refreshing ??= readPlatformSession(sql)
    .then((row) => void (cached = row))
    .catch(() => undefined)
    .finally(() => void (refreshing = null));
  return refreshing;
}

/** The cached state of Venduá's number on the gateway ('off' before the first read). */
export function cachedPlatformState(): PlatformState {
  return cached?.state ?? 'off';
}

export function cachedPlatformIdentity(): { phone: string | null; name: string | null } | null {
  if (!cached || cached.state !== 'open' || !cached.phone) return null;
  return { phone: cached.phone, name: cached.account_name };
}

/** tests */
export function setCachedPlatformSession(row: PlatformSessionRow | null) {
  cached = row;
}
