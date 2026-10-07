// The real rules behind this post's widgets, copied from Core so the widgets compute what the
// product computes. Sources: packages/core/src/vendedor/floor.ts (who answers), signals.ts (the
// handoff words), settings.ts (defaults and limits), triage.ts (who Duá answers, ADR 0033),
// admin/workers.ts (the re-pings) and admin/routes-vendedor.ts (the pause).

export type Coverage = 'rehearsal' | 'when_slow' | 'after_hours' | 'always';
export type Wait = 1 | 2 | 5;
export type Pause = 'none' | '1h' | 'tomorrow';

/** settings.ts DEFAULT_SETTINGS */
export const DEFAULTS = {
  coverage: 'when_slow' as Coverage,
  slowAfterMin: 2 as Wait,
  humanSilenceMin: 30,
  handoff: { complaint: true, allergy: true, above: false, newCash: false },
  /** the admin's value when "Pedido grande" is switched on (apps/admin Settings.tsx) */
  aboveCents: 30_000,
};

/** The example store hours the widgets use (not a setting of anyone's). */
export const OPEN_FROM = 9;
export const OPEN_TO = 19;
export const isOpen = (h: number) => h >= OPEN_FROM && h < OPEN_TO;

export type Who = 'dua' | 'primeiro' | 'voce' | 'rascunho' | 'pausa';

/** The hour a pause ends: 1 h, or the next 6:00 in the store's time (routes-vendedor.ts). */
export function pauseEnd(from: number, p: Pause): number | null {
  if (p === 'none') return null;
  if (p === '1h') return from + 1;
  return from < 6 ? 6 : 30;
}

/** floor.ts for a new conversation nobody holds yet, hour by hour. */
export function whoAt(
  h: number,
  coverage: Coverage,
  pause: { from: number; until: number } | null,
) {
  if (pause) {
    const x = h < pause.from ? h + 24 : h;
    if (x >= pause.from && x < pause.until) return 'pausa' as Who;
  }
  if (coverage === 'rehearsal') return 'rascunho' as Who;
  if (coverage === 'always' || !isOpen(h)) return 'dua' as Who;
  if (coverage === 'after_hours') return 'voce' as Who;
  return 'primeiro' as Who;
}

export const hourLabel = (h: number) => `${((h % 24) + 24) % 24}h`;
export const clockLabel = (minutes: number) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`;
};

// ── handoff words (signals.ts, verbatim) ─────────────────────────────────────

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const PERSON =
  /\b(atendente|humano|humana|uma pessoa|pessoa de verdade|falar com (alguem|o dono|a dona|o gerente|a gerente|voces|uma pessoa|o responsavel)|quero falar com|chama (o|a) (dono|dona|gerente|responsavel)|nao quero (falar com )?(robo|bot|maquina))\b/;
const COMPLAINT =
  /\b(reclama\w*|atrasad\w*|demorando|demorou|ta demorando|cade (meu|o) pedido|nao chegou|nunca chegou|veio errado|veio frio|chegou frio|faltou|faltando|pessimo|horrivel|absurdo|vergonha|nojento|estragad\w*|cabelo|passou mal|devolucao|reembols\w*|estorn\w*|procon)\b/;
const ALLERGY =
  /\b(alergi\w*|alergic\w*|intoleran\w*|celiac\w*|gluten|lactose|amendoim|castanha\w*|frutos do mar|anafila\w*|nao posso comer)\b/;

export type Trigger = 'pessoa' | 'reclamacao' | 'alergia' | 'pagamento' | 'grande' | 'dinheiro';

export function triggerOf(
  text: string,
  rules: { complaint: boolean; allergy: boolean },
): Trigger | null {
  if (!text.trim()) return null;
  const f = fold(text);
  if (PERSON.test(f)) return 'pessoa';
  if (rules.complaint && COMPLAINT.test(f)) return 'reclamacao';
  if (rules.allergy && ALLERGY.test(f)) return 'alergia';
  return null;
}

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** integer cents in, "R$ 1.234,56" out */
export const brl = (cents: number) => money.format(cents / 100);

/** admin/workers.ts WAITING_REPINGS */
export const REPINGS = [5, 15] as const;

// ── who Duá answers (triage.ts firstLookTx + decide) ─────────────────────────

export type AnswerWho = 'known_and_new' | 'known_only' | 'everyone';
export type Verdict = 'personal' | 'customer' | 'unsure';
export type Outcome = 'atende' | 'pergunta' | 'quieto';

export interface Contact {
  ordered: boolean;
  /** the chat had messages before this one */
  history: boolean;
  /** what the fast model would answer for this chat (an example, the widget's script) */
  verdict: Verdict;
}

export function outcomeOf(c: Contact, who: AnswerWho): { outcome: Outcome; step: string } {
  if (c.ordered) return { outcome: 'atende', step: 'já pediu na loja' };
  if (who === 'everyone') return { outcome: 'atende', step: 'você escolheu “Todo mundo”' };
  if (who === 'known_only')
    return { outcome: 'pergunta', step: 'você escolheu “Só quem já é cliente”' };
  if (!c.history)
    return c.verdict === 'personal'
      ? { outcome: 'pergunta', step: 'é um número novo que escreve como conhecido' }
      : { outcome: 'atende', step: 'é um número novo, sem conversa anterior' };
  if (c.verdict === 'personal') return { outcome: 'quieto', step: 'a conversa é pessoal' };
  if (c.verdict === 'customer') return { outcome: 'atende', step: 'a conversa é de cliente' };
  return { outcome: 'pergunta', step: 'a conversa não deixa claro' };
}
