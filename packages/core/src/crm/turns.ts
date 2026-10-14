import type { FencedTx, Json, TurnEnd, TurnFailure } from '@vendua/agent-runtime';
import { turn, turnOf, type TurnInfo } from '../agent-host/agents/crm/shared.ts';
import { appendDebriefTx, hasMemoryTablesTx } from '../modules/agent-memory.ts';
import { controlTx } from '../modules/control.ts';
import { emitControlEvent } from '../modules/control-events.ts';
import {
  capCentsOf,
  DEFAULT_GUARDRAILS,
  getSettingTx,
  type Guardrails,
} from '../modules/integrations.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { afterCommit, type Sql } from '../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { CRM_AGENT_ID, CRM_DISCOVERY_ID, CRM_STRATEGIST_ID, LEAD_SUBJECT } from './dispatch.ts';

// What the CRM keeps of a finished turn (ADR 0030 steps 2–4): one crm_turns row, written by the
// host's turn hooks in the transaction that ends the turn. It is what the activity list, the cost
// caps, metrics and reports read; the turn's whole story stays in agent_events.

export const CRM_AGENTS: readonly string[] = [CRM_AGENT_ID, CRM_DISCOVERY_ID, CRM_STRATEGIST_ID];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isCrmTurn = (t: { tenantId: string; agentId: string }) =>
  t.tenantId === PLATFORM_TENANT_ID && CRM_AGENTS.includes(t.agentId);

interface Totals {
  started_at: Date | null;
  steps: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  batch: Json;
}

/** The turn's spend and start, summed from its own log rows. */
async function totalsTx(tx: Sql, actorId: string, turnId: string): Promise<Totals> {
  const [row] = await tx<Totals[]>`
    select min(at) as started_at,
      count(*) filter (where type = 'model.responded')::int as steps,
      coalesce(sum((payload -> 'usage' ->> 'inputTokens')::int)
        filter (where type = 'model.responded'), 0)::int as tokens_in,
      coalesce(sum((payload -> 'usage' ->> 'outputTokens')::int)
        filter (where type = 'model.responded'), 0)::int as tokens_out,
      coalesce(sum((payload -> 'usage' ->> 'costUsd')::float8)
        filter (where type = 'model.responded'), 0)::float8 as cost_usd,
      (array_agg(payload -> 'batch') filter (where type = 'turn.started'))[1] as batch
    from agent_events where actor_id = ${actorId} and turn_id = ${turnId}`;
  return (
    row ?? { started_at: null, steps: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0, batch: null }
  );
}

async function projectTx(
  tx: Sql,
  t: { actorId: string; agentId: string; subject: { kind: string; id: string }; turnId: string },
  info: TurnInfo,
  status: 'done' | 'failed',
  error: string | null,
): Promise<{ leadId: string | null; costCents: number }> {
  const totals = await totalsTx(tx, t.actorId, t.turnId);
  const costCents = Math.round((totals.cost_usd + info.monidUsd) * 100);
  const leadId = t.subject.kind === LEAD_SUBJECT && UUID.test(t.subject.id) ? t.subject.id : null;
  const briefId =
    typeof info.params.briefId === 'string' && UUID.test(info.params.briefId)
      ? info.params.briefId
      : null;
  // staff text rides in params: bounded so the row stays under its 8 KB check
  const params = {
    ...info.params,
    ...(info.params.text ? { text: info.params.text.slice(0, 1500) } : {}),
    ...(info.params.focus ? { focus: info.params.focus.slice(0, 1500) } : {}),
  };
  await controlTx(
    tx,
    (c) => c`
    insert into crm_turns (turn_id, actor_id, agent_id, kind, source, lead_id, brief_id, status,
      started_at, steps, acted, leads_created, tokens_in, tokens_out, cost_cents, error, params)
    values (${t.turnId}, ${t.actorId}, ${t.agentId}, ${info.kind}, ${info.source.slice(0, 120) || 'agent'},
      (select id from leads where id = ${leadId}),
      (select id from discovery_briefs where id = ${briefId}),
      ${status}, ${totals.started_at ?? new Date()}, ${totals.steps}, ${info.acted},
      ${info.leadsCreated}, ${totals.tokens_in}, ${totals.tokens_out}, ${costCents},
      ${error ? error.slice(0, 1000) : null}, ${c.json(params as never)})
    on conflict (turn_id) do nothing`,
  );
  return { leadId, costCents };
}

