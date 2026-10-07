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
    path: '/novidades/dua-fecha-o-pedido/',
    title: 'O Duá fecha o pedido inteiro no WhatsApp da loja',
    description:
      'Do “oi, vocês têm bolo?” ao Pix pago: o Duá conduz a conversa, a Venduá faz toda a conta. Veja como o pedido nasce no WhatsApp e como cada conversa é contada.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/dua-chama-voce/',
    title: 'O Duá sabe quando chamar você, e quando ficar quieto',
    description:
      'Reclamação, alergia, pedido grande, amigo no seu número: o Duá separa o que é dele do que é seu, avisa no celular e devolve a conversa quando você mandar.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/dua-entende-audios/',
    title: 'O Duá entende os áudios do seu cliente, e quem ouve é a Venduá',
    description:
      'O cliente manda áudio no WhatsApp e o Duá entende, com o reconhecimento de voz rodando nos servidores da Venduá: mais rápido, sem o áudio sair daqui.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/dua-aprende-e-mostra-resultado/',
    title: 'Ensine o Duá, teste com clientes ocultos e veja o que ele vendeu',
    description:
      'Regras que o Duá sempre cumpre, um cliente de mentira que testa o seu cardápio e um painel que separa o que ele fechou do que ele ajudou a vender.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/tela-da-cozinha/',
    title: 'A cozinha ganhou uma tela: o pedido muda de cor antes de atrasar',
    description:
      'Cada pedido tem um relógio que começa quando você aceita. Âmbar aos 60% do tempo, vermelho no estouro, praças por categoria e chamada de pedido pronto.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/impressao-automatica/',
    title: 'O pedido aceito sai impresso na cozinha, sem ninguém apertar nada',
    description:
      'Uma impressora térmica, o app Venduá Impressora e a comanda sai sozinha quando você aceita o pedido. E se a internet cair, ela imprime quando voltar.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/pdv-mesas-e-qr/',
    title: 'Balcão, mesas e caixa na mesma loja, com QR para pedir da mesa',
    description:
      'Venda no balcão, abra comandas por mesa, divida a conta, feche o caixa contando cada forma de pagamento e deixe o cliente pedir pelo QR da mesa.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/entrega-por-distancia/',
    title: 'Taxa de entrega por distância: o cliente marca a porta e a conta sai pelo caminho',
    description:
      'A taxa muda com os quilômetros de verdade, pelo caminho de carro. Simule a conta, veja os limites e entenda por que o cliente paga o que viu.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/importar-cardapio-por-link/',
    title: 'Cole o link do cardápio que você já tem e veja a prévia da sua loja',
    description:
      'A Venduá lê categorias, fotos, opções e horários de sete plataformas de cardápio. Você confere a prévia antes de gravar, e preço que não bate fica escondido.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/seu-dia-e-aviso-de-pedido/',
    title: 'O pedido chega no seu celular e, quando a loja fecha, o dia vira um resumo',
    description:
      'Push com botão de aceitar, tempo de preparo em um toque e, ao fechar, o Seu dia: vendas, ticket médio, campeão e hora mais movimentada.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/cupons-e-cartao-fidelidade/',
    title: 'Cupons que você controla e um cartão fidelidade que se completa sozinho',
    description:
      'Porcentagem, valor fixo ou entrega zerada, com mínimo, limite e validade. E um cartão de selos que vira cupom pessoal quando o cliente completa.',
    published: '2026-10-07',
  },
  {
    path: '/novidades/pausar-a-loja/',
    title: 'Pausar a loja sem perder o cliente: recado, horário e “muitos pedidos agora”',
    description:
      'Pause por 15 minutos ou até você voltar, avise que a cozinha está cheia sem parar de vender e deixe o cliente montar a sacola enquanto a loja está fechada.',
    published: '2026-10-07',
  },
];

/** a guide or a news post */
export const article = (path: string) => [...guides, ...posts].find((g) => g.path === path)!;
