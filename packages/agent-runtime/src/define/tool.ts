import type { ConversationState, Figure } from '../engine/state.ts';
import type { JsonSchema, StandardSchemaV1 } from '../schema.ts';
import type { Card, DispatchResult, Json, SubjectRef } from '../types.ts';

/** `read` tools may run in parallel; everything else runs in order, one transaction each. */
export type Effect = 'read' | 'write' | 'money' | 'send' | 'irreversible';

/** A tool failure the model sees and can fix. The step's business writes roll back. */
export class ToolError extends Error {
  constructor(
    message: string,
    readonly data: Json = null,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface TimerInput {
  /** Becomes `timer.<name>` in the mailbox. */
  name: string;
  deliverAt: Date;
  /** Unique per actor; setting the same timer twice writes one row. */
  key: string;
  payload?: Json;
}

export interface MemoryProposal {
  key: string;
  value: Json;
  confidence: number;
  /** The shopper agreed to this being remembered (required for sensitive keys). */
  consent?: boolean;
}

export interface ToolContext<H = unknown> {
  /** The step's transaction: fenced and tenant-scoped; a read-only one for `read` tools. */
  readonly tx: H;
  readonly tenantId: string;
  readonly actorId: string;
  readonly agentId: string;
  readonly turnId: string;
  readonly subject: SubjectRef;
  readonly state: Readonly<ConversationState>;
  readonly now: Date;
  /** A short id the model reads (`p12`) for a host id; stable for the conversation. */
  alias(kind: string, id: string): string;
  /** The host id behind an alias; a `ToolError` the model sees if it doesn't exist. */
  resolve(alias: string, kind: string): string;
  /** Enters a Core figure in the ledger; replies cite it as `{{id}}`. */
  figure(id: string, f: { value: Json; text: string; kind: Figure['kind'] }): void;
  setSlot(name: string, value: Json): void;
  /** Cards ride on the turn's next reply; Core renders them. */
  card(card: Card): void;
  handoff(reason: string): void;
  handback(): void;
  proposeMemory(p: MemoryProposal): void;
  forgetMemory(key: string): void;
  /** Writes a timer through the producer, in this transaction. Not for `read` tools. */
  timer(t: TimerInput): Promise<DispatchResult>;
  /**
   * An external call keyed by the business object (`order:{id}:pix`), not the step: a later
   * turn finds the recorded result instead of calling again. `key` doubles as the provider's
   * idempotency key.
   */
  external<T extends Json>(key: string, call: (idempotencyKey: string) => Promise<T>): Promise<T>;
}

export type ToolResult = Json | { content: string; data?: Json };

export interface ToolDefinition<I = any, H = any> {
  name: string;
  description: string;
  effect: Effect;
  /** Statechart states where it's offered; omitted means every state. */
  states?: readonly string[];
  input: StandardSchemaV1<unknown, I>;
  /** JSON Schema for providers, when `input` isn't the built-in `s` (which carries its own). */
  jsonSchema?: JsonSchema;
  /** Needs the shopper's explicit yes in state first (checked by the `confirmation` guard). */
  confirm?: (state: Readonly<ConversationState>, input: I) => string | null;
  run(ctx: ToolContext<H>, input: I): Promise<ToolResult> | ToolResult;
}

const NAME = /^[a-z][a-z0-9_]{0,62}$/;

export function defineTool<I, H = any>(def: ToolDefinition<I, H>): ToolDefinition<I, H> {
  if (!NAME.test(def.name)) throw new Error(`tool name must match ${NAME}: ${def.name}`);
  if (def.description.length > 1024) throw new Error(`tool ${def.name}: description too long`);
  return Object.freeze({ ...def });
}
