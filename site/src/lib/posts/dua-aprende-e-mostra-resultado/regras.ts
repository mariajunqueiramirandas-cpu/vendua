import { brl } from './money';

// A copy of Core's rule compiler (packages/core/src/vendedor/knowledge.ts: compileRule,
// describeGuard, fold, parseMoney), so the post tags a rule exactly as the admin's preview does.
// Keep the two in step.

export type CompiledGuard =
  | { kind: 'handoff_qty'; min: number; term: string | null }
  | { kind: 'handoff_above'; cents: number }
  | { kind: 'cash_max'; cents: number }
  | { kind: 'coupon_min'; cents: number }
  | { kind: 'pix_only_above'; cents: number };

export type GuardKind = CompiledGuard['kind'];

export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function parseMoney(s: string): number | null {
  const m =
    /r\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/i.exec(s) ??
    /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(?:reais|real|conto)/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]!.replace(/\./g, ''));
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const cents = whole * 100 + frac;
  return Number.isFinite(cents) && cents > 0 && cents <= 100_000_000 ? cents : null;
}

const HANDOFF =
  /\b(passe|passa|transfira|transfere|chame|chama|me chame|me chama|me avise|me avisa|fale comigo|me passe|me passa|deixa comigo|comigo)\b/;

export function compileRule(text: string): CompiledGuard | null {
  const f = fold(text);
  const money = parseMoney(f);
  if (
    /\bdinheiro\b/.test(f) &&
    money &&
    /\b(acima|mais de|maior|passar de|so ate|ate)\b/.test(f) &&
    /\b(nao|so ate|ate|maximo)\b/.test(f)
  )
    return { kind: 'cash_max', cents: money };
  if (
    /\bcupo(m|ns)\b|\bdesconto\b/.test(f) &&
    money &&
    /\b(abaixo|menos de|menor)\b/.test(f) &&
    /\bnao\b/.test(f)
  )
    return { kind: 'coupon_min', cents: money };
  if (
    /\bso (pix|no pix)\b|\bapenas pix\b|\bsomente pix\b/.test(f) &&
    money &&
    /\b(acima|mais de|maior)\b/.test(f)
  )
    return { kind: 'pix_only_above', cents: money };
  if (HANDOFF.test(f)) {
    if (money && /\b(acima|mais de|maior|passar de)\b/.test(f))
      return { kind: 'handoff_above', cents: money };
    const q =
      /\bmais de (\d{1,4})\s+([a-z ]{2,40}?)(?:[,:;.]|\bpasse|\bpassa|\bme |\bchame|$)/.exec(f);
    if (q) {
      const term = q[2]!
        .trim()
        .replace(/\b(unidades?|itens?|pedidos?)\b/g, '')
        .trim();
      return {
        kind: 'handoff_qty',
        min: Number(q[1]) + 1,
        term: term.length >= 3 ? term.replace(/s$/, '') : null,
      };
    }
  }
  return null;
}

export function describeGuard(g: CompiledGuard): string {
  switch (g.kind) {
    case 'handoff_qty':
      return `Pedidos com ${g.min} ou mais ${g.term ?? 'itens iguais'} passam para você.`;
    case 'handoff_above':
      return `Pedidos acima de ${brl(g.cents)} passam para você.`;
    case 'cash_max':
      return `Dinheiro só em pedidos até ${brl(g.cents)}; acima disso, o cliente escolhe outra forma de pagamento.`;
    case 'coupon_min':
      return `Nenhum cupom em pedidos abaixo de ${brl(g.cents)}.`;
    case 'pix_only_above':
      return `Acima de ${brl(g.cents)}, só Pix.`;
  }
}

/** The five kinds Core knows how to enforce, in the owner's words. */
export const KINDS: { kind: GuardKind; label: string }[] = [
  { kind: 'cash_max', label: 'um limite para pagar em dinheiro' },
  { kind: 'pix_only_above', label: 'só Pix acima de um valor' },
  { kind: 'coupon_min', label: 'nenhum cupom abaixo de um valor' },
  { kind: 'handoff_above', label: 'passar para você acima de um valor' },
  { kind: 'handoff_qty', label: 'passar para você acima de uma quantidade' },
];