/** Whether the lead's agent spend reached its lifetime cap. Crossing it is flagged once per cap
 *  level: the lead's timeline, a task for a person and one staff event. */
export async function leadOverCostCapTx(tx: Sql, leadId: string): Promise<boolean> {
  return controlTx(tx, async (c) => {
    const g = {
      ...DEFAULT_GUARDRAILS,
      ...(await getSettingTx<Partial<Guardrails>>(c, 'guardrails', {})),
    };
    const capCents = capCentsOf(g);
    if (capCents <= 0) return false;
    await c`select pg_advisory_xact_lock(hashtext(${`capfin:${leadId}`}))`;
    const [row] = await c<{ spent: number }[]>`
      select coalesce(sum(cost_cents), 0)::int as spent from crm_turns where lead_id = ${leadId}`;
    const spent = row?.spent ?? 0;
    if (spent < capCents) return false;
    // once per cap level: a raised cap flags again on the next crossing
    const [flagged] = await c`
      select 1 from lead_activities
      where lead_id = ${leadId} and kind = 'system' and meta->>'type' = 'cost-cap'
        and (meta->>'capUsd')::numeric = ${g.leadLifetimeCostCapUsd}
      limit 1`;
    if (flagged) return true;
    const [lead] = await c<{ name: string }[]>`select name from leads where id = ${leadId}`;
    const name = lead?.name ?? leadId;
    await c`
      insert into lead_activities (lead_id, kind, body, meta, created_by)
      values (${leadId}, 'system',
              ${`custo acumulado do agente atingiu o teto (US$ ${g.leadLifetimeCostCapUsd}) — novas runs suspensas`},
              ${c.json({ type: 'cost-cap', capUsd: g.leadLifetimeCostCapUsd, spentCents: spent } as never)}, 'system')`;
    await c`
      insert into lead_tasks (lead_id, title, due_at, created_by)
      values (${leadId},
              ${`[humano] ${name}: custo do agente ≥ US$ ${g.leadLifetimeCostCapUsd} — suba o teto ou encerre a automação`.slice(0, 300)},
              null, 'agent')`;
    await recordStaffEventTx(
      c,
      'agent.cost_cap',
      { leadId, leadName: name, spentCents: spent, capCents },
      { dedupeKey: `costcap:${leadId}:${capCents}` },
    );
    return true;
  });
}

