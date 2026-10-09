<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'burger',
    seoTitle: 'Delivery e cardápio digital para hamburguerias · Venduá',
    description:
      'Adicionais com preço em cada escolha, combos que o cliente monta, entrega cobrada pela distância e Pix na sua conta. O delivery próprio da sua hamburgueria.',
    title: 'Delivery próprio e cardápio digital para hamburguerias',
    lede: 'O pedido chega montado: o pão, o ponto da carne, o bacon a mais e a batata do combo, com cada adicional já somado. Você confere no celular e volta para a chapa.',
    chapters: [
      {
        title: 'Adicionais com preço em cada escolha',
        text: [
          'No cardápio digital da sua hamburgueria, cada lanche tem foto, preço e descrição, e os adicionais ficam em Opções. Com a regra “Soma”, cada adicional escolhido entra no total com o seu valor. Você define quantas escolhas o cliente pode fazer em cada grupo, do ponto da carne ao molho da casa.',
          'Bacon, cheddar, ovo, cebola caramelizada: o cliente marca o que quiser e vê o preço mudar antes de pedir. Ninguém grava áudio perguntando quanto fica, e você não refaz a conta no papel, porque ela é feita pela loja. Se o cardápio já mora numa lista no WhatsApp, cole a lista e cada linha vira um produto.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
        demo: { id: 'loja', label: 'Veja uma loja online tomando forma no celular' },
      },
      {
        title: 'O combo montado pelo cliente, etapa por etapa',
        text: [
          'Transforme o combo num Kit, com etapas para o cliente montar: primeiro o hambúrguer, depois o acompanhamento, depois a bebida. Em cada etapa aparece só o que você colocou nela, e o cliente vê o combo inteiro antes de fechar. Dá para ter o combo do dia, o da dupla e o da família.',
          'O pedido toca no celular com som e aviso, mesmo com o app fechado, e chega com cada lanche do jeito que foi montado. Você aceita direto da notificação, escolhe 15, 30 ou 45 minutos de preparo, e o cliente acompanha pela página do pedido, da chapa até a porta.',
        ],
        screen: 'pedidos',
        alt: 'A lista de pedidos no app, aqui com a Bolos da Nena: os pedidos novos, cada um com o botão aceitar',
        demo: { id: 'pedido', label: 'Veja um pedido entrar e ser aceito no celular' },
      },
      {
        title: 'Sexta à noite, com a chapa lotada',
        text: [
          'Quando os pedidos se acumulam, ligue “Muitos pedidos agora” e a loja avisa que o preparo está demorando mais. Se precisar parar, pause por 15 minutos, uma hora ou o resto do dia, com um recado para quem entrar. O cliente sabe o que esperar antes de pedir, e você não responde um por um.',
          'Cada pessoa da equipe usa o próprio celular, como dono, gerente ou atendente, e o app registra quem aceitou cada pedido e quem mandou para a entrega. Abre só à noite? Os horários de cada dia ficam no app, e com “Tela ligada” o aparelho do balcão não apaga no meio do movimento.',
        ],
        screen: 'pausar',
        alt: 'Pausar a loja no app da Bolos da Nena: 15 minutos, 1 hora ou o resto do dia, com recado para o cliente',
      },
      {
        title: 'Entrega pela distância e Pix que se confirma',
        text: [
          'No seu delivery próprio, a taxa pode sair pela distância: um valor por quilômetro pelo caminho de carro, uma taxa mínima e o limite até onde você entrega. Se preferir, monte áreas por bairro, cada uma com a sua taxa e o seu tempo. E quem mora na esquina retira no balcão, sabendo onde e como retirar.',
          'Com o Mercado Pago conectado, o Pix cai direto na sua conta e se confirma sozinho; a loja também aceita cartão pelo site e dinheiro. Divulgue o link no Instagram e imprima o QR code para o balcão. Quando a loja fecha, o Seu dia mostra o lanche que mais saiu e o horário de pico.',
        ],
        screen: 'seuDia',
        alt: 'O Seu dia no app da Bolos da Nena: o resumo de quando a loja fecha',
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz o cardápio, os adicionais e o Pix. O Bandeira soma o que faz diferença quando a chapa não para:',
      perks: [
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Cada pedido numa tela na cozinha, item por item, com o tempo correndo: no tempo, atenção, atrasado. Separe estações pelas categorias do cardápio, como lanches, porções e bebidas, e cada tela mostra só o que é dela. E o pedido que não pode esperar, você passa na frente.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'A comanda sai numa impressora térmica de 58 ou 80 mm, por USB, rede ou Bluetooth, assim que o pedido chega ou quando você aceita. Quem imprime é o app Venduá Impressora, num computador com Windows ou num tablet Android.',
        },
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quem pergunta até que horas dá para pedir e fecha o pedido com os adicionais, sempre com os seus preços, taxas e horários. Reclamação ou pedido para falar com você, ele chama, e você assume a conversa quando quiser.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. A turma do hambúrguer de sexta ganha mais um motivo para pedir de você.',
        },
      ],
    },
    questions: [
      {
        q: 'Como cobro cada adicional separado?',
        a: 'Em Opções, crie um grupo de adicionais com a regra “Soma”: cada escolha soma o seu valor ao lanche. Você define o mínimo e o máximo de escolhas do grupo, e o cliente vê o total antes de pedir.',
      },
      {
        q: 'Dá para montar combo com lanche, batata e bebida?',
        a: 'Dá. Transforme o combo num Kit e crie as etapas: uma para o hambúrguer, outra para o acompanhamento, outra para a bebida. O cliente escolhe em cada etapa, e o pedido chega com tudo descrito.',
      },
      {
        q: 'Minha hamburgueria só abre à noite. Dá para pedir antes?',
        a: 'O cliente pode montar a sacola fora do horário, mas só finaliza o pedido quando a loja abre. Os horários de cada dia, os feriados e os dias especiais você ajusta no app.',
      },
      {
        q: 'Posso cobrar a entrega pela distância?',
        a: 'Pode. Em “cobrar pela distância”, a taxa sai pelo caminho de carro, com valor por quilômetro, uma taxa mínima e uma distância máxima. Se preferir, use áreas por bairro, cada uma com a sua taxa.',
      },
      {
        q: 'A tela da cozinha e a impressão da comanda estão em qual plano?',
        a: 'No Venduá Bandeira. No Venduá Mirim, os pedidos chegam e são acompanhados pelo app no celular, com som, aviso e o aceitar direto da notificação.',
      },
    ],
    closing: 'O pedido da próxima sexta pode chegar pelo seu próprio link.',
  };
</script>

<NichePage {content} />
