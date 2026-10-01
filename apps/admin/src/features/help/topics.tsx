import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RouteId } from '../../app/routes.ts';

// Per-screen help: short how-tos for what each screen really does. When a screen gains or loses
// a feature, its entry here changes in the same commit — never describe what isn't built.

export interface Topic {
  title: string;
  intro: string;
  items: { q: string; a: ReactNode }[];
}

const L = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="font-semibold text-ink underline underline-offset-2">
    {children}
  </Link>
);

export type TopicId =
  | 'inicio'
  | 'pedidos'
  | 'cardapio'
  | 'loja'
  | 'pagamentos'
  | 'clientes'
  | 'marketing'
  | 'aparencia'
  | 'relatorios'
  | 'equipe'
  | 'conta'
  | 'perfil';

export const TOPICS: Record<TopicId, Topic> = {
  inicio: {
    title: 'Início',
    intro: 'O resumo do dia e o que está esperando por você.',
    items: [
      {
        q: 'O que é “Precisa de você”?',
        a: 'Tudo o que espera uma ação sua agora, como um pedido sem aceite ou um produto acabando. Cada linha tem o botão para resolver ali mesmo.',
      },
      {
        q: 'Como pauso a loja?',
        a: (
          <>
            Toque no status lá em cima (“Aberta”) e em <strong>pausar agora</strong>. Escolha por
            quanto tempo e, se quiser, deixe um recado para quem entrar na loja.
          </>
        ),
      },
      {
        q: 'Como mudo o horário só de hoje?',
        a: (
          <>
            Toque no status e em <strong>Mudar o horário de hoje</strong>. Amanhã volta o horário de
            sempre.
          </>
        ),
      },
      {
        q: 'Quero ser avisado de cada pedido',
        a: (
          <>
            Em <L to="/perfil">Meu perfil</L>, ligue <strong>Avisos no celular</strong> e toque em{' '}
            <strong>testar aviso</strong> para conferir se chega.
          </>
        ),
      },
    ],
  },
  pedidos: {
    title: 'Pedidos',
    intro: 'Aceite, prepare e entregue. Cada toque avisa o cliente.',
    items: [
      {
        q: 'Como aceito um pedido?',
        a: (
          <>
            Escolha o tempo de preparo no cartão e toque em <strong>aceitar</strong>. No celular,
            também dá para arrastar o cartão para a direita.
          </>
        ),
      },
      {
        q: 'Como passo para a próxima etapa?',
        a: 'O botão grande do cartão leva o pedido adiante: em preparo, pronto ou saiu para entrega, e entregue. Arrastar para a direita faz o mesmo.',
      },
      {
        q: 'Como cancelo um pedido?',
        a: (
          <>
            Abra o pedido (ou arraste o cartão para a esquerda, no celular) e toque em{' '}
            <strong>cancelar pedido</strong>. Escolha o motivo e segure o botão para confirmar. Se
            foi pago pelo Mercado Pago, o dinheiro volta sozinho para o cliente.
          </>
        ),
      },
      {
        q: 'Falar com o cliente ou imprimir a comanda',
        a: (
          <>
            No pedido, toque em <strong>WhatsApp</strong> para mandar uma mensagem pronta, ou em{' '}
            <strong>imprimir comanda</strong>.
          </>
        ),
      },
      {
        q: 'Onde vejo encomendas e pedidos antigos?',
        a: (
          <>
            Nos botões <strong>Encomendas</strong> (um calendário com as datas escolhidas pelos
            clientes) e <strong>Histórico</strong>, no topo de Pedidos. <strong>Tela ligada</strong>{' '}
            impede o celular de apagar enquanto os pedidos chegam.
          </>
        ),
      },
    ],
  },
  cardapio: {
    title: 'Cardápio',
    intro: 'Seus produtos, fotos e preços, do jeito que aparecem na loja.',
    items: [
      {
        q: 'Como adiciono produtos?',
        a: (
          <>
            Toque em <strong>novo produto</strong>. Se o cardápio já está no WhatsApp, use{' '}
            <strong>colar lista</strong>: cada linha como “Pudim - 12,50” vira um produto.
          </>
        ),
      },
      {
        q: 'Como marco “esgotado hoje”?',
        a: (
          <>
            No modo lista, toque em <strong>disponível</strong> ou arraste o produto para a
            esquerda. Ele volta sozinho à meia-noite.
          </>
        ),
      },
      {
        q: 'Um produto só em alguns dias ou horários',
        a: (
          <>
            Abra o produto e, em <strong>Dias e horários</strong>, escolha os dias e, se quiser, o
            horário. Fora disso, ele aparece como indisponível ou some do cardápio, você escolhe.
          </>
        ),
      },
      {
        q: 'Mudar a ordem ou vários produtos de uma vez',
        a: (
          <>
            Na grade, segure uma foto e arraste. Para mexer em vários, toque em{' '}
            <strong>selecionar</strong>: dá para mudar disponibilidade, categoria ou preço em %.
          </>
        ),
      },
      {
        q: 'Sabores, tamanhos, estoque e kits',
        a: 'Dentro do produto: “Opções” para sabor e tamanho, “Estoque” para contar unidades (ou todos de uma vez em Cardápio › estoque), “Encomenda” para pedir com antecedência e “Kit” para o cliente montar.',
      },
    ],
  },
  loja: {
    title: 'Loja',
    intro: 'Horários, entrega, retirada e como a loja se apresenta.',
    items: [
      {
        q: 'Como mudo os horários?',
        a: 'Em Horários, toque no dia para mudar a hora ou use a chave para abrir ou fechar. Para um feriado, use “Feriados e dias especiais”: não mexe na semana.',
      },
      {
        q: 'Como configuro a entrega?',
        a: 'Em Entrega e retirada, ligue a entrega e crie áreas por bairro ou por distância, cada uma com a sua taxa e tempo. O pedido mínimo vale para a loja toda.',
      },
      {
        q: 'Onde o cliente retira?',
        a: 'Com a retirada ligada, preencha “Onde retirar” e, se quiser, “Como retirar”. O cliente vê os dois ao escolher retirar.',
      },
      {
        q: 'O que a loja diz quando está fechada?',
        a: (
          <>
            Em Mensagens, escreva o recado de pausa e o de fechada. Com muita gente pedindo, ligue{' '}
            <strong>Muitos pedidos agora</strong> para avisar que o preparo está demorando mais.
          </>
        ),
      },
      {
        q: 'A loja diz “Falta pagar o plano”',
        a: (
          <>
            A loja abre para pedidos assim que o primeiro pagamento do plano é confirmado. Quem é
            dono paga em <L to="/conta">Conta e plano</L>.
          </>
        ),
      },
    ],
  },
  pagamentos: {
    title: 'Pagamentos',
    intro: 'Como seus clientes pagam e o que chegou.',
    items: [
      {
        q: 'Como ligo ou desligo uma forma de pagamento?',
        a: 'Em Formas de pagamento, use a chave de cada uma. Só aparecem na loja as que estão ligadas.',
      },
      {
        q: 'Pix: automático ou conferido por mim?',
        a: 'Com o Mercado Pago conectado, o Pix se confirma sozinho. Sem ele, o cliente paga na sua chave Pix e você confere no app do banco antes de marcar como pago.',
      },
      {
        q: 'Onde marco um Pix como pago?',
        a: 'Em “Pix para conferir”, ou dentro do pedido. Confira no app do seu banco primeiro.',
      },
      {
        q: 'Cartão pelo site',
        a: 'Conecte sua conta do Mercado Pago. O cliente paga na tela do Mercado Pago, e o Mercado Pago desconta a taxa dele de cada pagamento.',
      },
    ],
  },
  clientes: {
    title: 'Clientes',
    intro: 'Todo mundo que já pediu, pelo telefone.',
    items: [
      {
        q: 'O que vejo de cada cliente?',
        a: 'Os pedidos, o que mais pede, o último endereço e o cartão fidelidade. Dá para ordenar por mais recentes, quem mais gastou ou mais pedidos.',
      },
      {
        q: 'Um cliente pediu os dados dele (LGPD)',
        a: 'Abra o cliente e use “Dados pessoais (LGPD)” para exportar ou apagar os dados.',
      },
    ],
  },
  marketing: {
    title: 'Marketing',
    intro: 'Traga gente nova e faça quem já comprou voltar.',
    items: [
      {
        q: 'Como divulgo a loja?',
        a: 'Em Compartilhar a loja, copie o link, mande pelo WhatsApp ou baixe o QR code para imprimir.',
      },
      {
        q: 'Como crio um cupom?',
        a: 'Em Cupons, toque em “criar cupom” e escolha: porcentagem, valor fixo ou entrega grátis.',
      },
      {
        q: 'Cartão fidelidade e lista de espera',
        a: 'No cartão fidelidade, cada pedido entregue vale um selo, e os selos viram um prêmio. A lista de espera mostra quem quer ser avisado quando um produto esgotado voltar.',
      },
      {
        q: 'Uma faixa com recado no topo da loja',
        a: 'Use “Aviso na loja”: promoção, novidade ou recado.',
      },
    ],
  },
  aparencia: {
    title: 'Aparência',
    intro: 'A sua loja de verdade, para editar do jeito que o cliente vê.',
    items: [
      {
        q: 'Como mudo um texto ou uma foto?',
        a: 'Toque na parte da página que quer mudar. Ela abre para editar, e a prévia muda na hora.',
      },
      {
        q: 'Quando os clientes veem a mudança?',
        a: (
          <>
            Só depois de tocar em <strong>publicar</strong>. Até lá, é só uma prévia sua. Em{' '}
            <strong>versões</strong> dá para voltar a uma versão anterior: ela é publicada de novo.
          </>
        ),
      },
      {
        q: 'Como mudo as cores?',
        a: 'Toque em “cores”. Se uma combinação ficar difícil de ler, o painel avisa antes de publicar.',
      },
      {
        q: 'Mudar a ordem ou esconder uma parte',
        a: 'Em “partes da página”, suba, desça ou esconda cada parte, ou adicione uma nova.',
      },
    ],
  },
  relatorios: {
    title: 'Relatórios',
    intro: 'Como a loja está indo, no período que você escolher.',
    items: [
      {
        q: 'O que cada número quer dizer?',
        a: 'Toque em um número lá em cima para ver a explicação. A comparação é com o período anterior do mesmo tamanho.',
      },
      {
        q: 'Entrega por área',
        a: 'Quanto cada área vendeu, quantas vezes pediram o frete para lá e quantas dessas viraram pedido.',
      },
      {
        q: 'Onde pediram e você não entrega',
        a: (
          <>
            Lugares onde alguém quis entrega e nenhuma área sua atende. Pode valer uma área nova em{' '}
            <L to="/loja#entrega">Loja › Entrega e retirada</L>.
          </>
        ),
      },
      {
        q: 'Quero os pedidos numa planilha',
        a: 'Toque em “baixar planilha”: vem com os pedidos do período escolhido.',
      },
    ],
  },
  equipe: {
    title: 'Equipe',
    intro: 'Quem ajuda na loja, cada um com o próprio celular.',
    items: [
      {
        q: 'Como chamo alguém para a equipe?',
        a: 'Toque em “adicionar pessoa”, com nome, celular e o que ela pode fazer. O convite vai pelo WhatsApp e, se você informar, pelo e-mail.',
      },
      {
        q: 'O convite não chegou',
        a: 'Toque em “reenviar convite” na pessoa, ou mande o link pelo seu próprio WhatsApp na tela que aparece depois.',
      },
      {
        q: 'Qual a diferença entre dono, gerente e atendente?',
        a: 'Atendente cuida dos pedidos e pausa a loja. Gerente cuida também de cardápio, loja, clientes, marketing e relatórios. Dono pode tudo, incluindo pagamentos, equipe e plano.',
      },
      {
        q: 'Como tiro o acesso de alguém?',
        a: 'Toque na pessoa e segure “tirar o acesso”. Ela sai do painel na hora.',
      },
    ],
  },
  conta: {
    title: 'Conta e plano',
    intro: 'Seu plano, faturas e o endereço da loja.',
    items: [
      {
        q: 'Como pago o plano?',
        a: 'Pelo cartão, que renova sozinho todo mês pelo Mercado Pago, ou por Pix, com uma fatura por mês. Você escolhe e pode trocar depois.',
      },
      {
        q: 'Onde vejo as faturas?',
        a: 'Em Conta e plano aparecem as últimas faturas. Uma fatura em aberto por Pix tem o código para copiar e pagar.',
      },
      {
        q: 'Posso usar meu próprio domínio?',
        a: 'Sim, no plano Venduá PRO+. O painel mostra o que configurar no seu domínio e confere quando estiver pronto.',
      },
    ],
  },
  perfil: {
    title: 'Meu perfil',
    intro: 'Seus avisos, som e aparência do painel.',
    items: [
      {
        q: 'Não ouço o som do pedido novo',
        a: 'Toque uma vez em qualquer lugar do painel (o navegador só libera o som depois de um toque) e use “testar som”. Deixe o celular fora do silencioso.',
      },
      {
        q: 'Os avisos estão chegando?',
        a: 'Em “Seus avisos”, toque em “testar aviso”. A lista mostra cada aparelho e se o último aviso chegou.',
      },
      {
        q: 'E se o aviso não chegar?',
        a: 'Quando o WhatsApp de reserva está ligado e um pedido espera sem aceite, donos e gerentes recebem uma mensagem no WhatsApp.',
      },
    ],
  },
};

const BY_ROUTE: Partial<Record<RouteId, TopicId>> = {
  home: 'inicio',
  orders: 'pedidos',
  order: 'pedidos',
  history: 'pedidos',
  scheduled: 'pedidos',
  menu: 'cardapio',
  product: 'cardapio',
  store: 'loja',
  payments: 'pagamentos',
  customers: 'clientes',
  customer: 'clientes',
  marketing: 'marketing',
  appearance: 'aparencia',
  reports: 'relatorios',
  team: 'equipe',
  account: 'conta',
  profile: 'perfil',
};

export const topicFor = (route: RouteId | undefined): TopicId | null =>
  (route && BY_ROUTE[route]) || null;
