<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'salgado',
    seoTitle: 'Loja online e encomendas para salgadeiras · Venduá',
    description:
      'Cento de salgados por encomenda com data marcada, sabores escolhidos pelo cliente, congelados com estoque contado e Pix na sua conta. A loja online de quem faz salgados.',
    title: 'Loja online e encomendas para salgadeiras',
    lede: 'O cento da festa de sábado, a porção frita para hoje e o pacote de congelados chegam no mesmo celular, cada um com a sua data. Você acompanha tudo e não sai de perto da panela.',
    chapters: [
      {
        title: 'O cento da festa, com data marcada',
        text: [
          'Marque o cento como “só por encomenda” e escolha a antecedência mínima, em dias. Na hora de pedir, o cliente escolhe a data, e só aparecem os dias que respeitam o seu prazo. Nenhum cento de coxinha chega de surpresa para amanhã cedo.',
          'Em Encomendas, um calendário mostra os dias que os clientes escolheram, e você planeja a produção da semana olhando um lugar só. Com “Encomendas com a loja fechada” ligado, a encomenda entra mesmo de madrugada, quando a cozinha já dormiu.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
      },
      {
        title: 'Os sabores escolhidos pelo cliente',
        text: [
          'Coxinha, kibe, bolinha de queijo, risole: em Opções, crie um grupo com os sabores e diga quantos o cliente pode escolher. O salgado especial, de camarão ou de costela, pode custar a mais com a regra “Soma”. O pedido chega com cada sabor anotado.',
          'O cardápio já mora numa lista no WhatsApp? Cole a lista e cada linha vira um produto, com o nome e o preço. Depois é só pôr as fotos e marcar o que contém glúten, lactose ou ovo, para quem precisa saber antes de pedir.',
        ],
        screen: 'cardapio',
        alt: 'O cardápio no app da Bolos da Nena: os produtos em categorias',
        demo: { id: 'loja', label: 'Veja uma loja sendo montada, do nome ao cardápio' },
      },
      {
        title: 'Congelados com o estoque contado',
        text: [
          'O pacote de 50 salgados congelados é um produto como os outros, com estoque. Quando chega a zero, ele aparece como esgotado sozinho, e quem chegou tarde pode entrar na lista de espera. Quando você repõe, a loja avisa essas pessoas que o pacote voltou.',
          'No Início, “Precisa de você” mostra o que está acabando no número que você escolheu, antes de o freezer ficar vazio. A porção frita na hora pode ter os seus Dias e horários, como só no fim da tarde, e fora deles fica indisponível.',
        ],
        screen: 'inicio',
        alt: 'O Início no app da Bolos da Nena: bom dia, Nena, e as vendas de hoje',
      },
      {
        title: 'Retirada no portão ou entrega no bairro',
        text: [
          'Na retirada, você explica onde e como retirar, do balcão ao portão de casa. Para quem quer receber, a entrega vai por bairro ou por distância, cada área com a sua taxa e o seu tempo, e você pode pedir um valor mínimo de pedido.',
          'Pedido novo toca no celular, mesmo com o app fechado, e você aceita da notificação. O Pix se confirma sozinho com o Mercado Pago conectado, e a loja também aceita cartão e dinheiro.',
        ],
        screen: 'pedidos',
        alt: 'A lista de pedidos no app, aqui com a Bolos da Nena: os pedidos novos, cada um com o botão aceitar',
        demo: { id: 'pedido', label: 'Veja um pedido chegando, do aviso ao pronto' },
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz as encomendas, o estoque e o Pix. O Bandeira soma o que ajuda quando a semana enche de festa:',
      perks: [
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quem pergunta o preço do cento e a data mais próxima e fecha a encomenda, sempre com os seus preços, prazos e o que tem no estoque.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'Numa impressora térmica, a comanda sai quando o pedido chega ou quando você aceita, e a encomenda vai para a produção já no papel, com os sabores.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. Quem pede o cento de todo aniversário ganha mais um motivo para voltar.',
        },
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Os pedidos numa tela na produção, item por item, com o tempo de cada um. Separe estações por categoria, como fritos e congelados.',
        },
      ],
    },
    questions: [
      {
        q: 'Como funciona a encomenda do cento?',
        a: 'Marque o produto como “só por encomenda” e defina a antecedência mínima, em dias, até 60. O cliente escolhe a data ao pedir, e a encomenda entra no calendário de Encomendas.',
      },
      {
        q: 'O cliente pode escolher os sabores?',
        a: 'Pode. Em Opções, crie um grupo com os sabores e diga quantas escolhas cabem. O pedido chega com cada sabor anotado.',
      },
      {
        q: 'Vendo salgado frito para hoje e cento por encomenda. Dá para ter os dois?',
        a: 'Dá. Cada produto tem a sua regra: a porção frita vende para hoje, nos horários que você escolher, e o cento só por encomenda, com a sua antecedência.',
      },
      {
        q: 'Vendo de casa. Funciona para mim?',
        a: 'Funciona. Você escolhe os bairros ou a distância em que entrega, e se o cliente pode retirar na sua porta. O endereço de retirada só aparece para quem escolhe retirar.',
      },
      {
        q: 'Meus clientes precisam baixar aplicativo?',
        a: 'Não. A loja abre no navegador do celular, pelo link que você divulga no Instagram ou manda no WhatsApp.',
      },
    ],
    closing: 'O cento da próxima festa pode chegar pelo seu próprio link.',
  };
</script>

<NichePage {content} />
