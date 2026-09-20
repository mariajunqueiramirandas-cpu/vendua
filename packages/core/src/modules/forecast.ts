import type { Sql } from '../platform/db.ts';
import { controlTx } from './control.ts';
import { getForecastConfigTx } from './integrations.ts';
import { LEAD_STATES, pipelineByStateTx, type StateBucket } from './leads.ts';

/**
 * forecast module — deal-value forecasting + pipeline snapshots.
 *
 * The math: every open lead's deal_value_cents × the close-probability of its
 * stage (the 'forecast' setting, DEFAULT_FORECAST_PROBABILITIES otherwise).
 * `pipeline_snapshots` freezes that picture once a day so Reports can draw a
 * trend; the worker takes it, POST /control/v1/stats/snapshot forces it.
 */

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

/** byState map + probabilities → per-state weighted value + the headline
 *  total. Pure — the rounding lives here so display and storage agree. */
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

/** Measure the pipeline NOW and upsert today's row — the unique taken_on
 *  makes same-day re-runs idempotent (the row refreshes, never duplicates).
 *  Call inside a control tx. */
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
      values (current_date, ${tx.json(byState as never)}, ${weightedCents}, ${cost})
      on conflict (taken_on) do update set
        by_state = excluded.by_state,
        weighted_cents = excluded.weighted_cents,
        agent_cost_cents = excluded.agent_cost_cents
      returning id, taken_on::text as taken_on, by_state, weighted_cents, agent_cost_cents, created_at
    `
  )[0]!;
  return snapshotJson(row);
}

/** Once-a-day cadence for the worker tick — no-op once today's row exists. */
export async function sweepPipelineSnapshots(sql: Sql): Promise<boolean> {
  return controlTx(sql, async (tx) => {
    const done = await tx`select 1 from pipeline_snapshots where taken_on = current_date`;
    if (done.length) return false;
    await snapshotPipelineTx(tx);
    return true;
  });
}

/** The forecast slice of /control/v1/stats — composed by the route so this
 *  shares the request's byState read instead of re-querying it. */
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
