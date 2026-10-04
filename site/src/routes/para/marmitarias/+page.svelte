<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'marmita',
    seoTitle: 'Cardápio digital e pedidos para marmitarias · Venduá',
    description:
      'Cardápio do dia que muda do almoço para a janta, kits de marmita fitness, estoque contado e Pix na sua conta. Pedidos e delivery de marmita no seu celular.',
    title: 'Cardápio digital e pedidos para marmitarias',
    lede: 'No cardápio digital da sua marmitaria, o prato do almoço aparece na hora do almoço e a sopa, na hora da janta. Cada pedido chega completo no celular, com endereço e pagamento, e você continua no fogão.',
    chapters: [
      {
        title: 'Almoço e janta, cada prato no seu horário',
        text: [
          'Cada produto tem os seus Dias e horários. A feijoada entra no cardápio só às quartas, o frango grelhado só no almoço e o caldo verde só à noite. Fora desses horários, você escolhe se o prato aparece como indisponível ou some do cardápio, e ninguém pede a janta ao meio-dia.',
          'Os horários da loja ficam combinados dia a dia, com os feriados e os dias especiais. Vai fechar mais cedo hoje? Em “Mudar o horário de hoje” você ajusta só o dia, e amanhã tudo volta ao normal. Fora do horário, o cliente pode montar a sacola, e o pedido só fecha quando a loja abre.',
        ],
        screen: 'loja',
        alt: 'Os horários da loja dia a dia no app, aqui com a Bolos da Nena',
      },
      {
        title: 'Kits de marmita fitness e o estoque contado',
        text: [
          'Com Kit, o cliente monta a refeição em etapas: escolhe a proteína, depois o acompanhamento, depois a bebida. Em Opções entram o tamanho e os adicionais, cada um com o seu valor, e o total aparece antes de pedir. Serve para o prato do dia e para o pacote de marmitas fitness da semana.',
          'Fez quarenta marmitas de strogonoff? Ligue Estoque e cada pedido desconta uma. Quando chegar no número que você escolheu, o prato aparece em “Precisa de você”, no Início, e no zero ele vira esgotado sozinho. Quem chegou tarde entra na lista de espera e fica sabendo se sair outra panela.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
        demo: { id: 'loja', label: 'Veja uma loja ganhando nome, cores e cardápio' },
      },
      {
        title: 'A correria do almoço sem perder pedido',
        text: [
          'Pedido novo toca no celular, mesmo com o app fechado, e você aceita direto da notificação, com 15, 30 ou 45 minutos de preparo. Em preparo, saiu para entrega, entregue: cada passo aparece na página do pedido, e o cliente não precisa mandar mensagem perguntando onde está a marmita.',
          'Apertou? Ligue “Muitos pedidos agora” e a loja avisa que o preparo está levando mais tempo. Se a cozinha precisar respirar, pause por 15 minutos, uma hora ou o resto do dia, com um recado para quem entrar. E com “Tela ligada”, o celular fica acordado em cima da bancada.',
        ],
        screen: 'pausar',
        alt: 'Pausar a loja no app da Bolos da Nena: 15 minutos, 1 hora ou o resto do dia, com recado para o cliente',
        demo: { id: 'pedido', label: 'Veja um pedido chegando e saindo para entrega' },
      },
      {
        title: 'Delivery de marmita com a taxa certa',
        text: [
          'Diga onde você entrega: por bairro ou por distância, cada área com a sua taxa e o seu tempo. Ou cobre pela distância, com valor por quilômetro pelo caminho de carro, uma taxa mínima e até onde você vai. Um pedido mínimo faz a entrega compensar, e quem trabalha perto pode retirar no balcão.',
          'Com o Mercado Pago conectado, o Pix se confirma sozinho e cai direto na sua conta, sem conferir comprovante por comprovante. No fim do expediente, o Seu dia mostra quanto você vendeu, a marmita que mais saiu e o horário de pico, comparado com o mesmo dia da semana passada.',
        ],
        screen: 'seuDia',
        alt: 'O Seu dia no app da Bolos da Nena: o resumo de quando a loja fecha',
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz o cardápio do dia, o estoque e o Pix. O Bandeira soma o que ajuda quando a fila do almoço cresce:',
      perks: [
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quem pergunta qual é a marmita de hoje e fecha o pedido, sempre com os seus preços, taxas e o estoque do dia. Se o cliente pergunta de alergia ou quer falar com você, ele chama.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vira um selo, e os selos viram um prêmio. Quem almoça com você a semana inteira vê o prêmio chegar logo.',
        },
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Os pedidos numa tela na cozinha, item por item, com o tempo de cada um: no tempo, atenção, atrasado. Quem fecha as marmitas vê a fila inteira sem parar para olhar o celular.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'Numa impressora térmica, a comanda sai quando o pedido chega ou quando você aceita, pronta para ir junto com a marmita na sacola.',
        },
      ],
    },
    questions: [
      {
        q: 'Consigo mostrar um cardápio no almoço e outro na janta?',
        a: 'Consegue. Cada prato tem os seus Dias e horários: o do almoço fica à venda só no almoço, e o da janta, só à noite. Fora do horário, ele aparece como indisponível ou some do cardápio, você escolhe.',
      },
      {
        q: 'Dá para vender as marmitas da semana por encomenda?',
        a: 'Dá. Marque o produto como “só por encomenda” e escolha a antecedência mínima, em dias. O cliente escolhe a data ao pedir, e o calendário de Encomendas mostra o que sai em cada dia.',
      },
      {
        q: 'E quando a marmita de hoje acaba?',
        a: 'Com o estoque ligado, ela vira esgotada sozinha quando chega a zero. Sem contar estoque, marque “esgotado hoje” e ela volta sozinha à meia-noite. Quem queria pode entrar na lista de espera.',
      },
      {
        q: 'Vendo marmita fitness em tamanhos diferentes. Como fica o preço?',
        a: 'Em Opções, cada escolha tem o seu valor: o tamanho, a proteína extra, a troca do acompanhamento. O cliente vê o total antes de pedir, e a conta é feita pela loja.',
      },
      {
        q: 'Como sei se vale a pena entregar em outro bairro?',
        a: 'Os relatórios mostram as vendas por área de entrega e os lugares onde pediram entrega e você ainda não entrega. Dá também para baixar tudo numa planilha.',
      },
    ],
    closing: 'O cardápio de amanhã pode estar no ar ainda hoje.',
  };
</script>

<NichePage {content} />
