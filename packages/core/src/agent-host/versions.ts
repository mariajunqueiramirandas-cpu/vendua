import type { Agent, VersionResolver } from '@vendua/agent-runtime';
import {
  evaluateCandidate,
  nextStage,
  resolveStage,
  type RolloutMetrics,
  type Stage as RingStage,
  type TenantRing,
  type Thresholds,
  type VersionRollout,
} from '@vendua/agent-runtime/evals';
import { controlTx } from '../modules/control.ts';
import { recordStaffEventTx } from '../modules/staff-events.ts';
import { log } from '../platform/log.ts';
import type { Sql } from '../platform/db.ts';

export const STAGES = [
  'candidate',
  'canary',
  'early',
  'share',
  'all',
  'rolled_back',
  'retired',
] as const;
export type Stage = (typeof STAGES)[number];

const vLog = log.child({ mod: 'agent-versions' });
const CACHE_MS = 30_000;
const FIRST_SHARE_PCT = 25;

/**
 * Every loaded definition is a row on deploy. An agent's first version goes to every store
 * (nothing older to fall back to); later ones start as candidates and move through the rings
 * once CI posts a passing eval report (ADR 0030 decision 10).
 */
export async function deployVersions(sql: Sql, agents: readonly Agent<Sql>[]): Promise<string[]> {
  return controlTx(sql, async (tx) => {
    const added: string[] = [];
    for (const a of agents) {
      const rows = await tx<{ version: string }[]>`
        insert into agent_versions (version, agent_id, manifest, stage)
        values (${a.version}, ${a.def.id}, ${tx.json(a.manifest as never)},
          case when exists (select 1 from agent_versions where agent_id = ${a.def.id} and stage = 'all')
               then 'candidate' else 'all' end)
        on conflict (version) do nothing
        returning version`;
      if (rows[0]) added.push(rows[0].version);
    }
    if (added.length) vLog.info({ added }, 'agent versions deployed');
    return added;
  });
}

interface VersionDb {
  version: string;
  stage: Stage;
  share_pct: number;
  stage_since: Date;
}

/** Pins, then the newest version whose stage covers the store's ring (`storefront_ops.ring`). */
export function pgVersionResolver(sql: Sql): VersionResolver {
  const byAgent = new Map<string, { at: number; rows: VersionRollout[] }>();
  const byTenant = new Map<string, { at: number; ring: TenantRing; pins: Map<string, string> }>();
  return {
    async resolve(tenantId, agentId) {
      const now = Date.now();
      let versions = byAgent.get(agentId);
      let tenant = byTenant.get(tenantId);
      if (!versions || now - versions.at > CACHE_MS || !tenant || now - tenant.at > CACHE_MS) {
        await controlTx(sql, async (tx) => {
          if (!versions || now - versions.at > CACHE_MS) {
            const rows = await tx<VersionDb[]>`
              select version, stage, share_pct, stage_since from agent_versions
              where agent_id = ${agentId} and stage in ('canary', 'early', 'share', 'all')
              order by created_at`;
            versions = {
              at: now,
              rows: rows.map((r) => ({
                version: r.version,
                stage: r.stage as RingStage,
                sharePct: r.share_pct,
                since: r.stage_since,
              })),
            };
            byAgent.set(agentId, versions);
          }
          if (!tenant || now - tenant.at > CACHE_MS) {
            const [ops] = await tx<
              { ring: TenantRing }[]
            >`select ring from storefront_ops where tenant_id = ${tenantId}`;
            const pins = await tx<{ agent_id: string; version: string }[]>`
              select agent_id, version from agent_version_pins where tenant_id = ${tenantId}`;
            tenant = {
              at: now,
              ring: ops?.ring ?? 'stable',
              pins: new Map(pins.map((p) => [p.agent_id, p.version])),
            };
            byTenant.set(tenantId, tenant);
          }
        });
      }
      const pin = tenant!.pins.get(agentId) ?? null;
      if (pin) return pin;
      return resolveStage(tenant!.ring, tenantId, versions!.rows)?.version ?? null;
    },
  };
}

