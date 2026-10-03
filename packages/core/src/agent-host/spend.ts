import type { SpendPort } from '@vendua/agent-runtime';
import { controlTx } from '../modules/control.ts';
import { withTenant, type Sql } from '../platform/db.ts';

const CACHE_MS = 60_000;

/**
 * Tenant daily budgets: spend is the sum of `model.responded` costs in the log; limits come
 * from `control_settings` key `agent_runtime.budgets` ({ "<budget key>": usd,
 * "tenants": { "<tenantId>": { "<budget key>": usd } } }). No limit set means no cap.
 */
export function pgSpend(sql: Sql): SpendPort {
  let cached: { at: number; value: Record<string, unknown> } | null = null;
  return {
    async tenantSpend(tenantId, agentId, since) {
      const rows = await withTenant(
        sql,
        tenantId,
        (tx) => tx<{ usd: number }[]>`
        select coalesce(sum((e.payload -> 'usage' ->> 'costUsd')::float8), 0) as usd
        from agent_events e join agent_actors a on a.id = e.actor_id
        where e.tenant_id = ${tenantId} and e.type = 'model.responded' and e.at >= ${since}
          and a.agent_id = ${agentId}`,
      );
      return Number(rows[0]?.usd ?? 0);
    },
    async tenantDailyLimit(tenantId, _agentId, key) {
      if (!cached || Date.now() - cached.at > CACHE_MS) {
        const rows = await controlTx(
          sql,
          (tx) => tx<{ value: Record<string, unknown> }[]>`
          select value from control_settings where key = 'agent_runtime.budgets'`,
        );
        cached = { at: Date.now(), value: rows[0]?.value ?? {} };
      }
      const tenants = cached.value.tenants as Record<string, Record<string, unknown>> | undefined;
      const v = tenants?.[tenantId]?.[key] ?? cached.value[key];
      return typeof v === 'number' && v >= 0 ? v : null;
    },
  };
}
