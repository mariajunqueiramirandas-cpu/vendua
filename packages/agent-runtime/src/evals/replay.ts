import type { Agent } from '../define/agent.ts';
import { Runtime } from '../engine/runtime.ts';
import type { BatchItem } from '../engine/state.ts';
import type { ModelGateway } from '../model/types.ts';
import type { Telemetry } from '../ports.ts';
import { FakeClock } from '../testing/clock.ts';
import { drive } from '../testing/drive.ts';
import { MemoryStore, type MemoryHost } from '../testing/memory-store.ts';
import type { AgentEvent, Json, JsonObject, SubjectRef } from '../types.ts';

export interface ReplayOpts {
  /** An actor's log, synthetic or real (anonymized, with consent). */
  log: readonly AgentEvent[];
  /** Re-run from the first turn that starts at or after this seq. */
  fromSeq: number;
  candidate: Agent<MemoryHost>;
  gateway: ModelGateway;
  /** The log doesn't carry it; default `{ kind: candidate.def.subject, id: 'replay' }`. */
  subject?: SubjectRef;
  /**
   * Host tables as they were at `fromSeq`. The log has tool results, not the host's rows: a
   * cart a tool wrote before the cut must be seeded here.
   */
  setup?: (store: MemoryStore) => Promise<void>;
  /** Original turns whose inputs are re-delivered, at their original times. Default all. */
  turns?: number;
  telemetry?: Telemetry;
}

export interface ReplayDiff {
  same: boolean;
  changed: { index: number; original: string | null; candidate: string | null }[];
  tools: { original: string[]; candidate: string[] };
  guardBlocks: { original: number; candidate: number };
  handoff: { original: boolean; candidate: boolean };
  failedTurns: { original: number; candidate: number };
}

export interface ReplayResult {
  fromSeq: number;
  /** message.sent texts after the cut. */
  original: string[];
  candidate: string[];
  diff: ReplayDiff;
  /** The candidate's log from the cut on. */
  log: AgentEvent[];
  store: MemoryStore;
  actorId: string;
}

