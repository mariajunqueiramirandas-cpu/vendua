import type { SubjectRef } from '@vendua/agent-runtime';
import type { Sql } from '../platform/db.ts';

/**
 * LGPD erasure of one conversation: its actor (the log and mailbox cascade) and the facts
 * remembered under `memoryScope`. `tx` is scoped to the store.
 */
export async function forgetSubjectTx(
  tx: Sql,
  tenantId: string,
  subject: SubjectRef,
  memoryScope?: string,
): Promise<number> {
  const gone = await tx`
    delete from agent_actors
    where tenant_id = ${tenantId} and subject_kind = ${subject.kind} and subject_id = ${subject.id}
    returning id`;
  if (memoryScope)
    await tx`delete from agent_memory where tenant_id = ${tenantId} and scope = ${memoryScope}`;
  return gone.length;
}
