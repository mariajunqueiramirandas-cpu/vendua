import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createSql(url: string): Sql {
  return postgres(url, { max: 10 });
}

/**
 * Runs `fn` inside a transaction with the tenant context set. SET LOCAL scopes
 * the GUC to the transaction, so the RLS context can never leak across requests
 * on a pooled connection.
 */
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
  const applied = new Set(
    (await sql<MigrationRow[]>`select name from schema_migrations`).map((r) => r.name),
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = await readFile(join(dir, file), 'utf8');
    // Migration files may create roles/policies that need the owner — run as
    // the connecting (migration) user, which is intentionally NOT vendua_app.
    await sql.unsafe(body);
    await sql`insert into schema_migrations (name) values (${file})`;
    ran.push(file);
  }
  return ran;
}
