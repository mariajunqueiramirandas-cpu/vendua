import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { migrate, RENAMED_MIGRATIONS } from '../src/platform/db.ts';

const dir = join(import.meta.dir, '../db/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));

// shipped before this check; 0031 builds on the second, so renumbering it
// would shift every migration after it
const SHARED_NUMBERS = new Set(['0030']);

describe('migration files', () => {
  test('each is NNNN_name.sql', () => {
    expect(files.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f))).toEqual([]);
  });

  test('no two share a number (rebase onto main and take the next free one)', () => {
    const byNumber = new Map<string, string[]>();
    for (const f of files) byNumber.set(f.slice(0, 4), [...(byNumber.get(f.slice(0, 4)) ?? []), f]);
    const clashes = [...byNumber]
      .filter(([n, fs]) => fs.length > 1 && !SHARED_NUMBERS.has(n))
      .map(([, fs]) => fs);
    expect(clashes).toEqual([]);
  });

  test('renames point from a gone file to a present one', () => {
    for (const [from, to] of Object.entries(RENAMED_MIGRATIONS)) {
      expect(files).not.toContain(from);
      expect(files).toContain(to);
    }
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('migrate: renamed migrations (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });

  beforeAll(async () => {
    await migrate(sql, dir);
  });
  afterAll(async () => {
    await sql.end();
  });

  test('a DB that ran the old name moves its ledger row and does not run it again', async () => {
    const [from, to] = Object.entries(RENAMED_MIGRATIONS)[0]!;
    const ledger = async () =>
      (
        await sql<{ name: string }[]>`
          select name from schema_migrations where name in ${sql([from, to])} order by name
        `
      ).map((r) => r.name);
    try {
      await sql`update schema_migrations set name = ${from} where name = ${to}`;
      expect(await ledger()).toEqual([from]);
      expect(await migrate(sql, dir)).not.toContain(to);
      expect(await ledger()).toEqual([to]);

      // both rows present (a DB that ran it twice): the rename is skipped, not a key clash
      await sql`insert into schema_migrations (name) values (${from})`;
      expect(await migrate(sql, dir)).toEqual([]);
    } finally {
      await sql`delete from schema_migrations where name = ${from}`;
      await migrate(sql, dir);
    }
  });
});
