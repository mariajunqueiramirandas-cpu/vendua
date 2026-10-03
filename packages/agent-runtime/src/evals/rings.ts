import { createHash } from 'node:crypto';
import type { AgentEvent, Json, JsonObject } from '../types.ts';

// ADR 0011's rings applied to agent versions: internal stores → pilot stores → a share of
// stores → all. Pure functions; the host keeps the rollout rows and acts on the decisions.

export type TenantRing = 'canary' | 'early' | 'stable';
export type Stage = 'canary' | 'early' | 'share' | 'all' | 'rolled_back';

export interface VersionRollout {
  version: string;
  stage: Stage;
  /** For `share`: percent of stable tenants, 0..100. */
  sharePct?: number;
  /** When it entered its stage, for soak time. */
  since?: Date;
}

const ORDER: readonly Stage[] = ['canary', 'early', 'share', 'all'];

export function nextStage(stage: Stage): Stage | null {
  const i = ORDER.indexOf(stage);
  return i < 0 || i === ORDER.length - 1 ? null : ORDER[i + 1]!;
}

/** 0..100, stable per tenant: the same stores are "the share" for every version. */
export function shareBucket(tenantId: string): number {
  const h = createHash('sha256').update(`ring-share:${tenantId}`).digest();
  return (h.readUInt32BE(0) / 0x1_0000_0000) * 100;
}

export function covers(r: VersionRollout, ring: TenantRing, tenantId: string): boolean {
  switch (r.stage) {
    case 'canary':
      return ring === 'canary';
    case 'early':
      return ring !== 'stable';
    case 'share':
      return ring !== 'stable' || shareBucket(tenantId) < (r.sharePct ?? 0);
    case 'all':
      return true;
    case 'rolled_back':
      return false;
  }
}

/**
 * The version a tenant runs. `versions` is in deploy order, oldest first: the newest one whose
 * stage covers the tenant wins, else the newest `all`. A pin wins over everything.
 */
export function resolveStage(
  ring: TenantRing,
  tenantId: string,
  versions: readonly VersionRollout[],
  pin?: string | null,
): VersionRollout | null {
  if (pin) {
    const p = versions.find((v) => v.version === pin);
    if (p) return p;
  }
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i]!;
    if (covers(v, ring, tenantId)) return v;
  }
  return null;
}

export interface RolloutMetrics {
  turns: number;
  failedTurns: number;
  guardBlocks: number;
  handoffs: number;
  orders?: number;
  complaints?: number;
  /** Online-QA mean, 0..1. */
  qaMean?: number;
  /** Time the version has been live in its stage. */
  soakMs?: number;
}

export interface Thresholds {
  /** Turns before a promotion is considered. Default 200. */
  minTurns?: number;
  /** Turns before an automatic rollback is trusted. Default 30. */
  rollbackMinTurns?: number;
  /** Default 24h. */
  minSoakMs?: number;
  /** Failed turns per turn that roll back on their own. Default 0.05. */
  maxFailedRate?: number;
  /** Candidate rate ÷ baseline rate that holds a promotion. Default 1.25. */
  holdRatio?: number;
  /** …and that rolls back. Default 2. */
  rollbackRatio?: number;
  /** Rates this small are noise; ratios below it don't count. Default 0.01 per turn. */
  rateFloor?: number;
  /** QA mean drop (absolute) that holds; twice it rolls back. Default 0.1. */
  qaDrop?: number;
}

export type Decision = 'promote' | 'hold' | 'rollback';

const rate = (n: number | undefined, turns: number) => (turns > 0 ? (n ?? 0) / turns : 0);

