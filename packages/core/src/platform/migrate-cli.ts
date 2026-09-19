import { join } from 'node:path';
import { createSql, migrate } from './db.ts';

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const sql = createSql(url);
const ran = await migrate(sql, join(import.meta.dir, '../../db/migrations'));
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'already up to date');
// Migration 0001 creates the vendua_app role with a local-dev password.
// Deployments inject VENDUA_APP_DB_PASSWORD to rotate it — the literal in the
// migration must never be the production credential.
const appPassword = process.env.VENDUA_APP_DB_PASSWORD;
if (appPassword) {
  await sql.unsafe(
    `alter role vendua_app with login password '${appPassword.replaceAll("'", "''")}'`,
  );
  console.log('vendua_app password rotated from VENDUA_APP_DB_PASSWORD');
}
await sql.end();
