import type { Context, Hono } from 'hono';
import postgres from 'postgres';
import type { Sql } from '../platform/db.ts';
import { bodyJson, HttpError, str } from '../platform/http.ts';
import { log } from '../platform/log.ts';
import type { Tenant } from '../platform/tenancy.ts';
import { claimControl, controlTx } from './control.ts';

// Wiping a throwaway instance from the CRM, for testing on a cloud deploy without a shell.
// The server never holds the owner credentials (docker-entrypoint.sh drops them), so it can't
// drop anything: staff leave a request in control_settings and Core restarts; on the way back up
// the entrypoint, still holding them, drops and recreates the database before migrating and
// seeding as on any boot. Both halves only act with VENDUA_ALLOW_RESET=1.

export const RESET_KEY = 'instance_reset';
/** what staff type to confirm */
export const RESET_WORD = 'resetar';
/** a request older than this is dropped, not honoured: a wipe belongs to the restart it asked
 *  for, never to some later deploy */
export const RESET_STALE_MS = 15 * 60_000;

const rlog = log.child({ mod: 'instance-reset' });

export function mountInstanceReset(o: {
  app: Hono<{ Variables: { tenant: Tenant } }>;
  sql: Sql;
  controlGate: (c: Context) => void;
  requireIdemKey: (c: Context) => string;
  enabled: boolean;
  /** restarts Core so the entrypoint performs the reset (index.ts: SIGTERM itself) */
  onRequested?: (() => void) | undefined;
}) {
  const { app, sql, controlGate } = o;

  app.get('/control/v1/instance', async (c) => {
    controlGate(c);
    const [row] = await controlTx(
      sql,
      (tx) => tx<{ value: { requestedAt?: string } }[]>`
        select value from control_settings where key = ${RESET_KEY}`,
    );
    c.header('cache-control', 'no-store');
    return c.json({ resetEnabled: o.enabled, resetRequestedAt: row?.value.requestedAt ?? null });
  });

  app.post('/control/v1/instance/reset', async (c) => {
    controlGate(c);
    if (!o.enabled)
      throw new HttpError(403, 'RESET_DISABLED', 'reset is off: set VENDUA_ALLOW_RESET=1');
    const body = await bodyJson(c);
    if (str(body.confirm, 'confirm', 40).trim().toLowerCase() !== RESET_WORD)
      throw new HttpError(422, 'CONFIRM_MISMATCH', `type "${RESET_WORD}" to confirm`, {
        field: 'confirm',
      });
    const res = await claimControl(sql, o.requireIdemKey(c), async (tx) => {
      const requestedAt = new Date().toISOString();
      await tx`
        insert into control_settings (key, value) values (${RESET_KEY}, ${tx.json({ requestedAt })})
        on conflict (key) do update set value = excluded.value`;
      return { status: 202, body: { requestedAt } };
    });
    if (res.replayed) c.header('x-idempotent-replay', 'true');
    else {
      rlog.warn('instance reset requested from the CRM — restarting');
      o.onRequested?.();
    }
    return c.json(res.body, 202);
  });
}

/**
 * The entrypoint's half, as the owner role: drop and recreate the database when a fresh request
 * is waiting, so migrate and seed then run on an empty one. Also finishes a reset that died
 * between the drop and the create.
 */
export async function resetIfRequested(
  url: string,
  now = new Date(),
): Promise<'reset' | 'stale' | 'none'> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[\w-]+$/.test(name)) throw new Error(`unexpected database name '${name}'`);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const opts = { max: 1, onnotice: () => {}, connect_timeout: 10 } as const;

  let requestedAt: string | null = null;
  let missing = false;
  const db = postgres(url, opts);
  try {
    const [row] = await db<{ value: { requestedAt?: string } }[]>`
      select value from control_settings where key = ${RESET_KEY}`;
    requestedAt = row?.value.requestedAt ?? null;
    if (requestedAt && now.getTime() - Date.parse(requestedAt) > RESET_STALE_MS) {
      await db`delete from control_settings where key = ${RESET_KEY}`;
      rlog.warn({ requestedAt }, 'stale instance reset request dropped, nothing wiped');
      return 'stale';
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    // 3D000: the database is gone (a reset cut off after its drop); 42P01: never migrated
    if (code === '3D000') missing = true;
    else if (code !== '42P01') throw e;
  } finally {
    await db.end({ timeout: 2 });
  }
  if (!requestedAt && !missing) return 'none';

  const root = postgres(admin.toString(), opts);
  try {
    if (requestedAt) await root.unsafe(`drop database if exists "${name}" with (force)`);
    await root.unsafe(`create database "${name}"`);
  } finally {
    await root.end({ timeout: 2 });
  }
  rlog.warn({ database: name, requestedAt }, 'instance reset: database dropped and recreated');
  return 'reset';
}
