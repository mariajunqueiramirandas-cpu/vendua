import { join } from 'node:path';
import { createSql, migrate } from './db.ts';
import { log } from './log.ts';

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const sql = createSql(url);
const ran = await migrate(sql, join(import.meta.dir, '../../db/migrations'));
const mlog = log.child({ mod: 'migrate' });
if (ran.length) mlog.info({ applied: ran }, 'migrations applied');
else mlog.info('already up to date');
// the literal password in migration 0001 is dev-only — prod rotates it via VENDUA_APP_DB_PASSWORD
const appPassword = process.env.VENDUA_APP_DB_PASSWORD;
if (appPassword) {
  await sql.unsafe(
    `alter role vendua_app with login password '${appPassword.replaceAll("'", "''")}'`,
  );
  mlog.info('vendua_app password rotated from VENDUA_APP_DB_PASSWORD');
}
await sql.end();
