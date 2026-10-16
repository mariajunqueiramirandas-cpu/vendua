import type { PlanFeature, Role, StoreStatus } from '../lib/api.ts';
import { fold, startsWord } from './screens.ts';

// Buscar does things too: "pausar", "novo produto", "acabou pudim de coco". An action is matched
// like a screen (every word typed in its label or words), and only offered when it makes sense
// right now: no "pausar" on a closed store, no "abrir" on an open one.

export type ActionRun =
  | { go: string }
  /** the store's status sheet, opened on its pause, on "muitos pedidos" or on today's hours */
  | { sheet: 'pause' | 'demand' | 'hours' }
  | { resume: true }
  | { copyLink: true }
  /** puts words in the field, for an action that needs a product named */
  | { fill: string };

export type ActionId =
  | 'pause'
  | 'resume'
  | 'demand'
  | 'hours'
  | 'new-product'
  | 'sold-out'
  | 'new-coupon'
  | 'pdv'
  | 'link';

export interface ActionEntry {
  id: ActionId;
  label: string;
  hint: string;
  words: string;
  min: Role;
  feature?: PlanFeature;
  run: ActionRun;
}

export const ACTIONS: ActionEntry[] = [
  {
    id: 'pause',
    label: 'Pausar a loja',
    hint: 'ninguém pede até você voltar',
    words: 'pausar pausa parar fechar agora intervalo almoco descanso',
    min: 'attendant',
    run: { sheet: 'pause' },
  },
  {
    id: 'resume',
    label: 'Abrir a loja agora',
    hint: 'encerra a pausa',
    words: 'abrir voltar reabrir despausar retomar continuar',
    min: 'attendant',
    run: { resume: true },
  },
  {
    id: 'demand',
    label: 'Avisar que tem muitos pedidos',
    hint: 'o cliente vê que pode demorar mais',
    words: 'muitos pedidos movimento movimentado cheio lotado demora demorar atraso fila',
    min: 'attendant',
    run: { sheet: 'demand' },
  },
  {
    id: 'hours',
    label: 'Mudar o horário de hoje',
    hint: 'abrir mais cedo, fechar mais tarde ou folgar',
    words: 'horario hoje abrir fechar cedo tarde folga feriado nao abrir',
    min: 'manager',
    run: { sheet: 'hours' },
  },
  {
    id: 'sold-out',
    label: 'Esgotar um produto',
    hint: 'escreva o nome, como “acabou pudim”',
    words: 'esgotar esgotado esgotou acabou acabar faltou sem estoque',
    min: 'manager',
    run: { fill: 'acabou ' },
  },
  {
    id: 'new-product',
    label: 'Novo produto',
    hint: 'com foto, preço e descrição',
    words: 'novo produto adicionar cadastrar criar incluir item prato',
    min: 'manager',
    run: { go: '/cardapio?novo=1' },
  },
  {
    id: 'new-coupon',
    label: 'Novo cupom',
    hint: 'um desconto com código',
    words: 'novo cupom criar desconto promocao codigo',
    min: 'manager',
    run: { go: '/marketing?novo=cupom' },
  },
  {
    id: 'pdv',
    label: 'Vender no balcão',
    hint: 'uma venda no PDV',
    words: 'vender venda nova balcao pdv caixa registrar',
    min: 'attendant',
    feature: 'pdv',
    run: { go: '/pdv' },
  },
  {
    id: 'link',
    label: 'Copiar o link da loja',
    hint: 'para mandar a um cliente',
    words: 'copiar link endereco url compartilhar mandar divulgar',
    min: 'attendant',
    run: { copyLink: true },
  },
];

export interface ActionContext {
  allowed: (e: ActionEntry) => boolean;
  /** null while the store hasn't loaded: the status actions wait for it */
  status: StoreStatus | null;
  billingHold: boolean;
}

function fits(e: ActionEntry, c: ActionContext) {
  if (!c.allowed(e)) return false;
  // a store waiting for its plan payment can't open: no button pretends it can
  if (e.id === 'resume') return c.status === 'paused' && !c.billingHold;
  if (e.id === 'pause' || e.id === 'demand') return c.status === 'open';
  return true;
}

export function findActions(q: string, c: ActionContext, max = 3) {
  const terms = fold(q).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return ACTIONS.filter((e) => fits(e, c))
    .map((e) => {
      const name = fold(e.label);
      const hay = `${name} ${e.words}`.split(/\s+/);
      if (!terms.every((t) => hay.some((w) => w.startsWith(t)))) return null;
      return { e, score: terms.filter((t) => startsWord(name, t)).length };
    })
    .filter((x): x is { e: ActionEntry; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}

/** With the field empty: the day's likely next move, in this order. Creating stays where it's
 *  made (or typed for): the empty field is no global "+" menu. */
export function suggestedActions(c: ActionContext, max = 4) {
  const order: ActionId[] = ['resume', 'pause', 'sold-out', 'pdv', 'link'];
  return order
    .map((id) => ACTIONS.find((e) => e.id === id)!)
    .filter((e) => fits(e, c))
    .slice(0, max);
}

// "acabou pudim de coco", "voltou o sacolé", "pedido 128", "#128", "cliente ana": the verb or the
// kind is ours to read, the rest is what Core searches for.
const SOLD_OUT = new Set([
  'esgotar',
  'esgota',
  'esgotou',
  'esgotado',
  'esgotada',
  'esgotaram',
  'acabou',
  'acabaram',
  'acabar',
  'faltou',
]);
const BACK = new Set(['voltar', 'volta', 'voltou', 'repor', 'repus', 'reabastecer', 'chegou']);
const KIND = new Set(['pedido', 'pedidos', 'cliente', 'clientes', 'produto', 'produtos']);
const FILLER = new Set([
  'o',
  'a',
  'os',
  'as',
  'de',
  'do',
  'da',
  'um',
  'uma',
  'vender',
  'venda',
  'hoje',
  'agora',
  'produto',
  'pra',
  'para',
]);

export type Intent = 'sold_out' | 'back' | null;

export function parseQuery(raw: string): { term: string; intent: Intent } {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  const head = fold(words[0] ?? '');
  const intent: Intent = SOLD_OUT.has(head) ? 'sold_out' : BACK.has(head) ? 'back' : null;
  let trimmed = false;
  if (intent) {
    words.shift();
    trimmed = true;
  } else if (words.length > 1 && KIND.has(head)) {
    words.shift();
    trimmed = true;
  }
  // "acabou o pudim de coco hoje" → "pudim de coco"; a plain query keeps every word it has
  if (trimmed) {
    while (words.length && FILLER.has(fold(words[0]!))) words.shift();
    while (words.length && FILLER.has(fold(words[words.length - 1]!))) words.pop();
  }
  return { term: words.join(' ').replace(/^#(?=\d)/, ''), intent };
}
