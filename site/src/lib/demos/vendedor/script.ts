// The Duá (Vendedor) demo's fixed script: Bolos da Nena's real menu and prices, integer cents, and the
// cards in Core's own fields and words (packages/core/src/vendedor/cards.ts).

export interface Line {
  text: string;
  cents: number;
}

export type Msg = { time: string } & (
  | { kind: 'me'; text: string }
  | { kind: 'dua'; text: string }
  | {
      kind: 'summary';
      lines: Line[];
      mode: 'delivery' | 'pickup';
      address: string | null;
      feeCents: number;
      totalCents: number;
      eta: string | null;
      payment: string;
    }
  | { kind: 'pix'; orderNumber: number; totalCents: number; until: string; code: string }
  | { kind: 'order'; number: number; state: string; totalCents: number; payment: string }
);

export interface Chip {
  id: string;
  label: string;
}

interface Item {
  name: string;
  cents: number;
}

type Draft = Msg extends infer M ? (M extends Msg ? Omit<M, 'time'> : never) : never;

export interface State {
  minute: number;
  cake: Item | null;
  slice: Item | null;
  mode: 'delivery' | 'pickup' | null;
  msgs: Msg[];
  chips: Chip[];
}

const ORDER = 30;
const FEE = 800;
const ADDRESS = 'Rua das Acácias, 120';

const CAKES: Record<string, Item> = {
  cenoura: { name: 'Bolo de cenoura com brigadeiro', cents: 4500 },
  chocolate: { name: 'Bolo de chocolate molhadinho', cents: 4800 },
  fuba: { name: 'Bolo de fubá com goiabada', cents: 3800 },
};

