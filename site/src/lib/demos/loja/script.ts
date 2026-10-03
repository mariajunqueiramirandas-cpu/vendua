// The onboarding's words, from the admin's own wizard (apps/admin/src/features/onboarding):
// Duá's line per step (flow.ts LINE), the question on its screen (steps.tsx, steps-more.tsx) and the
// praise it says after an answer (each step's `next(...)`). Same order as the wizard: nome → cores →
// como → produtos → pronto.

export type StepId = 'nome' | 'cores' | 'como' | 'produtos' | 'pronto';
export type Accent = 'caramelo' | 'floresta' | 'vinho';
export type How = 'retirada' | 'entrega' | 'ambos';
export type Cat = 'inteiros' | 'fatias' | 'encomendas';

export const NAME = 'Bolos da Nena';
export const URL = 'bolosdanena.vendua.com.br';

export const STEPS: Record<StepId, { line: string; question: string; hint?: string }> = {
  nome: {
    line: 'O mais importante: o nome!',
    question: 'Como se chama a sua loja?',
    hint: 'Esse é o nome que seus clientes vão ver.',
  },
  cores: {
    line: 'Que tal as cores da loja?',
    question: 'Escolha a cor da loja',
    hint: 'Ela vai nos botões e nos detalhes.',
  },
  como: { line: 'Como o pedido chega até o cliente?', question: 'Como o cliente recebe?' },
  produtos: {
    line: 'A parte mais gostosa: o cardápio!',
    question: 'O que você vende?',
    hint: 'Toque no que entra no cardápio.',
  },
  pronto: { line: 'Olha só o que a gente fez juntos!', question: 'Sua loja está no ar!' },
};

// the admin's colour presets (appearance/Colors.tsx PRESETS), three of them
export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'caramelo', label: 'caramelo' },
  { id: 'floresta', label: 'floresta' },
  { id: 'vinho', label: 'vinho' },
];

export const HOWS: { id: How; label: string; praise: string; badge: string }[] = [
  { id: 'retirada', label: 'Retirada', praise: 'Retirada, anotado!', badge: 'Retirada' },
  { id: 'entrega', label: 'Entrega', praise: 'Entrega, anotado!', badge: 'Entrega' },
  {
    id: 'ambos',
    label: 'Os dois',
    praise: 'Retirada e entrega, que capricho!',
    badge: 'Entrega e retirada',
  },
];

// the store's real menu (scripts/assets.ts MENU), a few from each category
export const CATS: { id: Cat; label: string }[] = [
  { id: 'inteiros', label: 'Bolos inteiros' },
  { id: 'fatias', label: 'Fatias do dia' },
  { id: 'encomendas', label: 'Encomendas' },
];

export const PRODUCTS: { cat: Cat; name: string; price: string }[] = [
  { cat: 'inteiros', name: 'Bolo de cenoura com brigadeiro', price: 'R$ 45,00' },
  { cat: 'inteiros', name: 'Bolo de chocolate molhadinho', price: 'R$ 48,00' },
  { cat: 'fatias', name: 'Fatia de cenoura com brigadeiro', price: 'R$ 9,00' },
  { cat: 'inteiros', name: 'Bolo de fubá com goiabada', price: 'R$ 38,00' },
  { cat: 'encomendas', name: 'Bolo de aniversário 2 kg', price: 'R$ 160,00' },
  { cat: 'encomendas', name: 'Kit festa: bolo + 50 docinhos', price: 'R$ 210,00' },
];

export interface Shop {
  named: boolean;
  accent: Accent | null;
  how: How | null;
  cats: Cat[];
}

export const EMPTY: Shop = { named: false, accent: null, how: null, cats: [] };
export const DONE: Shop = {
  named: true,
  accent: 'caramelo',
  how: 'ambos',
  cats: ['inteiros', 'fatias', 'encomendas'],
};
