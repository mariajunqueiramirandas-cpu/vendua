import type { ConversationState } from '../engine/state.ts';
import type { ModelGateway } from '../model/types.ts';
import type { Part, ToolCall } from '../types.ts';
import type { ToolDefinition } from './tool.ts';

export type Verdict = { ok: true } | { ok: false; reason: string; feedback: string };

export const pass: Verdict = { ok: true };
export function block(reason: string, feedback: string): Verdict {
  return { ok: false, reason, feedback };
}

export interface InputGuardCtx {
  state: Readonly<ConversationState>;
  kind: string;
}

/** Rewrites inbound parts (fencing, redaction); it never blocks input. */
export interface InputGuard {
  id: string;
  stage: 'input';
  run(parts: Part[], ctx: InputGuardCtx): Part[];
}

export interface ToolGuardCtx {
  state: Readonly<ConversationState>;
  tool: ToolDefinition | undefined;
  allowed: ReadonlySet<string>;
  input: unknown;
}

export interface ToolGuard {
  id: string;
  stage: 'tool';
  run(call: ToolCall, ctx: ToolGuardCtx): Verdict | Promise<Verdict>;
}

export interface OutputGuardCtx {
  state: Readonly<ConversationState>;
  /** The model's text with `{{refs}}` intact. */
  raw: string;
  gateway: ModelGateway;
  meta: { tenantId: string; agentId: string; actorId: string; turnId: string };
}

/** Checks a reply after rendering. A block goes back to the model as feedback. */
export interface OutputGuard {
  id: string;
  stage: 'output';
  /** Only some replies need it (the supervisor's high-stakes ones). */
  when?: (rendered: string, ctx: OutputGuardCtx) => boolean;
  run(rendered: string, ctx: OutputGuardCtx): Verdict | Promise<Verdict>;
}

export type Guard = InputGuard | ToolGuard | OutputGuard;

export function defineGuard<G extends Guard>(g: G): G {
  return Object.freeze(g);
}
