import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { migrate } from '../src/platform/db.ts';
import { ownsJob, releaseJobs } from '../src/platform/job-lease.ts';

// Two Cores (a deploy's overlap, a second replica) run the same timers: one owns a job, renews it
// each tick, and the other takes over only once that lapses or is released.
describe.skipIf(!process.env.TEST_DATABASE_URL)('job leases (db)', () => {
  const sql = postgres(process.env.TEST_DATABASE_URL!, { onnotice: () => {} });
  const job = `test.${crypto.randomUUID()}`;

  beforeAll(async () => {
    await migrate(sql, join(import.meta.dir, '../db/migrations'));
  });
  afterAll(async () => {
    await sql`delete from job_leases where name = ${job}`;
    await sql.end();
  });

  test('one owner at a time; it keeps the job by renewing it', async () => {
    const both = await Promise.all([
      ownsJob(sql, job, 60_000, 'core:a'),
      ownsJob(sql, job, 60_000, 'core:b'),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
    const [owner, other] = both[0] ? ['core:a', 'core:b'] : ['core:b', 'core:a'];
    expect(await ownsJob(sql, job, 60_000, owner)).toBe(true);
    expect(await ownsJob(sql, job, 60_000, other)).toBe(false);
  });

  test('a lapsed lease passes to the other Core; a release hands it over at once', async () => {
    await sql`delete from job_leases where name = ${job}`;
    expect(await ownsJob(sql, job, 60_000, 'core:a')).toBe(true);
    await sql`update job_leases set until = now() - interval '1 second' where name = ${job}`;
    expect(await ownsJob(sql, job, 60_000, 'core:b')).toBe(true);
    expect(await ownsJob(sql, job, 60_000, 'core:a')).toBe(false);
    await releaseJobs(sql, 'core:b');
    expect(await ownsJob(sql, job, 60_000, 'core:a')).toBe(true);
  });
});
