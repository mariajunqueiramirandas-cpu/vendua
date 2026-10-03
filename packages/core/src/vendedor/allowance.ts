import { emitAdminTx } from '../admin/live.ts';
import { claimAiConversationTx } from '../modules/billing/ai-allowance.ts';
import type { Sql } from '../platform/db.ts';
import { writes, type Floor } from './floor.ts';
import { sendDirectTx } from './outbound.ts';
import type { Thread } from './threads.ts';

/**
 * May the Vendedor spend on this thread now (ADR 0032)? A writing floor on a shopper's thread
 * claims the plan's conversation; the owner's test threads never count. When the plan or the
 * month says no, the thread goes to the store: the shopper hears it once, it waits in the inbox,
 * and no handback timer is set (the next message asks again). Ensaio only drafts, so it just
 * stops. Call with the thread row locked FOR UPDATE: the claim's per-store lock comes after it.
 */
export async function claimForTurnTx(
  tx: Sql,
  thread: Thread,
  floor: Floor,
  o: { key: string; silenceMin: number; note?: string; now?: Date },
): Promise<boolean> {
  if (thread.channel === 'test' || !writes(floor)) return true;
  const claim = await claimAiConversationTx(
    tx,
    thread.tenantId,
    `thread:${thread.id}`,
    o.now ?? new Date(),
  );
  if (claim.ok) return true;
  if (floor !== 'agent') return false;
  if (thread.owner !== 'human')
    await sendDirectTx(tx, thread, {
      author: 'core',
      key: o.key,
      // the web chat has no push to the store: point at the menu on the page instead of a person
      text:
        thread.channel === 'whatsapp'
          ? `Vou chamar alguém da loja para te ajudar.${o.note ?? ''}`
          : 'No momento não consigo continuar por aqui, mas você pode fazer o seu pedido pelo cardápio desta página.',
    });
  const reason = claim.reason === 'plan' ? 'plano sem o Duá' : 'conversas do mês esgotadas';
  await tx`update shopper_threads set owner = 'human', owner_reason = ${reason},
    human_until = now() + make_interval(mins => ${o.silenceMin}),
    waiting_since = coalesce(waiting_since, now()), updated_at = now() where id = ${thread.id}`;
  await emitAdminTx(tx, thread.tenantId, 'vendedor.waiting', thread.id);
  return false;
}
