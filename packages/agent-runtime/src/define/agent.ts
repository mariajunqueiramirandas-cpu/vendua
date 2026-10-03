import { createHash } from 'node:crypto';
import type { ConversationState } from '../engine/state.ts';
import type { VerifierOptions } from '../ledger/verifier.ts';
import { jsonSchemaOf } from '../schema.ts';
import type {
  AgentEvent,
  Card,
  ChatMessage,
  ContextTier,
  Json,
  Lane,
  SubjectRef,
  Tier,
} from '../types.ts';
import type { InputGuard, OutputGuard, ToolGuard } from './guard.ts';
import type { SkillDefinition } from './skill.ts';
import { openChart, type Statechart } from './statechart.ts';
import type { ToolContext, ToolDefinition } from './tool.ts';

export interface BlockCtx {
  state: Readonly<ConversationState>;
  /** What `load.tenant` returned, as recorded in the log. */
  tenant: Json;
  subject: Json;
  now: Date;
}

/** A piece of the prompt. Over its budget, the compiler cuts the lowest priority first. */
export interface InstructionBlock {
  id: string;
  tier: Exclude<ContextTier, 'conversation' | 'volatile'>;
  text: string | ((ctx: BlockCtx) => string);
  /** Higher survives longer. Default 50; the base rules should be 100. */
  priority?: number;
  maxTokens?: number;
}

export interface LoadCtx<H = unknown> {
  tx: H;
  tenantId: string;
  subject: SubjectRef;
  state: Readonly<ConversationState>;
}

export interface MemoryKeyPolicy {
  /** Exact key or a `prefix.*` pattern. */
  key: string;
  minConfidence?: number;
  /** Health data and the like: kept only with recorded consent, confirmed on every use. */
  sensitive?: boolean;
}

export interface Escalation {
  when: (s: Readonly<ConversationState>) => boolean;
  to: Tier;
}

export interface AgentDefinition<H = any> {
  id: string;
  /** The subject kind actors of this agent are about (`shopper_thread`). */
  subject: string;
  lane: Lane;
  /** The transport replies go out through. */
  transport: string;
  models: {
    default: Tier;
    escalate?: readonly Escalation[];
    maxTokens?: number;
    temperature?: number;
  };
  instructions: readonly InstructionBlock[];
  skills?: readonly SkillDefinition[];
  tools: readonly ToolDefinition<any, H>[];
  statechart?: Statechart;
  guards?: {
    input?: readonly InputGuard[];
    tool?: readonly ToolGuard[];
    output?: readonly OutputGuard[];
  };
  mailbox?: {
    /** Coalesce a burst of messages: wait `minMs` after the last one, at most `maxMs` after the first. */
    quiet?: { minMs: number; maxMs: number; extendWhile?: string };
    /** New input stops the turn at the next step boundary. */
    preempt?: boolean;
    /** Mailbox kinds that count as new input. Default `message.inbound`. */
    inputKinds?: readonly string[];
  };
  budgets?: {
    stepsPerTurn?: number;
    tokensPerTurn?: number;
    costPerTurnUsd?: number;
    costPerSubjectUsd?: number;
    /** A key the host's `SpendPort` resolves to the tenant's daily cap. */
    tenantDaily?: string;
  };
  /** The turn is done. Default: replied since the last input, or a person owns the conversation. */
  finish?: (s: Readonly<ConversationState>) => boolean;
  /** A mailbox row as the model reads it; null keeps it out of the transcript. */
  toInput?: (
    msg: { kind: string; source: string; payload: Json },
    s: Readonly<ConversationState>,
  ) => ChatMessage | null;
  /** Host data for the tenant and subject tiers, recorded in the log so a turn can be replayed. */
  load?: {
    tenant?: (ctx: LoadCtx<H>) => Promise<Json>;
    subject?: (ctx: LoadCtx<H>) => Promise<Json>;
  };
  /** Extra turn-scoped lines after `AGORA`, `ESTADO` and `FALTA`. */
  volatile?: (ctx: BlockCtx) => string;
  fold?: {
    initial: Json;
    apply: (custom: Json, e: AgentEvent, s: Readonly<ConversationState>) => Json;
  };
  memory?: {
    scope?: (subject: SubjectRef, s: Readonly<ConversationState>) => string;
    keys: readonly MemoryKeyPolicy[];
  };
  compaction?: { thresholdTokens: number; keepRecent: number } | false;
  /** Sleep-time consolidation: after this much quiet, a background turn proposes facts. */
  consolidate?: { afterIdleMs: number; instructions: string };
  verifier?: VerifierOptions;
  /** Runs when a turn fails its retries (the storefront link, a handoff). */
  degrade?: (ctx: ToolContext<H>) => Promise<{ text: string; cards?: Card[] } | null>;
  /** Activations a turn may take before it fails. Default 3. */
  maxAttempts?: number;
  /** Where the eval suite lives, for the host's release gate. */
  evals?: string;
}

