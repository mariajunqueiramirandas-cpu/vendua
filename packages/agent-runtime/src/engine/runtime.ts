import { createHash, randomUUID } from 'node:crypto';
import { canonical, type Agent, type LoadCtx } from '../define/agent.ts';
import type { OutputGuardCtx, ToolGuard, Verdict } from '../define/guard.ts';
import { transitionFor, type Trigger } from '../define/statechart.ts';
import {
  ToolError,
  type MemoryProposal,
  type ToolDefinition,
  type ToolResult,
} from '../define/tool.ts';
import { compile, messageTokens } from '../context/compiler.ts';
import { confirmation, stateGate } from '../guards/stock.ts';
import { render } from '../ledger/render.ts';
import { decide } from '../memory/policy.ts';
import { BudgetExceededError } from '../model/gateway.ts';
import type { ModelGateway } from '../model/types.ts';
import {
  systemClock,
  type ActorStore,
  type Claimed,
  type Clock,
  type FencedTx,
  type HostHooks,
  type MemoryPort,
  type Span,
  type SpendPort,
  type Telemetry,
  type Transport,
  type VersionResolver,
} from '../ports.ts';
import { formatIssues } from '../schema.ts';
import {
  addUsage,
  ZERO_USAGE,
  type ActorRow,
  type AgentEvent,
  type ChatMessage,
  type Json,
  type JsonObject,
  type Lane,
  type Lease,
  type MailboxMessage,
  type ModelResponse,
  type NewEvent,
  type Part,
  type ToolCall,
  type Usage,
} from '../types.ts';
import { meterFor } from './budget.ts';
import { loadSkillTool, replyTool } from './builtins.ts';
import { LeaseLostError, SupersededSignal } from './errors.ts';
import { applyEvent, initialState, type BatchItem, type ConversationState } from './state.ts';
import { AliasBook, ToolCtx } from './tool-context.ts';

export interface RuntimeOptions<H> {
  /** The current definition of each agent this process runs. */
  agents: readonly Agent<H>[];
  /** Other versions kept loaded so rings and pins can route to them. */
  versions?: readonly Agent<H>[];
  store: ActorStore<H>;
  gateway: ModelGateway;
  transports: readonly Transport<H>[];
  /** This worker's id on leases. */
  owner: string;
  clock?: Clock;
  leaseMs?: number;
  resolver?: VersionResolver;
  memory?: MemoryPort<H>;
  spend?: SpendPort;
  hooks?: HostHooks<H>;
  telemetry?: Telemetry;
  log?: (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;
}

export interface PumpOpts {
  limit?: number;
  perTenantCap?: number;
}

const MAINTENANCE = new Set(['runtime.compact', 'runtime.consolidate']);
const DEFAULT_INPUT_KINDS = ['message.inbound'];
const MAX_TURNS_PER_ACTIVATION = 6;

const noopSpan: Span = { setAttributes: () => {}, end: () => {} };

function backoffMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 10 * 60_000);
}

function hashOf(v: unknown): string {
  return createHash('sha256').update(canonical(v)).digest('hex').slice(0, 16);
}

