<script lang="ts">
  import NichePage, { type NicheContent } from '$lib/components/NichePage.svelte';

  const content: NicheContent = {
    kind: 'pao',
    seoTitle: 'Loja online e encomendas para padarias · Venduá',
    description:
      'Encomendas de salgados e tortas com antecedência, fornada esgotada que avisa quando volta, retirada no balcão e Pix na sua conta. A loja online da sua padaria.',
    title: 'Loja online e encomendas para padarias',
    lede: 'O pão de queijo da manhã, o cento de salgados do aniversário e a torta de sábado chegam no mesmo celular, cada um no seu horário. Você acompanha as encomendas online e não tira o olho da fornada.',
    chapters: [
      {
        title: 'Quando a fornada acaba, a lista de espera avisa',
        text: [
          'Na loja online da sua padaria, cada produto mostra se ainda tem. Acabou o pão de queijo? Marque “esgotado hoje” e ele volta sozinho à meia-noite, pronto para a fornada de amanhã. Se você conta estoque, nem precisa marcar: quando chega a zero, o produto aparece como esgotado sozinho.',
          'Quem chegou tarde pode entrar na lista de espera. Quando você repõe, a loja avisa essas pessoas que o produto voltou, e a broa da tarde encontra quem queria. No Início, “Precisa de você” mostra o que está acabando no número que você escolheu, antes de o balcão ficar vazio.',
        ],
        screen: 'inicio',
        alt: 'O Início no app da Bolos da Nena: bom dia, Nena, e as vendas de hoje',
      },
      {
        title: 'Encomendas para festas, com antecedência mínima',
        text: [
          'Cento de coxinha, torta salgada, bolo de aniversário: marque o produto como “só por encomenda” e escolha a antecedência mínima, em dias. Na hora de pedir, o cliente escolhe a data, e só aparecem os dias que respeitam o seu prazo. E nenhum cento de coxinha chega de surpresa para amanhã cedo.',
          'Em Encomendas, um calendário mostra os dias que os clientes escolheram, e você planeja a produção da semana olhando um lugar só. Com “Encomendas com a loja fechada” ligado, o pedido da festa entra mesmo depois que a padaria baixa a porta. Os sabores de cada salgado e o pagamento vêm no próprio pedido.',
        ],
        screen: 'pedido',
        alt: 'Um pedido aberto no app, aqui com a Bolos da Nena: os itens, o total, o cliente e o botão aceitar',
      },
      {
        title: 'Do primeiro pão da manhã ao lanche da tarde',
        text: [
          'A loja abre quando a padaria abre, por mais cedo que seja: os horários de cada dia, os feriados e os dias especiais ficam no app. E cada produto pode ter os seus Dias e horários, como o pão de queijo só de manhã e a pizza brotinho só no fim da tarde. Fora deles, o produto fica indisponível ou some, você escolhe.',
          'O forno atrasou e a padaria abre mais tarde? Use “Mudar o horário de hoje”, e amanhã tudo volta ao normal. Fora do horário, o cliente já pode montar a sacola, e o pedido só fecha quando a loja abre. Saiu sonho fresquinho? Um “Aviso na loja” conta para quem entrar.',
        ],
        screen: 'loja',
        alt: 'Os horários da loja dia a dia no app, aqui com a Bolos da Nena',
        demo: { id: 'loja', label: 'Veja uma loja sendo montada, do nome ao cardápio' },
      },
      {
        title: 'Retirada no balcão ou entrega no bairro',
        text: [
          'Muita gente prefere passar e pegar. Na retirada, você explica onde retirar e como retirar, do balcão da frente ao portão lateral. Para quem quer receber em casa, a entrega vai por bairro ou por distância, cada área com a sua taxa e o seu tempo, e você pode pedir um valor mínimo de pedido.',
          'Pedido novo toca no celular, mesmo com o app fechado, e você aceita da notificação com 15, 30 ou 45 minutos de preparo. Quando você marca pronto, a página do pedido mostra para o cliente, que passa na hora certa. O Pix se confirma sozinho com o Mercado Pago conectado, e a loja também aceita cartão e dinheiro.',
        ],
        screen: 'pedidos',
        alt: 'A lista de pedidos no app, aqui com a Bolos da Nena: os pedidos novos, cada um com o botão aceitar',
        demo: { id: 'pedido', label: 'Veja um pedido chegando, do aviso ao pronto' },
      },
    ],
    extras: {
      lede: 'O Venduá Mirim já traz as encomendas, a lista de espera e o Pix. O Bandeira soma o que ajuda quando o balcão enche:',
      perks: [
        {
          feature: 'vendedor',
          name: 'O Duá no WhatsApp',
          text: 'O Duá, o vendedor com IA no WhatsApp da loja, responde quem pergunta se ainda tem sonho ou até que horas a padaria fica aberta e fecha o pedido, sempre com os seus preços, horários e o que tem no estoque. Pediu para falar com você, ele chama.',
        },
        {
          feature: 'loyalty',
          name: 'Cartão fidelidade',
          text: 'Cada pedido entregue vale um selo, e os selos viram um prêmio. O freguês do pão de todo dia ganha mais um motivo para pedir de você.',
        },
        {
          feature: 'kds',
          name: 'Tela da cozinha',
          text: 'Os pedidos numa tela na produção, item por item, com o tempo de cada um. Separe estações por categoria, como salgados e confeitaria, e cada tela mostra só o que é dela.',
        },
        {
          feature: 'printing',
          name: 'Comanda impressa sozinha',
          text: 'Numa impressora térmica, a comanda sai quando o pedido chega ou quando você aceita, e a encomenda vai para a produção já no papel.',
        },
      ],
    },
    questions: [
      {
        q: 'Dá para vender pão de queijo só de manhã?',
        a: 'Dá. Abra o produto e, em Dias e horários, deixe só as manhãs. No resto do dia ele fica indisponível na loja, ou nem aparece, se você preferir.',
      },
      {
        q: 'Como funciona a encomenda de salgados para festa?',
        a: 'Marque o produto como “só por encomenda” e defina a antecedência mínima, em dias, até 60. O cliente escolhe a data ao pedir, e a encomenda entra no calendário de Encomendas.',
      },
      {
        q: 'O cliente pode escolher os sabores do cento de salgados?',
        a: 'Pode. Em Opções, crie um grupo com os sabores e diga quantas escolhas cabem no cento. O cliente monta o pedido sozinho, e ele chega com cada sabor anotado.',
      },
      {
        q: 'Posso abrir a loja online bem cedo?',
        a: 'Pode. Os horários são por dia da semana, e feriados e dias especiais têm os seus. Se um dia a padaria abrir mais tarde, mude só o horário de hoje: amanhã volta ao normal.',
      },
      {
        q: 'Quem vem retirar sabe onde pegar?',
        a: 'Sabe. Na retirada, você escreve onde retirar e como retirar, e o cliente acompanha pela página do pedido até ficar pronto.',
      },
    ],
    closing: 'A sua padaria pode abrir a loja online antes da próxima fornada.',
  };
</script>

<NichePage {content} />
