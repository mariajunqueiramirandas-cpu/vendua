import { emitAdminTx } from '../admin/live.ts';
import { CONVERSATION_WINDOW_MS, claimAiConversationTx } from '../modules/billing/ai-allowance.ts';
import type { Sql } from '../platform/db.ts';
import { writes, type Floor } from './floor.ts';
import { sendDirectTx } from './outbound.ts';
import type { Thread } from './threads.ts';

/** New storefront-chat conversations a store takes per hour: anyone can open carts on a site. */
export const WEB_CHAT_NEW_PER_HOUR = 30;

/** A web thread that would start a conversation past the hourly cap. Takes the claim's lock. */
async function webCapReachedTx(tx: Sql, thread: Thread, now: Date): Promise<boolean> {
  const subject = `thread:${thread.id}`;
  const open = () => tx`
    select 1 from ai_conversations where tenant_id = ${thread.tenantId} and subject_key = ${subject}
      and started_at > ${new Date(now.getTime() - CONVERSATION_WINDOW_MS)} limit 1`;
  if ((await open()).length) return false;
  // the same per-store lock claimAiConversationTx takes: the count and the claim are one step
  await tx`select pg_advisory_xact_lock(hashtextextended(${`ai-allowance|${thread.tenantId}`}, 0))`;
  if ((await open()).length) return false;
  const [r] = await tx<{ n: number }[]>`
    select count(*)::int as n from ai_conversations a
    join shopper_threads s on a.subject_key = 'thread:' || s.id::text
    where a.tenant_id = ${thread.tenantId} and a.started_at > ${new Date(now.getTime() - 3600_000)}
      and s.tenant_id = ${thread.tenantId} and s.channel = 'web'`;
  return (r?.n ?? 0) >= WEB_CHAT_NEW_PER_HOUR;
}

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
  const now = o.now ?? new Date();
  const capped = thread.channel === 'web' && (await webCapReachedTx(tx, thread, now));
  const claim = capped
    ? null
    : await claimAiConversationTx(tx, thread.tenantId, `thread:${thread.id}`, now);
  if (claim?.ok) return true;
  // the owner hears it (a push, once in a while) and sees it on Duá's home and in Conta
  if (claim?.reason === 'exhausted')
    await emitAdminTx(
      tx,
      thread.tenantId,
      'vendedor.exhausted',
      claim.allowance.resetsAt?.toISOString() ?? 'trial',
    );
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
  const reason = !claim
    ? 'muitas conversas novas no site'
    : claim.reason === 'plan'
      ? 'plano sem o Duá'
      : 'conversas do mês esgotadas';
  await tx`update shopper_threads set owner = 'human', owner_reason = ${reason},
    human_until = now() + make_interval(mins => ${o.silenceMin}),
    waiting_since = coalesce(waiting_since, now()), updated_at = now() where id = ${thread.id}`;
  await emitAdminTx(tx, thread.tenantId, 'vendedor.waiting', thread.id);
  return false;
}