/** Moves a version; reaching `all` retires the previous one, a rollback tells the team. */
export async function setStage(
  tx: Sql,
  version: string,
  stage: Stage,
  o: {
    sharePct?: number | null;
    reason?: string | null;
    by: 'staff' | 'rings';
    /** The stage the caller decided from; a version that moved since is left alone. */
    from?: Stage;
  },
): Promise<boolean> {
  const [row] = await tx<{ agent_id: string; stage: Stage }[]>`
    select agent_id, stage from agent_versions where version = ${version} for update`;
  if (!row || (o.from !== undefined && row.stage !== o.from)) return false;
  if (stage === 'all')
    await tx`update agent_versions set stage = 'retired', stage_since = now()
             where agent_id = ${row.agent_id} and stage = 'all' and version <> ${version}`;
  const sharePct = stage === 'share' ? (o.sharePct ?? FIRST_SHARE_PCT) : 0;
  await tx`
    update agent_versions set stage = ${stage}, share_pct = ${sharePct}, stage_since = now(),
      rollback_reason = case when ${stage} = 'rolled_back' then ${o.reason ?? null} else rollback_reason end
    where version = ${version}`;
  if (stage === 'rolled_back')
    await recordStaffEventTx(
      tx,
      'agent.version_rollback',
      {
        agentId: row.agent_id,
        version,
        stage: row.stage,
        reasons: (o.reason ?? (o.by === 'staff' ? 'pela equipe' : ''))
          .split('\n')
          .filter(Boolean)
          .slice(0, 10),
      },
      { dedupeKey: `agent.version_rollback:${version}` },
    );
  return true;
}

interface MetricsDb {
  version: string;
  turns: number;
  failed: number;
  blocks: number;
  handoffs: number;
  orders: number;
}

async function metricsSince(
  tx: Sql,
  agentId: string,
  since: Date,
  orderTools: string[],
): Promise<Map<string, RolloutMetrics>> {
  const rows = await tx<MetricsDb[]>`
    select e.version,
      count(*) filter (where e.type = 'turn.started' and e.payload ->> 'maintenance' is null)::int as turns,
      count(*) filter (where e.type = 'turn.failed')::int as failed,
      count(*) filter (where e.type = 'guard.blocked')::int as blocks,
      count(*) filter (where e.type = 'handoff.started')::int as handoffs,
      count(*) filter (where e.type = 'tool.returned' and e.payload ->> 'ok' = 'true'
                         and e.payload ->> 'name' = any(${orderTools}))::int as orders
    from agent_events e join agent_actors a on a.id = e.actor_id
    where a.agent_id = ${agentId} and e.at >= ${since}
      and e.type in ('turn.started', 'turn.failed', 'guard.blocked', 'handoff.started', 'tool.returned')
    group by e.version`;
  return new Map(
    rows.map((r) => [
      r.version,
      {
        turns: r.turns,
        failedTurns: r.failed,
        guardBlocks: r.blocks,
        handoffs: r.handoffs,
        orders: r.orders,
      },
    ]),
  );
}

/**
 * The ring controller: a candidate with passing evals enters canary; a version in a ring is
 * promoted while its monitors hold against the `all` version over the same window, and rolled
 * back when they regress. Runs as control, one transaction per version.
 */
export async function ringPass(
  sql: Sql,
  o: { thresholds?: Thresholds; orderTools?: string[]; now?: Date } = {},
): Promise<{ version: string; decision: string; reasons: string[] }[]> {
  const out: { version: string; decision: string; reasons: string[] }[] = [];
  const live = await controlTx(
    sql,
    (tx) => tx<(VersionDb & { agent_id: string; evals_passed_at: Date | null })[]>`
    select version, agent_id, stage, share_pct, stage_since, evals_passed_at from agent_versions
    where stage in ('candidate', 'canary', 'early', 'share') order by created_at`,
  );
  for (const v of live) {
    await controlTx(sql, async (tx) => {
      if (v.stage === 'candidate') {
        if (v.evals_passed_at) {
          await setStage(tx, v.version, 'canary', { by: 'rings', from: 'candidate' });
          out.push({ version: v.version, decision: 'promote', reasons: ['evals passed'] });
        }
        return;
      }
      const [base] = await tx<{ version: string }[]>`
        select version from agent_versions where agent_id = ${v.agent_id} and stage = 'all'
        order by stage_since desc limit 1`;
      const metrics = await metricsSince(
        tx,
        v.agent_id,
        v.stage_since,
        o.orderTools ?? ['place_order'],
      );
      const empty: RolloutMetrics = {
        turns: 0,
        failedTurns: 0,
        guardBlocks: 0,
        handoffs: 0,
        orders: 0,
      };
      const cand = {
        ...(metrics.get(v.version) ?? empty),
        soakMs: (o.now ?? new Date()).getTime() - v.stage_since.getTime(),
      };
      const baseline = (base && metrics.get(base.version)) || empty;
      const { decision, reasons } = evaluateCandidate(cand, baseline, o.thresholds);
      out.push({ version: v.version, decision, reasons });
      if (decision === 'rollback')
        await setStage(tx, v.version, 'rolled_back', {
          reason: reasons.join('\n'),
          by: 'rings',
          from: v.stage,
        });
      else if (decision === 'promote') {
        const next = nextStage(v.stage as RingStage);
        if (next) await setStage(tx, v.version, next as Stage, { by: 'rings', from: v.stage });
      }
    });
  }
  return out;
}
