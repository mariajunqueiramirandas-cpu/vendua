// Deterministic readings of a shopper's message (sales-agent.md §4.12): the triggers code acts
// on before any model sees the message. Pure and unit-tested; the model's own `handoff` covers
// what these miss.

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const PERSON =
  /\b(atendente|humano|humana|uma pessoa|pessoa de verdade|falar com (alguem|o dono|a dona|o gerente|a gerente|voces|uma pessoa|o responsavel)|quero falar com|chama (o|a) (dono|dona|gerente|responsavel)|nao quero (falar com )?(robo|bot|maquina))\b/;
const COMPLAINT =
  /\b(reclama\w*|atrasad\w*|demorando|demorou|ta demorando|cade (meu|o) pedido|nao chegou|nunca chegou|veio errado|veio frio|chegou frio|faltou|faltando|pessimo|horrivel|absurdo|vergonha|nojento|estragad\w*|cabelo|passou mal|devolucao|reembols\w*|estorn\w*|procon)\b/;
const ALLERGY =
  /\b(alergi\w*|alergic\w*|intoleran\w*|celiac\w*|gluten|lactose|amendoim|castanha\w*|frutos do mar|anafila\w*|nao posso comer)\b/;
const NOT_SHOPPER =
  /\b(boleto|nota fiscal|nf-?e|fornecedor\w*|representante|vendedor de|orcamento de|cobranca|duplicata|entrega de mercadoria|currículo|curriculo|vaga de emprego|parceria comercial|maquininha|aluguel)\b/;

export type Trigger = 'pediu uma pessoa' | 'reclamação' | 'alergia';

export function triggerOf(
  text: string | null | undefined,
  rules: { complaint: boolean; allergy: boolean },
): Trigger | null {
  if (!text) return null;
  const f = fold(text);
  if (PERSON.test(f)) return 'pediu uma pessoa';
  if (rules.complaint && COMPLAINT.test(f)) return 'reclamação';
  if (rules.allergy && ALLERGY.test(f)) return 'alergia';
  return null;
}

/** A first message from a number that never ordered: answered only if it reads as a shopper's. */
export function readsAsShopper(text: string | null | undefined): boolean {
  if (!text) return true;
  return !NOT_SHOPPER.test(fold(text));
}
