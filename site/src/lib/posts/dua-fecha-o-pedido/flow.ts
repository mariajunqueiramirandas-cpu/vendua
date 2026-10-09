import { brl } from '$lib/demos/vendedor/script';
import { readAnswer, type Verdict } from './gate';

// The gate widget's script: Bia orders from Bolos da Nena on the store's WhatsApp. The menu, the
// R$ 8,00 delivery and the address are the site's Duá demo's (demos/vendedor/script.ts). Every
// figure is integer cents and is "Core's": Duá's bubbles hold a reference that the ledger fills
// in, as the Vendedor's replies do (ADR 0031 §1). An order needs a yes to the latest summary, read
// by readAnswer, and any change sends a new summary that needs a new yes (ADR 0031 §2).

export { brl };

export const ORDER_NUMBER = 31;
const FEE = 800;
const ADDRESS = 'Rua das Acácias, 120';

const CAKE = { name: 'Bolo de chocolate molhadinho', cents: 4800 };
const SLICE = { name: 'Fatia de cenoura com brigadeiro', cents: 900 };

export interface Cart {
  slice: boolean;
  mode: 'delivery' | 'pickup';
}

export interface Line {
  text: string;
  cents: number;
}

/** A figure in Duá's words: the label is what the draft shows, the cents what the shopper reads. */
export type Seg = string | { label: string; cents: number };

export type Msg =
  | { kind: 'me'; text: string; verdict?: Verdict & { summary: number } }
  | { kind: 'dua'; segs: Seg[] }
  | {
      kind: 'summary';
      n: number;
      lines: Line[];
      mode: Cart['mode'];
      feeCents: number;
      totalCents: number;
      replacedBy: number | null;
    }
  | { kind: 'pix'; totalCents: number; summary: number };

export interface State {
  cart: Cart;
  msgs: Msg[];
  /** the summary a yes would close, 0 before the first */
  summary: number;
  placed: boolean;
  /** what changed last in the ledger, so it can light up */
  touched: 'slice' | 'mode' | null;
}

export interface Reply {
  id: string;
  text: string;
}

export const lines = (c: Cart): Line[] => [
  { text: `1× ${CAKE.name}`, cents: CAKE.cents },
  ...(c.slice ? [{ text: `1× ${SLICE.name}`, cents: SLICE.cents }] : []),
];
export const feeOf = (c: Cart) => (c.mode === 'delivery' ? FEE : 0);
export const totalOf = (c: Cart) => lines(c).reduce((t, l) => t + l.cents, 0) + feeOf(c);
export const address = ADDRESS;

function sendSummary(s: State): Msg[] {
  const prev = s.msgs.findLast((m) => m.kind === 'summary');
  s.summary++;
  if (prev && prev.kind === 'summary') prev.replacedBy = s.summary;
  return [
    {
      kind: 'summary',
      n: s.summary,
      lines: lines(s.cart),
      mode: s.cart.mode,
      feeCents: feeOf(s.cart),
      totalCents: totalOf(s.cart),
      replacedBy: null,
    },
  ];
}

export function start(): State {
  const s: State = {
    cart: { slice: false, mode: 'delivery' },
    msgs: [
      { kind: 'me', text: 'Oi, tem bolo de chocolate hoje?' },
      {
        kind: 'dua',
        segs: [
          'Oi, Bia! Sou o Duá, assistente virtual da Bolos da Nena. Tem sim: o bolo de chocolate molhadinho sai ',
          { label: 'preço', cents: CAKE.cents },
          '.',
        ],
      },
      { kind: 'me', text: `Quero um, pra entregar na ${ADDRESS}` },
      {
        kind: 'dua',
        segs: [
          'Anotei. A entrega aí fica ',
          { label: 'entrega', cents: FEE },
          '. Vai pagar no Pix?',
        ],
      },
      { kind: 'me', text: 'Pix' },
      { kind: 'dua', segs: ['Confere o resumo:'] },
    ],
    summary: 0,
    placed: false,
    touched: null,
  };
  s.msgs.push(...sendSummary(s));
  return s;
}

/** The replies on offer while a summary waits: a change flips with the cart. */
export function replies(s: State): Reply[] {
  if (s.placed) return [];
  return [
    { id: 'sim', text: 'sim' },
    { id: 'joinha', text: '👍' },
    s.cart.mode === 'delivery'
      ? { id: 'buscar', text: 'sim, mas vou buscar' }
      : { id: 'entregar', text: 'pode, mas manda entregar' },
    s.cart.slice
      ? { id: 'tira', text: 'tira a fatia' }
      : { id: 'fatia', text: 'põe uma fatia de cenoura também' },
    { id: 'quanto', text: 'quanto fica?' },
  ];
}

/** One shopper message and Duá's answer: a pure step, so the finished state is a fold. */
export function answer(s: State, id: string, typed?: string): Msg[] {
  const text = typed ?? replies(s).find((r) => r.id === id)?.text ?? '';
  const verdict = { ...readAnswer(text), summary: s.summary };
  const me: Msg = { kind: 'me', text, verdict };
  s.touched = null;
  if (verdict.yes) {
    s.placed = true;
    return [
      me,
      { kind: 'dua', segs: ['Pedido feito! Aqui está o Pix:'] },
      { kind: 'pix', totalCents: totalOf(s.cart), summary: s.summary },
    ];
  }
  const change = (what: State['touched'], said: string): Msg[] => {
    s.touched = what;
    return [me, { kind: 'dua', segs: [said] }, ...sendSummary(s)];
  };
  switch (id) {
    case 'buscar':
      s.cart.mode = 'pickup';
      return change('mode', 'Combinado, fica para retirar na loja. Confere o novo resumo:');
    case 'entregar':
      s.cart.mode = 'delivery';
      return change('mode', `Combinado, entrega na ${ADDRESS}. Confere o novo resumo:`);
    case 'fatia':
      s.cart.slice = true;
      return change('slice', 'Coloquei a fatia. Confere o novo resumo:');
    case 'tira':
      s.cart.slice = false;
      return change('slice', 'Tirei a fatia. Confere o novo resumo:');
    case 'quanto':
      return [
        me,
        {
          kind: 'dua',
          segs: [
            'Fica ',
            { label: 'total', cents: totalOf(s.cart) },
            '. Posso confirmar? Responda sim.',
          ],
        },
      ];
    default:
      return [me, { kind: 'dua', segs: ['Posso confirmar? Responda sim.'] }];
  }
}

/** The story as it ends, for the page before (or without) JavaScript. */
export function finished(): State {
  const s = start();
  for (const id of ['buscar', 'sim']) s.msgs.push(...answer(s, id));
  return s;
}
