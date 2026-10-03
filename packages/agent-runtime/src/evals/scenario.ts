import type { Agent } from '../define/agent.ts';
import { Runtime } from '../engine/runtime.ts';
import type { ModelGateway } from '../model/types.ts';
import type { HostHooks, Telemetry, Transport } from '../ports.ts';
import { FakeClock } from '../testing/clock.ts';
import { drive } from '../testing/drive.ts';
import { MemoryStore, type MemoryHost } from '../testing/memory-store.ts';
import {
  addUsage,
  ZERO_USAGE,
  type AgentEvent,
  type Json,
  type SubjectRef,
  type Usage,
} from '../types.ts';
import { foldLog, type Assertion, type AssertionCtx, type OutboxRow } from './assertions.ts';
import type { Exchange, Persona } from './persona.ts';

export const EVAL_TENANT = '00000000-0000-4000-8000-00000000e7a1';

export interface SetupEnv {
  store: MemoryStore;
  /** The host's tables tools read and write; seed fixtures here. */
  kv: Map<string, Json>;
  clock: FakeClock;
  tenantId: string;
  subject: SubjectRef;
}

export interface ScenarioDef {
  agent: Agent<MemoryHost>;
  setup?: (env: SetupEnv) => Promise<void>;
  user: Persona;
  expect: readonly Assertion[];
  /** pass^k: every one of k runs must pass. Default 3. */
  k?: number;
  /** User messages before the run stops. Default 12. */
  maxTurns?: number;
  /** User-model ids to run under; each gets its own k runs. */
  models?: readonly string[];
  /** Goal met: stop early (checked after each agent response). */
  done?: (ctx: AssertionCtx) => boolean;
  /** Pause between the agent's answer and the user's next message. Default 4s. */
  userDelayMs?: number;
  /** How far `drive` jumps the fake clock after each user message. Default 30s (quiet windows). */
  horizonMs?: number;
}

export type Scenario = Readonly<
  Omit<ScenarioDef, 'k' | 'maxTurns' | 'models'> & {
    name: string;
    k: number;
    maxTurns: number;
    models: readonly string[];
  }
>;

export function scenario(name: string, def: ScenarioDef): Scenario {
  if (!name.trim()) throw new Error('scenario needs a name');
  return Object.freeze({
    ...def,
    name,
    k: def.k ?? 3,
    maxTurns: def.maxTurns ?? 12,
    models: def.models ?? [],
  });
}

export interface ScenarioEnv {
  /** The agent's gateway. */
  gateway: ModelGateway;
  /** The simulated user's gateway, or one per user-model id. */
  userGateway?: ModelGateway | ((model: string) => ModelGateway);
  /** For `judge()` assertions. */
  judgeGateway?: ModelGateway;
  tenantId?: string;
  start?: Date | string;
  telemetry?: Telemetry;
  hooks?: HostHooks<MemoryHost>;
  /** Transports besides the agent's own in-memory one. */
  transports?: readonly Transport<MemoryHost>[];
}

export interface ScenarioResult {
  scenario: string;
  model: string | null;
  passed: boolean;
  failures: string[];
  actorId: string | null;
  log: AgentEvent[];
  transcript: Exchange[];
  outbox: OutboxRow[];
  usage: { agent: Usage; user: Usage };
  ended: 'persona' | 'goal' | 'maxTurns';
}

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'scenario'
  );
}

/**
 * One run: the agent on an in-memory store and fake clock, talking to the persona until it's
 * done, the goal is met or `maxTurns`; then every assertion against the log.
 */
export async function runScenario(
  sc: Scenario,
  env: ScenarioEnv,
  opts: { userModel?: string } = {},
): Promise<ScenarioResult> {
  const agent = sc.agent;
  const clock = new FakeClock(env.start);
  const store = new MemoryStore(clock, () => agent.def.lane);
  const tenantId = env.tenantId ?? EVAL_TENANT;
  const subject: SubjectRef = { kind: agent.def.subject, id: `eval-${slug(sc.name)}` };
  await sc.setup?.({ store, kv: store.kv, clock, tenantId, subject });
  const runtime = new Runtime<MemoryHost>({
    agents: [agent],
    store,
    gateway: env.gateway,
    transports: [store.transport(agent.def.transport), ...(env.transports ?? [])],
    owner: 'eval',
    clock,
    memory: store.memoryPort(),
    ...(env.telemetry ? { telemetry: env.telemetry } : {}),
    ...(env.hooks ? { hooks: env.hooks } : {}),
  });
  const model = opts.userModel ?? null;
  const userGateway =
    typeof env.userGateway === 'function'
      ? env.userGateway(model ?? 'default')
      : (env.userGateway ?? null);

  const transcript: Exchange[] = [];
  let userUsage = ZERO_USAGE;
  let actorId: string | null = null;
  let seen = 0;
  let ended: ScenarioResult['ended'] = 'maxTurns';
  const ctxNow = (): AssertionCtx => {
    const log = actorId ? store.log(actorId) : [];
    return {
      scenario: sc.name,
      agent,
      tenantId,
      log,
      state: foldLog(agent, log),
      transcript,
      outbox: store.outbox.filter((m) => m.actorId === actorId),
      kv: store.kv,
      goal: sc.user.goal,
      judge: env.judgeGateway ?? null,
    };
  };

  for (let turn = 0; turn < sc.maxTurns; turn++) {
    const next = await sc.user.next({
      transcript,
      turn,
      gateway: userGateway,
      model,
      tenantId,
      scenario: sc.name,
    });
    if (next.usage) userUsage = addUsage(userUsage, next.usage);
    if (next.text) {
      transcript.push({ role: 'user', text: next.text });
      const r = await store.dispatch({
        actor: { tenantId, agentId: agent.def.id, subject },
        kind: 'message.inbound',
        source: 'eval',
        dedupeKey: `eval:${turn}`,
        payload: { text: next.text },
      });
      actorId = r.actorId;
      await drive(runtime, clock, { horizonMs: sc.horizonMs ?? 30_000 });
      const rows = store.outbox.filter((m) => m.actorId === actorId);
      for (const m of rows.slice(seen)) transcript.push({ role: 'agent', text: m.text });
      seen = rows.length;
    }
    if (next.done) {
      ended = 'persona';
      break;
    }
    if (sc.done && sc.done(ctxNow())) {
      ended = 'goal';
      break;
    }
    clock.advance(sc.userDelayMs ?? 4_000);
  }

  const ctx = ctxNow();
  const failures: string[] = [];
  for (const a of sc.expect) {
    try {
      const r = await a.check(ctx);
      if (!r.ok) failures.push(r.detail ? `${a.name}: ${r.detail}` : a.name);
    } catch (e) {
      failures.push(`${a.name}: threw ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return {
    scenario: sc.name,
    model,
    passed: failures.length === 0,
    failures,
    actorId,
    log: [...ctx.log],
    transcript,
    outbox: [...ctx.outbox],
    usage: { agent: ctx.state.usage, user: userUsage },
    ended,
  };
}
