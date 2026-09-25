import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { log } from './log.ts';

export type Sql = postgres.Sql;

const dbLog = log.child({ mod: 'db' });

export function createSql(url: string): Sql {
  // route NOTICEs through pino — the default onnotice breaks stdout's JSON-lines contract
  return postgres(url, {
    max: 10,
    onnotice: (n) => dbLog.debug({ code: n.code, message: n.message }, 'notice'),
  });
}

// runs `fn` in a tx with the tenant GUC SET LOCAL — RLS context can't leak
// across requests on a pooled connection
export async function withTenant<T>(
  sql: Sql,
  tenantId: string,
  fn: (tx: Sql) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`select set_config('vendua.tenant_id', ${tenantId}, true)`;
    const out = await fn(tx as unknown as Sql);
    return out as T extends readonly unknown[] ? never : Awaited<T>;
  }) as Promise<T>;
}

interface MigrationRow {
  name: string;
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
