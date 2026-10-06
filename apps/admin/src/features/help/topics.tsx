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
  | 'whatsapp'
  | 'impressoras'
  | 'clientes'
  | 'marketing'
  | 'aparencia'
  | 'relatorios'
  | 'equipe'
  | 'conta'
  | 'perfil'
  | 'vendedor'
  | 'copiloto'
  | 'pdv';

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
        q: 'Recebo pedidos com a loja fechada?',
        a: 'Fora do horário, o cliente monta a sacola mas só finaliza quando a loja abrir. A exceção são as encomendas: com “Encomendas com a loja fechada” ligado, um pedido feito apenas de encomendas entra a qualquer hora. Desligue para não receber nada com a loja fechada.',
      },
      {
        q: 'Como configuro a entrega?',
        a: 'Em Entrega e retirada, ligue a entrega e crie áreas por bairro ou por distância, cada uma com a sua taxa e tempo. O pedido mínimo vale para a loja toda.',
      },
      {
        q: 'Como cobro a entrega pela distância?',
        a: 'Marque a loja no mapa (ou use “pelo endereço”) e ligue “Cobrar pela distância”. O cliente confirma no mapa onde entregar e a taxa sai pelo caminho de carro: a taxa de saída mais o valor por km, nunca abaixo da mínima, até a distância máxima. As áreas ficam de reserva para quando o endereço chega sem o local no mapa.',
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
  whatsapp: {
    title: 'WhatsApp',
    intro: 'Os avisos do pedido que seus clientes recebem pelo número da loja.',
    items: [
      {
        q: 'Como conecto?',
        a: 'Digite o número do WhatsApp da loja e toque em gerar código. No celular da loja, abra o WhatsApp, vá em Aparelhos conectados, toque em Conectar aparelho e depois em Conectar com número de telefone. Digite o código que aparece aqui.',
      },
      {
        q: 'Continuo usando o WhatsApp normalmente?',
        a: 'Sim. A Venduá entra como um aparelho conectado, como o WhatsApp Web. As respostas dos clientes chegam no seu celular, como sempre.',
      },
      {
        q: 'Quais avisos o cliente recebe?',
        a: 'Os que estão ligados em Avisos aos clientes. Cada um mostra a mensagem como o cliente vai ler.',
      },
      {
        q: 'E se o cliente não quiser receber?',
        a: 'A primeira mensagem diz como parar: é só responder SAIR. Se ele responder VOLTAR, recebe de novo.',
      },
      {
        q: 'Por que o WhatsApp desconectou?',
        a: 'O WhatsApp desconecta os aparelhos quando alguém remove a Venduá em Aparelhos conectados ou quando o celular da loja fica muitos dias sem abrir o WhatsApp. Conecte de novo com um código novo.',
      },
    ],
  },
  impressoras: {
    title: 'Impressoras',
    intro: 'A comanda impressa sozinha, numa impressora térmica da loja.',
    items: [
      {
        q: 'Como conecto?',
        a: 'Instale o app Venduá Impressora no computador com Windows ou no tablet Android ligado à impressora. Abra o app: ele mostra um código. Toque em conectar aparelho e digite o código.',
      },
      {
        q: 'Que impressora serve?',
        a: 'Térmica de 58 ou 80 mm (Epson, Elgin, Bematech, Daruma e as genéricas), ligada por USB, rede ou Bluetooth. No Windows, a impressora precisa estar instalada como impressora do Windows.',
      },
      {
        q: 'Quando a comanda sai?',
        a: 'Nas impressoras com “imprimir pedidos sozinha” ligado: ao aceitar o pedido ou assim que ele chega, como você escolher em Quando imprimir. Em Pedidos, imprimir comanda manda de novo quando quiser.',
      },
      {
        q: 'E se o aparelho estiver desligado?',
        a: 'Os pedidos esperam. Quando ele liga, imprime o que ficou para trás, com o aviso de impressão atrasada. Depois de 2 horas, a comanda não sai mais.',
      },
      {
        q: 'Saiu um símbolo no lugar do ç ou do ã',
        a: 'Abra a impressora, troque Acentos e toque em imprimir teste até sair certinho.',
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
        a: 'Toque na parte da página que quer mudar. No celular, o nome dela aparece embaixo (as setas passam para a vizinha): toque nele para editar. A prévia muda na hora.',
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
        a: 'Toque em “Cores e cantos”, no alto da lista. Se uma combinação ficar difícil de ler, o painel avisa antes de publicar.',
      },
      {
        q: 'Mudar a ordem ou esconder uma parte',
        a: 'Na lista, suba, desça ou esconda cada parte, ou adicione uma nova. O topo e o rodapé aparecem em todas as páginas.',
      },
      {
        q: 'Errei. Como volto atrás?',
        a: 'Toque em desfazer (a seta para trás), ou em “descartar” para voltar ao que está no ar. Se sair da tela antes de publicar, as mudanças continuam guardadas neste aparelho.',
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
  vendedor: {
    title: 'Duá',
    intro: 'O Duá, o vendedor com IA no WhatsApp da loja, e como você entra na conversa.',
    items: [
      {
        q: 'Como assumo uma conversa?',
        a: (
          <>
            Toque em <strong>assumir</strong> na conversa, ou no aviso do celular. Responder pelo
            WhatsApp da loja também vale: ele pausa sozinho naquela conversa. Para devolver, toque
            em <strong>devolver</strong>.
          </>
        ),
      },
      {
        q: 'Quando o Duá me chama?',
        a: 'Quando o cliente pede uma pessoa e nos casos que você escolheu em Configurar, como reclamação ou alergia. A conversa aparece em “Precisa de você” e o celular avisa.',
      },
      {
        q: 'Os preços que ele manda estão certos?',
        a: 'O resumo do pedido, a entrega e o Pix são calculados pela loja, como no site, e vêm com “calculado pela loja”. Quando ele cita um preço na conversa, é o do seu cardápio.',
      },
      {
        q: 'O que é o ensaio?',
        a: 'O Duá escreve o que responderia, mas não manda nada. Você continua atendendo e compara as respostas antes de ligar.',
      },
      {
        q: 'Como ensino algo que só eu sei?',
        a: (
          <>
            Em <L to="/vendedor/ensinar">Ensinar</L>: responda às perguntas que ele não soube ou
            escreva uma regra. Horário, taxas, preços e estoque ele já lê da loja.
          </>
        ),
      },
      {
        q: 'O Duá diz que é uma pessoa?',
        a: 'Nunca. Ele se apresenta como assistente virtual da loja (dá para tirar isso em Configurar) e, se perguntarem, conta que não é uma pessoa.',
      },
      {
        q: 'Posso dar outro nome a ele?',
        a: 'Não: em todas as lojas ele é o Duá. O jeito de falar e como ele se apresenta você escolhe em Configurar.',
      },
    ],
  },
  copiloto: {
    title: 'Copiloto',
    intro: 'O Duá no painel: você pergunta da loja ou pede uma mudança, e ele prepara.',
    items: [
      {
        q: 'O que posso perguntar?',
        a: 'Como vão as vendas, o que está acabando no estoque, o que mais vende, como está a cozinha. Ele responde com os números da loja.',
      },
      {
        q: 'O Duá muda alguma coisa sozinho?',
        a: (
          <>
            Não. Quando você pede uma mudança (pausar a loja, mudar um preço, criar um cupom, mudar
            o horário), ele monta um cartão com o antes e o depois. Nada muda até você tocar em{' '}
            <strong>confirmar</strong>. Se não quiser, toque em <strong>agora não</strong>.
          </>
        ),
      },
      {
        q: 'Quem da equipe usa o Copiloto?',
        a: 'Donos e gerentes. Cada pessoa tem a sua própria conversa com o Duá.',
      },
      {
        q: 'O que faz “nova conversa”?',
        a: 'O Duá esquece a conversa e começa do zero. O que você já confirmou continua valendo.',
      },
    ],
  },
  pdv: {
    title: 'PDV',
    intro: 'Venda no balcão, comandas nas mesas e o caixa do dia, com o cardápio da loja.',
    items: [
      {
        q: 'Como faço uma venda no balcão?',
        a: (
          <>
            Em <strong>Vender</strong>, toque nos produtos (o que tem opções pede elas antes),
            escolha <strong>para levar</strong> ou <strong>comer aqui</strong> e toque em{' '}
            <strong>cobrar</strong>. O total é sempre o que a loja calcula. No computador, é só
            digitar para buscar; Enter na busca põe o primeiro produto e Enter fora dela cobra.
          </>
        ),
      },
      {
        q: 'Como recebo em mais de uma forma, ou com troco?',
        a: (
          <>
            Ao cobrar, toque em <strong>dividir em formas</strong> e escolha cada forma com o seu
            valor. No dinheiro, digite quanto o cliente entregou: o troco aparece quando a venda
            fecha. No Pix, o QR da chave da loja aparece com o valor.
          </>
        ),
      },
      {
        q: 'Como funcionam as mesas?',
        a: (
          <>
            Em <L to="/pdv/mesas">Mesas</L>, toque numa mesa livre para abrir a comanda. Cada vez
            que você adiciona itens, sai uma rodada para a cozinha. Receba um pagamento de cada vez,
            ou divida a conta em partes: quando não falta nada, a comanda fecha e a mesa fica livre.
          </>
        ),
      },
      {
        q: 'Como abro e fecho o caixa?',
        a: (
          <>
            Em <L to="/pdv/caixa">Caixa</L>, abra com o troco da gaveta. Sangria é dinheiro que sai
            da gaveta e suprimento é o que entra. Para fechar, conte cada forma: o fechamento mostra
            o que sobrou ou faltou.
          </>
        ),
      },
      {
        q: 'O que só gerentes fazem?',
        a: 'Dar desconto, estornar um pagamento, cancelar uma comanda, criar e editar as mesas e mudar a taxa de serviço.',
      },
    ],
  },
};

const BY_ROUTE: Partial<Record<RouteId, TopicId>> = {
  pdv: 'pdv',
  pdvMesas: 'pdv',
  pdvComanda: 'pdv',
  pdvCaixa: 'pdv',
  pdvReport: 'pdv',
  copilot: 'copiloto',
  home: 'inicio',
  orders: 'pedidos',
  order: 'pedidos',
  history: 'pedidos',
  scheduled: 'pedidos',
  menu: 'cardapio',
  product: 'cardapio',
  store: 'loja',
  payments: 'pagamentos',
  whatsapp: 'whatsapp',
  printers: 'impressoras',
  customers: 'clientes',
  customer: 'clientes',
  marketing: 'marketing',
  appearance: 'aparencia',
  reports: 'relatorios',
  team: 'equipe',
  account: 'conta',
  profile: 'perfil',
  vendedorHome: 'vendedor',
  vendedorTrain: 'vendedor',
  vendedorConversations: 'vendedor',
  vendedorConversation: 'vendedor',
  vendedorTeach: 'vendedor',
  vendedorEnsaio: 'vendedor',
  vendedorClienteOculto: 'vendedor',
  vendedorResults: 'vendedor',
  vendedorSettings: 'vendedor',
  vendedorTest: 'vendedor',
};

export const topicFor = (route: RouteId | undefined): TopicId | null =>
  (route && BY_ROUTE[route]) || null;
