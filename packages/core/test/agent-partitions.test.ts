import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { migrate } from '../src/platform/db.ts';

// Two Cores at a month's turn both ask for the new agent_events partition.
describe.skipIf(!process.env.TEST_DATABASE_URL)('agent_events partitions (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 8, onnotice: () => {} });
  const month = '2031-07-01';
  const table = 'agent_events_y2031m07';

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });
  afterAll(async () => {
    if ((await sql`select to_regclass(${table}) as t`)[0]!.t) {
      await sql.unsafe(`alter table agent_events detach partition ${table}`);
      await sql.unsafe(`drop table ${table}`);
    }
    await sql.end();
  });

  test('eight callers at once all get the one partition', async () => {
    const rs = await Promise.all(
      Array.from({ length: 8 }, () => sql`select agent_events_partition(${month}::date) as n`),
    );
    expect(rs.map((r) => r[0]!.n)).toEqual(Array(8).fill(table));
  });
});
