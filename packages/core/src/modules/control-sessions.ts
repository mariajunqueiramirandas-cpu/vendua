import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '../platform/db.ts';
import { controlTx } from './control.ts';

export const CONTROL_SESSION_DAYS = 30;
// sliding expiry is written at most this often — every CRM poll would otherwise be a write
const TOUCH_EVERY_MS = 60 * 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

// base64url of 32 bytes; anything else never reaches the DB
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function createControlSession(sql: Sql, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await controlTx(sql, async (tx) => {
    await tx`
      insert into control_sessions (token_hash, expires_at, user_agent)
      values (${hashToken(token)}, now() + make_interval(days => ${CONTROL_SESSION_DAYS}),
              ${userAgent ? userAgent.slice(0, 300) : null})
    `;
    // expired and long-revoked rows are dead weight
    if (Math.random() < 0.05)
      await tx`delete from control_sessions where expires_at < now() - interval '7 days'`;
  });
  return token;
}

/** The live session for `token`, sliding its expiry; null when unknown, expired or revoked. */
export async function touchControlSession(sql: Sql, token: string): Promise<string | null> {
  if (!TOKEN_RE.test(token)) return null;
  return controlTx(sql, async (tx) => {
    const row = (
      await tx<{ id: string; last_seen_at: Date }[]>`
        select id, last_seen_at from control_sessions
        where token_hash = ${hashToken(token)} and revoked_at is null and expires_at > now()
      `
    )[0];
    if (!row) return null;
    if (Date.now() - row.last_seen_at.getTime() > TOUCH_EVERY_MS) {
      await tx`
        update control_sessions
        set last_seen_at = now(), expires_at = now() + make_interval(days => ${CONTROL_SESSION_DAYS})
        where id = ${row.id}
      `;
    }
    return row.id;
  });
}

export async function revokeControlSession(sql: Sql, token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return;
  await controlTx(
    sql,
    (tx) =>
      tx`update control_sessions set revoked_at = now()
         where token_hash = ${hashToken(token)} and revoked_at is null`,
  );
}
