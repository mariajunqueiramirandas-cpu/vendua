import { beginTracked, inheritCommitHooks, type Sql } from '../platform/db.ts';

// sets the vendua.control GUC — RLS policies on CRM tables require it. Inside a transaction (an
// Agent Runtime step's fenced tx: the CRM agent runs under the platform tenant) it is a savepoint
// that restores the scope it found, so the CRM work commits with the step and nothing leaks.
export function controlTx<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
  const inner = sql as unknown as {
    begin?: unknown;
    savepoint?: (fn: (sp: Sql) => Promise<T>) => Promise<T>;
  };
  if (typeof inner.begin !== 'function' && typeof inner.savepoint === 'function')
    return inner.savepoint(async (sp) => {
      inheritCommitHooks(sql, sp);
      const [row] = await sp<{ prev: string | null }[]>`
        select current_setting('vendua.control', true) as prev`;
      await sp`select set_config('vendua.control', '1', true)`;
      const out = await work(sp);
      if (row?.prev !== '1') await sp`select set_config('vendua.control', ${row?.prev ?? ''}, true)`;
      return out;
    });
  return beginTracked(sql, async (tx) => {
    await tx`select set_config('vendua.control', '1', true)`;
    return work(tx);
  });
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
