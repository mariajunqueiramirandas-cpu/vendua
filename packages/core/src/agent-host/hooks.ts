import type { HostHooks } from '@vendua/agent-runtime';
import { crmTurnEnded, crmTurnFailed, isCrmTurn } from '../crm/turns.ts';
import { controlTx } from '../modules/control.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import type { Sql } from '../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { vendedorTurnEnded } from '../vendedor/turn-hook.ts';

export interface HookOpts {
  /** Online QA (§10): dispatch a sampled finished conversation to the QA agent. */
  qa?: HostHooks<Sql>['turnEnded'];
}

/** The team hears about a failed turn in the transaction that records it (ADR 0023). */
export function hostHooks(o: HookOpts = {}): HostHooks<Sql> {
  return {
    async turnFailed(tx, f) {
      // Venduá's own CRM agents: a failed run for the CRM team, not a store incident
      if (isCrmTurn(f)) return crmTurnFailed(tx, f);
      const isPlatform = f.tenantId === PLATFORM_TENANT_ID;
      const [store] = isPlatform
        ? []
        : await tx.host<{ name: string }[]>`select name from tenants where id = ${f.tenantId}`;
      const payload = {
        agentId: f.agentId,
        actorId: f.actorId,
        turnId: f.turnId,
        version: f.version,
        storeName: store?.name ?? null,
        error: f.error.slice(0, 500),
        attempts: f.attempts,
      };
      // awaited alone: it runs in a savepoint of this transaction
      if (isPlatform) {
        await controlTx(tx.host, (c) =>
          recordStaffEventTx(c, 'agent.turn_failed', payload, {
            dedupeKey: `agent.turn_failed:${f.turnId}`,
          }),
        );
      } else {
        await recordStaffEventTx(tx.host, 'agent.turn_failed', payload, {
          tenantId: f.tenantId,
          dedupeKey: `agent.turn_failed:${f.turnId}`,
        });
      }
    },
    async turnEnded(tx, end) {
      await vendedorTurnEnded(tx, end);
      await crmTurnEnded(tx, end);
      await o.qa?.(tx, end);
    },
  };
}