function obj(p: Json): JsonObject {
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

function summary(events: readonly AgentEvent[]) {
  return {
    texts: events
      .filter((e) => e.type === 'message.sent')
      .map((e) => String(obj(e.payload).text ?? '')),
    tools: events
      .filter((e) => e.type === 'tool.returned' && obj(e.payload).name !== 'reply')
      .map((e) => String(obj(e.payload).name ?? '')),
    guardBlocks: events.filter((e) => e.type === 'guard.blocked').length,
    handoff: events.some((e) => e.type === 'handoff.started'),
    failed: events.filter((e) => e.type === 'turn.failed').length,
  };
}

/**
 * Counterfactual replay: rebuilds the actor from the log up to the cut, puts the inputs of the
 * turns after it back in the mailbox, and lets the candidate answer them.
 */
export async function replay(o: ReplayOpts): Promise<ReplayResult> {
  const log = [...o.log].sort((a, b) => a.seq - b.seq);
  const first = log[0];
  if (!first) throw new Error('replay needs a non-empty log');
  const turns = log.filter(
    (e) =>
      e.type === 'turn.started' &&
      e.seq >= o.fromSeq &&
      typeof obj(e.payload).maintenance !== 'string',
  );
  const start = turns[0];
  if (!start) throw new Error(`no turn starts at or after seq ${o.fromSeq}`);
  const prefix = log.filter((e) => e.seq < start.seq);
  const after = log.filter((e) => e.seq >= start.seq);

  const def = o.candidate.def;
  const clock = new FakeClock(first.at);
  const store = new MemoryStore(clock, () => def.lane);
  await o.setup?.(store);
  const key = {
    tenantId: first.tenantId,
    agentId: def.id,
    subject: o.subject ?? { kind: def.subject, id: 'replay' },
  };
  // the store has no import; a consumed seed row lets the replay claim the actor and append
  const seed = await store.dispatch({
    actor: key,
    kind: 'runtime.replay_seed',
    source: 'replay',
    dedupeKey: 'replay:seed',
  });
  const span = Math.max(0, (prefix.at(-1)?.at.getTime() ?? 0) - first.at.getTime());
  const [claimed] = await store.claim({
    lane: def.lane,
    owner: 'replay',
    leaseMs: span + 3_600_000,
    limit: 1,
    agentIds: [def.id],
    perTenantCap: 1,
    backoffMs: () => 0,
  });
  if (!claimed) throw new Error('replay could not claim its actor');
  await store.fenced(claimed.lease, async (tx) => {
    await tx.consume([seed.mailboxId!], 'replay:seed');
    for (const e of prefix) {
      clock.set(e.at);
      await tx.append(e.turnId, [{ type: e.type, step: e.step, payload: e.payload }], e.version);
    }
  });

  const seen = new Set<string>();
  for (const t of turns.slice(0, o.turns ?? turns.length)) {
    const batch = (Array.isArray(obj(t.payload).batch)
      ? obj(t.payload).batch
      : []) as unknown as BatchItem[];
    for (const b of batch) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      await store.dispatch({
        actor: key,
        kind: b.kind,
        source: b.source,
        dedupeKey: `replay:${b.id}`,
        payload: b.payload,
        deliverAt: t.at,
      });
    }
  }
  await store.release(claimed.lease, { clean: true });

  const runtime = new Runtime<MemoryHost>({
    agents: [o.candidate],
    store,
    gateway: o.gateway,
    transports: [store.transport(def.transport)],
    owner: 'replay',
    clock,
    memory: store.memoryPort(),
    ...(o.telemetry ? { telemetry: o.telemetry } : {}),
  });
  const lastAt = (after.at(-1) ?? start).at.getTime();
  await drive(runtime, clock, { horizonMs: Math.max(0, lastAt - clock.now().getTime()) + 60_000 });

  const actorId = claimed.actor.id;
  const cand = store.log(actorId).filter((e) => e.seq >= start.seq);
  const a = summary(after);
  const b = summary(cand);
  const changed: ReplayDiff['changed'] = [];
  for (let i = 0; i < Math.max(a.texts.length, b.texts.length); i++)
    if (a.texts[i] !== b.texts[i])
      changed.push({ index: i, original: a.texts[i] ?? null, candidate: b.texts[i] ?? null });
  const diff: ReplayDiff = {
    same:
      changed.length === 0 &&
      a.tools.join() === b.tools.join() &&
      a.guardBlocks === b.guardBlocks &&
      a.handoff === b.handoff &&
      a.failed === b.failed,
    changed,
    tools: { original: a.tools, candidate: b.tools },
    guardBlocks: { original: a.guardBlocks, candidate: b.guardBlocks },
    handoff: { original: a.handoff, candidate: b.handoff },
    failedTurns: { original: a.failed, candidate: b.failed },
  };
  return {
    fromSeq: start.seq,
    original: a.texts,
    candidate: b.texts,
    diff,
    log: cand,
    store,
    actorId,
  };
}

/** A plain-text report of what the candidate did differently. */
export function diffReport(r: Pick<ReplayResult, 'fromSeq' | 'diff'>): string {
  const d = r.diff;
  const lines = [`replay from #${r.fromSeq}: ${d.same ? 'no change' : 'changed'}`];
  for (const c of d.changed) {
    lines.push(`  message ${c.index + 1}:`);
    lines.push(`    - ${c.original ?? '(none)'}`);
    lines.push(`    + ${c.candidate ?? '(none)'}`);
  }
  if (d.tools.original.join() !== d.tools.candidate.join())
    lines.push(
      `  tools: ${d.tools.original.join(', ') || '(none)'} → ${d.tools.candidate.join(', ') || '(none)'}`,
    );
  if (d.guardBlocks.original !== d.guardBlocks.candidate)
    lines.push(`  guard blocks: ${d.guardBlocks.original} → ${d.guardBlocks.candidate}`);
  if (d.handoff.original !== d.handoff.candidate)
    lines.push(`  handoff: ${d.handoff.original} → ${d.handoff.candidate}`);
  if (d.failedTurns.original !== d.failedTurns.candidate)
    lines.push(`  failed turns: ${d.failedTurns.original} → ${d.failedTurns.candidate}`);
  return lines.join('\n');
}
