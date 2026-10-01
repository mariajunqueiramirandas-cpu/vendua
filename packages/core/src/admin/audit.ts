import type { Sql } from '../platform/db.ts';
import type { Merchant } from './context.ts';

/** One row per admin mutation, in the mutation's own tx — no change lands unrecorded. */
export async function audit(
  tx: Sql,
  tenantId: string,
  // staff (the CRM's menu import) have no merchant_users row: userId null, a label for the log
  actor: Pick<Merchant, 'name'> & { userId: string | null },
  entry: {
    action: string;
    entity: string;
    entityId?: string | null;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
) {
  const clip = (v: unknown) => {
    if (v === undefined || v === null) return null;
    // the log is for "who changed what", not a backup — big payloads keep their shape only
    return JSON.stringify(v).length > 16_000 ? { truncated: true } : v;
  };
  const before = clip(entry.before);
  const after = clip(entry.after);
  await tx`
    insert into audit_log (tenant_id, actor_user_id, actor_label, action, entity, entity_id, summary, before, after)
    values (${tenantId}, ${actor.userId}, ${actor.name}, ${entry.action}, ${entry.entity},
            ${entry.entityId ?? null}, ${entry.summary.slice(0, 300)},
            ${before === null ? null : tx.json(before as never)},
            ${after === null ? null : tx.json(after as never)})
  `;
}
