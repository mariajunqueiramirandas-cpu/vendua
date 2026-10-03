import type { FencedTx, MemoryFact, MemoryPort } from '@vendua/agent-runtime';
import type { Sql } from '../../platform/db.ts';

/** Semantic memory (§9): accepted proposals, keyed per scope, under the store's RLS. */
export const pgMemory: MemoryPort<Sql> = {
  async load(tx: FencedTx<Sql>, scope) {
    const rows = await tx.host<
      {
        key: string;
        value: MemoryFact['value'];
        confidence: number;
        provenance: string;
        sensitive: boolean;
      }[]
    >`
      select key, value, confidence, provenance, sensitive from agent_memory
      where tenant_id = ${tx.actor.tenantId} and scope = ${scope}
      order by key limit 100`;
    return rows.map((r) => ({ scope, ...r }));
  },
  async accept(tx, fact) {
    await tx.host`
      insert into agent_memory (tenant_id, scope, key, value, confidence, provenance, sensitive)
      values (${tx.actor.tenantId}, ${fact.scope}, ${fact.key}, ${fact.value === null ? tx.host`'null'::jsonb` : tx.host.json(fact.value as never)},
              ${fact.confidence}, ${fact.provenance}, ${fact.sensitive})
      on conflict (tenant_id, scope, key) do update set
        value = excluded.value, confidence = excluded.confidence, provenance = excluded.provenance,
        sensitive = excluded.sensitive, updated_at = now()`;
  },
  async forget(tx, scope, key) {
    await tx.host`delete from agent_memory where tenant_id = ${tx.actor.tenantId} and scope = ${scope} and key = ${key}`;
  },
};
