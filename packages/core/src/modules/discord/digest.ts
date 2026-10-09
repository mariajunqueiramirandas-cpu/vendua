import type { Sql } from '../../platform/db.ts';
import { anchorTx } from '../../agent/schedule-anchors.ts';
import { controlTx } from '../control.ts';
import { getIntegrationTx, getSettingTx } from '../integrations.ts';
import { recordStaffEvent, type DailyDigest } from '../staff-events.ts';
import { discordAppOf, discordSettingOf } from './config.ts';

// The daily summary (`discord-digest` job), the team's only one: CRM and agent numbers from
// their own tables, commerce, billing and system numbers from the staff event log of the last
// 24 hours — staff never need a cross-tenant query on orders for it.

type N = { n: number };

export interface DigestReport {
  /** local date (guardrails.timezone) this digest covers. */
  date: string;
  newLeads: number;
  repliesIn: number;
  meetingsBooked: number;
  meetingsNext24h: number;
  agentRuns: number;
  costCents: number;
  pendingDrafts: number;
  openTasks: number;
}

/** The CRM and agent side of the summary: the last 24 hours on the board. */
export async function digestReportTx(tx: Sql, date: string): Promise<DigestReport> {
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]!.n;
  const [newLeads, repliesIn, meetingsBooked, meetingsNext24h, runs, pendingDrafts, openTasks] =
    await Promise.all([
      one(
        tx<{ n: number }[]>`
          select count(*)::int as n from leads
          where created_at > now() - interval '24 hours' and archived_at is null
        `,
      ),
      one(
        tx<{ n: number }[]>`
          select count(*)::int as n from lead_messages
          where direction = 'in' and created_at > now() - interval '24 hours'
        `,
      ),
      one(
        tx<{ n: number }[]>`
          select count(*)::int as n from meetings
          where created_at > now() - interval '24 hours'
        `,
      ),
      one(
        tx<{ n: number }[]>`
          select count(*)::int as n from meetings
          where status = 'scheduled' and starts_at between now() and now() + interval '24 hours'
        `,
      ),
      tx<{ runs: number; cost_cents: number }[]>`
        select count(*)::int as runs, coalesce(sum(cost_cents), 0)::int as cost_cents
        from agent_runs where created_at > now() - interval '24 hours'
      `.then((r) => r[0]!),
      one(
        tx<{ n: number }[]>`
          select count(*)::int as n from lead_messages where status = 'draft'
        `,
      ),
      one(
        tx<{ n: number }[]>`
          select count(*)::int as n from lead_tasks where done_at is null
        `,
      ),
    ]);
  return {
    date,
    newLeads,
    repliesIn,
    meetingsBooked,
    meetingsNext24h,
    agentRuns: runs.runs,
    costCents: runs.cost_cents,
    pendingDrafts,
    openTasks,
  };
}

