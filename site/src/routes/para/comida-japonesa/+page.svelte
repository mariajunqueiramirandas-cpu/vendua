<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'sushi',
    seoTitle: 'Delivery e cardápio digital para comida japonesa · Venduá',
    description:
      'Combinados que o cliente monta, peças com foto e descrição, o aviso de frutos do mar em cada prato, entrega pela distância e Pix na sua conta. O delivery próprio do seu japonês.',
    title: 'Delivery próprio e cardápio digital para comida japonesa',
    lede: 'O combinado chega montado: as peças, o temaki, o hot roll e o shoyu a mais, com a conta já feita. Você confere no celular e o sushiman começa.',
    chapters: [
      {
        title: 'O combinado que o cliente monta',
        text: [
          'No cardápio digital do seu japonês, cada peça e cada combinado tem foto, preço e descrição. Transforme o combinado num Kit com etapas: primeiro os uramakis, depois os niguiris, depois o temaki. Em cada etapa aparece só o que você colocou nela, e o cliente vê o combinado inteiro antes de fechar.',
          'Cream cheese a mais, cebolinha, gergelim, molho tarê: os adicionais ficam em Opções, e a regra “Soma” coloca cada um no total. O cliente vê o preço mudar antes de pedir, e você não refaz a conta.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
        demo: { id: 'loja', label: 'Veja uma loja online tomando forma no celular' },
      },
      {
        title: 'Frutos do mar e glúten, avisados no prato',
        text: [
          'Cada produto pode dizer o que contém: frutos do mar, glúten, lactose, ovo, amendoim, castanhas. E também o que é: vegetariano, vegano, sem glúten, apimentado. O cliente vê antes de pedir, e quem tem alergia não precisa perguntar peça por peça.',
          'O peixe acabou? Marque o produto como “esgotado hoje” e ele volta sozinho à meia-noite. Se você conta estoque, nem precisa marcar: quando chega a zero, ele aparece como esgotado.',
        ],
        screen: 'cardapio',
        alt: 'O cardápio no app da Bolos da Nena: os produtos em categorias',
      },
      {
        title: 'Sexta à noite, com o balcão cheio',
        text: [
          'Pedido novo toca no celular com som e aviso, mesmo com o app fechado. Você aceita direto da notificação e escolhe o tempo de preparo. Quando os pedidos se acumulam, ligue “Muitos pedidos agora” e a loja avisa que vai demorar mais. Se precisar parar, pause com um recado para quem entrar.',
          'Abre só no jantar? Os horários de cada dia ficam no app, e fora deles o cliente já pode montar a sacola, mas o pedido só fecha quando a casa abre.',
        ],
        screen: 'pedidos',
        alt: 'A lista de pedidos no app, aqui com a Bolos da Nena: os pedidos novos, cada um com o botão aceitar',
        demo: { id: 'pedido', label: 'Veja um pedido entrar e ser aceito no celular' },
      },
      {
        title: 'Entrega pela distância e Pix que se confirma',
        text: [
          'A taxa de entrega pode sair pela distância, com valor por quilômetro, taxa mínima e o limite até onde você entrega, ou por bairro, cada um com a sua taxa e o seu tempo. Você pode pedir um valor mínimo de pedido.',
          'Com o Mercado Pago conectado, o Pix cai direto na sua conta e se confirma sozinho; a loja também aceita cartão e dinheiro. Quando a casa fecha, o Seu dia mostra o combinado que mais saiu e o horário de pico.',
        ],
        screen: 'seuDia',
        alt: 'O Seu dia no app da Bolos da Nena: o resumo de quando a loja fecha',
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz o cardápio, os combinados e o Pix. O Bandeira soma o que faz diferença quando a cozinha tem duas frentes:',
      perks: [
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Separe estações pelas categorias do cardápio, como o balcão do sushi e a cozinha quente, e cada tela mostra só o que é dela, item por item, com o tempo correndo.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'A comanda sai numa impressora térmica, por USB, rede ou Bluetooth, assim que o pedido chega ou quando você aceita.',
        },
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quantas peças vêm no combinado e se o prato tem frutos do mar, e fecha o pedido com os seus preços, taxas e horários.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. O japonês de sexta ganha mais um motivo para ser o seu.',
        },
      ],
    },
    questions: [
      {
        q: 'Como monto um combinado?',
        a: 'Transforme o combinado num Kit e crie as etapas, cada uma com as peças que podem entrar e quantas o cliente escolhe. O pedido chega com o combinado descrito.',
      },
      {
        q: 'Dá para avisar que o prato tem frutos do mar?',
        a: 'Dá. Em cada produto, marque o que ele contém, como frutos do mar, glúten ou lactose. O aviso aparece para o cliente antes de pedir.',
      },
      {
        q: 'A cozinha quente e o sushi podem ver pedidos separados?',
        a: 'Podem, com a tela da cozinha do Venduá Bandeira: cada estação mostra só as categorias que são dela.',
      },
      {
        q: 'Posso cobrar a entrega pela distância?',
        a: 'Pode. A taxa sai pelo caminho de carro, com valor por quilômetro, taxa mínima e distância máxima. Se preferir, use áreas por bairro.',
      },
      {
        q: 'Meus clientes precisam baixar aplicativo?',
        a: 'Não. A loja abre no navegador do celular, pelo link que você divulga no Instagram, no WhatsApp ou no QR code da embalagem.',
      },
    ],
    closing: 'O combinado da próxima sexta pode chegar pelo seu próprio link.',
  };
</script>

<NichePage {content} />
