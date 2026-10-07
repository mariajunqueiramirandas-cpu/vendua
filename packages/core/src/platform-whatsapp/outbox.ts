import { controlTx } from '../modules/control.ts';
import type { Sql } from '../platform/db.ts';
import { VENDUA_SESSION } from './transport.ts';

// Every message from Venduá's own number is a platform_wa_outbox row: whoever holds the number
// (the gateway, or Core's socket before the cutover) sends it, at least once, deduped by
// WhatsApp through an id derived from the row (messageIdFor).

export type OutboxPurpose = 'otp' | 'dua' | 'notice' | 'crm';

export interface Enqueue {
  /** international digits ('55' + national) or a jid */
  to: string;
  body: string;
  purpose: OutboxPurpose;
  dedupeKey: string;
  ref?: string | null;
  /** how long the message is still worth sending */
  ttlMs?: number;
  session?: string;
}

const TTL_MS: Record<OutboxPurpose, number> = {
  otp: 10 * 60_000,
  dua: 30 * 60_000,
  notice: 6 * 60 * 60_000,
  crm: 6 * 60 * 60_000,
};

/** `tx` must carry the control GUC (controlTx, inControlScope). */
export async function enqueuePlatformWaTx(
  tx: Sql,
  m: Enqueue,
): Promise<{ id: string; inserted: boolean }> {
  const to = m.to.includes('@') ? m.to : m.to.replace(/\D/g, '');
  const body = m.body.trim().slice(0, 4000);
  if (!body) throw new Error('empty whatsapp message');
  const ttl = m.ttlMs ?? TTL_MS[m.purpose];
  const inserted = await tx<{ id: string }[]>`
    insert into platform_wa_outbox (session, to_jid, body, purpose, ref, dedupe_key, expires_at)
    values (${m.session ?? VENDUA_SESSION}, ${to}, ${body}, ${m.purpose}, ${m.ref ?? null},
            ${m.dedupeKey.slice(0, 200)}, now() + ${ttl} * interval '1 millisecond')
    on conflict (dedupe_key) do nothing
    returning id`;
  if (inserted[0]) return { id: inserted[0].id, inserted: true };
  const [row] = await tx<{ id: string }[]>`
    select id from platform_wa_outbox where dedupe_key = ${m.dedupeKey.slice(0, 200)}`;
  return { id: row!.id, inserted: false };
}

export function enqueuePlatformWa(sql: Sql, m: Enqueue) {
  return controlTx(sql, (tx) => enqueuePlatformWaTx(tx, m));
}

export type OutboxOutcome = 'sent' | 'failed' | 'expired' | 'timeout';

/** Waits for a row to settle (the signup code answers 503 when it doesn't in time). */
export async function waitForSent(sql: Sql, id: string, timeoutMs: number): Promise<OutboxOutcome> {
  const until = Date.now() + timeoutMs;
  let wake: (() => void) | null = null;
  const sub = await sql
    .listen('vendua_platform_wa_out', (payload) => {
      if (payload.startsWith(`${id}|`)) wake?.();
    })
    .catch(() => null);
  try {
    for (;;) {
      const [row] = await controlTx(
        sql,
        (tx) => tx<{ status: string }[]>`select status from platform_wa_outbox where id = ${id}`,
      );
      if (row && (row.status === 'sent' || row.status === 'failed' || row.status === 'expired'))
        return row.status;
      const left = until - Date.now();
      if (left <= 0) return 'timeout';
      // the notification is the fast path; the poll covers a missed one
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(left, 1000));
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  } finally {
    await sub?.unlisten().catch(() => undefined);
  }
}
