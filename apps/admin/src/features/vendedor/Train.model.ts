import type { AgentTone, Coverage, MenuGap, VendedorOnboarding } from '../../lib/api.ts';
import { greeting } from '../../lib/format.ts';
import type { AgentPart } from '../../ui/vendedor/index.ts';

// "Treinar o Duá" (sales-agent-ux §3.12): the screens of the four parts, in order. Where the
// owner stopped is Core's (`progress.step`), so another device resumes on the same screen.

export type StepId =
  'nome' | 'whatsapp' | 'li' | 'entrevista' | 'passar' | 'peca' | 'oculto' | 'quando' | 'pronto';

export const ORDER: StepId[] = [
  'nome',
  'whatsapp',
  'li',
  'entrevista',
  'passar',
  'peca',
  'oculto',
  'quando',
  'pronto',
];

export const PART_OF: Record<StepId, AgentPart> = {
  nome: 'conhecer',
  whatsapp: 'conhecer',
  li: 'ensinar',
  entrevista: 'ensinar',
  passar: 'ensinar',
  peca: 'testar',
  oculto: 'testar',
  quando: 'comecar',
  pronto: 'comecar',
};

export const isStep = (s: unknown): s is StepId => ORDER.includes(s as StepId);

/** the interview's length, as the interviewer is told (5 to 8 questions) */
export const INTERVIEW_MAX = 8;

/** where the journey bar stands on each screen, and what it says */
export function journeyAt(step: StepId, question: number): { progress: number; status: string } {
  switch (step) {
    case 'nome':
      return { progress: 0.25, status: '1 de 2' };
    case 'whatsapp':
      return { progress: 0.75, status: '2 de 2' };
    case 'li':
      return { progress: 0.08, status: 'o que eu li' };
    case 'entrevista':
      return {
        progress: 0.15 + 0.6 * Math.min(1, question / INTERVIEW_MAX),
        status: question ? `pergunta ${question}` : 'a entrevista',
      };
    case 'passar':
      return { progress: 0.9, status: 'quando passar para você' };
    case 'peca':
      return { progress: 0.25, status: '1 de 2' };
    case 'oculto':
      return { progress: 0.75, status: '2 de 2' };
    case 'quando':
      return { progress: 0.5, status: 'quando ele atende' };
    case 'pronto':
      return { progress: 1, status: 'pronto!' };
  }
}

export interface Persona {
  disclose: boolean;
  tone: AgentTone;
}

/** How Duá greets a shopper who asks "vocês entregam?", in the tone chosen. A preview only:
 *  the real words are his, built from the same settings (Core's `intro`). */
export function greetingPreview(p: Persona, store: string, delivers: boolean): string {
  const who = `o Duá${p.disclose ? `, assistente virtual da ${store}` : `, da ${store}`}`;
  const hello = greeting();
  if (p.tone === 'relaxed')
    return `Oi! Aqui é ${who}. ${delivers ? 'Entregamos sim! Me fala o seu bairro?' : 'Por enquanto é só retirada aqui na loja, tá?'}`;
  if (p.tone === 'formal')
    return `${hello}! Eu sou ${who}. ${delivers ? 'Sim, fazemos entregas. Poderia me informar o seu bairro?' : 'No momento trabalhamos apenas com retirada na loja.'}`;
  return `Oi, ${hello.toLowerCase()}! Sou ${who}. ${delivers ? 'Entregamos sim. Qual é o seu bairro?' : 'Por enquanto só retirada na loja.'}`;
}

/** The interviewer's last question, and whether "sim" / "não" answer it. */
export function questionOf(text: string | null | undefined): { text: string; yesNo: boolean } {
  const t = (text ?? '').trim();
  const asks = t.match(/[^.!?\n]*\?/g);
  const q = asks?.at(-1)?.trim() ?? '';
  const open =
    /^(e\s+)?(o que|que|qual|quais|quanto|quantos|quantas|como|quando|onde|aonde|por ?que|quem|pra quem|para quem)\b/i;
  return { text: t, yesNo: !!q && !open.test(q) };
}

/** the interview so far: his questions, whether his reply is still on its way */
export function interviewState(ob: VendedorOnboarding) {
  const msgs = ob.interview.messages.filter((m) => m.author === 'agent' || m.author === 'shopper');
  const last = msgs.at(-1) ?? null;
  const asked = msgs.filter((m) => m.author === 'agent' && (m.body ?? '').includes('?')).length;
  const lastAgent = [...msgs].reverse().find((m) => m.author === 'agent') ?? null;
  return {
    msgs,
    started: msgs.length > 0,
    waiting: last?.author === 'shopper',
    waitingSince: last?.author === 'shopper' ? last.at : null,
    asked,
    current: lastAgent?.body ?? null,
    currentId: lastAgent?.id ?? 'inicio',
    done: !!ob.progress.interviewDone,
  };
}

/** a gap the owner left as it is, kept in `progress.skipped` (Core caps ids at 40 chars) */
const GAP_CODE: Record<MenuGap['kind'], string> = {
  size_unstated: 's',
  unpriced_option: 'u',
  no_allergen_info: 'a',
  duplicate_name: 'd',
  empty_combo_slot: 'c',
};
export const gapKey = (g: MenuGap) =>
  `g${GAP_CODE[g.kind]}:${(g.productId ?? g.categoryId ?? g.title).slice(0, 36)}`;

/** Core keeps up to 20 skipped ids: the steps first, then the newest gaps */
export function withSkipped(skipped: string[], add: string[], remove: string[] = []) {
  const all = [...new Set([...skipped.filter((s) => !remove.includes(s)), ...add])];
  const steps = all.filter((s) => !s.startsWith('g'));
  const gaps = all.filter((s) => s.startsWith('g'));
  return [...steps, ...gaps.slice(-(20 - steps.length))];
}

export const COVERAGE: {
  id: Coverage;
  title: string;
  detail: string;
}[] = [
  {
    id: 'when_slow',
    title: 'Quando eu demorar',
    detail: 'Ele responde se você não responder a tempo, e com a loja fechada.',
  },
  {
    id: 'after_hours',
    title: 'Fora do horário',
    detail: 'Só com a loja fechada; agenda pedidos para quando abrir.',
  },
  {
    id: 'always',
    title: 'Sempre',
    detail: 'Responde tudo na hora; você assume quando quiser.',
  },
  {
    id: 'rehearsal',
    title: 'Ensaio',
    detail: 'Ele escreve o que diria, mas não manda nada.',
  },
];

export const coverageShort = (c: Coverage, slow: number) =>
  c === 'when_slow'
    ? `quando você demorar · ${slow} min`
    : c === 'after_hours'
      ? 'fora do horário'
      : c === 'always'
        ? 'sempre'
        : 'em ensaio';
