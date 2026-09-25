import type { Sql } from '../platform/db.ts';

// sets the vendua.control GUC — RLS policies on CRM tables require it
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

// durable idempotency claim — first run stores status+body, retries replay it; claims never evicted, concurrent same-key blocks on the row lock
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
