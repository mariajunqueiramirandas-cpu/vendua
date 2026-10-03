import type { Sql } from '../platform/db.ts';
import { brl } from './cards.ts';

// The store's own knowledge (sales-agent.md §5, UX §3.5): answers the merchant wrote, rules,
// and the questions waiting for an answer. A rule the system recognizes is compiled into a guard
// Core enforces ("sempre cumprida"); any other rule is guidance the model follows and the
// screens say so.

export type CompiledGuard =
  /** more than `min - 1` of one item (or of anything matching `term`): hand the order over */
  | { kind: 'handoff_qty'; min: number; term: string | null }
  /** an order above this total: hand it over */
  | { kind: 'handoff_above'; cents: number }
  /** cash only up to this total */
  | { kind: 'cash_max'; cents: number }
  /** no incentive on an order below this subtotal */
  | { kind: 'coupon_min'; cents: number }
  /** above this total, Pix only */
  | { kind: 'pix_only_above'; cents: number };

export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "R$ 1.200,50", "200 reais", "r$200" → cents; null when there's no amount. */
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

/** The merchant's words → a guard Core enforces, or null for guidance. */
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

/** Plain words for the "sempre cumprida" preview: what the system will do. */
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

export interface LiveKnowledge {
  answers: { q: string; a: string }[];
  guidance: string[];
  guards: CompiledGuard[];
}

export async function liveRules(tx: Sql, tenantId: string): Promise<LiveKnowledge> {
  const rows = await tx<
    { kind: string; question: string | null; answer: string | null; guard: CompiledGuard | null }[]
  >`
    select kind, question, answer, guard from store_knowledge
    where tenant_id = ${tenantId} and status = 'live' and kind in ('answer', 'rule')
    order by used_count desc, created_at limit 200`;
  return {
    answers: rows
      .filter((r) => r.kind === 'answer' && r.question && r.answer)
      .slice(0, 80)
      .map((r) => ({ q: r.question!, a: r.answer! })),
    guidance: rows
      .filter((r) => r.kind === 'rule' && !r.guard && r.answer)
      .slice(0, 40)
      .map((r) => r.answer!),
    guards: rows.filter((r) => r.kind === 'rule' && r.guard).map((r) => r.guard!),
  };
}

const STOP = new Set([
  'a',
  'o',
  'as',
  'os',
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'em',
  'no',
  'na',
  'um',
  'uma',
  'voces',
  'vcs',
  'tem',
  'que',
  'para',
  'pra',
  'com',
  'se',
  'eu',
  'me',
  'é',
  'e',
  'ou',
  'qual',
  'quais',
  'como',
]);

export function tokens(s: string): string[] {
  return fold(s)
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.replace(/(oes|aes)$/, 'ao').replace(/s$/, ''));
}

export function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let n = 0;
  for (const t of ta) if (tb.has(t)) n++;
  return n / Math.min(ta.size, tb.size);
}

export async function findAnswers(tx: Sql, tenantId: string, question: string) {
  const rows = await tx<{ id: string; question: string; answer: string }[]>`
    select id, question, answer from store_knowledge
    where tenant_id = ${tenantId} and kind = 'answer' and status = 'live'
      and question is not null and answer is not null
    limit 300`;
  return rows
    .map((r) => ({ ...r, score: similarity(question, r.question) }))
    .filter((r) => r.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** A question only the store can answer: merged with a similar open one, counted. */
export async function queueQuestion(
  tx: Sql,
  tenantId: string,
  question: string,
  threadId: string | null,
): Promise<{ id: string; askedCount: number }> {
  const q = question.trim().slice(0, 500);
  const open = await tx<{ id: string; question: string }[]>`
    select id, question from store_knowledge
    where tenant_id = ${tenantId} and kind = 'question' and status = 'open'
    order by last_asked_at desc nulls last limit 200`;
  const same = open.find((r) => similarity(q, r.question) >= 0.75);
  if (same) {
    const [r] = await tx<{ id: string; asked_count: number }[]>`
      update store_knowledge set asked_count = asked_count + 1, last_asked_at = now(), updated_at = now(),
        thread_id = coalesce(${threadId}, thread_id)
      where id = ${same.id} returning id, asked_count`;
    return { id: r!.id, askedCount: r!.asked_count };
  }
  const [r] = await tx<{ id: string; asked_count: number }[]>`
    insert into store_knowledge (tenant_id, kind, status, source, question, asked_count, last_asked_at, thread_id)
    values (${tenantId}, 'question', 'open', 'unanswered', ${q}, 1, now(), ${threadId})
    returning id, asked_count`;
  return { id: r!.id, askedCount: r!.asked_count };
}
