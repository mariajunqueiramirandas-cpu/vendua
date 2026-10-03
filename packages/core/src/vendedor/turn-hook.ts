import type { FencedTx, TurnEnd } from '@vendua/agent-runtime';
import { emitAdminTx } from '../admin/live.ts';
import type { Sql } from '../platform/db.ts';
import { loadAgent } from './settings.ts';
import { AGENT_ID } from './threads.ts';

interface EndCustom {
  turnId: string | null;
  handoff?: { turnId: string; reason: string } | null;
  demand?: { kind: string; term: string }[];
  knowledgeUsed?: string[];
}

/**
 * After a Vendedor turn, in the transaction that records its end: the floor moves to the store
 * if a tool handed off this turn (its one "vou chamar a loja" already went out), demand and
 * answers used this turn are counted, and the thread's stage follows the statechart.
 */
export async function vendedorTurnEnded(tx: FencedTx<Sql>, end: TurnEnd): Promise<void> {
  if (end.agentId !== AGENT_ID) return;
  const sql = tx.host;
  const c = (end.state.custom ?? {}) as unknown as EndCustom;
  if (c.handoff?.turnId === end.turnId) {
    const agent = await loadAgent(sql, end.tenantId);
    const moved = await sql`
      update shopper_threads set owner = 'human',
        human_until = now() + make_interval(mins => ${agent.settings.humanSilenceMin}),
        waiting_since = coalesce(waiting_since, now()), updated_at = now()
      where tenant_id = ${end.tenantId} and id = ${end.subject.id} and owner <> 'muted'
      returning id`;
    if (moved.length) await emitAdminTx(sql, end.tenantId, 'vendedor.waiting', end.subject.id);
  }
  if (c.turnId === end.turnId) {
    for (const d of (c.demand ?? []).slice(0, 5))
      if ((d.kind === 'unmet' || d.kind === 'out_of_zone') && d.term)
        await sql`insert into vendedor_demand (tenant_id, kind, term) values (${end.tenantId}, ${d.kind}, ${d.term.slice(0, 80)})`;
    const used = [...new Set(c.knowledgeUsed ?? [])].slice(0, 10);
    if (used.length)
      await sql`update store_knowledge set used_count = used_count + 1, updated_at = now()
        where tenant_id = ${end.tenantId} and id = any(${used}::uuid[])`;
  }
  const stage = end.state.chart.state;
  if (['browsing', 'building', 'confirming', 'ordered'].includes(stage))
    await sql`update shopper_threads set stage = ${stage} where id = ${end.subject.id} and stage <> ${stage}
      and not (stage = 'paying' and ${stage} = 'ordered')`;
}