function errText(e: unknown): string {
  return (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
}

type TurnOutcome =
  | { kind: 'idle' }
  | { kind: 'wait'; until: Date }
  | { kind: 'ended' }
  | { kind: 'superseded' }
  | { kind: 'failed' };

interface TurnRun<H> {
  agent: Agent<H>;
  actor: ActorRow;
  lease: Lease;
  state: ConversationState;
  turnId: string;
  /** Recorded events of this turn, by step, for fast-forwarding a re-run. */
  memo: Map<string, AgentEvent[]>;
  usage: Usage;
  aliases: AliasBook;
  span: Span;
}

export class Runtime<H = unknown> {
  readonly clock: Clock;
  private readonly leaseMs: number;
  private readonly current = new Map<string, Agent<H>>();
  private readonly byVersion = new Map<string, Agent<H>>();
  private readonly transports = new Map<string, Transport<H>>();

  constructor(private readonly o: RuntimeOptions<H>) {
    this.clock = o.clock ?? systemClock;
    this.leaseMs = o.leaseMs ?? 60_000;
    for (const a of o.agents) {
      if (this.current.has(a.def.id)) throw new Error(`agent ${a.def.id} registered twice`);
      this.current.set(a.def.id, a);
      this.byVersion.set(a.version, a);
    }
    for (const a of o.versions ?? []) this.byVersion.set(a.version, a);
    for (const t of o.transports) this.transports.set(t.id, t);
    for (const a of this.byVersion.values())
      if (!this.transports.has(a.def.transport))
        throw new Error(`agent ${a.def.id}: no transport ${a.def.transport}`);
  }

  get agents(): Agent<H>[] {
    return [...this.current.values()];
  }

  agentIdsIn(lane: Lane): string[] {
    return this.agents.filter((a) => a.def.lane === lane).map((a) => a.def.id);
  }

  /** Claims due actors in a lane, rotating across tenants. Each must then be `activate`d. */
  async claim(lane: Lane, opts: PumpOpts = {}): Promise<Claimed[]> {
    const agentIds = this.agentIdsIn(lane);
    if (agentIds.length === 0 || (opts.limit ?? 4) <= 0) return [];
    return this.o.store.claim({
      lane,
      owner: this.o.owner,
      leaseMs: this.leaseMs,
      limit: opts.limit ?? 4,
      agentIds,
      perTenantCap: opts.perTenantCap ?? 2,
      backoffMs,
    });
  }

  /** Claims and runs to completion: for tests and simulations; the host keeps a pool instead. */
  async pump(lane: Lane, opts: PumpOpts = {}): Promise<number> {
    const claimed = await this.claim(lane, opts);
    await Promise.all(claimed.map((c) => this.activate(c)));
    return claimed.length;
  }

  nextDue(lanes: readonly Lane[]): Promise<Date | null> {
    const ids = lanes.flatMap((l) => this.agentIdsIn(l));
    return ids.length ? this.o.store.nextDue(lanes, ids) : Promise.resolve(null);
  }

  /** One activation: turns until the mailbox is quiet, then release. */
  async activate(claimed: Claimed): Promise<void> {
    let { lease } = claimed;
    const actor = claimed.actor;
    const agent = this.current.get(actor.agentId);
    if (!agent) {
      this.log('error', 'actor of an agent this process does not run', {
        actorId: actor.id,
        agentId: actor.agentId,
      });
      await this.o.store.release(lease, {
        clean: false,
        retryAt: new Date(this.now().getTime() + 60_000),
      });
      return;
    }
    let retryAt: Date | undefined;
    try {
      for (let i = 0; i < MAX_TURNS_PER_ACTIVATION; i++) {
        const out = await this.turn(actor, lease);
        lease = out.lease;
        if (out.outcome.kind === 'wait') {
          retryAt = out.outcome.until;
          break;
        }
        if (out.outcome.kind === 'idle' || out.outcome.kind === 'failed') break;
        // ended or superseded: there may be more input already
      }
      await this.o.store.release(lease, retryAt ? { clean: true, retryAt } : { clean: true });
    } catch (e) {
      if (e instanceof LeaseLostError) {
        this.log('warn', 'lease lost mid-activation', { actorId: actor.id });
        return;
      }
      this.log('error', 'activation failed; will retry', {
        actorId: actor.id,
        attempts: actor.attempts,
        err: errText(e),
      });
      await this.o.store
        .release(lease, {
          clean: false,
          retryAt: new Date(this.now().getTime() + backoffMs(actor.attempts)),
        })
        .catch(() => undefined);
    }
  }

  // ── a turn ──────────────────────────────────────────────────────────────────

  private async turn(
    claimedActor: ActorRow,
    lease: Lease,
  ): Promise<{ lease: Lease; outcome: TurnOutcome }> {
    const opened = await this.o.store.fenced(lease, (tx) => this.open(tx, claimedActor));
    if (opened.kind !== 'run') return { lease, outcome: opened };
    const run = opened.run;
    run.lease = lease;
    run.span = this.span('invoke_agent', {
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.agent.name': run.agent.def.id,
      'gen_ai.agent.version': run.agent.version,
      'gen_ai.conversation.id': run.actor.id,
      'vendua.tenant_id': run.actor.tenantId,
      'vendua.turn_id': run.turnId,
    });
    try {
      if (run.actor.attempts > (run.agent.def.maxAttempts ?? 3)) {
        await this.fail(run, `gave up after ${run.actor.attempts - 1} attempts`);
        run.span.end();
        return { lease: run.lease, outcome: { kind: 'failed' } };
      }
      const maintenance = opened.maintenance;
      if (maintenance === 'runtime.compact') await this.compact(run);
      else if (maintenance === 'runtime.consolidate') await this.consolidate(run);
      else await this.steps(run);
      await this.end(run);
      run.span.end();
      return { lease: run.lease, outcome: { kind: 'ended' } };
    } catch (e) {
      run.span.end(e instanceof SupersededSignal ? undefined : e);
      if (e instanceof SupersededSignal)
        return { lease: run.lease, outcome: { kind: 'superseded' } };
      if (e instanceof BudgetExceededError) {
        await this.fail(run, `budget: ${e.message}`);
        return { lease: run.lease, outcome: { kind: 'failed' } };
      }
      throw e;
    }
  }

  private async open(
    tx: FencedTx<H>,
    claimedActor: ActorRow,
  ): Promise<
    | { kind: 'idle' }
    | { kind: 'wait'; until: Date }
    | { kind: 'run'; run: TurnRun<H>; maintenance: string | null }
  > {
    const actor = { ...claimedActor, ...tx.actor };
    const current = this.current.get(actor.agentId)!;
    let state = await this.load(tx, actor, current);
    const now = this.now();

    if (state.openTurn) {
      // a crashed or retried turn: re-run it from the top, fast-forwarding through the log
      const agent = this.byVersion.get(state.openTurn.version) ?? current;
      if (agent !== current) state = await this.load(tx, actor, agent);
      const turnId = state.openTurn!.id;
      const events = await tx.events(state.openTurn!.startSeq - 1);
      return {
        kind: 'run',
        run: this.newRun(agent, actor, tx, state, turnId, events),
        maintenance: maintenanceOf(events),
      };
    }

    const due = await tx.dueMailbox(now);
    if (due.length === 0) return { kind: 'idle' };
    const version = await this.versionFor(actor, current);
    const agent = this.byVersion.get(version) ?? current;
    if (agent !== current) state = await this.load(tx, actor, agent);
    const def = agent.def;
    const inputKinds = def.mailbox?.inputKinds ?? DEFAULT_INPUT_KINDS;
    const typing = def.mailbox?.quiet?.extendWhile;
    const conversational = due.filter((m) => !MAINTENANCE.has(m.kind));

    let batch: MailboxMessage[];
    let maintenance: string | null = null;
    if (conversational.length) {
      const quiet = def.mailbox?.quiet;
      const inputs = conversational.filter((m) => inputKinds.includes(m.kind) || m.kind === typing);
      if (quiet && inputs.length) {
        const newest = Math.max(...inputs.map((m) => m.createdAt.getTime()));
        const oldest = Math.min(...inputs.map((m) => m.createdAt.getTime()));
        const until = Math.min(newest + quiet.minMs, oldest + quiet.maxMs);
        if (until > now.getTime()) return { kind: 'wait', until: new Date(until) };
      }
      batch = conversational;
    } else {
      maintenance = due[0]!.kind;
      batch = due.filter((m) => m.kind === maintenance);
    }

    const turnId = randomUUID();
    await tx.consume(
      batch.map((m) => m.id),
      turnId,
    );
    const items: BatchItem[] = batch
      .filter((m) => m.kind !== typing)
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        source: m.source,
        payload: m.payload,
        input: maintenance ? null : this.toInput(agent, m, state),
      }));
    const events: NewEvent[] = [
      {
        type: 'turn.started',
        payload: {
          batch: items as unknown as Json,
          version: agent.version,
          maintenance,
          attempts: actor.attempts,
        },
      },
    ];
    if (!maintenance) {
      for (const m of batch)
        if (m.kind === 'runtime.handback')
          events.push({ type: 'handoff.ended', payload: { source: m.source } });
      events.push(...(await this.contextLoad(tx, agent, actor, state)));
    }
    const appended = await tx.append(turnId, events, agent.version);
    for (const e of appended) this.applyFolded(agent, state, e);
    const chartEvents: NewEvent[] = [];
    if (!maintenance)
      for (const m of batch)
        chartEvents.push(...this.transition(agent, state, `mailbox:${m.kind}`, m.payload));
    if (chartEvents.length)
      for (const e of await tx.append(turnId, chartEvents, agent.version))
        this.applyFolded(agent, state, e);
    return {
      kind: 'run',
      run: this.newRun(agent, actor, tx, state, turnId, [...appended]),
      maintenance,
    };
  }

  private newRun(
    agent: Agent<H>,
    actor: ActorRow,
    tx: FencedTx<H>,
    state: ConversationState,
    turnId: string,
    turnEvents: AgentEvent[],
  ): TurnRun<H> {
    const memo = new Map<string, AgentEvent[]>();
    let usage = ZERO_USAGE;
    for (const e of turnEvents) {
      if (e.turnId !== turnId) continue;
      if (e.step) memo.set(e.step, [...(memo.get(e.step) ?? []), e]);
      if (e.type === 'model.responded')
        usage = addUsage(usage, (e.payload as JsonObject).usage as unknown as Usage);
    }
    return {
      agent,
      actor: { ...actor, seq: tx.actor.seq },
      lease: {
        actorId: actor.id,
        tenantId: actor.tenantId,
        owner: this.o.owner,
        epoch: 0,
        until: new Date(0),
      },
      state,
      turnId,
      memo,
      usage,
      aliases: new AliasBook(state),
      span: noopSpan,
    };
  }

  /** The projection when it's current for this version, else a fold of the whole log. */
  private async load(
    tx: FencedTx<H>,
    actor: ActorRow,
    agent: Agent<H>,
  ): Promise<ConversationState> {
    const p = actor.projection;
    let state: ConversationState;
    let after: number;
    if (p && p.version === agent.version) {
      state = structuredClone(p.state) as unknown as ConversationState;
      after = actor.projectionSeq;
    } else {
      state = initialState(agent.chart.initial, agent.def.fold?.initial ?? null);
      after = 0;
    }
    for (const e of await tx.events(after)) this.applyFolded(agent, state, e);
    return state;
  }

  private applyFolded(agent: Agent<H>, state: ConversationState, e: AgentEvent): void {
    applyEvent(state, e);
    if (agent.def.fold) state.custom = agent.def.fold.apply(state.custom, e, state);
  }

  private async versionFor(actor: ActorRow, current: Agent<H>): Promise<string> {
    if (actor.versionPin && this.byVersion.has(actor.versionPin)) return actor.versionPin;
    const resolved = await this.o.resolver?.resolve(actor.tenantId, actor.agentId);
    if (resolved && this.byVersion.has(resolved)) return resolved;
    if (resolved && resolved !== current.version)
      this.log('warn', 'resolved version not loaded here; running current', {
        resolved,
        agentId: actor.agentId,
      });
    return current.version;
  }

  private toInput(
    agent: Agent<H>,
    m: MailboxMessage,
    state: ConversationState,
  ): ChatMessage | null {
    const msg = { kind: m.kind, source: m.source, payload: m.payload };
    let input: ChatMessage | null;
    if (agent.def.toInput) input = agent.def.toInput(msg, state);
    else if (m.kind === 'message.inbound') {
      const p = (m.payload ?? {}) as JsonObject;
      const parts = Array.isArray(p.parts)
        ? (p.parts as unknown as Part[])
        : [{ type: 'text' as const, text: typeof p.text === 'string' ? p.text : '' }];
      input = { role: 'user', parts };
    } else if (m.kind === 'runtime.handback') input = null;
    else
      input = {
        role: 'user',
        parts: [
          { type: 'text', text: `[evento ${m.kind}] ${JSON.stringify(m.payload).slice(0, 1000)}` },
        ],
      };
    if (input?.role !== 'user') return input;
    let parts = input.parts;
    for (const g of agent.def.guards?.input ?? []) parts = g.run(parts, { state, kind: m.kind });
    return { role: 'user', parts };
  }

  /** Host data for the tenant and subject tiers; bodies are logged only when they change. */
  private async contextLoad(
    tx: FencedTx<H>,
    agent: Agent<H>,
    actor: ActorRow,
    state: ConversationState,
  ): Promise<NewEvent[]> {
    const def = agent.def;
    const lctx: LoadCtx<H> = {
      tx: tx.host,
      tenantId: actor.tenantId,
      subject: actor.subject,
      state,
    };
    const payload: JsonObject = {};
    if (def.load?.tenant) {
      const tenant = await def.load.tenant(lctx);
      const h = hashOf(tenant);
      if (h !== state.context.tenantHash) Object.assign(payload, { tenant, tenantHash: h });
    }
    if (def.load?.subject) {
      const subject = await def.load.subject(lctx);
      const h = hashOf(subject);
      if (h !== state.context.subjectHash) Object.assign(payload, { subject, subjectHash: h });
    }
    if (def.memory && this.o.memory) {
      const facts = await this.o.memory.load(tx, this.memoryScope(agent, actor, state));
      const memory = facts.map((f) => ({ key: f.key, value: f.value, sensitive: f.sensitive }));
      if (hashOf(memory) !== hashOf(state.memory)) payload.memory = memory as unknown as Json;
    }
    return Object.keys(payload).length ? [{ type: 'context.loaded', payload }] : [];
  }

  private memoryScope(agent: Agent<H>, actor: ActorRow, state: ConversationState): string {
    return (
      agent.def.memory?.scope?.(actor.subject, state) ?? `${actor.subject.kind}:${actor.subject.id}`
    ).slice(0, 200);
  }

  // ── steps ───────────────────────────────────────────────────────────────────

  private async steps(run: TurnRun<H>): Promise<void> {
    const def = run.agent.def;
    const finish = def.finish ?? ((s) => s.repliedSinceLastInput || s.owner !== 'agent');
    const maxSteps = def.budgets?.stepsPerTurn ?? 8;
    for (let i = 0; i < maxSteps; i++) {
      if (finish(run.state)) return;
      const step = `m${i}`;
      let recorded = run.memo.get(step)?.find((e) => e.type === 'model.responded');
      if (!recorded) {
        if (def.mailbox?.preempt) await this.preemptIfNewInput(run);
        run.lease = await this.keepLease(run.lease);
        recorded = await this.modelStep(run, step);
      }
      const out = (recorded.payload as JsonObject).output as unknown as {
        text: string;
        toolCalls: ToolCall[];
      };
      const blockedBefore = run.state.guardBlocks;
      if (out.toolCalls.length === 0) {
        if (out.text.trim()) await this.reply(run, `${step}.reply`, step, out.text, null);
        if (run.state.guardBlocks === blockedBefore) return;
        continue;
      }
      await this.toolCalls(run, step, out.toolCalls);
    }
    if (!finish(run.state)) {
      await this.commit(run, [
        { type: 'turn.step_limit', step: `m${maxSteps}`, payload: { steps: maxSteps } },
      ]);
      // the shopper still gets an answer: the definition's safe line, never silence
      if (def.degrade && run.state.owner === 'agent' && !run.memo.has('degrade'))
        await this.fenced(run, async (tx) => {
          const events = await this.degradeEvents(run, tx);
          if (events.length) await this.commitIn(tx, run, events, false);
        });
    }
  }

  private async modelStep(run: TurnRun<H>, step: string): Promise<AgentEvent> {
    const def = run.agent.def;
    let tier = def.models.default;
    for (const e of def.models.escalate ?? []) if (e.when(run.state)) tier = e.to;
    const tools = this.allowedTools(run);
    const compiled = compile({
      agent: run.agent,
      state: run.state,
      now: this.now(),
      tier,
      tools,
      meta: {
        tenantId: run.actor.tenantId,
        agentId: def.id,
        actorId: run.actor.id,
        turnId: run.turnId,
        lane: def.lane,
      },
    });
    const meter = meterFor({
      def,
      state: run.state,
      turnUsage: run.usage,
      tenantId: run.actor.tenantId,
      spend: this.o.spend,
      dayStart: dayStart(this.now()),
    });
    const span = this.span(
      'chat',
      { 'gen_ai.operation.name': 'chat', 'vendua.tier': tier },
      run.span,
    );
    let res: ModelResponse;
    try {
      res = await this.o.gateway.generate(compiled.request, {
        meter,
        hedge: def.lane === 'interactive',
      });
    } catch (e) {
      span.end(e);
      throw e;
    }
    span.setAttributes({
      'gen_ai.provider.name': res.provider,
      'gen_ai.response.model': res.model,
      'gen_ai.usage.input_tokens': res.usage.inputTokens,
      'gen_ai.usage.output_tokens': res.usage.outputTokens,
      'vendua.cache_read_tokens': res.usage.cacheReadTokens,
      'vendua.cost_usd': res.usage.costUsd,
    });
    span.end();
    run.usage = addUsage(run.usage, res.usage);
    const [e] = await this.commit(run, [
      {
        type: 'model.responded',
        step,
        payload: {
          tier,
          provider: res.provider,
          model: res.model,
          latencyMs: res.latencyMs,
          finish: res.finish,
          hedged: res.hedged ?? false,
          cacheMiss: res.cacheMiss ?? null,
          usage: res.usage as unknown as Json,
          output: { text: res.text, toolCalls: res.toolCalls as unknown as Json },
          input: {
            system: compiled.request.system.map((b) => ({
              id: b.id,
              tier: b.tier,
              hash: hashOf(b.text),
            })),
            messages: compiled.request.messages.length,
            tools: compiled.request.tools.map((t) => t.name),
            volatile: compiled.request.volatile,
            tokens: compiled.tokens,
            cut: compiled.cut,
          },
        },
      },
    ]);
    return e!;
  }

  private allowedTools(run: TurnRun<H>): ToolDefinition[] {
    const def = run.agent.def;
    const chartTools = run.agent.chart.states[run.state.chart.state]?.tools ?? [];
    const skillTools = (def.skills ?? [])
      .filter((sk) => run.state.loadedSkills.includes(sk.id))
      .flatMap((sk) => sk.tools ?? []);
    const pool = new Map<string, ToolDefinition>();
    for (const t of def.tools)
      if (
        (chartTools === '*' || chartTools.includes(t.name)) &&
        (!t.states || t.states.includes(run.state.chart.state))
      )
        pool.set(t.name, t);
    for (const t of skillTools) pool.set(t.name, t);
    const out: ToolDefinition[] = [replyTool, ...pool.values()];
    const ls = loadSkillTool(run.agent);
    if (ls) out.push(ls);
    return out;
  }

  private toolByName(run: TurnRun<H>, name: string): ToolDefinition | undefined {
    if (name === 'reply') return replyTool;
    if (name === 'load_skill') return loadSkillTool(run.agent) ?? undefined;
    return (
      run.agent.def.tools.find((t) => t.name === name) ??
      (run.agent.def.skills ?? []).flatMap((sk) => sk.tools ?? []).find((t) => t.name === name)
    );
  }

  private async toolCalls(run: TurnRun<H>, modelStep: string, calls: ToolCall[]): Promise<void> {
    const allowed = new Set(this.allowedTools(run).map((t) => t.name));
    type Ready = { call: ToolCall; tool: ToolDefinition; input: unknown; step: string };
    const reads: Ready[] = [];
    const ordered: Ready[] = [];
    for (const [j, call] of calls.entries()) {
      const step = `${modelStep}.t${j}`;
      if (run.memo.has(step)) continue;
      const tool = this.toolByName(run, call.name);
      const parsed = tool ? await tool.input['~standard'].validate(call.args) : null;
      const input = parsed && !parsed.issues ? parsed.value : call.args;
      const verdict = await this.toolGuards(run, call, tool, allowed, input);
      if (!verdict.ok) {
        await this.commit(run, [
          {
            type: 'guard.blocked',
            step,
            payload: {
              stage: 'tool',
              callId: call.id,
              tool: call.name,
              guard: verdict.reason.split(':')[0]!,
              reason: verdict.reason,
              feedback: verdict.feedback,
            },
          },
        ]);
        continue;
      }
      if (parsed?.issues) {
        await this.commit(run, [
          {
            type: 'tool.returned',
            step,
            payload: {
              callId: call.id,
              name: call.name,
              ok: false,
              content: `Argumentos inválidos: ${formatIssues(parsed.issues)}`,
              args: call.args,
            },
          },
        ]);
        continue;
      }
      const ready = { call, tool: tool!, input, step };
      if (tool!.effect === 'read') reads.push(ready);
      else ordered.push(ready);
    }

    if (reads.length) {
      const results = await Promise.all(
        reads.map(async (r) =>
          this.o.store.read(run.actor.tenantId, async (host) => {
            const ctx = this.toolCtx(run, host, null);
            return { r, ctx, out: await this.runTool(run, r.tool, ctx, r.input) };
          }),
        ),
      );
      const events: NewEvent[] = [];
      for (const { r, ctx, out } of results) events.push(...this.toolEvents(run, r, ctx, out));
      await this.commit(run, events, true);
    }

    for (const r of ordered) {
      if (r.tool.name === 'reply') {
        const text = (r.input as { text: string }).text;
        await this.reply(run, r.step, modelStep, text, r.call);
        continue;
      }
      if (run.agent.def.mailbox?.preempt && r.tool.effect === 'send')
        await this.preemptIfNewInput(run);
      await this.fenced(run, async (tx) => {
        const ctx = this.toolCtx(run, tx.host, tx);
        const out = await this.runTool(run, r.tool, ctx, r.input, tx);
        return this.commitIn(tx, run, this.toolEvents(run, r, ctx, out), true);
      });
    }
  }

  private async toolGuards(
    run: TurnRun<H>,
    call: ToolCall,
    tool: ToolDefinition | undefined,
    allowed: ReadonlySet<string>,
    input: unknown,
  ): Promise<Verdict> {
    const guards: ToolGuard[] = [stateGate, confirmation, ...(run.agent.def.guards?.tool ?? [])];
    for (const g of guards) {
      const v = await g.run(call, { state: run.state, tool, allowed, input });
      if (!v.ok) return { ...v, reason: `${g.id}:${v.reason}` };
    }
    return { ok: true };
  }

  private toolCtx(run: TurnRun<H>, host: H, fenced: FencedTx<H> | null): ToolCtx<H> {
    return new ToolCtx<H>({
      host,
      fenced,
      tenantId: run.actor.tenantId,
      actorId: run.actor.id,
      agentId: run.agent.def.id,
      turnId: run.turnId,
      subject: run.actor.subject,
      state: run.state,
      now: this.now(),
      aliases: run.aliases,
    });
  }

  private async runTool(
    run: TurnRun<H>,
    tool: ToolDefinition,
    ctx: ToolCtx<H>,
    input: unknown,
    tx?: FencedTx<H>,
  ): Promise<{ ok: boolean; result: ToolResult; ms: number }> {
    const span = this.span(
      'execute_tool',
      { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': tool.name },
      run.span,
    );
    const t0 = Date.now();
    try {
      const exec = () => Promise.resolve(tool.run(ctx, input));
      // a ToolError rolls back the tool's own writes; the step still records the error
      const result = tx ? await tx.savepoint(() => exec()) : await exec();
      span.end();
      return { ok: true, result, ms: Date.now() - t0 };
    } catch (e) {
      span.end(e instanceof ToolError ? undefined : e);
      if (e instanceof ToolError) {
        ctx.events.length = 0;
        return { ok: false, result: { content: e.message, data: e.data }, ms: Date.now() - t0 };
      }
      throw e;
    }
  }

  private toolEvents(
    run: TurnRun<H>,
    r: { call: ToolCall; tool: ToolDefinition; step: string },
    ctx: ToolCtx<H>,
    out: { ok: boolean; result: ToolResult; ms: number },
  ): NewEvent[] {
    const res = out.result;
    const asObj =
      res && typeof res === 'object' && !Array.isArray(res) ? (res as JsonObject) : null;
    const content =
      asObj && typeof asObj.content === 'string'
        ? asObj.content
        : JSON.stringify(res ?? null).slice(0, 8000);
    const data = asObj && 'content' in asObj ? (asObj.data ?? null) : res;
    const events: NewEvent[] = ctx.events.map((e) => ({ ...e, step: r.step }));
    events.push({
      type: 'tool.returned',
      step: r.step,
      payload: {
        callId: r.call.id,
        name: r.call.name,
        effect: r.tool.effect,
        ok: out.ok,
        content,
        data: data ?? null,
        args: r.call.args,
        ms: out.ms,
      },
    });
    if (out.ok && r.tool.name === 'load_skill') {
      const id = (asObj?.data as JsonObject | undefined)?.skill;
      if (typeof id === 'string')
        events.push({ type: 'skill.loaded', step: r.step, payload: { id } });
    }
    return events;
  }

  // ── replies: render, guard, and send as the commit point ───────────────────

  private async reply(
    run: TurnRun<H>,
    step: string,
    modelStep: string,
    raw: string,
    call: ToolCall | null,
  ): Promise<void> {
    if (run.memo.has(step)) return;
    const def = run.agent.def;
    const blocked = (guard: string, reason: string, feedback: string) =>
      this.commit(run, [
        {
          type: 'guard.blocked',
          step,
          payload: {
            stage: 'output',
            callId: call?.id ?? null,
            tool: 'reply',
            guard,
            reason,
            feedback,
            raw,
          },
        },
      ]);
    if (run.state.owner !== 'agent')
      return void (await blocked('owner', 'human', 'A loja assumiu a conversa; não responda.'));
    const rendered = render(raw, run.state.ledger);
    if (rendered.unknown.length)
      return void (await blocked(
        'references',
        `unknown:${rendered.unknown.join(',')}`,
        `Referências inexistentes: ${rendered.unknown.map((u) => `{{${u}}}`).join(', ')}. Use só as do REGISTRO.`,
      ));
    const gctx: OutputGuardCtx = {
      state: run.state,
      raw,
      gateway: this.o.gateway,
      meta: {
        tenantId: run.actor.tenantId,
        agentId: def.id,
        actorId: run.actor.id,
        turnId: run.turnId,
      },
    };
    for (const g of def.guards?.output ?? []) {
      if (g.when && !g.when(rendered.text, gctx)) continue;
      const v = await g.run(rendered.text, gctx);
      if (!v.ok) return void (await blocked(g.id, v.reason, v.feedback));
    }
    // the send is the commit point: newer input supersedes instead of a stale answer
    const superseded = await this.fenced(run, async (tx) => {
      if (def.mailbox?.preempt && (await this.supersedeIfNewInput(tx, run))) return true;
      const transport = this.transports.get(def.transport)!;
      const cards = run.state.pendingCards;
      const { outboxId } = await transport.send(tx, {
        actorId: run.actor.id,
        tenantId: run.actor.tenantId,
        subject: run.actor.subject,
        turnId: run.turnId,
        step,
        text: rendered.text,
        cards,
      });
      const events: NewEvent[] = [];
      if (call)
        events.push({
          type: 'tool.returned',
          step,
          payload: {
            callId: call.id,
            name: 'reply',
            effect: 'send',
            ok: true,
            content: 'Enviada.',
            data: null,
            args: { text: raw },
            ms: 0,
          },
        });
      events.push({
        type: 'message.sent',
        step,
        payload: {
          modelStep,
          callId: call?.id ?? null,
          text: rendered.text,
          raw,
          refs: rendered.refs,
          cards: cards as unknown as Json,
          outboxId,
          transport: transport.id,
        },
      });
      await this.commitIn(tx, run, events, false);
      return false;
    });
    if (superseded) throw new SupersededSignal(run.turnId);
  }

  // ── preemption ──────────────────────────────────────────────────────────────

  private async preemptIfNewInput(run: TurnRun<H>): Promise<void> {
    if (await this.fenced(run, (tx) => this.supersedeIfNewInput(tx, run)))
      throw new SupersededSignal(run.turnId);
  }

  /**
   * New input since the batch: release the batch and mark the turn superseded. The caller
   * signals after its transaction commits, or the release would roll back with it.
   */
  private async supersedeIfNewInput(tx: FencedTx<H>, run: TurnRun<H>): Promise<boolean> {
    const kinds = run.agent.def.mailbox?.inputKinds ?? DEFAULT_INPUT_KINDS;
    const fresh = (await tx.dueMailbox(this.now())).filter((m) => kinds.includes(m.kind));
    if (fresh.length === 0) return false;
    await tx.unconsume(run.turnId);
    await this.commitIn(
      tx,
      run,
      [{ type: 'turn.superseded', payload: { by: fresh.map((m) => m.id) } }],
      false,
    );
    return true;
  }

  // ── end, failure, maintenance ───────────────────────────────────────────────

  private async end(run: TurnRun<H>): Promise<void> {
    const def = run.agent.def;
    await this.fenced(run, async (tx) => {
      await this.commitIn(
        tx,
        run,
        [
          {
            type: 'turn.ended',
            payload: { usage: run.usage as unknown as Json, guardBlocks: run.state.guardBlocks },
          },
        ],
        false,
      );
      const key = { tenantId: run.actor.tenantId, agentId: def.id, subject: run.actor.subject };
      const compaction = def.compaction ?? { thresholdTokens: 12_000, keepRecent: 8 };
      if (compaction) {
        const tokens = run.state.transcript.reduce((n, t) => n + messageTokens(t.message), 0);
        if (
          tokens > compaction.thresholdTokens &&
          run.state.transcript.length > compaction.keepRecent
        )
          await tx.dispatch({
            actor: key,
            kind: 'runtime.compact',
            source: `agent:${run.turnId}`,
            dedupeKey: `compact:${run.actor.id}:${run.state.compactedThroughSeq}`,
          });
      }
      if (def.consolidate && def.memory && run.state.lastInputAt)
        await tx.dispatch({
          actor: key,
          kind: 'runtime.consolidate',
          source: `agent:${run.turnId}`,
          dedupeKey: `consolidate:${run.actor.id}:${run.state.lastInputAt}`,
          deliverAt: new Date(this.now().getTime() + def.consolidate.afterIdleMs),
        });
      await this.o.hooks?.turnEnded?.(tx, {
        actorId: run.actor.id,
        tenantId: run.actor.tenantId,
        agentId: def.id,
        subject: run.actor.subject,
        turnId: run.turnId,
        version: run.agent.version,
        state: run.state,
      });
      await tx.saveProjection(
        { version: run.agent.version, state: run.state as unknown as Json },
        run.actor.seq,
      );
    });
  }

  private async fail(run: TurnRun<H>, error: string): Promise<void> {
    const def = run.agent.def;
    await this.fenced(run, async (tx) => {
      const events: NewEvent[] =
        def.degrade && run.state.owner === 'agent' && !run.memo.has('degrade')
          ? await this.degradeEvents(run, tx)
          : [];
      events.push({
        type: 'turn.failed',
        payload: {
          error: error.slice(0, 500),
          attempts: run.actor.attempts,
          usage: run.usage as unknown as Json,
        },
      });
      await this.commitIn(tx, run, events, false);
      await this.o.hooks?.turnFailed?.(tx, {
        actorId: run.actor.id,
        tenantId: run.actor.tenantId,
        agentId: def.id,
        subject: run.actor.subject,
        turnId: run.turnId,
        version: run.agent.version,
        error,
        attempts: run.actor.attempts,
      });
      await tx.saveProjection(
        { version: run.agent.version, state: run.state as unknown as Json },
        run.actor.seq,
      );
    });
    this.log('warn', 'turn failed', { actorId: run.actor.id, turnId: run.turnId, error });
  }

  /** The definition's safe line, sent as Core's own words (no guards: the model didn't write it). */
  private async degradeEvents(run: TurnRun<H>, tx: FencedTx<H>): Promise<NewEvent[]> {
    const def = run.agent.def;
    const events: NewEvent[] = [];
    try {
      const ctx = this.toolCtx(run, tx.host, tx);
      const out = await tx.savepoint(() => def.degrade!(ctx));
      events.push(...ctx.events.map((e) => ({ ...e, step: e.step ?? 'degrade' })));
      if (out?.text) {
        const transport = this.transports.get(def.transport)!;
        // in a savepoint: a send that fails must not abort the transaction turn.failed commits in
        const { outboxId } = await tx.savepoint(() =>
          transport.send(tx, {
            actorId: run.actor.id,
            tenantId: run.actor.tenantId,
            subject: run.actor.subject,
            turnId: run.turnId,
            step: 'degrade',
            text: out.text,
            cards: out.cards ?? [],
          }),
        );
        events.push({
          type: 'message.sent',
          step: 'degrade',
          payload: {
            text: out.text,
            cards: (out.cards ?? []) as unknown as Json,
            outboxId,
            degraded: true,
            transport: transport.id,
          },
        });
      }
    } catch (e) {
      events.push({ type: 'degrade.failed', step: 'degrade', payload: { error: errText(e) } });
    }
    return events;
  }

  /** A background turn: the older transcript becomes a summary the compiler uses instead. */
  private async compact(run: TurnRun<H>): Promise<void> {
    const keep = (run.agent.def.compaction || { keepRecent: 8 }).keepRecent;
    const t = run.state.transcript;
    let cutAt = t.length - keep;
    while (cutAt > 0 && t[cutAt]?.message.role === 'tool') cutAt--;
    if (cutAt <= 0) return;
    const older = t.slice(0, cutAt);
    const throughSeq = older[older.length - 1]!.seq;
    const step = 'c0';
    let rec = run.memo.get(step)?.find((e) => e.type === 'model.responded');
    if (!rec) {
      rec = await this.plainModelStep(
        run,
        step,
        'Resuma a conversa abaixo para o próprio atendente continuar depois. Mantenha pedidos, escolhas, endereços citados, problemas e promessas da loja; omita cumprimentos. No máximo 12 linhas.',
        `${run.state.summary ? `Resumo anterior:\n${run.state.summary}\n\n` : ''}${older.map((x) => transcriptLine(x.message)).join('\n')}`,
        600,
      );
    }
    const summary = String(((rec.payload as JsonObject).output as JsonObject).text ?? '').trim();
    if (summary)
      await this.commit(run, [
        {
          type: 'memory.compacted',
          step: 'c1',
          payload: { summary: summary.slice(0, 4000), throughSeq },
        },
      ]);
  }

  /** Sleep-time: after the conversation goes quiet, propose facts worth remembering. */
  private async consolidate(run: TurnRun<H>): Promise<void> {
    const def = run.agent.def;
    if (!def.consolidate || !def.memory) return;
    const last = run.state.lastInputAt ? Date.parse(run.state.lastInputAt) : 0;
    if (this.now().getTime() - last < def.consolidate.afterIdleMs) return;
    const step = 'k0';
    let rec = run.memo.get(step)?.find((e) => e.type === 'model.responded');
    if (!rec) {
      const keys = def.memory.keys
        .map(
          (k) =>
            `${k.key}${k.sensitive ? ' (sensível: só com consentimento explícito do cliente na conversa)' : ''}`,
        )
        .join(', ');
      rec = await this.plainModelStep(
        run,
        step,
        `${def.consolidate.instructions}\nChaves permitidas: ${keys}.\nResponda só JSON: {"facts":[{"key":"…","value":…,"confidence":0..1,"consent":true|false}]}`,
        `${run.state.summary ? `Resumo:\n${run.state.summary}\n\n` : ''}${run.state.transcript.map((x) => transcriptLine(x.message)).join('\n')}`,
        500,
      );
    }
    const text = String(((rec.payload as JsonObject).output as JsonObject).text ?? '');
    let facts: MemoryProposal[] = [];
    try {
      const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
        facts?: unknown;
      };
      if (Array.isArray(parsed.facts))
        facts = parsed.facts
          .filter(
            (f): f is MemoryProposal =>
              !!f &&
              typeof f === 'object' &&
              typeof (f as MemoryProposal).key === 'string' &&
              typeof (f as MemoryProposal).confidence === 'number',
          )
          .slice(0, 20);
    } catch {
      facts = [];
    }
    if (facts.length)
      await this.commit(
        run,
        facts.map((f) => ({
          type: 'memory.proposed',
          step: 'k1',
          payload: {
            key: f.key,
            value: f.value ?? null,
            confidence: f.confidence,
            consent: f.consent === true,
            origin: 'consolidation',
          },
        })),
        true,
      );
  }

  private async plainModelStep(
    run: TurnRun<H>,
    step: string,
    instructions: string,
    body: string,
    maxTokens: number,
  ): Promise<AgentEvent> {
    const def = run.agent.def;
    const meter = meterFor({
      def,
      state: run.state,
      turnUsage: run.usage,
      tenantId: run.actor.tenantId,
      spend: this.o.spend,
      dayStart: dayStart(this.now()),
    });
    run.lease = await this.keepLease(run.lease);
    const res = await this.o.gateway.generate(
      {
        tier: 'fast',
        system: [
          {
            id: step.startsWith('c') ? 'compaction' : 'consolidation',
            tier: 'static',
            text: instructions,
            cache: true,
          },
        ],
        messages: [
          { role: 'user', parts: [{ type: 'text', text: `<conversa>\n${body}\n</conversa>` }] },
        ],
        volatile: null,
        tools: [],
        maxTokens,
        temperature: 0,
        meta: {
          tenantId: run.actor.tenantId,
          agentId: def.id,
          actorId: run.actor.id,
          turnId: run.turnId,
          lane: 'background',
        },
      },
      { meter },
    );
    run.usage = addUsage(run.usage, res.usage);
    const [e] = await this.commit(run, [
      {
        type: 'model.responded',
        step,
        payload: {
          tier: 'fast',
          provider: res.provider,
          model: res.model,
          latencyMs: res.latencyMs,
          finish: res.finish,
          usage: res.usage as unknown as Json,
          output: { text: res.text, toolCalls: [] },
          maintenance: true,
        },
      },
    ]);
    return e!;
  }

  // ── committing events ───────────────────────────────────────────────────────

  private fenced<T>(run: TurnRun<H>, fn: (tx: FencedTx<H>) => Promise<T>): Promise<T> {
    return this.o.store.fenced(run.lease, fn);
  }

  private commit(run: TurnRun<H>, events: NewEvent[], withMemory = false): Promise<AgentEvent[]> {
    return this.fenced(run, (tx) => this.commitIn(tx, run, events, withMemory));
  }

  /**
   * Appends events, folds them, then appends what they cause in the same transaction:
   * statechart transitions, skills a state loads, and memory decisions.
   */
  private async commitIn(
    tx: FencedTx<H>,
    run: TurnRun<H>,
    events: NewEvent[],
    withMemory: boolean,
  ): Promise<AgentEvent[]> {
    const out: AgentEvent[] = [];
    let pending = events;
    for (let round = 0; pending.length && round < 5; round++) {
      const appended = await tx.append(run.turnId, pending, run.agent.version);
      run.actor.seq = appended[appended.length - 1]?.seq ?? run.actor.seq;
      const next: NewEvent[] = [];
      for (const e of appended) {
        this.applyFolded(run.agent, run.state, e);
        if (e.step) run.memo.set(e.step, [...(run.memo.get(e.step) ?? []), e]);
        out.push(e);
        const p = (e.payload ?? {}) as JsonObject;
        if (e.type === 'tool.returned' && p.ok === true && typeof p.name === 'string')
          next.push(
            ...this.transition(run.agent, run.state, `tool:${p.name}`, p.data ?? null, e.step),
          );
        if (e.type !== 'state.changed' && e.type !== 'tool.returned')
          next.push(...this.transition(run.agent, run.state, `event:${e.type}`, e.payload, e.step));
        if (e.type === 'state.changed') {
          for (const sk of run.agent.def.skills ?? [])
            if (sk.autoLoad?.includes(String(p.to)) && !run.state.loadedSkills.includes(sk.id))
              next.push({ type: 'skill.loaded', step: e.step, payload: { id: sk.id, auto: true } });
        }
        if (withMemory && e.type === 'memory.proposed')
          next.push(...(await this.decideMemory(tx, run, e)));
        if (e.type === 'memory.forgotten' && this.o.memory && typeof p.key === 'string')
          await this.o.memory.forget(tx, this.memoryScope(run.agent, run.actor, run.state), p.key);
      }
      pending = next;
    }
    return out;
  }

  private transition(
    agent: Agent<H>,
    state: ConversationState,
    trigger: Trigger,
    payload: Json,
    step?: string | null,
  ): NewEvent[] {
    const to = transitionFor(agent.chart, state, trigger, payload);
    if (!to) return [];
    return [
      {
        type: 'state.changed',
        step: step ?? null,
        payload: { from: state.chart.state, to, trigger },
      },
    ];
  }

  private async decideMemory(tx: FencedTx<H>, run: TurnRun<H>, e: AgentEvent): Promise<NewEvent[]> {
    const def = run.agent.def;
    const p = e.payload as JsonObject;
    const proposal: MemoryProposal = {
      key: String(p.key),
      value: p.value ?? null,
      confidence: typeof p.confidence === 'number' ? p.confidence : 0,
      consent: p.consent === true,
    };
    const d =
      def.memory && this.o.memory
        ? decide(def.memory.keys, proposal)
        : ({ accept: false, reason: 'not_allowlisted' } as const);
    if (!d.accept)
      return [
        { type: 'memory.rejected', step: e.step, payload: { key: proposal.key, reason: d.reason } },
      ];
    await this.o.memory!.accept(tx, {
      scope: this.memoryScope(run.agent, run.actor, run.state),
      key: proposal.key,
      value: proposal.value,
      confidence: proposal.confidence,
      provenance: `${run.actor.id}:${e.seq}`,
      sensitive: d.sensitive,
    });
    return [
      {
        type: 'memory.accepted',
        step: e.step,
        payload: { key: proposal.key, value: proposal.value, sensitive: d.sensitive },
      },
    ];
  }

  // ── leases, time, telemetry ─────────────────────────────────────────────────

  private async keepLease(lease: Lease): Promise<Lease> {
    if (lease.until.getTime() - this.now().getTime() > this.leaseMs / 2) return lease;
    const renewed = await this.o.store.renew(lease, this.leaseMs);
    if (!renewed) throw new LeaseLostError(lease.actorId);
    return renewed;
  }

  private now(): Date {
    return this.clock.now();
  }

  private span(
    name: string,
    attrs: Record<string, string | number | boolean>,
    parent?: Span,
  ): Span {
    return this.o.telemetry?.span(name, attrs, parent) ?? noopSpan;
  }

  private log(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>): void {
    this.o.log?.(level, msg, data);
  }
}

function maintenanceOf(events: AgentEvent[]): string | null {
  const started = events.find((e) => e.type === 'turn.started');
  const m = (started?.payload as JsonObject | undefined)?.maintenance;
  return typeof m === 'string' ? m : null;
}

function dayStart(now: Date): Date {
  // the platform's day is São Paulo's: budgets reset at local midnight (UTC−3, no DST since 2019)
  const local = new Date(now.getTime() - 3 * 3600_000);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3600_000,
  );
}

function transcriptLine(m: ChatMessage): string {
  if (m.role === 'user')
    return `cliente: ${m.parts.map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join(' ')}`;
  if (m.role === 'assistant')
    return `atendente: ${m.text}${m.toolCalls.length ? ` [ferramentas: ${m.toolCalls.map((c) => c.name).join(', ')}]` : ''}`;
  return `resultado ${m.name}: ${m.content.slice(0, 300)}`;
}