/** Discovery's deterministic debrief: next runs read it as doctrine (memory scope `debrief`). */
async function debriefTx(tx: Sql, turnId: string, actorId: string, info: TurnInfo): Promise<void> {
  const rows = await tx<{ name: string; data: Record<string, unknown> | null }[]>`
    select payload ->> 'name' as name, payload -> 'data' as data from agent_events
    where actor_id = ${actorId} and turn_id = ${turnId} and type = 'tool.returned'
      and (payload ->> 'ok')::boolean`;
  let leads = 0;
  let merges = 0;
  let withWa = 0;
  const resolvers = new Set<string>();
  for (const r of rows) {
    const d = r.data ?? {};
    if (r.name === 'create_lead') {
      const lead = d.lead as { whatsapp?: unknown } | undefined;
      if (lead) {
        leads++;
        if (typeof lead.whatsapp === 'string') withWa++;
      } else if (d.duplicate) merges++;
    }
    const fc = d.foundContacts as { phones?: string[]; whatsappLinks?: string[] } | undefined;
    if (fc?.phones?.length || fc?.whatsappLinks?.length) resolvers.add(r.name);
    if ((d.candidates as { phone?: string | null }[] | undefined)?.some((c) => c.phone))
      resolvers.add(r.name);
  }
  const dead = info.book.filter((e) => e.status === 'dead').map((e) => e.name);
  if (!leads && !merges && !dead.length) return;
  const seg = String(info.params.query ?? info.params.briefName ?? 'discovery').slice(0, 60);
  const city = String(info.params.city ?? '').slice(0, 40);
  const fact =
    `run ${seg}${city ? `/${city}` : ''}: ${leads} leads (${withWa} c/ whatsapp)` +
    `${merges ? `, ${merges} merges` : ''}` +
    `${resolvers.size ? `; canais via ${[...resolvers].join('+')}` : ''}` +
    `${dead.length ? `; beco sem saída: ${dead.slice(0, 4).join(', ')}` : ''}` +
    `${info.monidUsd ? `; monid $${info.monidUsd.toFixed(3)}` : ''}`;
  await controlTx(tx, async (c) => {
    if (!(await hasMemoryTablesTx(c))) return;
    await appendDebriefTx(c, {
      content: fact.slice(0, 500),
      sourceRunId: turnId,
      segment: info.params.segment ?? null,
    });
  });
}

export async function crmTurnEnded(tx: FencedTx<Sql>, end: TurnEnd): Promise<void> {
  if (!isCrmTurn(end)) return;
  const info = turn(end.state);
  // a maintenance turn (compaction) did no CRM work
  if (info.id !== end.turnId) return;
  const sql = tx.host;
  // a parked subject (cost cap, paused lead) finished without a model call: say why
  const parked = (end.state.context.subject as { parked?: string | null } | null)?.parked ?? null;
  const { leadId, costCents } = await projectTx(sql, end, info, 'done', parked);
  // a lowered cap parks the lead without spending: the flag still goes up
  if (leadId) await leadOverCostCapTx(sql, leadId);
  if (end.agentId === CRM_DISCOVERY_ID) await debriefTx(sql, end.turnId, end.actorId, info);
  afterCommit(sql, () => {
    emitControlEvent('run.update', end.turnId);
    if (leadId) emitControlEvent('lead.change', leadId);
  });
}

/** A CRM turn that exhausted its retries: the team hears it as a failed run (ADR 0023). */
export async function crmTurnFailed(tx: FencedTx<Sql>, f: TurnFailure): Promise<void> {
  const sql = tx.host;
  const totals = await totalsTx(sql, f.actorId, f.turnId);
  const batch = Array.isArray(totals.batch)
    ? (totals.batch as unknown as { kind: string; source: string; payload: Json }[])
    : [];
  const info = turnOf(batch, f.turnId);
  const { leadId } = await projectTx(sql, f, info, 'failed', f.error);
  await controlTx(sql, async (c) => {
    const [lead] = leadId
      ? await c<{ name: string }[]>`select name from leads where id = ${leadId}`
      : [];
    await recordStaffEventTx(
      c,
      'agent.run_failed',
      {
        runId: f.turnId,
        job: info.kind,
        leadId,
        leadName: lead?.name ?? null,
        error: f.error.slice(0, 500),
        attempts: f.attempts,
      },
      { dedupeKey: `run:${f.turnId}:failed` },
    );
    // a lead who wrote is waiting on an answer nobody will send: a person picks it up
    if (leadId && info.kind === 'reply')
      await c`
        insert into lead_tasks (lead_id, title, due_at, created_by)
        values (${leadId},
                ${`[humano] ${lead?.name ?? 'lead'}: o agente falhou ao responder — responda pela conversa`.slice(0, 300)},
                now(), 'agent')`;
  });
  afterCommit(sql, () => {
    emitControlEvent('run.update', f.turnId);
    if (leadId) emitControlEvent('lead.change', leadId);
  });
}
