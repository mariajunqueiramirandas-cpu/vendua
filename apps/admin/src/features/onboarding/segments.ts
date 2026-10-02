import {
  Basket,
  Bread,
  BowlFood,
  Cake,
  Fish,
  ForkKnife,
  Hamburger,
  IceCream,
  Pizza,
  Wine,
  type Icon,
} from '@phosphor-icons/react';

// What a store sells. Asked once (signup, or the onboarding for stores born elsewhere) and kept
// by Core (store_settings.segment); the ids are Core's list. It only tunes suggestions: the
// hours a store of that kind usually keeps, its first category, example products and phrases.

export type SegmentId =
  | 'doces'
  | 'salgados'
  | 'pizzaria'
  | 'lanches'
  | 'marmitas'
  | 'acai'
  | 'padaria'
  | 'japonesa'
  | 'bebidas'
  | 'outro';

export type HoursPreset = 'todos' | 'sab' | 'semana' | 'fim' | 'tdom';

export interface Segment {
  id: SegmentId;
  label: string;
  Icon: Icon;
  /** Duá's reaction to the choice */
  praise: string;
  /** the first category the menu gets */
  category: string;
  /** placeholders for the first products */
  examples: [string, string, string];
  taglines: string[];
  hours: { preset: HoursPreset; open: string; close: string };
}

export const SEGMENTS: Segment[] = [
  {
    id: 'doces',
    label: 'Doces e bolos',
    Icon: Cake,
    praise: 'Hmm, doce!',
    category: 'Doces',
    examples: ['Pudim de leite', 'Bolo de cenoura', 'Brigadeiro gourmet'],
    taglines: [
      'Feito com carinho',
      'Doce que abraça',
      'Sobremesa de vó',
      'Encomendas e pronta entrega',
    ],
    hours: { preset: 'sab', open: '10:00', close: '19:00' },
  },
  {
    id: 'salgados',
    label: 'Salgados',
    Icon: Basket,
    praise: 'Salgadinho quentinho, que delícia!',
    category: 'Salgados',
    examples: ['Coxinha de frango', 'Kibe', 'Empada de palmito'],
    taglines: ['Sempre quentinho', 'Salgados de festa', 'Frito na hora', 'O cento mais gostoso'],
    hours: { preset: 'sab', open: '09:00', close: '19:00' },
  },
  {
    id: 'pizzaria',
    label: 'Pizzaria',
    Icon: Pizza,
    praise: 'Pizza! Já quero uma.',
    category: 'Pizzas',
    examples: ['Pizza calabresa', 'Pizza margherita', 'Pizza de frango com catupiry'],
    taglines: [
      'Massa de longa fermentação',
      'Direto do forno',
      'Borda recheada',
      'Pizza de verdade',
    ],
    hours: { preset: 'tdom', open: '18:00', close: '23:30' },
  },
  {
    id: 'lanches',
    label: 'Lanches e hambúrgueres',
    Icon: Hamburger,
    praise: 'Hambúrguer, que fome!',
    category: 'Lanches',
    examples: ['X-burguer', 'X-bacon', 'Batata frita'],
    taglines: ['Feito na chapa', 'Smash de respeito', 'Lanche caprichado', 'Entrega rápida'],
    hours: { preset: 'tdom', open: '18:00', close: '23:30' },
  },
  {
    id: 'marmitas',
    label: 'Marmitas e refeições',
    Icon: BowlFood,
    praise: 'Comida de verdade, adoro!',
    category: 'Marmitas',
    examples: ['Marmita de frango', 'Feijoada', 'Prato executivo'],
    taglines: ['Comida caseira', 'Tempero de casa', 'Almoço quentinho', 'Feito no dia'],
    hours: { preset: 'semana', open: '11:00', close: '14:30' },
  },
  {
    id: 'acai',
    label: 'Açaí e sorvetes',
    Icon: IceCream,
    praise: 'Açaí, que refrescante!',
    category: 'Açaí',
    examples: ['Açaí 300 ml', 'Açaí 500 ml', 'Milk-shake'],
    taglines: ['Monte do seu jeito', 'Gelado na medida', 'Açaí de verdade', 'Pra refrescar o dia'],
    hours: { preset: 'todos', open: '13:00', close: '22:00' },
  },
  {
    id: 'padaria',
    label: 'Padaria e café',
    Icon: Bread,
    praise: 'Cheirinho de pão!',
    category: 'Pães',
    examples: ['Pão de queijo', 'Pão francês', 'Café coado'],
    taglines: [
      'Pão quentinho toda hora',
      'Feito de madrugada',
      'Café passado na hora',
      'Fornada fresquinha',
    ],
    hours: { preset: 'todos', open: '06:30', close: '19:00' },
  },
  {
    id: 'japonesa',
    label: 'Comida japonesa',
    Icon: Fish,
    praise: 'Japa! Que chique.',
    category: 'Combinados',
    examples: ['Combinado 20 peças', 'Temaki salmão', 'Hot roll'],
    taglines: [
      'Peixe fresco todo dia',
      'Feito na hora',
      'Do jeitinho japonês',
      'Combinados caprichados',
    ],
    hours: { preset: 'tdom', open: '18:00', close: '23:00' },
  },
  {
    id: 'bebidas',
    label: 'Bebidas',
    Icon: Wine,
    praise: 'Saúde!',
    category: 'Bebidas',
    examples: ['Cerveja lata', 'Refrigerante 2 L', 'Gelo 5 kg'],
    taglines: [
      'Sempre geladinha',
      'Entrega rápida',
      'Do jeito que a festa pede',
      'Bebida gelada na porta',
    ],
    hours: { preset: 'todos', open: '10:00', close: '23:00' },
  },
  {
    id: 'outro',
    label: 'Outra coisa',
    Icon: ForkKnife,
    praise: 'Que legal!',
    category: 'Cardápio',
    examples: ['Seu produto mais vendido', 'O segundo mais pedido', 'Aquele que todo mundo ama'],
    taglines: ['Feito com carinho', 'Tudo fresquinho', 'Entrega rápida', 'O melhor da cidade'],
    hours: { preset: 'sab', open: '09:00', close: '18:00' },
  },
];

export const segmentOf = (id: string | null | undefined): Segment | null =>
  SEGMENTS.find((s) => s.id === id) ?? null;

/** What to suggest when nothing is known: the old generic copy. */
export const GENERIC: Segment = SEGMENTS.find((s) => s.id === 'outro')!;
