import {
  block,
  defineGuard,
  pass,
  type InputGuard,
  type OutputGuard,
  type ToolGuard,
} from '../define/guard.ts';
import { describeFindings, verify, type VerifierOptions } from '../ledger/verifier.ts';

/** Shopper text enters as data the base rules say never to obey. */
export const markUntrusted: InputGuard = defineGuard({
  id: 'mark_untrusted',
  stage: 'input',
  run: (parts) =>
    parts.map((p) =>
      p.type === 'text'
        ? {
            ...p,
            text: `<mensagem_do_cliente>\n${p.text.replaceAll('</mensagem_do_cliente>', '')}\n</mensagem_do_cliente>`,
          }
        : p,
    ),
});

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL = /\bhttps?:\/\/\S+/gi;

/** Links and e-mail addresses a shopper pastes never reach a provider or a tool argument. */
export const redactContacts: InputGuard = defineGuard({
  id: 'redact_contacts',
  stage: 'input',
  run: (parts) =>
    parts.map((p) =>
      p.type === 'text'
        ? { ...p, text: p.text.replace(EMAIL, '[e-mail]').replace(URL, '[link]') }
        : p,
    ),
});

/** The statechart is the gate: a tool the state doesn't offer is refused with the ones it does. */
export const stateGate: ToolGuard = defineGuard({
  id: 'state_gate',
  stage: 'tool',
  run: (call, ctx) => {
    if (!ctx.tool) return block('unknown_tool', `A ferramenta ${call.name} não existe.`);
    if (ctx.allowed.has(call.name)) return pass;
    return block(
      'state',
      `${call.name} não está disponível em "${ctx.state.chart.state}". Disponíveis: ${[...ctx.allowed].join(', ')}.`,
    );
  },
});

/** A tool that declares `confirm` runs only once the state holds the shopper's yes. */
export const confirmation: ToolGuard = defineGuard({
  id: 'confirmation',
  stage: 'tool',
  run: (_call, ctx) => {
    const reason = ctx.tool?.confirm?.(ctx.state, ctx.input);
    return reason ? block('confirmation', reason) : pass;
  },
});

/** At most `max` calls of one tool per turn: a loop breaker, not a budget. */
export function callLimit(max: number): ToolGuard {
  return defineGuard({
    id: `call_limit_${max}`,
    stage: 'tool',
    run: (call, ctx) => {
      const turn = ctx.state.openTurn?.id;
      let n = 0;
      for (const t of ctx.state.transcript)
        if (t.turnId === turn && t.message.role === 'assistant')
          n += t.message.toolCalls.filter((c) => c.name === call.name).length;
      // the call being checked is already in the transcript
      return n > max
        ? block(
            'call_limit',
            `${call.name} já foi chamada ${max} vezes neste turno. Responda com o que tem.`,
          )
        : pass;
    },
  });
}

/** The verifier: amounts, times, products and promises come only through references. */
export function grounded(opts: VerifierOptions = {}): OutputGuard {
  return defineGuard({
    id: 'grounded',
    stage: 'output',
    run: (_rendered, ctx) => {
      const findings = verify(ctx.raw, ctx.state, opts);
      return findings.length
        ? block(`ungrounded:${findings.map((f) => f.kind).join(',')}`, describeFindings(findings))
        : pass;
    },
  });
}

const HUMAN_CLAIM = [
  /\bsou (?:uma )?(?:pessoa|humano|humana|gente de verdade)\b/i,
  /\bn[aã]o sou (?:um |uma )?(?:rob[oô]|bot|ia|intelig[eê]ncia artificial|assistente virtual)\b/i,
  /\b(?:sou|aqui é) (?:o|a) (?:dono|dona|atendente|gerente)\b/i,
];

/** It never claims to be a person (ADR 0031 decision 10). */
export const noHumanClaim: OutputGuard = defineGuard({
  id: 'no_human_claim',
  stage: 'output',
  run: (rendered) =>
    HUMAN_CLAIM.some((re) => re.test(rendered))
      ? block('human_claim', 'Você é um assistente virtual da loja. Nunca diga que é uma pessoa.')
      : pass,
});

export interface StyleOpts {
  maxChars?: number;
  /** WhatsApp shows `**` and `#` literally. */
  noMarkdown?: boolean;
  maxQuestions?: number;
}

export function style(opts: StyleOpts = {}): OutputGuard {
  const maxChars = opts.maxChars ?? 700;
  return defineGuard({
    id: 'style',
    stage: 'output',
    run: (rendered) => {
      if (rendered.trim().length === 0) return block('empty', 'A resposta está vazia.');
      if (rendered.length > maxChars)
        return block(
          'too_long',
          `Resposta longa demais (${rendered.length} caracteres; máximo ${maxChars}). Seja breve.`,
        );
      if (opts.noMarkdown !== false && /\*\*|^#{1,6}\s|\[[^\]]+\]\(/m.test(rendered))
        return block(
          'markdown',
          'Sem markdown: o WhatsApp mostra os símbolos. Use *negrito* simples se precisar.',
        );
      if (
        opts.maxQuestions !== undefined &&
        (rendered.match(/\?/g) ?? []).length > opts.maxQuestions
      )
        return block('questions', `Faça no máximo ${opts.maxQuestions} pergunta(s) por mensagem.`);
      return pass;
    },
  });
}

export interface SupervisorOpts {
  id?: string;
  rubric: string;
  /** Only high-stakes replies (an incentive, a complaint, a refusal). */
  when: (rendered: string) => boolean;
}

/**
 * A second, cheap model checks a high-stakes reply against a short rubric. It can only pass
 * or block; its blocks feed the eval suite.
 */
export function supervisor(opts: SupervisorOpts): OutputGuard {
  return defineGuard({
    id: opts.id ?? 'supervisor',
    stage: 'output',
    when: (rendered) => opts.when(rendered),
    run: async (rendered, ctx) => {
      const out = await ctx.gateway.generate({
        tier: 'fast',
        system: [
          {
            id: 'supervisor',
            tier: 'static',
            cache: true,
            text: `Você revisa uma resposta de um vendedor virtual antes do envio.\nRegras:\n${opts.rubric}\nResponda só "OK" ou "BLOQUEAR: <motivo curto>".`,
          },
        ],
        messages: [
          { role: 'user', parts: [{ type: 'text', text: `<resposta>\n${rendered}\n</resposta>` }] },
        ],
        volatile: null,
        tools: [],
        maxTokens: 120,
        temperature: 0,
        meta: { ...ctx.meta, lane: 'interactive' },
      });
      const verdict = out.text.trim();
      if (/^bloquear/i.test(verdict))
        return block(
          'supervisor',
          verdict.replace(/^bloquear:?\s*/i, '') || 'Reescreva seguindo as regras.',
        );
      return pass;
    },
  });
}
