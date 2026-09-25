import type { Sql } from '../platform/db.ts';
import { controlTx } from './control.ts';
import { emitControlEvent } from './control-events.ts';
import { DEFAULT_GUARDRAILS, getForecastConfigTx, getSettingTx } from './integrations.ts';
import { LEAD_STATES, pipelineByStateTx, type StateBucket } from './leads.ts';

// deal_value × per-stage close probability; snapshots freeze the picture once a day

export interface ForecastByState extends StateBucket {
  probability: number;
  weightedCents: number;
}

export interface PipelineForecast {
  weightedCents: number;
  byState: Record<string, ForecastByState>;
  /** oldest → newest, at most the last 30 daily snapshots. */
  trend: { takenOn: string; weightedCents: number; valueCents: number }[];
}

export interface Snapshot {
  id: string;
  takenOn: string;
  byState: Record<string, StateBucket>;
  weightedCents: number;
  agentCostCents: number;
  createdAt: string;
}

interface SnapshotRow {
  id: string;
  taken_on: string;
  by_state: Record<string, StateBucket>;
  weighted_cents: number;
  agent_cost_cents: number;
  created_at: string;
}

/** rounding lives here so display and storage agree */
export function applyProbabilities(
  byState: Record<string, StateBucket>,
  probabilities: Record<string, number>,
): { byState: Record<string, ForecastByState>; weightedCents: number } {
  let weightedCents = 0;
  const out: Record<string, ForecastByState> = {};
  for (const st of LEAD_STATES) {
    const cur = byState[st] ?? { count: 0, valueCents: 0 };
    const p = probabilities[st] ?? 0;
    const w = Math.round(cur.valueCents * p);
    weightedCents += w;
    out[st] = { ...cur, probability: p, weightedCents: w };
  }
  return { byState: out, weightedCents };
}

function snapshotJson(r: SnapshotRow): Snapshot {
  return {
    id: r.id,
    takenOn: r.taken_on,
    byState: r.by_state,
    weightedCents: r.weighted_cents,
    agentCostCents: r.agent_cost_cents,
    createdAt: r.created_at,
  };
}

/** measure the pipeline now and upsert today's row — unique taken_on makes re-runs idempotent; call inside a control tx */
/** today in the workspace timezone — a snapshot's day is the team's day, not UTC's */
async function localDateTx(tx: Sql): Promise<string> {
  const g = await getSettingTx<{ timezone?: string }>(tx, 'guardrails', {});
  const tz = g.timezone ?? DEFAULT_GUARDRAILS.timezone;
  return (await tx<{ d: string }[]>`select (now() at time zone ${tz})::date::text as d`)[0]!.d;
}

export async function snapshotPipelineTx(tx: Sql): Promise<Snapshot> {
  const byState = await pipelineByStateTx(tx);
  const { weightedCents } = applyProbabilities(byState, await getForecastConfigTx(tx));
  const cost = (
    await tx<{ cost_cents: number }[]>`
      select coalesce(sum(cost_cents), 0)::int as cost_cents
      from agent_runs where created_at > now() - interval '30 days'
    `
  )[0]!.cost_cents;
  const row = (
    await tx<SnapshotRow[]>`
      insert into pipeline_snapshots (taken_on, by_state, weighted_cents, agent_cost_cents)
      values (${await localDateTx(tx)}::date, ${tx.json(byState as never)}, ${weightedCents}, ${cost})
      on conflict (taken_on) do update set
        by_state = excluded.by_state,
        weighted_cents = excluded.weighted_cents,
        agent_cost_cents = excluded.agent_cost_cents
      returning id, taken_on::text as taken_on, by_state, weighted_cents, agent_cost_cents, created_at
    `
  )[0]!;
  return snapshotJson(row);
}

/** no-op once today's row exists */
export async function sweepPipelineSnapshots(sql: Sql): Promise<boolean> {
  const taken = await controlTx(sql, async (tx) => {
    const done = await tx`
      select 1 from pipeline_snapshots where taken_on = ${await localDateTx(tx)}::date
    `;
    if (done.length) return false;
    await snapshotPipelineTx(tx);
    return true;
  });
  if (taken) emitControlEvent('lead.change');
  return taken;
}

/** shares the request's byState read instead of re-querying it */
export async function pipelineForecast(
  sql: Sql,
  byState: Record<string, StateBucket>,
): Promise<PipelineForecast> {
  return controlTx(sql, async (tx) => {
    const { byState: forecastByState, weightedCents } = applyProbabilities(
      byState,
      await getForecastConfigTx(tx),
    );
    const rows = await tx<
      { taken_on: string; weighted_cents: number; by_state: Record<string, StateBucket> }[]
    >`
      select taken_on::text as taken_on, weighted_cents, by_state
      from pipeline_snapshots order by taken_on desc limit 30
    `;
    return {
      weightedCents,
      byState: forecastByState,
      trend: rows
        .map((r) => ({
          takenOn: r.taken_on,
          weightedCents: r.weighted_cents,
          valueCents: Object.values(r.by_state ?? {}).reduce((s, v) => s + (v?.valueCents ?? 0), 0),
        }))
        .reverse(),
    };
  });
}