export async function computeDigest(sql: Sql, date: string): Promise<DailyDigest> {
  return controlTx(sql, async (tx) => {
    const crm = await digestReportTx(tx, date);
    const one = async (q: Promise<N[]>) => (await q)[0]?.n ?? 0;
    const [failedRuns, milestones, orders, top, cancelled, firstOrders, stores, paid, problems] =
      await Promise.all([
        one(tx<N[]>`
          select count(*)::int as n from agent_runs
          where status = 'failed' and finished_at > now() - interval '24 hours'
        `),
        one(tx<N[]>`
          select count(*)::int as n from lead_state_history
          where to_state in ('invited', 'live') and at > now() - interval '24 hours'
        `),
        tx<{ n: number; cents: number; stores: number }[]>`
          select count(*)::int as n, coalesce(sum((data->>'totalCents')::bigint), 0)::bigint as cents,
                 count(distinct tenant_id)::int as stores
          from staff_events
          where kind = 'order.placed' and created_at > now() - interval '24 hours'
        `,
        tx<{ storeName: string; orders: number; gmvCents: number }[]>`
          select max(data->>'storeName') as "storeName", count(*)::int as orders,
                 coalesce(sum((data->>'totalCents')::bigint), 0)::bigint as "gmvCents"
          from staff_events
          where kind = 'order.placed' and created_at > now() - interval '24 hours'
          group by tenant_id order by 3 desc, 2 desc limit 5
        `,
        one(tx<N[]>`
          select count(*)::int as n from staff_events
          where kind = 'order.updated' and data->>'to' = 'cancelled'
            and created_at > now() - interval '24 hours'
        `),
        tx<{ name: string }[]>`
          select data->>'storeName' as name from staff_events
          where kind = 'store.first_order' and created_at > now() - interval '24 hours'
          order by id limit 10
        `,
        one(tx<N[]>`
          select count(*)::int as n from staff_events
          where kind = 'store.created' and created_at > now() - interval '24 hours'
        `),
        tx<{ n: number; cents: number }[]>`
          select count(*)::int as n, coalesce(sum((data->>'amountCents')::bigint), 0)::bigint as cents
          from staff_events
          where kind = 'billing.paid' and created_at > now() - interval '24 hours'
        `,
        one(tx<N[]>`
          select count(*)::int as n from staff_events
          where kind = 'billing.problem' and created_at > now() - interval '24 hours'
        `),
      ]);
    const [live, incidents, failedDeploys, errors, boots, failing] = await Promise.all([
      one(tx<N[]>`select count(*)::int as n from storefront_ops where live_release_id is not null`),
      one(tx<N[]>`select count(*)::int as n from fleet_incidents where resolved_at is null`),
      one(tx<N[]>`
        select count(*)::int as n from staff_events
        where kind = 'deployment.failed' and created_at > now() - interval '24 hours'
      `),
      one(tx<N[]>`
        select coalesce(sum((data->>'count')::int), 0)::int as n from staff_events
        where kind = 'system.error' and created_at > now() - interval '24 hours'
      `),
      one(tx<N[]>`
        select count(*)::int as n from staff_events
        where kind = 'system.boot' and created_at > now() - interval '24 hours'
      `),
      tx<{ name: string }[]>`
        select name from scheduled_jobs where failing_since is not null order by name limit 10
      `,
    ]);
    return {
      date,
      crm: {
        newLeads: crm.newLeads,
        replies: crm.repliesIn,
        meetingsBooked: crm.meetingsBooked,
        meetingsNext24h: crm.meetingsNext24h,
        milestones,
        pendingDrafts: crm.pendingDrafts,
        openTasks: crm.openTasks,
      },
      agent: { runs: crm.agentRuns, failedRuns, costCents: crm.costCents },
      vendas: {
        orders: Number(orders[0]?.n ?? 0),
        gmvCents: Number(orders[0]?.cents ?? 0),
        cancelled,
        stores: Number(orders[0]?.stores ?? 0),
        top: top.map((t) => ({
          storeName: t.storeName ?? 'loja',
          orders: Number(t.orders),
          gmvCents: Number(t.gmvCents),
        })),
        firstOrders: firstOrders.map((f) => f.name ?? 'loja'),
      },
      assinaturas: {
        newStores: stores,
        paid: Number(paid[0]?.n ?? 0),
        paidCents: Number(paid[0]?.cents ?? 0),
        problems,
      },
      frota: { storesLive: live, openIncidents: incidents, failedDeployments: failedDeploys },
      sistema: { errors, boots, failingJobs: failing.map((f) => f.name) },
    };
  });
}

async function dueDateTx(tx: Sql): Promise<{ due: string | null; next: Date | null }> {
  if (!discordAppOf(await getIntegrationTx(tx, 'discord')).ok) return { due: null, next: null };
  const s = discordSettingOf(await getSettingTx<unknown>(tx, 'discord', {}));
  if (!s.digest.enabled) return { due: null, next: null };
  const { next, timezone } = await anchorTx(tx, { hour: s.digest.hour });
  const [now] = await tx<{ date: string; hour: number }[]>`
    select (now() at time zone ${timezone})::date::text as date,
           extract(hour from now() at time zone ${timezone})::int as hour
  `;
  if (!now || now.hour < s.digest.hour) return { due: null, next };
  const done = await tx`select 1 from staff_events where dedupe_key = ${`digest:${now.date}`}`;
  return done[0] ? { due: null, next } : { due: now.date, next: new Date() };
}

/** Today's hour until today's summary exists, then tomorrow's; null = off or not configured. */
export async function discordDigestNextAtTx(tx: Sql): Promise<Date | null> {
  return (await dueDateTx(tx)).next;
}

/** Records today's `digest.daily` once (the dedupe key is the local date). */
export async function sweepDiscordDigest(sql: Sql): Promise<boolean> {
  const { due } = await controlTx(sql, dueDateTx);
  if (!due) return false;
  const report = await computeDigest(sql, due);
  await recordStaffEvent(sql, 'digest.daily', report, { dedupeKey: `digest:${due}` });
  return true;
}

export async function discordDigestCadenceTx(tx: Sql): Promise<string> {
  const s = discordSettingOf(await getSettingTx<unknown>(tx, 'discord', {}));
  return s.digest.enabled
    ? `todo dia às ${String(s.digest.hour).padStart(2, '0')}:00`
    : 'desligado';
}
