import { controlTx } from '../modules/control.ts';
import type { Sql } from './db.ts';

/** This process, as the owner of the job leases it holds. */
const OWNER = `core:${crypto.randomUUID()}`;

/**
 * Whether this process runs job `name` now. The first Core to ask owns it and keeps it by asking
 * again each tick; another Core gets false until the owner's lease lapses (`ttlMs` after its last
 * tick, so make it a few intervals) or the owner releases it on shutdown.
 */
export async function ownsJob(
  sql: Sql,
  name: string,
  ttlMs: number,
  owner = OWNER,
): Promise<boolean> {
  const rows = await controlTx(
    sql,
    (tx) => tx<{ name: string }[]>`
      insert into job_leases (name, owner, until)
      values (${name}, ${owner}, now() + make_interval(secs => ${ttlMs / 1000}))
      on conflict (name) do update set owner = excluded.owner, until = excluded.until
        where job_leases.owner = excluded.owner or job_leases.until < now()
      returning name
    `,
  );
  return rows.length > 0;
}

/** Hands this process's jobs to the next Core at once, instead of after their ttl. */
export async function releaseJobs(sql: Sql, owner = OWNER): Promise<void> {
  await controlTx(sql, (tx) => tx`delete from job_leases where owner = ${owner}`);
}
