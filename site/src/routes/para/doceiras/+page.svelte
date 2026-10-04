<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'bolo',
    seoTitle: 'Loja online para doceiras e confeitarias · Venduá',
    description:
      'Encomendas com data marcada, cardápio com fotos e sabores, Pix na sua conta e o celular avisando cada pedido. A loja online da Venduá para quem vende bolos e doces.',
    title: 'Loja online para doceiras e confeitarias',
    lede: 'O bolo de sábado, os docinhos da festa de domingo e a fatia de hoje chegam no mesmo lugar, cada um com a sua data. Você confere tudo no celular e cuida do forno.',
    chapters: [
      {
        title: 'As encomendas chegam com data marcada',
        text: [
          'Marque um bolo como “só por encomenda” e diga com quantos dias de antecedência você precisa. Na hora de pedir, o cliente escolhe a data, e o pedido cai em Encomendas, um calendário com os dias que os clientes escolheram.',
          'Nada de rolar conversa atrás de conversa para lembrar o que foi combinado: sabor, tamanho, data e pagamento estão no pedido. E com “Encomendas com a loja fechada” ligado, quem lembra do aniversário à meia-noite pede na hora, e o pedido está lá de manhã.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app da Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
      },
      {
        title: 'Um cardápio com a cara da sua vitrine',
        text: [
          'Cada bolo com foto, preço e descrição. Em Opções entram sabor, recheio e tamanho, cada escolha com o seu valor, e o cliente monta o pedido sozinho, sem aquela troca de mensagens para saber quanto fica.',
          'Se o seu cardápio já mora no WhatsApp, cole a lista: cada linha como “Pudim - 12,50” vira um produto. Acabou o brigadeiro de hoje? Marque “esgotado hoje” e ele volta sozinho à meia-noite. Quem queria entra na lista de espera e fica sabendo quando você fizer mais.',
        ],
        screen: 'cardapio',
        demo: { id: 'loja', label: 'Veja a loja da Bolos da Nena tomando forma' },
      },
      {
        title: 'O celular avisa, você aceita e volta para a batedeira',
        text: [
          'Pedido novo toca no celular, mesmo com o app fechado. Você escolhe o tempo de preparo e aceita direto da notificação. O cliente acompanha cada etapa pela página do pedido, sem precisar perguntar se já está pronto.',
          'O Pix cai direto na sua conta do Mercado Pago e se confirma sozinho. A loja também aceita cartão e dinheiro, e você escolhe se entrega, se o cliente retira ou os dois.',
        ],
        screen: 'pedidos',
        demo: { id: 'pedido', label: 'Veja um pedido chegando no celular' },
      },
      {
        title: 'Fornada atrasou? Pause a loja em dois toques',
        text: [
          'Em dia de muita encomenda, pause a loja por 15 minutos, uma hora ou o resto do dia, com um recado para quem entrar. Os horários de cada dia, os feriados e os dias especiais ficam combinados no app, e a loja abre e fecha sozinha.',
          'Quando a loja fecha, o Seu dia mostra o que mais saiu, o horário de pico e como foi em comparação com o mesmo dia da semana passada.',
        ],
        screen: 'pausar',
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz a loja, as encomendas e o Pix. O Bandeira soma o que ajuda quando as encomendas apertam:',
      perks: [
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quem pergunta se tem bolo de cenoura hoje e fecha o pedido, sempre com os seus preços, sabores e horários. Pediu para falar com você, ele chama.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. A freguesa do bolo de domingo tem mais um motivo para voltar.',
        },
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Os pedidos numa tela na cozinha, item por item, com o tempo de cada um. Quem confeita vê o que vem a seguir sem largar o bico de confeitar.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'Numa impressora térmica, a comanda sai quando o pedido chega ou quando você aceita.',
        },
      ],
    },
    questions: [
      {
        q: 'Dá para aceitar encomenda só com antecedência?',
        a: 'Dá. Em cada produto você liga “só por encomenda” e escolhe a antecedência mínima, em dias. O cliente só consegue escolher datas a partir dela.',
      },
      {
        q: 'Posso vender bolo inteiro por encomenda e fatia para hoje?',
        a: 'Pode. Cada produto tem a sua regra: o bolo inteiro fica só por encomenda e a fatia, de pronta entrega. O cliente vê os dois no mesmo cardápio.',
      },
      {
        q: 'Como cobro a mais pelo recheio especial ou pelo tamanho maior?',
        a: 'Em Opções, cada escolha tem o seu valor: recheio, cobertura, tamanho, topo de bolo. O preço final aparece para o cliente antes de pedir, e a conta é feita pela loja.',
      },
      {
        q: 'Vendo de casa. Funciona para mim?',
        a: 'Funciona. Você escolhe os bairros ou a distância em que entrega, cada um com a sua taxa, e se o cliente pode retirar na sua porta. O endereço de retirada só aparece para quem escolhe retirar.',
      },
      {
        q: 'Meus clientes precisam baixar aplicativo?',
        a: 'Não. Eles abrem o link da sua loja no navegador, escolhem, pagam e acompanham o pedido, sem cadastro e sem senha.',
      },
    ],
    closing: 'A sua confeitaria pode estar no ar ainda hoje.',
  };
</script>

<NichePage {content} />
