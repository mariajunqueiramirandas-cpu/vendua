import { canonical, type Agent } from '../define/agent.ts';
import { applyEvent, initialState, type ConversationState } from '../engine/state.ts';
import { describeFindings, verify, type VerifierOptions } from '../ledger/verifier.ts';
import type { ModelGateway } from '../model/types.ts';
import type {
  AgentEvent,
  Json,
  JsonObject,
  ModelRequest,
  OutboundMessage,
  Usage,
} from '../types.ts';
import type { Exchange } from './persona.ts';

export type OutboxRow = OutboundMessage & { id: string; transport: string };

/** Everything a finished run left behind, for assertions to read. */
export interface AssertionCtx {
  scenario: string;
  agent: Agent;
  tenantId: string;
  log: readonly AgentEvent[];
  /** The fold of `log` under `agent`. */
  state: Readonly<ConversationState>;
  transcript: readonly Exchange[];
  outbox: readonly OutboxRow[];
  /** The in-memory host's tables after the run. */
  kv: ReadonlyMap<string, Json>;
  /** The persona's hidden goal. */
  goal: Json;
  judge: ModelGateway | null;
}

export interface AssertionResult {
  ok: boolean;
  detail?: string;
}

export interface Assertion {
  name: string;
  check(ctx: AssertionCtx): AssertionResult | Promise<AssertionResult>;
}

function obj(p: Json): JsonObject {
  return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}

const ok: AssertionResult = { ok: true };
const fail = (detail: string): AssertionResult => ({ ok: false, detail });

/** Folds a log the way the runtime does, the agent's custom fold included. */
export function foldLog(agent: Agent, log: readonly AgentEvent[]): ConversationState {
  const s = initialState(agent.chart.initial, agent.def.fold?.initial ?? null);
  for (const e of log) {
    applyEvent(s, e);
    if (agent.def.fold) s.custom = agent.def.fold.apply(s.custom, e, s);
  }
  return s;
}

function isMaintenance(e: AgentEvent): boolean {
  return e.type === 'turn.started' && typeof obj(e.payload).maintenance === 'string';
}

/** Conversational turns, not compaction or consolidation. */
export function turnCount(log: readonly AgentEvent[]): number {
  return log.filter((e) => e.type === 'turn.started' && !isMaintenance(e)).length;
}

/** Every sent message passes the verifier on what the model wrote: no typed figures got out. */
export function noLiteralFigures(opts?: VerifierOptions): Assertion {
  return {
    name: 'noLiteralFigures',
    check: (ctx) => {
      const vopts = opts ?? ctx.agent.def.verifier ?? {};
      const s = initialState(ctx.agent.chart.initial, ctx.agent.def.fold?.initial ?? null);
      const bad: string[] = [];
      for (const e of ctx.log) {
        if (e.type === 'message.sent') {
          const raw = obj(e.payload).raw;
          if (typeof raw === 'string') {
            const findings = verify(raw, s, vopts);
            if (findings.length) bad.push(`#${e.seq}: ${describeFindings(findings)}`);
          }
        }
        applyEvent(s, e);
      }
      return bad.length ? fail(bad.join('; ')) : ok;
    },
  };
}

export function turnsAtMost(n: number): Assertion {
  return {
    name: `turnsAtMost(${n})`,
    check: (ctx) => {
      const t = turnCount(ctx.log);
      return t <= n ? ok : fail(`${t} turns`);
    },
  };
}

export function noHandoff(): Assertion {
  return {
    name: 'noHandoff',
    check: (ctx) => {
      const h = ctx.log.find((e) => e.type === 'handoff.started');
      return h ? fail(`handed off at #${h.seq}: ${String(obj(h.payload).reason ?? '')}`) : ok;
    },
  };
}

export function handedOff(): Assertion {
  return {
    name: 'handedOff',
    check: (ctx) =>
      ctx.log.some((e) => e.type === 'handoff.started') ? ok : fail('never handed off'),
  };
}

/** Some message the shopper received matches. */
export function sentMatches(re: RegExp): Assertion {
  return {
    name: `sentMatches(${re})`,
    check: (ctx) => {
      const texts = ctx.log
        .filter((e) => e.type === 'message.sent')
        .map((e) => String(obj(e.payload).text ?? ''));
      return texts.some((t) => new RegExp(re.source, re.flags.replace('g', '')).test(t))
        ? ok
        : fail(`no sent message matches; sent ${texts.length}`);
    },
  };
}

/** A successful call of `name`, optionally with arguments or data that satisfy `pred`. */
export function toolCalled(
  name: string,
  pred?: (args: Json, returned: JsonObject) => boolean,
): Assertion {
  return {
    name: `toolCalled(${name})`,
    check: (ctx) => {
      const calls = ctx.log
        .filter((e) => e.type === 'tool.returned')
        .map((e) => obj(e.payload))
        .filter((p) => p.name === name);
      if (!calls.length) return fail('never called');
      const good = calls.filter((p) => p.ok !== false);
      if (!good.length) return fail(`${calls.length} calls, all failed`);
      if (pred && !good.some((p) => pred(p.args ?? null, p)))
        return fail(`${good.length} calls, none matched`);
      return ok;
    },
  };
}