/** "R$ 1.234,56", as Core shows it (no-break space so it never splits) */
export function brl(cents: number): string {
  const reais = Math.floor(Math.abs(cents) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const c = String(Math.abs(cents) % 100).padStart(2, '0');
  return `${cents < 0 ? '−' : ''}R$ ${reais},${c}`;
}

const clock = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

// the add-on Duá offers: one suggestion, never the same thing they already took
const sliceFor = (cake: Item): Item & { pitch: string } =>
  cake.name === CAKES.cenoura!.name
    ? {
        name: 'Fatia de chocolate',
        cents: 950,
        pitch: 'Quer levar também uma fatia de chocolate para comer hoje? Sai R$ 9,50.',
      }
    : {
        name: 'Fatia de cenoura com brigadeiro',
        cents: 900,
        pitch:
          'Quer levar também uma fatia de cenoura com brigadeiro? Sai R$ 9,00 e é a mais pedida.',
      };

const ADDON: Chip[] = [
  { id: 'so-bolo', label: 'Só o bolo' },
  { id: 'com-fatia', label: 'Quero a fatia também' },
];
const MODE: Chip[] = [
  { id: 'entrega', label: 'Entrega' },
  { id: 'retirada', label: 'Vou buscar' },
];

export function start(): State {
  return {
    minute: 9 * 60 + 41,
    cake: null,
    slice: null,
    mode: null,
    msgs: [],
    chips: [],
  };
}

/** Duá's first words, before the customer says anything. */
export function greeting(): { replies: Draft[]; chips: Chip[] } {
  return {
    replies: [
      {
        kind: 'dua',
        text: 'Oi! Sou o Duá, assistente virtual da Bolos da Nena. Quer ver o que tem hoje ou já sabe o que vai pedir?',
      },
    ],
    chips: [
      { id: 'tem-cenoura', label: 'Tem bolo de cenoura?' },
      { id: 'menu', label: 'O que tem hoje?' },
    ],
  };
}

function summary(s: State): Draft {
  const lines = [s.cake!, ...(s.slice ? [s.slice] : [])].map((i) => ({
    text: `1× ${i.name}`,
    cents: i.cents,
  }));
  const feeCents = s.mode === 'delivery' ? FEE : 0;
  return {
    kind: 'summary',
    lines,
    mode: s.mode!,
    address: s.mode === 'delivery' ? ADDRESS : null,
    feeCents,
    totalCents: lines.reduce((t, l) => t + l.cents, 0) + feeCents,
    eta: s.mode === 'delivery' ? '40–60 min' : null,
    payment: 'Pix',
  };
}

const totalOf = (s: State) =>
  (s.cake?.cents ?? 0) + (s.slice?.cents ?? 0) + (s.mode === 'delivery' ? FEE : 0);

/** What the customer's tap says, and what Duá answers: a pure step, so the finished state is a fold. */
export function answer(
  s: State,
  chip: string,
): { said: string; replies: Draft[]; chips: Chip[]; done?: boolean } {
  const pickCake = (key: string) => {
    s.cake = CAKES[key]!;
    s.slice = null;
    return sliceFor(s.cake);
  };
  switch (chip) {
    case 'tem-cenoura': {
      const add = pickCake('cenoura');
      return {
        said: 'Tem bolo de cenoura?',
        replies: [
          { kind: 'dua', text: 'Tem sim! O bolo de cenoura com brigadeiro inteiro sai R$ 45,00.' },
          { kind: 'dua', text: add.pitch },
        ],
        chips: ADDON,
      };
    }
    case 'menu':
      return {
        said: 'O que tem hoje?',
        replies: [
          {
            kind: 'dua',
            text: `Hoje tem:\n${['cenoura', 'chocolate', 'fuba'].map((k) => `${CAKES[k]!.name}, ${brl(CAKES[k]!.cents)}`).join('\n')}\nQual vai ser?`,
          },
        ],
        chips: [
          { id: 'c-cenoura', label: 'Cenoura' },
          { id: 'c-chocolate', label: 'Chocolate' },
          { id: 'c-fuba', label: 'Fubá' },
        ],
      };
    case 'c-cenoura':
    case 'c-chocolate':
    case 'c-fuba': {
      const key = chip.slice(2);
      const add = pickCake(key);
      const word = { cenoura: 'cenoura', chocolate: 'chocolate', fuba: 'fubá' }[key];
      return {
        said: `Quero o de ${word}`,
        replies: [
          { kind: 'dua', text: `Anotei: ${s.cake!.name.toLowerCase()}, ${brl(s.cake!.cents)}.` },
          { kind: 'dua', text: add.pitch },
        ],
        chips: ADDON,
      };
    }
    case 'so-bolo':
    case 'com-fatia': {
      const add = sliceFor(s.cake!);
      s.slice = chip === 'com-fatia' ? { name: add.name, cents: add.cents } : null;
      return {
        said: chip === 'com-fatia' ? 'Quero a fatia também' : 'Só o bolo mesmo',
        replies: [
          {
            kind: 'dua',
            text: `${s.slice ? 'Anotei a fatia também.' : 'Combinado.'} É para entregar ou você vem buscar?`,
          },
        ],
        chips: MODE,
      };
    }
    case 'entrega':
    case 'retirada':
      s.mode = chip === 'entrega' ? 'delivery' : 'pickup';
      return {
        said: chip === 'entrega' ? `Entrega, na ${ADDRESS}` : 'Vou buscar aí',
        replies: [
          {
            kind: 'dua',
            text:
              s.mode === 'delivery'
                ? 'A entrega aí fica R$ 8,00. Confere o resumo:'
                : 'Fica pronto para você retirar na loja. Confere o resumo:',
          },
          summary(s),
          { kind: 'dua', text: 'O pagamento é por Pix. Posso fechar?' },
        ],
        chips: [
          { id: 'fechar', label: 'Pode fechar' },
          { id: 'mudar', label: 'Quero mudar' },
        ],
      };
    case 'mudar':
      s.slice = null;
      s.mode = null;
      return {
        said: 'Quero mudar uma coisa',
        replies: [{ kind: 'dua', text: 'Claro. Vai só o bolo ou com a fatia?' }],
        chips: ADDON,
      };
    case 'fechar':
      return {
        said: 'Pode fechar',
        replies: [
          { kind: 'dua', text: 'Pedido feito! Aqui está o Pix:' },
          {
            kind: 'pix',
            orderNumber: ORDER,
            totalCents: totalOf(s),
            until: clock(s.minute + 30),
            code: '00020126580014br.gov.bcb.pix0136nena-5f2e-4b1a-9c3d-7a8e2f61b0d45204000053039865802BR6304E2CA',
          },
        ],
        chips: [{ id: 'pago', label: 'Já paguei' }],
      };
    case 'pago':
      return {
        said: 'Já paguei',
        replies: [
          { kind: 'dua', text: 'Pagamento confirmado! Seu pedido já foi para a cozinha.' },
          {
            kind: 'order',
            number: ORDER,
            state: 'aceito pela loja',
            totalCents: totalOf(s),
            payment: 'Pix',
          },
        ],
        chips: [],
        done: true,
      };
    default:
      return { said: '', replies: [], chips: s.chips };
  }
}

export const stamp = (s: State, d: Draft): Msg => ({ ...d, time: clock(s.minute) }) as Msg;

/** The conversation as it ends, for the page before (or without) JavaScript. */
export function finished(): State {
  const s = start();
  s.msgs.push(...greeting().replies.map((d) => stamp(s, d)));
  for (const chip of ['tem-cenoura', 'com-fatia', 'entrega', 'fechar', 'pago']) {
    s.minute++;
    const a = answer(s, chip);
    s.msgs.push(stamp(s, { kind: 'me', text: a.said }), ...a.replies.map((d) => stamp(s, d)));
  }
  return s;
}
