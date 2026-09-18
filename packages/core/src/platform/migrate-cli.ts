import { join } from 'node:path';
import { createSql, migrate } from './db.ts';

const url = process.env.MIGRATION_DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua';
const sql = createSql(url);
const ran = await migrate(sql, join(import.meta.dir, '../../db/migrations'));
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'already up to date');
await sql.end();
