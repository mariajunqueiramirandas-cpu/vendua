<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'bebida',
    seoTitle: 'Delivery e loja online para adegas e bebidas · Venduá',
    description:
      'Estoque contado em cada garrafa, combos com gelo e carvão, pedido mínimo, entrega pela distância e Pix na sua conta. O delivery próprio da sua adega.',
    title: 'Delivery próprio e loja online para adegas',
    lede: 'O pedido chega com o fardo, o gelo e o carvão, com a conta feita e o estoque descontado. Você confere no celular e separa.',
    chapters: [
      {
        title: 'O estoque contado em cada garrafa',
        text: [
          'Cada produto pode ter estoque. A cada pedido, a loja desconta, e quando chega a zero o produto aparece como esgotado sozinho, sem você vender o que não tem. Quem chegou tarde pode entrar na lista de espera e recebe o aviso quando você repõe.',
          'No Início, “Precisa de você” mostra o que está acabando no número que você escolheu, antes de a geladeira ficar vazia. O cardápio já mora numa lista no WhatsApp? Cole a lista e cada linha vira um produto, com o nome e o preço.',
        ],
        screen: 'inicio',
        alt: 'O Início no app da Bolos da Nena: bom dia, Nena, e as vendas de hoje',
      },
      {
        title: 'O combo do churrasco, montado pelo cliente',
        text: [
          'Transforme o combo num Kit com etapas: primeiro a bebida, depois o gelo, depois o carvão. Em cada etapa aparece só o que você colocou nela. Gelada ou natural, com ou sem copo: escolhas assim ficam em Opções, com preço ou sem.',
          'Pedido novo toca no celular com som e aviso, mesmo com o app fechado. Você aceita direto da notificação, e o cliente acompanha pela página do pedido até a porta.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
        demo: { id: 'pedido', label: 'Veja um pedido entrar e ser aceito no celular' },
      },
      {
        title: 'Sábado de jogo, com a moto na rua',
        text: [
          'Quando os pedidos se acumulam, ligue “Muitos pedidos agora” e a loja avisa que a entrega está demorando mais. Se precisar parar, pause por 15 minutos, uma hora ou o resto do dia, com um recado para quem entrar.',
          'Os horários de cada dia, os feriados e os dias especiais ficam no app. Dia de jogo e a adega abre mais cedo? Use “Mudar o horário de hoje”, e amanhã tudo volta ao normal.',
        ],
        screen: 'pausar',
        alt: 'Pausar a loja no app da Bolos da Nena: 15 minutos, 1 hora ou o resto do dia, com recado para o cliente',
      },
      {
        title: 'Pedido mínimo, entrega pela distância e Pix',
        text: [
          'Defina um valor mínimo de pedido, e a taxa de entrega pode sair pela distância, com valor por quilômetro, taxa mínima e o limite até onde você entrega, ou por bairro, cada um com a sua taxa e o seu tempo.',
          'Com o Mercado Pago conectado, o Pix cai direto na sua conta e se confirma sozinho; a loja também aceita cartão e dinheiro. Quando a adega fecha, o Seu dia mostra o que mais saiu e o horário de pico.',
        ],
        screen: 'seuDia',
        alt: 'O Seu dia no app da Bolos da Nena: o resumo de quando a loja fecha',
        demo: { id: 'loja', label: 'Veja uma loja online tomando forma no celular' },
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz o estoque, os combos e o Pix. O Bandeira soma o que ajuda quando o telefone não para:',
      perks: [
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde se tem gelo, quanto sai o fardo e até que horas entrega, e fecha o pedido com os seus preços e o que tem no estoque.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. Quem pede todo fim de semana ganha mais um motivo para pedir de você.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'Numa impressora térmica, a comanda sai quando o pedido chega ou quando você aceita, e vai junto com a sacola para o entregador.',
        },
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Se a adega também tem porções, os pedidos aparecem numa tela na cozinha, item por item, com o tempo de cada um.',
        },
      ],
    },
    questions: [
      {
        q: 'A loja desconta o estoque sozinha?',
        a: 'Desconta. Com o estoque ligado no produto, cada pedido tira a quantidade vendida, e o produto aparece como esgotado quando chega a zero.',
      },
      {
        q: 'Posso pedir um valor mínimo para entregar?',
        a: 'Pode. Você define o pedido mínimo, e a taxa de entrega por distância ou por bairro.',
      },
      {
        q: 'A loja confere a idade de quem compra bebida alcoólica?',
        a: 'Não. A venda de bebida alcoólica para menores de 18 anos é proibida, então confira o documento na entrega ou na retirada, como você já faz no balcão.',
      },
      {
        q: 'Dá para montar combo com bebida, gelo e carvão?',
        a: 'Dá. Transforme o combo num Kit e crie as etapas. O cliente escolhe em cada uma, e o pedido chega com tudo descrito.',
      },
      {
        q: 'Meus clientes precisam baixar aplicativo?',
        a: 'Não. A loja abre no navegador do celular, pelo link que você divulga no Instagram, no WhatsApp ou no QR code do balcão.',
      },
    ],
    closing: 'O pedido do próximo jogo pode chegar pelo seu próprio link.',
  };
</script>

<NichePage {content} />
