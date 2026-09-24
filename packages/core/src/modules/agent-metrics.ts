import type { Sql } from '../platform/db.ts';
import { controlTx } from './control.ts';

/**
 * modules/agent-metrics — the ops readout behind
 * GET /control/v1/agent/metrics?days=7|30 (ADR 0014). One pass over
 * agent_runs + lead_messages answers: is the agent acting when it finishes,
 * what is it spending, how much outbound needs a human, and do contacted
 * leads write back.
 */

export type MetricsKind = 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
const KINDS: MetricsKind[] = ['triage', 'reply', 'outreach', 'discovery', 'strategist'];

// Mirror of runner.ts's ACTION_TOOLS/runActed, expressed in SQL: a journaled
// tool result counts as "acted" only when it landed a visible effect — a
// result object carrying no `error`, `blocked !== true`, `ignored !== true`.
const ACTION_TOOLS: string[] = [
  'send_message',
  'draft_message',
  'request_human',
  'unsubscribe',
  'set_state',
  'update_lead',
  'create_task',
];

export interface KindMetrics {
  kind: MetricsKind;
  /** Runs created in the window, by terminal status. */
  runs: number;
  done: number;
  failed: number;
  canceled: number;
  /** Share of done runs whose journal holds a clean action tool result. */
  actedRate: number;
  /** Average journal length of done runs (model + tool + nudge entries). */
  avgSteps: number;
  costUsd: number;
  avgCostUsd: number;
}

export interface AgentMetrics {
  window: { from: string; to: string };
  byKind: KindMetrics[];
  /** Agent-authored outbound messages composed in the window — funnel
   *  counts, not a partition: an approved draft that later sent counts in
   *  both `approved` and `sent`. */
  outbound: { sent: number; drafted: number; approved: number; rejected: number };
  /** Leads the agent actually reached (sent/delivered) vs leads that wrote
   *  back in the same window. */
  replies: { leadsContacted: number; leadsReplied: number; replyRate: number };
  /** Live backlog of pending wakeups + how many fired; null while the
   *  agent_wakeups table isn't deployed. */
  wakeups: { pending: number; fired: number } | null;
}

export async function agentMetrics(sql: Sql, days: 7 | 30): Promise<AgentMetrics> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return controlTx(sql, async (tx) => {
    const kindRows = await tx<
      {
        kind: string;
        runs: number;
        done: number;
        failed: number;
        canceled: number;
        acted: number;
        avg_steps: number | null;
        cost_cents: number;
      }[]
    >`
      select kind,
        count(*)::int as runs,
        count(*) filter (where status = 'done')::int as done,
        count(*) filter (where status = 'failed')::int as failed,
        count(*) filter (where status = 'canceled')::int as canceled,
        count(*) filter (
          where status = 'done' and exists (
            select 1 from jsonb_array_elements(steps) e
            where e->>'type' = 'tool'
              and e->>'name' = any(${ACTION_TOOLS})
              and e->>'out' is not null
              and e->'out'->>'error' is null
              and coalesce(e->'out'->>'blocked', '') <> 'true'
              and coalesce(e->'out'->>'ignored', '') <> 'true'
          )
        )::int as acted,
        avg(jsonb_array_length(steps)) filter (where status = 'done')::float8 as avg_steps,
        coalesce(sum(cost_cents), 0)::int as cost_cents
      from agent_runs
      where created_at >= ${from} and created_at < ${to}
      group by kind
    `;
    const byKind = new Map(kindRows.map((r) => [r.kind, r]));

    const outbound = (
      await tx<{ sent: number; drafted: number; approved: number; rejected: number }[]>`
        select
          count(*) filter (where status in ('sent', 'delivered'))::int as sent,
          count(*) filter (where status = 'draft')::int as drafted,
          count(*) filter (where approved_by is not null)::int as approved,
          count(*) filter (where status = 'rejected')::int as rejected
        from lead_messages
        where direction = 'out' and author = 'agent'
          and created_at >= ${from} and created_at < ${to}
      `
    )[0]!;

    const replies = (
      await tx<{ leads_contacted: number; leads_replied: number }[]>`
        with contacted as (
          select distinct t.lead_id from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where m.direction = 'out' and m.author = 'agent'
            and m.status in ('sent', 'delivered')
            and m.created_at >= ${from} and m.created_at < ${to}
        ), replied as (
          select distinct t.lead_id from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where m.direction = 'in' and not m.historical
            and m.created_at >= ${from} and m.created_at < ${to}
        )
        select (select count(*)::int from contacted) as leads_contacted,
          (select count(*)::int from replied
            where lead_id in (select lead_id from contacted)) as leads_replied
      `
    )[0]!;

    // The table only exists once the wakeups migration deploys — a control
    // box ahead of schema must report absence, not error.
    const hasWakeups =
      (await tx<{ r: string | null }[]>`select to_regclass('agent_wakeups') as r`)[0]!.r !== null;
    const wakeups = hasWakeups
      ? (
          await tx<{ pending: number; fired: number }[]>`
            select count(*) filter (where status = 'pending')::int as pending,
              count(*) filter (where status = 'fired' and at >= ${from} and at < ${to})::int as fired
            from agent_wakeups
          `
        )[0]!
      : null;

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      byKind: KINDS.map((kind) => {
        const r = byKind.get(kind);
        const costUsd = (r?.cost_cents ?? 0) / 100;
        const runs = r?.runs ?? 0;
        const done = r?.done ?? 0;
        return {
          kind,
          runs,
          done,
          failed: r?.failed ?? 0,
          canceled: r?.canceled ?? 0,
          actedRate: r?.done ? r.acted / r.done : 0,
          avgSteps: Math.round((r?.avg_steps ?? 0) * 100) / 100,
          costUsd,
          avgCostUsd: runs ? costUsd / runs : 0,
        };
      }),
      outbound: {
        sent: outbound.sent,
        drafted: outbound.drafted,
        approved: outbound.approved,
        rejected: outbound.rejected,
      },
      replies: {
        leadsContacted: replies.leads_contacted,
        leadsReplied: replies.leads_replied,
        replyRate: replies.leads_contacted ? replies.leads_replied / replies.leads_contacted : 0,
      },
      wakeups: wakeups ? { pending: wakeups.pending, fired: wakeups.fired } : null,
    };
  });
}
