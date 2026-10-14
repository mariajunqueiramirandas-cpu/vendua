import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { log } from './log.ts';

export type Sql = postgres.Sql;

const dbLog = log.child({ mod: 'db' });

const poolMax = Number(process.env.DB_POOL_MAX) || 10;
/** the background-work pool's size (index.ts): what jobs and agents had when they shared the
 *  request pool — agent activations hold a connection through tool calls, some of them HTTP */
export const jobsPoolMax = Number(process.env.DB_JOBS_POOL_MAX) || 10;

export function createSql(url: string, max = poolMax): Sql {
  // route NOTICEs through pino — the default onnotice breaks stdout's JSON-lines contract
  return postgres(url, {
    max,
    // an unreachable DB fails the request in seconds instead of holding it for the 30s default
    connect_timeout: 10,
    // a connection prepares each statement once, so a recycled one starts cold: 2–4 h instead of
    // postgres.js's 30–60 min, jittered so the pool doesn't recycle all at once (a function is
    // read per connection, as postgres.js's own default is; its types only say number)
    max_lifetime: (() => 60 * 60 * (2 + Math.random() * 2)) as unknown as number,
    connection: { application_name: 'vendua-core' },
    onnotice: (n) => dbLog.debug({ code: n.code, message: n.message }, 'notice'),
  });
}

/** Opens the pool's connections now, so the first requests after a boot don't each pay a
 *  connection's TCP and auth handshake (and postgres.js's type lookup). Best effort. */
export async function warmPool(sql: Sql, n = poolMax): Promise<void> {
  await Promise.all(Array.from({ length: n }, () => sql`select 1`.catch(() => undefined)));
}

const commitHooks = new WeakMap<object, (() => void)[]>();

/** Runs `fn` once the withTenant transaction `tx` commits (in-process hints such as the CRM's
 *  SSE events, which must not announce a write that rolls back). Outside one, it runs now. */
export function afterCommit(tx: Sql, fn: () => void): void {
  const hooks = commitHooks.get(tx);
  if (hooks) hooks.push(fn);
  else fn();
}

/** A savepoint (`child`) of a tracked transaction hands its after-commit work to the parent. */
export function inheritCommitHooks(parent: Sql, child: Sql): void {
  const hooks = commitHooks.get(parent);
  if (hooks) commitHooks.set(child, hooks);
}

/** `sql.begin` whose `afterCommit` callbacks run once it commits. */
export async function beginTracked<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  const hooks: (() => void)[] = [];
  const out = await sql.begin(async (tx) => {
    commitHooks.set(tx, hooks);
    return fn(tx as unknown as Sql) as Promise<T extends readonly unknown[] ? never : T>;
  });
  for (const h of hooks) {
    try {
      h();
    } catch (err) {
      dbLog.error({ err }, 'after-commit hook failed');
    }
  }
  return out as T;
}

// runs `fn` in a tx with the tenant GUC SET LOCAL — RLS context can't leak
// across requests on a pooled connection
export async function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return beginTracked(sql, async (tx) => {
    // .execute() sends it now, without waiting: the connection is FIFO, so the handler's
    // first query is already ordered behind it — one round trip saved per transaction
    const set = tx`select set_config('vendua.tenant_id', ${tenantId}, true)`.execute();
    let out: Awaited<T>;
    try {
      out = await fn(tx as unknown as Sql);
    } catch (err) {
      await set.catch(() => undefined);
      throw err;
    }
    await set;
    return out;
  });
}

/**
 * Runs `fn` with the control scope open inside a tenant transaction, then closes it, so a store's
 * rows and a platform row commit together (the platform WhatsApp inbox consumer marks its row
 * consumed in the transaction that dispatches a Duá turn or applies a card). Only the platform
 * statements go in `fn`: store routes must never run with the scope open, since control_access
 * policies would stop scoping them to the tenant. A throw aborts the transaction anyway.
 */
export async function inControlScope<T>(tx: Sql, fn: () => Promise<T>): Promise<T> {
  await tx`select set_config('vendua.control', '1', true)`;
  const out = await fn();
  await tx`select set_config('vendua.control', '', true)`;
  return out;
}

interface MigrationRow {
  name: string;
}

// a migration renumbered after it shipped: old ledger name → new file name, so
// a DB that already ran it moves the row instead of running it again
export const RENAMED_MIGRATIONS: Readonly<Record<string, string>> = {
  '0079_kitchen.sql': '0080_kitchen.sql',
};

/** The migration files in `dir` the database hasn't applied yet. Read-only, so the app role can
 *  ask: a process that never migrates (the wa-gateway) waits on it until Core has. */
export async function pendingMigrations(sql: Sql, dir: string): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  // no ledger yet (a database Core never booted on) = everything pending
  const rows = await sql<MigrationRow[]>`select name from schema_migrations`.catch(
    () => [] as MigrationRow[],
  );
  const applied = new Set(rows.map((r) => RENAMED_MIGRATIONS[r.name] ?? r.name));
  return files.filter((f) => !applied.has(f));
}

export async function migrate(sql: Sql, dir: string): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  // one tx for the whole run: the xact advisory lock serializes concurrent
  // starters, each file commits atomically, a failure rolls back cleanly
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('vendua.migrate'))`;
    for (const [from, to] of Object.entries(RENAMED_MIGRATIONS)) {
      await tx`
        update schema_migrations set name = ${to}
        where name = ${from} and not exists (select 1 from schema_migrations where name = ${to})
      `;
    }
    const applied = new Set(
      (await tx<MigrationRow[]>`select name from schema_migrations`).map((r) => r.name),
    );
    // baseline squash: NNNN_baseline_thru_MMMM.sql carries the schema through
    // MMMM — it executes ONLY on a fresh DB (empty ledger); on existing DBs it's
    // marked covered without replaying (would collide with live tables)
    const baselineFile = files.find((f) => /^(\d+)_baseline_thru_(\d+)\.sql$/.test(f));
    const baselineThru = baselineFile ? Number(baselineFile.match(/_thru_(\d+)\.sql$/)![1]) : -1;
    const freshDb = applied.size === 0;
    const ran: string[] = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      if (file !== baselineFile) {
        const num = Number(file.match(/^(\d+)/)?.[1]);
        if (baselineFile && freshDb && num <= baselineThru) {
          // covered by the baseline — ledger row only, the DDL already ran
          await tx`insert into schema_migrations (name) values (${file})`;
          continue;
        }
      } else if (!freshDb) {
        // existing DB: mark the baseline covered so it never replays
        await tx`insert into schema_migrations (name) values (${file})`;
        continue;
      }
      const body = await readFile(join(dir, file), 'utf8');
      // files may create roles/policies needing the owner — run as the migration user, NOT vendua_app
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
      ran.push(file);
    }
    return ran;
  }) as Promise<string[]>;
}
