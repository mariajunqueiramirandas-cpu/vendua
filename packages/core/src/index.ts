import { createApp } from './app.ts';
import { createSql, migrate } from './platform/db.ts';
import { join } from 'node:path';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vendua_app:vendua_app@localhost:5433/vendua';
const migrationUrl =
  process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const port = Number(process.env.PORT ?? 8787);
const sessionSecret = process.env.SESSION_SECRET ?? 'dev-session-secret';

// Boot: apply migrations as the owner role, then serve as vendua_app (RLS on).
const migrator = createSql(migrationUrl);
const applied = await migrate(migrator, join(import.meta.dir, '../db/migrations'));
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
await migrator.end();

const sql = createSql(databaseUrl);
const app = createApp({ sql, sessionSecret });

console.log(`@vendua/core listening on :${port}`);
export default { port, fetch: app.fetch };
