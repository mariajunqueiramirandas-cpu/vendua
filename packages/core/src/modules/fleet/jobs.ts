import { controlTx } from '../control.ts';
import { emitControlEvent } from '../control-events.ts';
import type { FleetDeps } from './deps.ts';
import { reconcileTx } from './deploy.ts';
import { fleetLog } from './incidents.ts';
import { runProbes } from './probe.ts';
import { runProvisionings } from './provision.ts';

// The Control Plane's loop (docs/architecture/08 "Reconciler"). Replica-safe: provisionings and
// probes are claimed under leases, deployments move only from `pending`, and reconcile locks
// each store's ops row.

const TICK_MS = 15_000;
const RECONCILE_MS = 5 * 60_000;
const PRUNE_MS = 24 * 60 * 60_000;
const HISTORY_DAYS = 30;

/** Desired vs live for every store: catches whatever a missed publish or a crash left. */
export async function reconcileAll(d: FleetDeps): Promise<number> {
  const ids = await controlTx(
    d.sql,
    (tx) => tx<{ id: string }[]>`select id from tenants where status = 'active' order by id`,
  );
  let moved = 0;
  for (const { id } of ids) {
    try {
      const dep = await controlTx(d.sql, (tx) => reconcileTx(tx, d, id));
      if (dep) moved++;
    } catch (err) {
      fleetLog.warn({ err, tenant: id }, 'reconcile failed');
    }
  }
  if (moved) emitControlEvent('fleet.change');
  return moved;
}

export async function pruneHistory(d: FleetDeps) {
  await controlTx(d.sql, async (tx) => {
    await tx`delete from health_checks where at < now() - make_interval(days => ${HISTORY_DAYS})`;
    await tx`
      delete from fleet_incidents
      where resolved_at < now() - make_interval(days => ${HISTORY_DAYS * 3})
    `;
  });
}

export function startFleetJobs(d: FleetDeps): () => void {
  let running = false;
  let lastReconcile = 0;
  let lastPrune = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      if (now - lastReconcile >= RECONCILE_MS) {
        lastReconcile = now;
        await reconcileAll(d);
      }
      await runProvisionings(d);
      await runProbes(d);
      if (now - lastPrune >= PRUNE_MS) {
        lastPrune = now;
        await pruneHistory(d);
      }
    } catch (err) {
      fleetLog.error({ err }, 'fleet tick failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 5_000);
  const every = setInterval(tick, TICK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
