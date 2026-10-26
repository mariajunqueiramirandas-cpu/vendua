import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { Context } from 'hono';
import { beginTracked, inheritCommitHooks, type Sql } from '../platform/db.ts';
import { HttpError } from '../platform/http.ts';

/** A staff request's Idempotency-Key for claimControl: present and bounded. */
export function controlIdemKey(c: Context): string {
  const key = c.req.header('idempotency-key');
  if (!key)
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
  if (key.length > 200) throw new HttpError(400, 'BAD_REQUEST', 'Idempotency-Key too long');
  return key;
}

/** The staff route a request is on, set by app.ts' /control/v1 middleware: claimControl binds the
 *  key it claims to it (0141). The key itself stays bare, as a previous Core claims it. */
const controlRoute = new AsyncLocalStorage<string>();

export function inControlRoute<T>(c: Context, next: () => Promise<T>): Promise<T> {
  const scope = createHash('sha256').update(`${c.req.method} ${c.req.path}`).digest('hex');
  return controlRoute.run(scope.slice(0, 32), next);
}

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
      if (row?.prev !== '1')
        await sp`select set_config('vendua.control', ${row?.prev ?? ''}, true)`;
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
  const scope = controlRoute.getStore() ?? null;
  return controlTx(sql, async (tx) => {
    const claimed = await tx`
      insert into control_idempotency_keys (key, scope) values (${key}, ${scope})
      on conflict (key) do nothing
      returning key
    `;
    if (!claimed[0]) {
      const row = (
        await tx<{ response: T; status_code: number; scope: string | null }[]>`
          select response, status_code, scope from control_idempotency_keys where key = ${key}
        `
      )[0]!;
      // the key claimed on another staff route (another store, order): that one's result isn't
      // this request's. A null scope (a previous Core's, or a job's) replays as it always did.
      if (row.scope != null && scope != null && row.scope !== scope)
        throw new HttpError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'this Idempotency-Key was used for a different request — send a new key',
        );
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
