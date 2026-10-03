import { createHash } from 'node:crypto';
import { defineAgent, type Agent, type LoadCtx } from '../define/agent.ts';
import { defineTool, type ToolContext } from '../define/tool.ts';
import type { ConversationState } from '../engine/state.ts';
import { s } from '../schema.ts';
import type { DispatchInput, Json, Tier } from '../types.ts';

/** QA actors are about another actor: one per scored conversation. */
export const QA_SUBJECT = 'agent_actor';
export const QA_KIND = 'runtime.qa_sample';

export interface OnlineQaOpts<H> {
  /** Default `online_qa`. */
  id?: string;
  rubric: string;
  /** Share of finished conversations scored, 0..1. */
  sampleRate: number;
  /** Alert when the rolling mean drops below this. */
  alertBelow: number;
  /** Scores in the rolling mean. */
  window: number;
  /**
   * The scored conversation as the judge reads it, read by the host from the target actor's
   * log (`ctx.subject.id`). Recorded in the QA actor's log like any `load.subject`.
   */
  transcript: (ctx: LoadCtx<H>) => Promise<Json>;
  /** Persists the score in the step's transaction; the host feeds its `RollingScore` here. */
  onScore: (ctx: ToolContext<H>, score: number, reason: string) => Promise<void> | void;
  tier?: Tier;
  /** Default `none`: the host registers a no-op transport with this id, since QA never replies. */
  transport?: string;
}

export interface OnlineQaAgent<H> extends Agent<H> {
  readonly qa: {
    sampleRate: number;
    alertBelow: number;
    window: number;
    shouldSample(actorId: string): boolean;
    /** The mailbox row that asks for a score of `target`, deduped per target turn. */
    sample(target: { tenantId: string; actorId: string; turnId: string }): DispatchInput;
  };
}

/** Deterministic by actor: a conversation is either in the sample or not, on every turn. */
export function shouldSample(actorId: string, rate: number): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const h = createHash('sha256').update(`qa:${actorId}`).digest();
  return h.readUInt32BE(0) / 0x1_0000_0000 < rate;
}

function scoredThisTurn(st: Readonly<ConversationState>): boolean {
  return st.transcript.some(
    (t) =>
      t.turnId === st.openTurn?.id &&
      t.message.role === 'tool' &&
      t.message.name === 'record_score' &&
      !t.message.isError,
  );
}

/**
 * A background agent that scores a sampled conversation against a rubric and reports it through
 * `onScore`. The host samples finished turns (`hooks.turnEnded` + `qa.shouldSample`) and
 * dispatches `qa.sample(target)`; it registers a no-op transport `none`.
 */
export function defineOnlineQa<H = any>(o: OnlineQaOpts<H>): OnlineQaAgent<H> {
  if (!(o.sampleRate >= 0 && o.sampleRate <= 1)) throw new Error('sampleRate must be in 0..1');
  if (!Number.isInteger(o.window) || o.window < 1) throw new Error('window must be ≥ 1');
  const id = o.id ?? 'online_qa';
  const recordScore = defineTool<{ score: number; reason: string }, H>({
    name: 'record_score',
    description: 'Registra a nota da conversa (0 a 1) e o motivo em uma frase.',
    effect: 'write',
    input: s.object({
      score: s.number({ min: 0, max: 1 }),
      reason: s.string({ min: 1, max: 500 }),
    }),
    run: async (ctx, input) => {
      await o.onScore(ctx, input.score, input.reason);
      return { content: 'Registrado.', data: { score: input.score } };
    },
  });
  const agent = defineAgent<H>({
    id,
    subject: QA_SUBJECT,
    lane: 'background',
    transport: o.transport ?? 'none',
    models: { default: o.tier ?? 'fast', maxTokens: 600, temperature: 0 },
    instructions: [
      {
        id: 'qa',
        tier: 'static',
        priority: 100,
        text: [
          'Você é o avaliador de qualidade do atendimento de uma loja pelo WhatsApp.',
          'Avalie a conversa abaixo segundo a rubrica. Chame record_score uma vez, com a nota de 0 a 1 e o motivo em uma frase.',
          'Não escreva mensagens ao cliente; a conversa já terminou.',
        ].join('\n'),
      },
      { id: 'rubric', tier: 'static', priority: 100, text: `RUBRICA:\n${o.rubric}` },
      {
        id: 'conversation',
        tier: 'subject',
        priority: 90,
        text: (ctx) =>
          `CONVERSA AVALIADA:\n${typeof ctx.subject === 'string' ? ctx.subject : JSON.stringify(ctx.subject)}`,
      },
    ],
    tools: [recordScore],
    mailbox: { inputKinds: [QA_KIND] },
    budgets: { stepsPerTurn: 3 },
    finish: scoredThisTurn,
    toInput: () => ({
      role: 'user',
      parts: [{ type: 'text', text: 'Avalie a conversa e registre a nota.' }],
    }),
    load: { subject: o.transcript },
    compaction: false,
    maxAttempts: 2,
  });
  return Object.freeze({
    ...agent,
    qa: {
      sampleRate: o.sampleRate,
      alertBelow: o.alertBelow,
      window: o.window,
      shouldSample: (actorId: string) => shouldSample(actorId, o.sampleRate),
      sample: (t: { tenantId: string; actorId: string; turnId: string }): DispatchInput => ({
        actor: { tenantId: t.tenantId, agentId: id, subject: { kind: QA_SUBJECT, id: t.actorId } },
        kind: QA_KIND,
        source: `agent:${t.turnId}`,
        dedupeKey: `qa:${t.actorId}:${t.turnId}`,
      }),
    },
  });
}

/** Mean of the last `window` scores; alerts once the window is full and the mean drops. */
export class RollingScore {
  private readonly scores: number[] = [];

  constructor(
    readonly window: number,
    readonly alertBelow: number,
  ) {
    if (!Number.isInteger(window) || window < 1) throw new Error('window must be ≥ 1');
  }

  static of(scores: readonly number[], window: number, alertBelow: number): RollingScore {
    const r = new RollingScore(window, alertBelow);
    for (const x of scores) r.push(x);
    return r;
  }

  push(score: number): { mean: number; alert: boolean } {
    this.scores.push(score);
    if (this.scores.length > this.window) this.scores.splice(0, this.scores.length - this.window);
    return { mean: this.mean, alert: this.alert };
  }

  get count(): number {
    return this.scores.length;
  }

  get mean(): number {
    return this.scores.length ? this.scores.reduce((a, b) => a + b, 0) / this.scores.length : 0;
  }

  get alert(): boolean {
    return this.scores.length >= this.window && this.mean < this.alertBelow;
  }
}
