import type { ConversationState } from '../engine/state.ts';
import { withoutRefs } from './render.ts';

export interface VerifierOptions {
  /** Literal amounts (R$ 10, 10,00, 10 reais). Default on. */
  money?: boolean;
  /** Clock times and durations (19h30, 20:00, 40 min). Default on. */
  times?: boolean;
  /** Names that may only appear through a reference (catalog items). */
  products?: (s: Readonly<ConversationState>) => readonly string[];
  /** Phrases that commit the store to something only Core can promise. */
  promises?: readonly RegExp[];
  /** Literal spans that are fine anyway ("2 pizzas", the store's own phone). */
  allow?: readonly RegExp[];
}

export interface Finding {
  kind: 'money' | 'time' | 'product' | 'promise';
  match: string;
}

const MONEY = [
  /R\$\s*\d/gi,
  /\b\d{1,6}[.,]\d{2}\b/g,
  /\b\d+\s*(?:reais|real|centavos)\b/gi,
  /\d+\s*%/g,
];
const TIMES = [
  /\b\d{1,2}\s*(?::|h)\s*\d{2}\b/gi,
  /\b\d{1,2}\s*h(?:oras?)?\b/gi,
  /\b\d+\s*(?:min|minutos?|horas?|hrs?)\b/gi,
];
export const DEFAULT_PROMISES: readonly RegExp[] = [
  /\bgaranto\b/i,
  /\bprometo\b/i,
  /\bsem falta\b/i,
  /\bcom certeza (?:chega|fica|sai)\b/i,
  /\bnunca atras/i,
  /\breembols(?:o|amos|ar)\b/i,
];

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Every figure, time, product or promise the model typed instead of citing. */
export function verify(
  raw: string,
  state: Readonly<ConversationState>,
  opts: VerifierOptions = {},
): Finding[] {
  let text = withoutRefs(raw);
  for (const a of opts.allow ?? [])
    text = text.replace(new RegExp(a.source, a.flags.includes('g') ? a.flags : a.flags + 'g'), ' ');
  const out: Finding[] = [];
  const scan = (kind: Finding['kind'], patterns: readonly RegExp[]) => {
    for (const p of patterns) {
      const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
      for (const m of text.matchAll(re)) out.push({ kind, match: m[0] });
    }
  };
  if (opts.money !== false) scan('money', MONEY);
  if (opts.times !== false) scan('time', TIMES);
  scan('promise', opts.promises ?? DEFAULT_PROMISES);
  if (opts.products) {
    const hay = ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
    for (const name of opts.products(state)) {
      const needle = fold(name)
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
      if (needle.length >= 3 && hay.includes(` ${needle} `))
        out.push({ kind: 'product', match: name });
    }
  }
  return out;
}

export function describeFindings(findings: readonly Finding[]): string {
  const by: Record<Finding['kind'], string> = {
    money: 'valores',
    time: 'horários ou prazos',
    product: 'nomes de produto',
    promise: 'promessas',
  };
  const kinds = [...new Set(findings.map((f) => f.kind))].map((k) => by[k]);
  const sample = findings
    .slice(0, 3)
    .map((f) => `"${f.match}"`)
    .join(', ');
  return `Não escreva ${kinds.join(', ')} por conta própria (${sample}). Cite o valor do registro com {{id}} ou chame a ferramenta que o calcula.`;
}