const ID = /^[a-z][a-z0-9_-]{0,40}$/;

export interface Agent<H = any> {
  readonly def: AgentDefinition<H>;
  readonly version: string;
  readonly manifest: Json;
  readonly chart: Statechart;
}

export function defineAgent<H = any>(def: AgentDefinition<H>): Agent<H> {
  if (!ID.test(def.id)) throw new Error(`agent id must match ${ID}: ${def.id}`);
  const names = new Map<string, ToolDefinition>();
  for (const t of [...def.tools, ...(def.skills ?? []).flatMap((sk) => sk.tools ?? [])]) {
    if (RESERVED_TOOLS.has(t.name)) throw new Error(`tool name ${t.name} is reserved`);
    const prev = names.get(t.name);
    if (prev && prev !== t) throw new Error(`two tools named ${t.name}`);
    names.set(t.name, t);
  }
  const chart = def.statechart ?? openChart;
  for (const st of Object.values(chart.states))
    if (st.tools !== '*')
      for (const name of st.tools)
        if (!names.has(name) && !RESERVED_TOOLS.has(name))
          throw new Error(`statechart allows unknown tool ${name}`);
  const manifest = manifestOf(def, chart);
  const version =
    'v_' + createHash('sha256').update(canonical(manifest)).digest('hex').slice(0, 20);
  return Object.freeze({ def, version, manifest, chart });
}

export const RESERVED_TOOLS = new Set(['reply', 'load_skill']);

function src(f: unknown): Json {
  return typeof f === 'function' ? f.toString() : ((f as Json) ?? null);
}

function toolManifest(t: ToolDefinition): Json {
  return {
    name: t.name,
    description: t.description,
    effect: t.effect,
    states: t.states ? [...t.states] : null,
    parameters: jsonSchemaOf(t.input, t.jsonSchema) as Json,
    run: src(t.run),
    confirm: src(t.confirm),
  };
}

/** Everything that changes behaviour, function bodies included, so the hash moves with it. */
function manifestOf(def: AgentDefinition, chart: Statechart): Json {
  return {
    id: def.id,
    subject: def.subject,
    lane: def.lane,
    transport: def.transport,
    models: {
      default: def.models.default,
      escalate: (def.models.escalate ?? []).map((e) => ({ to: e.to, when: src(e.when) })),
      maxTokens: def.models.maxTokens ?? null,
      temperature: def.models.temperature ?? null,
    },
    instructions: def.instructions.map((b) => ({
      id: b.id,
      tier: b.tier,
      text: src(b.text),
      priority: b.priority ?? 50,
      maxTokens: b.maxTokens ?? null,
    })),
    skills: (def.skills ?? []).map((sk) => ({
      id: sk.id,
      when: sk.when,
      instructions: sk.instructions,
      examples: sk.examples ? [...sk.examples] : [],
      autoLoad: sk.autoLoad ? [...sk.autoLoad] : [],
      tools: (sk.tools ?? []).map(toolManifest),
    })),
    tools: def.tools.map(toolManifest),
    statechart: JSON.parse(
      JSON.stringify(chart, (_k, v) => (typeof v === 'function' ? v.toString() : v)),
    ) as Json,
    guards: {
      input: (def.guards?.input ?? []).map((g) => ({ id: g.id, run: src(g.run) })),
      tool: (def.guards?.tool ?? []).map((g) => ({ id: g.id, run: src(g.run) })),
      output: (def.guards?.output ?? []).map((g) => ({
        id: g.id,
        run: src(g.run),
        when: src(g.when),
      })),
    },
    mailbox: (def.mailbox ?? null) as Json,
    budgets: (def.budgets ?? null) as Json,
    finish: src(def.finish),
    toInput: src(def.toInput),
    load: { tenant: src(def.load?.tenant), subject: src(def.load?.subject) },
    volatile: src(def.volatile),
    fold: def.fold ? { initial: def.fold.initial, apply: src(def.fold.apply) } : null,
    memory: def.memory
      ? { scope: src(def.memory.scope), keys: def.memory.keys as unknown as Json }
      : null,
    compaction: (def.compaction ?? null) as Json,
    consolidate: (def.consolidate ?? null) as Json,
    verifier: def.verifier
      ? (JSON.parse(
          JSON.stringify(def.verifier, (_k, v) =>
            typeof v === 'function' ? v.toString() : v instanceof RegExp ? v.source : v,
          ),
        ) as Json)
      : null,
    degrade: src(def.degrade),
    maxAttempts: def.maxAttempts ?? 3,
  };
}

/** JSON with sorted keys: the same definition always hashes the same. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}
