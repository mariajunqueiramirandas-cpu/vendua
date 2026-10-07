import type { Kind } from './components/KindArt.svelte';

// The pages beyond the home: one per kind of shop, the guides and the news posts. The footer, the home's "para quem"
// tiles, the guides index and each page's related links read this list, so a new page is linked from
// everywhere once it is here. postbuild.ts builds the sitemap from the build itself.

export type Niche = {
  kind: Kind;
  path: string;
  /** the footer link and the crumb */
  label: string;
};

export const niches: Niche[] = [
  { kind: 'bolo', path: '/para/doceiras/', label: 'Para doceiras' },
  { kind: 'marmita', path: '/para/marmitarias/', label: 'Para marmitarias' },
  { kind: 'burger', path: '/para/hamburguerias/', label: 'Para hamburguerias' },
  { kind: 'pao', path: '/para/padarias/', label: 'Para padarias' },
];

export const nicheFor = (kind: Kind) => niches.find((n) => n.kind === kind)!;

export type Guide = {
  path: string;
  title: string;
  description: string;
  /** ISO date, for the article's structured data */
  published: string;
};

export const guides: Guide[] = [
  {
    path: '/guias/vender-comida-pelo-whatsapp/',
    title: 'Como vender comida pelo WhatsApp sem se perder nos pedidos',
    description:
      'Pedido no meio da conversa, Pix sem comprovante, cliente perguntando o cardápio de novo. Um jeito de organizar as vendas pelo WhatsApp sem largar o celular.',
    published: '2026-10-04',
  },
  {
    path: '/guias/cardapio-digital/',
    title: 'Cardápio digital: o que é e como montar o seu',
    description:
      'O que um cardápio digital precisa ter para o cliente pedir sozinho: fotos, preços, adicionais, horários e o que acabou. Passo a passo para montar o seu.',
    published: '2026-10-04',
  },
  {
    path: '/guias/encomendas-de-bolos-e-doces/',
    title: 'Encomendas de bolos e doces: como organizar sem caderno',
    description:
      'Data de entrega, sinal no Pix, sabor, recheio e o que já está combinado. Como a confeitaria organiza as encomendas sem perder nenhuma no meio das conversas.',
    published: '2026-10-04',
  },
  {
    path: '/guias/delivery-proprio/',
    title: 'Delivery próprio: como ter a sua loja online e vender direto',
    description:
      'Ter um link só seu para receber pedidos: o que muda para o cliente, para o caixa e para a cozinha, e o que preparar antes de divulgar.',
    published: '2026-10-04',
  },
];

export const guide = (path: string) => guides.find((g) => g.path === path)!;

// News posts (/novidades/<slug>/): what changed in the product, written for the shop owner. Same
// layout and rules as the guides.
export const posts: Guide[] = [
  {
    path: '/novidades/dua-entende-audios/',
    title: 'O Duá entende os áudios do seu cliente, e quem ouve é a Venduá',
    description:
      'O cliente manda áudio no WhatsApp e o Duá entende, com o reconhecimento de voz rodando nos servidores da Venduá: mais rápido, sem o áudio sair daqui.',
    published: '2026-10-07',
  },
];

/** a guide or a news post */
export const article = (path: string) => [...guides, ...posts].find((g) => g.path === path)!;