/** Compares a candidate's monitors with the baseline's over the same window. */
export function evaluateCandidate(
  cand: RolloutMetrics,
  base: RolloutMetrics,
  t: Thresholds = {},
): { decision: Decision; reasons: string[] } {
  const minTurns = t.minTurns ?? 200;
  const rollbackMin = t.rollbackMinTurns ?? 30;
  const holdRatio = t.holdRatio ?? 1.25;
  const rollbackRatio = t.rollbackRatio ?? 2;
  const floor = t.rateFloor ?? 0.01;
  const qaDrop = t.qaDrop ?? 0.1;
  const rollback: string[] = [];
  const hold: string[] = [];

  const failed = rate(cand.failedTurns, cand.turns);
  if (failed > (t.maxFailedRate ?? 0.05))
    rollback.push(`failed turns ${(failed * 100).toFixed(1)}% of turns`);

  // monitors where more is worse
  const worse: [string, number | undefined, number | undefined][] = [
    ['failed turns', cand.failedTurns, base.failedTurns],
    ['guard blocks', cand.guardBlocks, base.guardBlocks],
    ['handoffs', cand.handoffs, base.handoffs],
    ['complaints', cand.complaints, base.complaints],
  ];
  for (const [name, c, b] of worse) {
    if (c === undefined || b === undefined) continue;
    const rc = rate(c, cand.turns);
    const rb = Math.max(rate(b, base.turns), floor);
    if (rc <= floor) continue;
    const ratio = rc / rb;
    if (ratio >= rollbackRatio) rollback.push(`${name} ${ratio.toFixed(2)}× baseline`);
    else if (ratio >= holdRatio) hold.push(`${name} ${ratio.toFixed(2)}× baseline`);
  }
  // conversion: fewer orders per turn is worse
  if (cand.orders !== undefined && base.orders !== undefined && base.orders > 0) {
    const ratio = rate(cand.orders, cand.turns) / rate(base.orders, base.turns);
    if (ratio <= 1 / rollbackRatio) rollback.push(`conversion ${ratio.toFixed(2)}× baseline`);
    else if (ratio <= 1 / holdRatio) hold.push(`conversion ${ratio.toFixed(2)}× baseline`);
  }
  if (cand.qaMean !== undefined && base.qaMean !== undefined) {
    const drop = base.qaMean - cand.qaMean;
    if (drop >= 2 * qaDrop) rollback.push(`QA mean down ${drop.toFixed(2)}`);
    else if (drop >= qaDrop) hold.push(`QA mean down ${drop.toFixed(2)}`);
  }

  if (rollback.length && cand.turns >= rollbackMin)
    return { decision: 'rollback', reasons: rollback };
  if (rollback.length) hold.push(...rollback.map((r) => `${r} (only ${cand.turns} turns)`));
  if (cand.turns < minTurns) hold.push(`${cand.turns} of ${minTurns} turns`);
  const soak = t.minSoakMs ?? 24 * 3_600_000;
  if ((cand.soakMs ?? 0) < soak)
    hold.push(
      `soaked ${Math.round((cand.soakMs ?? 0) / 60_000)} of ${Math.round(soak / 60_000)} min`,
    );
  return hold.length ? { decision: 'hold', reasons: hold } : { decision: 'promote', reasons: [] };
}

function obj(p: Json): JsonObject {
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

/** Monitors from event logs (one version's actors). Orders are successful calls of `orderTools`. */
export function metricsFromEvents(
  events: readonly AgentEvent[],
  opts: { orderTools?: readonly string[] } = {},
): RolloutMetrics {
  const orderTools = opts.orderTools ?? ['place_order'];
  let turns = 0;
  let failedTurns = 0;
  let guardBlocks = 0;
  let handoffs = 0;
  let orders = 0;
  let first = Infinity;
  let last = -Infinity;
  for (const e of events) {
    const t = e.at.getTime();
    if (t < first) first = t;
    if (t > last) last = t;
    const p = obj(e.payload);
    if (e.type === 'turn.started' && typeof p.maintenance !== 'string') turns++;
    else if (e.type === 'turn.failed') failedTurns++;
    else if (e.type === 'guard.blocked') guardBlocks++;
    else if (e.type === 'handoff.started') handoffs++;
    else if (
      e.type === 'tool.returned' &&
      p.ok !== false &&
      typeof p.name === 'string' &&
      orderTools.includes(p.name)
    )
      orders++;
  }
  return {
    turns,
    failedTurns,
    guardBlocks,
    handoffs,
    orders,
    soakMs: events.length ? last - first : 0,
  };
}
