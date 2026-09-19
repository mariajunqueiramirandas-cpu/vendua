import type { Sql } from '../platform/db.ts';

/**
 * control module — shared plumbing for the staff surface (/control/v1).
 *
 * Every control-plane query runs inside a transaction with the
 * `vendua.control` GUC set — the RLS policies on leads/crm tables require it,
 * so tenant-path code running as the same vendua_app role can never touch
 * CRM tables.
 */
export function controlTx<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (t) => {
    const tx = t as unknown as Sql;
    await tx`select set_config('vendua.control', '1', true)`;
    return work(tx);
  }) as Promise<T>;
}

export interface ClaimResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

/** Durable Idempotency-Key claim for control mutations — the platform
 *  counterpart of the tenant-scoped `idempotency()` wrapper (these tables
 *  have no tenant FK for that table's composite key). The first execution
 *  runs `work` in the claim transaction and stores its status+body; every
 *  retry replays that stored response. Claims are never evicted — a replay
 *  can never re-apply — and a concurrent same-key request blocks on the
 *  row's write lock until the winner commits. If `work` throws the claim
 *  rolls back with it, so errors are re-evaluated, never replayed. */
export async function claimControl<T>(
  sql: Sql,
  key: string,
  work: (tx: Sql) => Promise<{ status: number; body: T }>,
): Promise<ClaimResult<T>> {
  return controlTx(sql, async (tx) => {
    const claimed = await tx`
      insert into control_idempotency_keys (key) values (${key})
      on conflict (key) do nothing
      returning key
    `;
    if (!claimed[0]) {
      const row = (
        await tx<{ response: T; status_code: number }[]>`
          select response, status_code from control_idempotency_keys where key = ${key}
        `
      )[0]!;
      return { status: row.status_code, body: row.response, replayed: true };
    }
    const res = await work(tx);
    await tx`
      update control_idempotency_keys
      set response = ${tx.json(res.body as never)}, status_code = ${res.status}
      where key = ${key}
    `;
    return { ...res, replayed: false };
  });
}
