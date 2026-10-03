import type { Thread } from '../../../vendedor/threads.ts';
import type { Ctx } from './shared.ts';

export const HANDOFF_REASONS = [
  'pediu uma pessoa',
  'reclamação',
  'atraso',
  'alergia',
  'pedido grande',
  'pagamento',
  'outro',
] as const;
export type HandoffReason = (typeof HANDOFF_REASONS)[number];

/**
 * Marks the shopper as waiting for the store, with the reason and a one-line summary for the
 * inbox and the push. The floor moves to the store when the turn ends (the end hook), so the
 * Vendedor's one "vou chamar a loja" still goes out; after that it stays silent until the store
 * hands back or its window lapses. The calling tool returns `data.handoff`.
 */
export async function handoffTx(
  ctx: Ctx,
  t: Thread,
  reason: string,
  summary: string,
): Promise<{ handoff: { reason: string; summary: string } }> {
  await ctx.tx`
    update shopper_threads set waiting_since = coalesce(waiting_since, now()),
      owner_reason = ${reason.slice(0, 200)}, updated_at = now()
    where id = ${t.id}`;
  return { handoff: { reason: reason.slice(0, 60), summary: summary.slice(0, 200) } };
}
