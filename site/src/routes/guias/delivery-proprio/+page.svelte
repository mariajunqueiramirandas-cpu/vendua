<script lang="ts">
  import Article from '$lib/components/Article.svelte';

  const outline = [
    { id: 'o-que-e', title: 'O que é ter um delivery próprio' },
    { id: 'aplicativos', title: 'Aplicativo de entrega ou link próprio' },
    { id: 'montar', title: 'O que montar antes de divulgar' },
    { id: 'areas', title: 'Áreas de entrega, taxas e pedido mínimo' },
    { id: 'quem-entrega', title: 'Quem entrega, e quem retira' },
    { id: 'primeiros', title: 'Como trazer os primeiros clientes para o link' },
    { id: 'medir', title: 'Acompanhar o que está funcionando' },
    { id: 'checklist', title: 'Para colocar no ar' },
  ];
</script>

<Article
  path="/guias/delivery-proprio/"
  pose="entrega"
  lede="Delivery próprio é receber pedidos por um link que é seu: o cliente pede direto para a sua cozinha, com os seus preços e as suas regras. Este guia mostra o que montar, quem entrega, como trazer os primeiros clientes e como saber se está dando certo."
  {outline}
  closing="Seus clientes pedindo direto para a sua cozinha."
>
  <h2 id="o-que-e">O que é ter um delivery próprio</h2>
  <p>
    Ter um delivery próprio é ter uma loja online para delivery que é só sua: o cliente abre o link,
    vê o cardápio, escolhe, paga e acompanha o pedido sem passar por outro aplicativo. O pedido cai
    direto para você, e quem compra fala com a sua cozinha.
  </p>
  <p>Três coisas mudam:</p>
  <ul>
    <li>
      <strong>O cliente fica com você.</strong> Nome, telefone, endereço e o que ele costuma pedir ficam
      na sua lista, e a próxima conversa é entre vocês.
    </li>
    <li>
      <strong>O preço é seu.</strong> O valor de cada produto e de cada entrega é o que você define.
    </li>
    <li>
      <strong>As regras são suas:</strong> horário, até onde entrega, pedido mínimo, se aceita retirada
      e como recebe.
    </li>
  </ul>
  <p>
    E não precisa de estrutura grande para começar. Dá para abrir com você mesmo entregando no
    bairro e o cardápio num link, e crescer a partir daí.
  </p>

  <h2 id="aplicativos">Aplicativo de entrega ou link próprio</h2>
  <p>
    Os aplicativos de entrega têm o seu lugar: muita gente procura comida neles, e eles podem trazer
    gente que ainda não conhece você. Mas cada um cobra as suas próprias taxas, segue as suas
    próprias regras, e o cliente que chega por lá é, antes de tudo, cliente do aplicativo.
  </p>
  <p>
    Para quem já tem freguesia no bairro, no WhatsApp e no Instagram, o link próprio é o caminho
    natural: quem já conhece a sua comida pede direto. Dá para usar os dois e, aos poucos, trazer
    para o link o cliente que já voltou algumas vezes. Para vender sem aplicativo de delivery, você
    precisa principalmente de um bom cardápio, de regras de entrega claras e de um motivo para o
    cliente mudar de hábito.
  </p>
  <p>
    Para comparar o que sai do seu bolso num caso e no outro, faça a conta com as suas vendas na
    <a href="/#preco">calculadora da página inicial</a>.
  </p>

  <h2 id="montar">O que montar antes de divulgar</h2>
  <p>
    Criar um delivery próprio começa antes da divulgação. Deixe pronto o que o cliente vai procurar:
  </p>
  <ul>
    <li>
      <strong>Cardápio:</strong> fotos, preços e as escolhas de cada produto. O guia
      <a href="/guias/cardapio-digital/">como montar um cardápio digital</a> mostra o passo a passo.
    </li>
    <li><strong>Horários:</strong> os de cada dia da semana, e o que muda nos feriados.</li>
    <li>
      <strong>Pagamento:</strong> Pix, cartão, dinheiro, e se o entregador leva troco.
    </li>
    <li><strong>Retirada:</strong> se o cliente pode buscar, onde e como.</li>
    <li><strong>Entrega:</strong> os lugares onde você entrega, com taxa e tempo.</li>
  </ul>
  <p>
    Depois, faça um pedido de teste como se fosse cliente, do seu celular, do começo ao fim. É o
    jeito mais rápido de achar a foto que faltou, a taxa errada ou o horário trocado.
  </p>

  <h2 id="areas">Áreas de entrega, taxas e pedido mínimo</h2>
  <p>
    Até onde entregar é a decisão que mais pesa num delivery próprio. Longe demais, a comida chega
    fria e o resto da fila atrasa. Perto demais, você perde venda que caberia na sua rota.
  </p>
  <p>Há dois jeitos comuns de cobrar a entrega:</p>
  <ul>
    <li>
      <strong>Por bairro:</strong> uma lista dos bairros atendidos, cada um com a sua taxa e o seu tempo.
      Fácil de explicar e de conferir.
    </li>
    <li>
      <strong>Por distância:</strong> a taxa sobe com os quilômetros, com um valor mínimo e uma distância
      máxima. Mais justo quando os bairros são grandes ou espalhados.
    </li>
  </ul>
  <p>
    Para chegar no valor, some o que cada entrega custa de verdade: combustível, o tempo de quem
    leva e o desgaste da moto ou do carro. A taxa pode não cobrir tudo, mas precisa ser uma escolha
    sua.
  </p>
  <p>
    O pedido mínimo protege a cozinha do pedido que custa mais para entregar do que vale. Escolha um
    valor que faça a viagem compensar e deixe-o visível antes de o cliente encher a sacola. Se
    quiser deixar o frete por conta da loja de vez em quando, faça isso de propósito, num cupom.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Monte as áreas por bairro ou por distância, cada uma com a sua taxa e o seu tempo, ou ligue
      “Cobrar pela distância”: a taxa sai pelo caminho de carro, com o valor por km, uma taxa mínima
      e a distância máxima. O pedido mínimo vale para a loja toda, e o cliente vê a taxa da entrega
      antes de pedir.
    </p>
  </aside>

  <h2 id="quem-entrega">Quem entrega, e quem retira</h2>
  <p>
    No começo, a entrega pode ficar com você ou com alguém da família, nos horários mais calmos e
    nos bairros mais perto. Quando o movimento cresce, o passo seguinte costuma ser um motoboy de
    confiança. Combine com ele antes da primeira saída:
  </p>
  <ul>
    <li>quanto recebe e quando: por entrega, por turno ou por dia;</li>
    <li>quem paga o combustível e o que acontece em dia de chuva;</li>
    <li>como recebe em dinheiro e como acerta o troco com você;</li>
    <li>o cuidado com a comida: bolsa térmica, caixa em pé, bebida separada.</li>
  </ul>
  <p>
    E não esqueça a retirada. Para quem mora perto, buscar na sua porta é rápido, e para você é um
    pedido sem viagem. Diga onde retirar, como avisar que chegou e em que horário.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Quando o pedido sai, marque “saiu para entrega”, e a página do pedido do cliente muda para
      essa etapa, sem ele precisar perguntar. Para a retirada, escreva “Onde retirar” e, se quiser,
      “Como retirar”: o cliente vê os dois ao escolher buscar.
    </p>
  </aside>

  <h2 id="primeiros">Como trazer os primeiros clientes para o link</h2>
  <p>
    O link não se divulga sozinho. Os primeiros pedidos vêm de quem já compra de você, então comece
    por eles:
  </p>
  <ul>
    <li>
      <strong>No WhatsApp:</strong> o link no perfil, no status e na resposta de quem pergunta o cardápio.
    </li>
    <li>
      <strong>No Instagram:</strong> o link na bio e um lembrete nos stories quando o cardápio muda.
    </li>
    <li>
      <strong>Na entrega:</strong> um QR code na sacola, na caixa ou num cartãozinho, para o próximo pedido
      vir pelo link.
    </li>
    <li>
      <strong>No balcão:</strong> se você tem ponto, o QR code na parede, à vista de quem espera.
    </li>
  </ul>
  <p>
    Dê um motivo para o primeiro pedido pelo link, como um desconto ou o frete por conta da loja, só
    na primeira vez. E tenha paciência: o cliente leva alguns pedidos para trocar o hábito de mandar
    mensagem. Responder a pergunta com o link, com gentileza, ensina o caminho.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Em Cupons, crie um desconto em porcentagem ou em valor fixo, ou um cupom de entrega sem custo
      para o cliente, e ligue “Só no primeiro pedido”. Em Compartilhar a loja, você copia o link,
      manda pelo WhatsApp ou baixa o QR code para imprimir na sacola.
    </p>
  </aside>

  <h2 id="medir">Acompanhar o que está funcionando</h2>
  <p>
    Delivery próprio dá trabalho no começo, então vale olhar os números uma vez por mês. Três
    perguntas bastam:
  </p>
  <ul>
    <li>Quanto vendi pelo link, semana a semana? Está crescendo?</li>
    <li>De quais bairros vêm os pedidos, e a taxa de cada um faz sentido?</li>
    <li>De onde pediram e eu não entrego? Se um lugar aparece sempre, talvez valha incluir.</li>
  </ul>
  <p>
    Olhe também quem voltou. Quem pede pela segunda vez pelo link já aprendeu o caminho. Quem sumiu
    talvez só precise de uma conversa, no WhatsApp, do jeito que você já faz.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Em Relatórios, você vê as vendas por período e por área de entrega, e os lugares de onde
      pediram entrega e você não entrega. Dá para baixar tudo numa planilha. Em Clientes, cada um
      aparece pelo telefone, com os pedidos, o que mais pede e o último endereço.
    </p>
  </aside>

  <h2 id="checklist">Para colocar no ar</h2>
  <ul>
    <li>Cardápio com fotos, preços e escolhas.</li>
    <li>Horários de cada dia e dos feriados.</li>
    <li>Áreas de entrega com taxa e tempo, e o pedido mínimo.</li>
    <li>Quem entrega, quanto recebe e como acerta o troco.</li>
    <li>As formas de pagamento que você aceita.</li>
    <li>Um pedido de teste, do começo ao fim.</li>
    <li>
      O link no WhatsApp, na bio e num QR code na sacola, com um cupom para o primeiro pedido.
    </li>
  </ul>
  <p>
    Veja como isso fica no dia a dia de cada cozinha: a loja online para
    <a href="/para/marmitarias/">marmitarias</a>, <a href="/para/hamburguerias/">hamburguerias</a>,
    <a href="/para/padarias/">padarias</a> e <a href="/para/doceiras/">doceiras e confeitarias</a>.
    E se quiser montar tudo de uma vez, a Venduá monta a loja com você em 8 perguntas, pelo celular.
  </p>
</Article>
