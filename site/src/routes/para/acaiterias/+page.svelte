<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'acai',
    seoTitle: 'Delivery e cardápio digital para açaiterias · Venduá',
    description:
      'O copo montado pelo cliente, com cada acompanhamento somado no total, o que acabou fora do cardápio, entrega pela distância e Pix na sua conta. O delivery próprio da sua açaiteria.',
    title: 'Delivery próprio e cardápio digital para açaiterias',
    lede: 'O copo chega montado: o tamanho, a granola, a banana, o leite em pó em dobro e a calda, com cada adicional já somado. Você confere no celular e monta.',
    chapters: [
      {
        title: 'O copo montado pelo cliente',
        text: [
          'Cada tamanho do açaí, de 300 ml a 1 litro, pode ser um produto com o seu preço. Os acompanhamentos ficam em Opções: os da casa com preço zero, os especiais com o seu valor, e a regra “Soma” coloca cada um no total. Você diz quantos o cliente pode escolher.',
          'Leite em pó em dobro? Cada acompanhamento pode ser escolhido mais de uma vez, até o limite que você definir, e o preço acompanha. O cliente vê o total mudar antes de pedir, e o pedido chega com o copo descrito, na ordem de montar.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
        demo: { id: 'loja', label: 'Veja uma loja online tomando forma no celular' },
      },
      {
        title: 'Acabou o morango? Some do copo',
        text: [
          'Quando um acompanhamento acaba, você desliga só ele, e os copos continuam à venda com o resto. Acabou o açaí de 1 litro? Marque “esgotado hoje” e ele volta sozinho à meia-noite. Se você conta estoque, nem precisa marcar.',
          'Os produtos podem ter os seus Dias e horários, como a tigela de café da manhã só até as 11h. Fora deles, o produto fica indisponível ou some, você escolhe. E um “Aviso na loja” conta a novidade da semana para quem entrar.',
        ],
        screen: 'cardapio',
        alt: 'O cardápio no app da Bolos da Nena: os produtos em categorias',
      },
      {
        title: 'Domingo de calor, com fila no balcão',
        text: [
          'Quando os pedidos se acumulam, ligue “Muitos pedidos agora” e a loja avisa que o preparo está demorando mais. Se precisar parar, pause por 15 minutos, uma hora ou o resto do dia, com um recado para quem entrar.',
          'Pedido novo toca no celular com som e aviso, mesmo com o app fechado. Você aceita direto da notificação, escolhe o tempo de preparo, e o cliente acompanha pela página do pedido até a porta.',
        ],
        screen: 'pausar',
        alt: 'Pausar a loja no app da Bolos da Nena: 15 minutos, 1 hora ou o resto do dia, com recado para o cliente',
        demo: { id: 'pedido', label: 'Veja um pedido entrar e ser aceito no celular' },
      },
      {
        title: 'Entrega pela distância e Pix que se confirma',
        text: [
          'A taxa de entrega pode sair pela distância, com valor por quilômetro, taxa mínima e o limite até onde você entrega, ou por bairro, cada um com a sua taxa e o seu tempo. Quem mora perto retira no balcão.',
          'Com o Mercado Pago conectado, o Pix cai direto na sua conta e se confirma sozinho; a loja também aceita cartão e dinheiro. Quando a açaiteria fecha, o Seu dia mostra o copo que mais saiu e o horário de pico.',
        ],
        screen: 'seuDia',
        alt: 'O Seu dia no app da Bolos da Nena: o resumo de quando a loja fecha',
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz o cardápio, os acompanhamentos e o Pix. O Bandeira soma o que ajuda nos dias de calor:',
      perks: [
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quem pergunta os tamanhos e monta o copo com o cliente, sempre com os seus preços, taxas e o que ainda tem.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. O açaí de toda tarde ganha mais um motivo para ser seu.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'Numa impressora térmica, a comanda sai quando o pedido chega ou quando você aceita, com o copo descrito para quem monta.',
        },
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Os pedidos numa tela no balcão de montagem, item por item, com o tempo de cada um.',
        },
      ],
    },
    questions: [
      {
        q: 'Como cobro os acompanhamentos especiais?',
        a: 'Em Opções, deixe os acompanhamentos da casa com preço zero e dê o valor dos especiais. Com a regra “Soma”, cada escolha entra no total, e você define quantas cabem no copo.',
      },
      {
        q: 'O cliente pode pedir o mesmo acompanhamento duas vezes?',
        a: 'Pode, até o limite que você puser em cada acompanhamento. O preço acompanha a quantidade.',
      },
      {
        q: 'E quando um acompanhamento acaba?',
        a: 'Desligue só ele no app. Os copos continuam à venda, sem aquela opção, até você ligar de novo.',
      },
      {
        q: 'Posso cobrar a entrega pela distância?',
        a: 'Pode. A taxa sai pelo caminho de carro, com valor por quilômetro, taxa mínima e distância máxima. Se preferir, use áreas por bairro.',
      },
      {
        q: 'Meus clientes precisam baixar aplicativo?',
        a: 'Não. A loja abre no navegador do celular, pelo link que você divulga no Instagram, no WhatsApp ou no QR code do balcão.',
      },
    ],
    closing: 'O açaí do próximo domingo pode sair pelo seu próprio link.',
  };
</script>

<NichePage {content} />
