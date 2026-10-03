import type { HostHooks } from '@vendua/agent-runtime';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import type { Sql } from '../platform/db.ts';
import { vendedorTurnEnded } from '../vendedor/turn-hook.ts';

export interface HookOpts {
  /** Online QA (§10): dispatch a sampled finished conversation to the QA agent. */
  qa?: HostHooks<Sql>['turnEnded'];
}

/** The team hears about a failed turn in the transaction that records it (ADR 0023). */
export function hostHooks(o: HookOpts = {}): HostHooks<Sql> {
  return {
    async turnFailed(tx, f) {
      const [store] = await tx.host<
        { name: string }[]
      >`select name from tenants where id = ${f.tenantId}`;
      // awaited alone: it runs in a savepoint of this transaction
      await recordStaffEventTx(
        tx.host,
        'agent.turn_failed',
        {
          agentId: f.agentId,
          actorId: f.actorId,
          turnId: f.turnId,
          version: f.version,
          storeName: store?.name ?? null,
          error: f.error.slice(0, 500),
          attempts: f.attempts,
        },
        { tenantId: f.tenantId, dedupeKey: `agent.turn_failed:${f.turnId}` },
      );
    },
    async turnEnded(tx, end) {
      await vendedorTurnEnded(tx, end);
      await o.qa?.(tx, end);
    },
  };
}
