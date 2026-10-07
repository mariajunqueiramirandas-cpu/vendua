// The simulated import of Bolos da Nena: the store's real menu (site/scripts/assets.ts MENU, the
// same 14 products in 4 categories as the screenshots) laid out the way the admin's preview shows
// an import (apps/admin/src/features/import/ImportFlow.tsx `Preview`), with lines from copy.ts.

export type Product = {
  name: string;
  cents: number;
  note?: string;
  hidden?: boolean;
};

export const SOURCE = 'Instadelivery';
export const LINK = 'instadelivery.com.br/bolosdanena';

export const MENU: { name: string; products: Product[] }[] = [
  {
    name: 'Bolos inteiros',
    products: [
      { name: 'Bolo de cenoura com brigadeiro', cents: 4500 },
      { name: 'Bolo de chocolate molhadinho', cents: 4800 },
      { name: 'Bolo de fubá com goiabada', cents: 3800 },
      { name: 'Bolo de milho cremoso', cents: 4000 },
      { name: 'Bolo de laranja com calda', cents: 3800 },
      { name: 'Bolo de banana com canela', cents: 4000 },
    ],
  },
  {
    name: 'Fatias do dia',
    products: [
      { name: 'Fatia de cenoura com brigadeiro', cents: 900 },
      { name: 'Fatia de chocolate', cents: 950 },
      { name: 'Fatia de fubá com goiabada', cents: 800 },
    ],
  },
  {
    name: 'Encomendas',
    products: [
      { name: 'Bolo de aniversário 2 kg', cents: 16000, note: '1 grupo de opções' },
      { name: 'Bolo de aniversário 3 kg', cents: 23000, hidden: true },
      { name: 'Kit festa: bolo + 50 docinhos', cents: 21000, note: '1 grupo de opções' },
    ],
  },
  {
    name: 'Para acompanhar',
    products: [
      { name: 'Café coado 300 ml', cents: 600 },
      { name: 'Suco de laranja 400 ml', cents: 900 },
    ],
  },
];

export const COUNTS = {
  categories: MENU.length,
  products: MENU.reduce((n, c) => n + c.products.length, 0),
  photos: MENU.reduce((n, c) => n + c.products.length, 0),
  optionGroups: 2,
  hidden: MENU.flatMap((c) => c.products).filter((p) => p.hidden).length,
};

/** the belt's stations, in the order the preview lists what it found */
export const STATIONS: { id: string; label: string; found: string }[] = [
  { id: 'categorias', label: 'Categorias', found: `${COUNTS.categories} categorias` },
  { id: 'produtos', label: 'Produtos e preços', found: `${COUNTS.products} produtos` },
  { id: 'fotos', label: 'Fotos', found: `${COUNTS.photos} fotos` },
  { id: 'opcoes', label: 'Opções', found: `${COUNTS.optionGroups} grupos de opções` },
  { id: 'horarios', label: 'Horários', found: '6 dias por semana' },
  { id: 'entrega', label: 'Entrega e retirada', found: 'retirada e entrega em 2 regiões' },
  { id: 'pagamento', label: 'Pagamento', found: '3 formas de pagamento e Pix' },
];

/** "O que mais trazer" (SECTION_LABEL and `summaries`, joined with commas here) */
export const SECTIONS: { id: string; label: string; summary: string }[] = [
  { id: 'profile', label: 'Perfil e visual', summary: 'Bolos da Nena, logo, capa e cor' },
  { id: 'hours', label: 'Horários', summary: '6 dias por semana, 2 horários' },
  {
    id: 'delivery',
    label: 'Entrega e retirada',
    summary: 'retirada, entrega em 2 regiões, preparo 30 min',
  },
  { id: 'payments', label: 'Pagamentos', summary: 'Pix, Dinheiro, Cartão na entrega' },
];

/** copy.ts `lostLine` for the codes this import produced */
export const HIDDEN_LINES = [
  '“Bolo de aniversário 3 kg” tem um desconto que não conseguimos ler. Confira o preço.',
];
export const NOTE_LINES = [
  'Os cupons não vêm. Crie de novo em Marketing.',
  'O programa de pontos e o saldo dos clientes não vêm. Aqui tem o cartão fidelidade, em Marketing.',
  'A foto de capa veio pequena (475 px de largura). Uma foto maior fica mais bonita: troque em Aparência.',
];
