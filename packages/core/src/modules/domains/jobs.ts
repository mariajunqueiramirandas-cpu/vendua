import type { Sql } from '../../platform/db.ts';
import { runDomainChecks } from '../billing/jobs.ts';
import {
  activateVerified,
  domainLog,
  finishRemovals,
  lapseAndRestore,
  recheckLive,
  refreshRdap,
  settleLapsed,
  syncZones,
  type DomainJobDeps,
} from './lifecycle.ts';
import {
  placeRegistrations,
  pollRegistrations,
  promoteAwaiting,
  runRenewals,
  scheduleRenewals,
} from './orders.ts';

const TICK_MS = 60_000;

/** One pass over every domain step (ADR 0038); each step's failure is logged and the rest run. */
export async function runDomainJobs(sql: Sql, d: DomainJobDeps, now: Date) {
  const steps: [string, () => Promise<unknown>][] = [
    ['orders.promote', () => promoteAwaiting(sql, now)],
    ['orders.place', () => placeRegistrations(sql, d, now)],
    ['orders.poll', () => pollRegistrations(sql, d, now)],
    ['zones', () => syncZones(sql, d, now)],
    [
      'dns',
      () =>
        runDomainChecks(
          sql,
          {
            storeDomain: d.storeDomain,
            rdap: d.providers.rdap,
            edgeIps: d.providers.edge ? [d.providers.edge.ipv4] : [],
          },
          now,
        ),
    ],
    ['activate', () => activateVerified(sql, d, now)],
    ['recheck', () => recheckLive(sql, d, now)],
    ['lapse', () => lapseAndRestore(sql, d, now)],
    ['lapsed', () => settleLapsed(sql, d, now)],
    ['remove', () => finishRemovals(sql, d, now)],
    ['rdap', () => refreshRdap(sql, d, now)],
    ['renewals.schedule', () => scheduleRenewals(sql, now)],
    ['renewals.run', () => runRenewals(sql, d, now)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      domainLog.error({ err, step: name }, 'domain step failed');
    }
  }
}

export function startDomainJobs(sql: Sql, d: DomainJobDeps): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDomainJobs(sql, d, new Date());
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 20_000);
  const every = setInterval(() => void tick(), TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
