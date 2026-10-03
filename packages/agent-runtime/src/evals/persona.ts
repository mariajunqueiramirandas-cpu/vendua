import type { ModelGateway } from '../model/types.ts';
import { canonical } from '../define/agent.ts';
import type { ChatMessage, Json, ModelRequest, Usage } from '../types.ts';

/** One line of a simulated conversation, as the shopper saw it. */
export interface Exchange {
  role: 'user' | 'agent';
  text: string;
}

export interface PersonaCtx {
  transcript: readonly Exchange[];
  /** User turns taken so far. */
  turn: number;
  /** The simulated user's own gateway; scripted personas ignore it. */
  gateway: ModelGateway | null;
  /** The user-model id this run is under, when the scenario lists several. */
  model: string | null;
  tenantId: string;
  scenario: string;
}

export interface PersonaTurn {
  /** What the user sends; empty with `done` ends the conversation without a last message. */
  text: string;
  done: boolean;
  usage?: Usage;
}

export interface Persona {
  readonly goal: Json;
  next(ctx: PersonaCtx): Promise<PersonaTurn>;
}

export interface PersonaOpts {
  goal: string | Json;
  /** How they write: `áudio, pressa`, `formal`, `erros de digitação`. */
  style?: string;
  /** A fixed first message, so every run starts the same. */
  opening?: string;
  /** What they know but only say when asked (an address, an allergy). */
  hidden?: string;
  maxTokens?: number;
  temperature?: number;
}

export const DONE_TOKEN = '[FIM]';

/** Strips the done token; anything left is still a message the user sends. */
export function parseTurn(raw: string): { text: string; done: boolean } {
  const done = raw.includes(DONE_TOKEN);
  return { text: raw.split(DONE_TOKEN).join('').trim(), done };
}

function goalText(goal: string | Json): string {
  return typeof goal === 'string' ? goal : canonical(goal);
}

export function personaSystem(o: PersonaOpts): string {
  return [
    'Você interpreta um cliente conversando pelo WhatsApp com o atendimento de uma loja.',
    'Você é o cliente, nunca o atendente. Nunca diga nem insinue que é uma simulação, um teste ou uma IA.',
    `Seu objetivo (secreto, não conte de uma vez): ${goalText(o.goal)}`,
    o.style
      ? `Seu jeito de escrever: ${o.style}.`
      : 'Escreva como um cliente comum: frases curtas, informais.',
    o.hidden ? `Você sabe, mas só diz se perguntarem: ${o.hidden}` : '',
    'Responda em uma ou duas frases curtas, uma mensagem por vez, em português do Brasil.',
    'Responda só ao que o atendente disse ou pediu; não invente preços nem itens que ele não ofereceu.',
    `Quando seu objetivo for cumprido, ou ficar claro que não vai ser, escreva ${DONE_TOKEN} no fim da mensagem (ou só ${DONE_TOKEN}).`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The conversation from the simulated user's side: the store speaks as `user`. */
export function personaMessages(transcript: readonly Exchange[]): ChatMessage[] {
  const out: ChatMessage[] = [
    {
      role: 'user',
      parts: [{ type: 'text', text: '[início] Escreva sua primeira mensagem para a loja.' }],
    },
  ];
  for (const x of transcript) {
    const last = out[out.length - 1]!;
    if (x.role === 'agent') {
      if (last.role === 'user') last.parts.push({ type: 'text', text: x.text });
      else out.push({ role: 'user', parts: [{ type: 'text', text: x.text }] });
    } else if (last.role === 'assistant') {
      last.text = `${last.text}\n${x.text}`;
    } else {
      out.push({ role: 'assistant', text: x.text, toolCalls: [] });
    }
  }
  if (out[out.length - 1]!.role === 'assistant')
    out.push({ role: 'user', parts: [{ type: 'text', text: '[a loja não respondeu]' }] });
  return out;
}

/** A simulated user that is itself a model call: a shopper with a hidden goal. */
export function persona(o: PersonaOpts): Persona {
  const system = personaSystem(o);
  return {
    goal: o.goal,
    async next(ctx) {
      if (ctx.turn === 0 && o.opening) return { text: o.opening, done: false };
      if (!ctx.gateway) throw new Error('persona needs a userGateway');
      const req: ModelRequest = {
        tier: 'fast',
        system: [{ id: 'persona', tier: 'static', text: system, cache: true }],
        messages: personaMessages(ctx.transcript),
        volatile: null,
        tools: [],
        maxTokens: o.maxTokens ?? 300,
        ...(o.temperature !== undefined ? { temperature: o.temperature } : {}),
        meta: {
          tenantId: ctx.tenantId,
          agentId: 'persona',
          actorId: `persona:${ctx.scenario}`.slice(0, 200),
          turnId: `persona:${ctx.turn}`,
          lane: 'interactive',
        },
      };
      const res = await ctx.gateway.generate(req);
      return { ...parseTurn(res.text), usage: res.usage };
    },
  };
}

/** Deterministic user for tests: one line per turn, done after the last (or at `[FIM]`). */
export function scriptedPersona(lines: readonly string[], goal: Json = null): Persona {
  return {
    goal,
    async next(ctx) {
      const line = lines[ctx.turn];
      if (line === undefined) return { text: '', done: true };
      const t = parseTurn(line);
      return { text: t.text, done: t.done || ctx.turn === lines.length - 1 };
    },
  };
}
