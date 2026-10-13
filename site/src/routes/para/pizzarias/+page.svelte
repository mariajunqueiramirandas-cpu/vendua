<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'pizza',
    seoTitle: 'Delivery e cardápio digital para pizzarias · Venduá',
    description:
      'Pizza meio a meio cobrada do jeito que você escolher, borda recheada somada no total, entrega pela distância e Pix na sua conta. O delivery próprio da sua pizzaria.',
    title: 'Delivery próprio e cardápio digital para pizzarias',
    lede: 'O pedido chega com os dois sabores, a borda e o refrigerante, com a conta já feita. Você confere no celular e a pizza vai para o forno.',
    chapters: [
      {
        title: 'Meio a meio, cobrado do seu jeito',
        text: [
          'No cardápio digital da sua pizzaria, os sabores ficam num grupo de Opções, e você diz quantos cabem numa pizza: dois, três ou quatro. A regra do grupo decide o preço. Com “Mais caro”, a pizza meio a meio sai pelo sabor mais caro. Com “Média”, sai pela média dos sabores escolhidos.',
          'A borda recheada e os adicionais ficam em outro grupo, com a regra “Soma”: cada escolha entra no total com o seu valor. O cliente vê o preço mudar antes de pedir, ninguém grava áudio perguntando quanto fica, e você não refaz a conta no papel.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
        demo: { id: 'loja', label: 'Veja uma loja online tomando forma no celular' },
      },
      {
        title: 'Pizza grande, broto e o combo da família',
        text: [
          'Cada tamanho pode ser um produto, com foto, preço e os seus sabores. A pizza doce de sobremesa entra na mesma sacola. Para o combo de sábado, transforme a oferta num Kit com etapas: primeiro a pizza grande, depois a broto doce, depois o refrigerante.',
          'O pedido toca no celular com som e aviso, mesmo com o app fechado. Você aceita direto da notificação, escolhe 15, 30 ou 45 minutos de preparo, e o cliente acompanha pela página do pedido, do forno até a porta.',
        ],
        screen: 'pedidos',
        alt: 'A lista de pedidos no app, aqui com a Bolos da Nena: os pedidos novos, cada um com o botão aceitar',
        demo: { id: 'pedido', label: 'Veja um pedido entrar e ser aceito no celular' },
      },
      {
        title: 'Sábado à noite, com o forno cheio',
        text: [
          'Quando os pedidos se acumulam, ligue “Muitos pedidos agora” e a loja avisa que o preparo está demorando mais. Se precisar parar, pause por 15 minutos, uma hora ou o resto do dia, com um recado para quem entrar.',
          'Abre só à noite? Os horários de cada dia ficam no app, e fora deles o cliente já pode montar a sacola, mas o pedido só fecha quando a pizzaria abre. Cada pessoa da equipe usa o próprio celular, e o app registra quem aceitou cada pedido.',
        ],
        screen: 'pausar',
        alt: 'Pausar a loja no app da Bolos da Nena: 15 minutos, 1 hora ou o resto do dia, com recado para o cliente',
      },
      {
        title: 'Entrega pela distância e Pix que se confirma',
        text: [
          'A taxa de entrega pode sair pela distância: um valor por quilômetro pelo caminho de carro, uma taxa mínima e o limite até onde você entrega. Se preferir, monte áreas por bairro, cada uma com a sua taxa e o seu tempo.',
          'Com o Mercado Pago conectado, o Pix cai direto na sua conta e se confirma sozinho; a loja também aceita cartão pelo site e dinheiro na entrega. Quando a pizzaria fecha, o Seu dia mostra o sabor que mais saiu e o horário de pico.',
        ],
        screen: 'seuDia',
        alt: 'O Seu dia no app da Bolos da Nena: o resumo de quando a loja fecha',
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz o cardápio, o meio a meio e o Pix. O Bandeira soma o que faz diferença quando o forno não para:',
      perks: [
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Cada pedido numa tela na cozinha, item por item, com o tempo correndo. Separe estações pelas categorias do cardápio, como pizzas e bebidas, e cada tela mostra só o que é dela.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'A comanda sai numa impressora térmica, por USB, rede ou Bluetooth, assim que o pedido chega ou quando você aceita, com os sabores de cada metade escritos.',
        },
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quem pergunta os sabores e monta o meio a meio, sempre com os seus preços, taxas e horários. Reclamação ou pedido para falar com você, ele chama.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. A pizza de sexta da família ganha mais um motivo para ser sua.',
        },
      ],
    },
    questions: [
      {
        q: 'Como cobro a pizza meio a meio?',
        a: 'Coloque os sabores num grupo de Opções e escolha a regra: “Mais caro” cobra o sabor mais caro, “Média” cobra a média dos sabores. Você define quantos sabores cabem em cada pizza.',
      },
      {
        q: 'E a borda recheada?',
        a: 'Crie um grupo de bordas com a regra “Soma”. A borda escolhida entra no total com o seu preço, e o cliente vê o valor antes de pedir.',
      },
      {
        q: 'Tenho muitos sabores. Cabe tudo?',
        a: 'Cabe. Um grupo de Opções aceita até 100 sabores, e cada um pode ter descrição. O sabor que acabou, você desliga e liga de novo quando quiser.',
      },
      {
        q: 'Posso cobrar a entrega pela distância?',
        a: 'Pode. A taxa sai pelo caminho de carro, com valor por quilômetro, taxa mínima e distância máxima. Se preferir, use áreas por bairro, cada uma com a sua taxa.',
      },
      {
        q: 'Meus clientes precisam baixar aplicativo?',
        a: 'Não. A loja abre no navegador do celular, pelo link que você divulga no Instagram, no WhatsApp ou no QR code da caixa da pizza.',
      },
    ],
    closing: 'A pizza do próximo sábado pode chegar pelo seu próprio link.',
  };
</script>

<NichePage {content} />
