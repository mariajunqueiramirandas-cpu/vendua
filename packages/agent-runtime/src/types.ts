export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** What a conversation is about, as the host names it (`shopper_thread`, `lead`). */
export interface SubjectRef {
  kind: string;
  id: string;
}

export interface ActorKey {
  tenantId: string;
  agentId: string;
  subject: SubjectRef;
}

export type Lane = 'interactive' | 'followup' | 'background';
export const LANES: readonly Lane[] = ['interactive', 'followup', 'background'];

export interface ActorRow {
  id: string;
  tenantId: string;
  agentId: string;
  subject: SubjectRef;
  lane: Lane;
  /** Staff pin: overrides the ring's version for this actor. */
  versionPin: string | null;
  /** Last event sequence written. */
  seq: number;
  /** Cached fold of the log up to `projectionSeq`, with the version that folded it. */
  projection: { version: string; state: Json } | null;
  projectionSeq: number;
  nextWakeAt: Date | null;
  /** Consecutive failed activations, reset by a turn that ends. */
  attempts: number;
}

export interface Lease {
  actorId: string;
  tenantId: string;
  owner: string;
  epoch: number;
  until: Date;
}

/** Namespaced kinds: `message.inbound`, `timer.<name>`, `webhook.<name>`, `merchant.<name>`, `runtime.<name>`. */
export interface MailboxMessage {
  id: string;
  actorId: string;
  tenantId: string;
  kind: string;
  payload: Json;
  source: string;
  dedupeKey: string;
  deliverAt: Date;
  createdAt: Date;
  consumedByTurn: string | null;
}

export interface DispatchInput {
  actor: ActorKey;
  kind: string;
  /** Who caused it: `whatsapp`, `admin:<user>`, `mercadopago`, `timer`, `agent:<turn>`. */
  source: string;
  /** Unique per tenant: a re-delivered webhook or a retried transaction writes nothing new. */
  dedupeKey: string;
  deliverAt?: Date;
  payload?: Json;
}

export interface DispatchResult {
  actorId: string;
  mailboxId: string | null;
  inserted: boolean;
}

export interface AgentEvent {
  actorId: string;
  tenantId: string;
  seq: number;
  turnId: string | null;
  step: string | null;
  type: string;
  payload: Json;
  version: string;
  at: Date;
}

export interface NewEvent {
  type: string;
  step?: string | null;
  payload: Json;
}

// ── the provider-neutral message model ────────────────────────────────────────

export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; url?: string; data?: string; description?: string }
  | { type: 'audio'; mediaType: string; url?: string; data?: string; transcript?: string };

export interface ToolCall {
  id: string;
  name: string;
  args: Json;
}

export type ChatMessage =
  | { role: 'user'; parts: Part[] }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; content: string; isError: boolean };

export type Tier = 'fast' | 'strong';

/** Context tiers in cache order: everything above a tier's breakpoint is byte-stable longer. */
export type ContextTier = 'static' | 'tenant' | 'subject' | 'conversation' | 'volatile';
export const CONTEXT_TIERS: readonly ContextTier[] = [
  'static',
  'tenant',
  'subject',
  'conversation',
  'volatile',
];

export interface SystemBlock {
  id: string;
  tier: ContextTier;
  text: string;
  /** A cache breakpoint after this block. */
  cache: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: { [k: string]: unknown };
}

export interface ModelRequest {
  tier: Tier;
  system: SystemBlock[];
  messages: ChatMessage[];
  /** Turn-scoped facts (clock, cart, checklist): sent after the transcript, never cached. */
  volatile: string | null;
  tools: ToolSpec[];
  maxTokens: number;
  temperature?: number;
  /** Metadata for routing and accounting; never sent to a provider. */
  meta: { tenantId: string; agentId: string; actorId: string; turnId: string; lane: Lane };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** USD; platform cost, never store money. */
  costUsd: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd + b.costUsd,
  };
}

export interface ModelResponse {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage;
  provider: string;
  model: string;
  latencyMs: number;
  finish: 'stop' | 'tool_calls' | 'length';
  /** Why the provider's cache missed, where it says. */
  cacheMiss?: string;
  hedged?: boolean;
}

/** An outbound message the transport writes to its outbox inside the step's transaction. */
export interface OutboundMessage {
  actorId: string;
  tenantId: string;
  subject: SubjectRef;
  turnId: string;
  step: string;
  text: string;
  cards: Card[];
}

/** Structured content Core renders (a summary, a Pix code); the model never writes it. */
export interface Card {
  kind: string;
  data: Json;
}