export function stateReached(name: string): Assertion {
  return {
    name: `stateReached(${name})`,
    check: (ctx) =>
      ctx.agent.chart.initial === name ||
      ctx.log.some((e) => e.type === 'state.changed' && obj(e.payload).to === name)
        ? ok
        : fail(`ended in ${ctx.state.chart.state}`),
  };
}

export function noFailedTurns(): Assertion {
  return {
    name: 'noFailedTurns',
    check: (ctx) => {
      const f = ctx.log.filter((e) => e.type === 'turn.failed');
      return f.length ? fail(f.map((e) => String(obj(e.payload).error ?? e.type)).join('; ')) : ok;
    },
  };
}

/** The host's table after the run, compared as canonical JSON. */
export function kvEquals(key: string, value: Json): Assertion {
  return {
    name: `kvEquals(${key})`,
    check: (ctx) => {
      const got = ctx.kv.get(key);
      return canonical(got ?? null) === canonical(value)
        ? ok
        : fail(`got ${got === undefined ? 'nothing' : canonical(got)}`);
    },
  };
}

// ── LLM as judge ─────────────────────────────────────────────────────────────

export interface JudgeVerdict {
  pass: boolean;
  /** 0..1 */
  score: number;
  reason: string;
  usage: Usage | null;
}

const JUDGE_SYSTEM = [
  'Você avalia conversas de atendimento de uma loja pelo WhatsApp.',
  'Leia a rubrica e a conversa e responda só com um objeto JSON:',
  '{"pass": true|false, "score": número de 0 a 1, "reason": "uma frase"}.',
].join('\n');

export function transcriptText(transcript: readonly Exchange[]): string {
  return transcript.map((x) => `${x.role === 'user' ? 'cliente' : 'loja'}: ${x.text}`).join('\n');
}

/** Pulls the verdict out of the judge's text; null when there's no usable JSON object. */
export function parseVerdict(text: string): Omit<JudgeVerdict, 'usage'> | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let v: unknown;
  try {
    v = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const score =
    typeof o.score === 'number' && Number.isFinite(o.score)
      ? Math.min(1, Math.max(0, o.score))
      : null;
  const pass = typeof o.pass === 'boolean' ? o.pass : score !== null ? score >= 0.5 : null;
  if (pass === null) return null;
  return {
    pass,
    score: score ?? (pass ? 1 : 0),
    reason: typeof o.reason === 'string' ? o.reason.slice(0, 500) : '',
  };
}

export async function runJudge(
  gateway: ModelGateway,
  input: { rubric: string; transcript: string; goal?: Json; tenantId?: string; id?: string },
): Promise<JudgeVerdict> {
  const goal =
    input.goal === undefined || input.goal === null
      ? ''
      : `Objetivo do cliente: ${typeof input.goal === 'string' ? input.goal : canonical(input.goal)}\n\n`;
  const req: ModelRequest = {
    tier: 'strong',
    system: [
      { id: 'judge', tier: 'static', text: JUDGE_SYSTEM, cache: true },
      { id: 'rubric', tier: 'tenant', text: `RUBRICA:\n${input.rubric}`, cache: false },
    ],
    messages: [
      { role: 'user', parts: [{ type: 'text', text: `${goal}CONVERSA:\n${input.transcript}` }] },
    ],
    volatile: null,
    tools: [],
    maxTokens: 400,
    temperature: 0,
    meta: {
      tenantId: input.tenantId ?? 'eval',
      agentId: 'judge',
      actorId: input.id ?? 'judge',
      turnId: 'judge',
      lane: 'background',
    },
  };
  const res = await gateway.generate(req);
  const v = parseVerdict(res.text);
  if (!v) return { pass: false, score: 0, reason: 'unparseable judge output', usage: res.usage };
  return { ...v, usage: res.usage };
}

/** LLM-as-judge on the transcript, through `opts.gateway` or the run's judge gateway. */
export function judge(
  rubric: string,
  opts: { gateway?: ModelGateway; minScore?: number } = {},
): Assertion {
  return {
    name: `judge(${rubric.length > 40 ? rubric.slice(0, 40) + '…' : rubric})`,
    check: async (ctx) => {
      const gw = opts.gateway ?? ctx.judge;
      if (!gw) return fail('no judge gateway');
      const v = await runJudge(gw, {
        rubric,
        transcript: transcriptText(ctx.transcript),
        goal: ctx.goal,
        tenantId: ctx.tenantId,
        id: ctx.scenario,
      });
      const passed = v.pass && (opts.minScore === undefined || v.score >= opts.minScore);
      return passed ? { ok: true, detail: v.reason } : fail(`${v.score}: ${v.reason}`);
    },
  };
}
