import type { Sql } from '../platform/db.ts';
import { PLATFORM_TENANT_ID } from '../platform/tenancy.ts';
import { CRM_AGENT_ID } from '../crm/dispatch.ts';
import { controlTx } from './control.ts';

// Ops readout behind GET /control/v1/agent/metrics (ADR 0014).

export type MetricsKind = 'triage' | 'reply' | 'outreach' | 'discovery' | 'strategist';
const KINDS: MetricsKind[] = ['triage', 'reply', 'outreach', 'discovery', 'strategist'];

export interface KindMetrics {
  kind: MetricsKind;
  /** Turns finished in the window, by status (a turn is never canceled: canceled stays 0). */
  runs: number;
  done: number;
  failed: number;
  canceled: number;
  /** Share of done turns where a lead-facing action landed. */
  actedRate: number;
  /** Average model calls per done turn. */
  avgSteps: number;
  costUsd: number;
  avgCostUsd: number;
}

export interface AgentMetrics {
  window: { from: string; to: string };
  byKind: KindMetrics[];
  /** Funnel counts, not a partition: an approved draft that later sent counts in both. */
  outbound: { sent: number; drafted: number; approved: number; rejected: number };
  /** Leads the agent actually reached (sent/delivered) vs leads that wrote
   *  back in the same window. */
  replies: { leadsContacted: number; leadsReplied: number; replyRate: number };
  /** The agenda: timers waiting for a lead's agent, and how many came due in the window. */
  wakeups: { pending: number; fired: number };
}

export async function agentMetrics(sql: Sql, days: 7 | 30): Promise<AgentMetrics> {
  const to = new Date();
  // Inclusive `to`: same-ms rows fall inside the window, never just past it.
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
        0 as canceled,
        count(*) filter (where status = 'done' and acted)::int as acted,
        avg(steps) filter (where status = 'done')::float8 as avg_steps,
        coalesce(sum(cost_cents), 0)::int as cost_cents
      from crm_turns
      where finished_at >= ${from} and finished_at <= ${to}
      group by kind
    `;
    const byKind = new Map(kindRows.map((r) => [r.kind, r]));

    // Each aggregate uses its own event timestamp — a pre-window draft approved and sent
    // in-window counts as in-window contact, its approval on the day staff approved it.
    const outbound = (
      await tx<{ sent: number; drafted: number; approved: number; rejected: number }[]>`
        select
          count(*) filter (
            where status in ('sent', 'delivered')
              and coalesce(dispatch_attempted_at, created_at) >= ${from}
              and coalesce(dispatch_attempted_at, created_at) <= ${to}
          )::int as sent,
          count(*) filter (
            where status = 'draft' and created_at >= ${from} and created_at <= ${to}
          )::int as drafted,
          count(*) filter (
            where approved_by is not null
              and coalesce(approved_at, created_at) >= ${from}
              and coalesce(approved_at, created_at) <= ${to}
          )::int as approved,
          count(*) filter (
            where status = 'rejected' and updated_at >= ${from} and updated_at <= ${to}
          )::int as rejected
        from lead_messages
        where direction = 'out' and author = 'agent'
      `
    )[0]!;

    const replies = (
      await tx<{ leads_contacted: number; leads_replied: number }[]>`
        with contacted as (
          -- replied = non-historical inbound landing after the agent's first send
          select t.lead_id, min(coalesce(m.dispatch_attempted_at, m.created_at)) as first_sent_at
          from lead_messages m
          join lead_threads t on t.id = m.thread_id
          where m.direction = 'out' and m.author = 'agent'
            and m.status in ('sent', 'delivered')
            -- dispatch time, same as the sent count
            and coalesce(m.dispatch_attempted_at, m.created_at) >= ${from}
            and coalesce(m.dispatch_attempted_at, m.created_at) <= ${to}
          group by t.lead_id
        ), replied as (
          select distinct t.lead_id from lead_messages m
          join lead_threads t on t.id = m.thread_id
          join contacted c on c.lead_id = t.lead_id
          where m.direction = 'in' and not m.historical
            and m.created_at >= ${from} and m.created_at <= ${to}
            and m.created_at > c.first_sent_at
        )
        select (select count(*)::int from contacted) as leads_contacted,
          (select count(*)::int from replied) as leads_replied
      `
    )[0]!;

    const [wakeups] = await tx<{ pending: number; fired: number }[]>`
      select count(*) filter (where m.consumed_by_turn is null)::int as pending,
        count(*) filter (
          where m.consumed_by_turn is not null and m.deliver_at >= ${from} and m.deliver_at <= ${to}
        )::int as fired
      from agent_mailbox m join agent_actors a on a.id = m.actor_id
      where a.tenant_id = ${PLATFORM_TENANT_ID} and a.agent_id = ${CRM_AGENT_ID} and m.kind like 'timer.%'`;

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
      wakeups: { pending: wakeups?.pending ?? 0, fired: wakeups?.fired ?? 0 },
    };
  });
}
