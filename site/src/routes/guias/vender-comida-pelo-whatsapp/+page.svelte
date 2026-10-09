<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';

  const outline = [
    { id: 'por-que', title: 'Por que o pedido se perde na conversa' },
    { id: 'link', title: 'Mande um link, não a foto do cardápio' },
    { id: 'pedido-completo', title: 'O pedido completo de uma vez' },
    { id: 'pix', title: 'Pix sem caçar comprovante' },
    { id: 'horarios', title: 'Horários claros, inclusive para dizer não' },
    { id: 'respostas', title: 'Responder rápido sem viver no celular' },
    { id: 'divulgar', title: 'Onde divulgar o link' },
    { id: 'resumo', title: 'Para fazer esta semana' },
  ];
</script>

<Article
  path="/guias/vender-comida-pelo-whatsapp/"
  pose="avatar-ola"
  lede="O WhatsApp é onde o seu cliente já está, e é por ele que a maioria das cozinhas pequenas vende. O problema é quando o pedido some entre um áudio, uma figurinha e um “oi, tudo bem?”. Este guia mostra como manter a conversa e tirar o pedido dela."
  {outline}
  closing="Deixe o WhatsApp para conversar. O pedido chega pronto."
>
  <h2 id="por-que">Por que o pedido se perde na conversa</h2>
  <p>
    Vender pelo WhatsApp começa bem: o cliente chama, você responde, sai o pedido. Com dez clientes
    por dia, ainda dá para segurar tudo de cabeça. Com trinta, começa a escapar. O sabor ficou
    combinado três mensagens acima, o endereço veio num áudio, o comprovante do Pix chegou num print
    que você ainda não abriu.
  </p>
  <p>
    O que se perde não é a conversa, é a <strong>estrutura do pedido</strong>: o que foi pedido,
    para quando, para onde, quanto deu e se já foi pago. Quando essas cinco informações ficam
    espalhadas, cada pedido custa várias mensagens e uma conferência no fim do dia. A saída é deixar
    a conversa para tirar dúvidas e mandar o pedido para um lugar onde ele chega completo.
  </p>

  <h2 id="link">Mande um link, não a foto do cardápio</h2>
  <p>
    A foto do cardápio resolve a primeira pergunta e cria todas as outras: “tem de chocolate hoje?”,
    “quanto fica com entrega?”, “ainda dá tempo?”. Cada resposta é uma mensagem que você escreve com
    a mão suja de massa.
  </p>
  <p>
    Um cardápio digital, aberto num link, responde sozinho. O cliente vê o que tem hoje, com foto e
    preço, escolhe sabor e tamanho, e o total aparece antes de ele pedir. O que acabou aparece como
    esgotado, em vez de virar uma conversa. Para montar um, veja o guia
    <a href="/guias/cardapio-digital/">Cardápio digital: o que é e como montar o seu</a>.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Se o seu cardápio já está escrito no WhatsApp, use “colar lista” no app: cada linha como
      “Pudim - 12,50” vira um produto. Depois é só pôr as fotos. A loja fica em
      seunome.vendua.com.br, e o cliente abre no navegador, sem baixar nada e sem criar conta.
    </p>
  </aside>

  <h2 id="pedido-completo">O pedido completo de uma vez</h2>
  <p>Todo pedido de comida precisa das mesmas respostas. Peça todas no mesmo momento:</p>
  <ul>
    <li><strong>O que:</strong> os itens, com sabor, tamanho e adicionais.</li>
    <li><strong>Quando:</strong> agora ou numa data, se for encomenda.</li>
    <li><strong>Onde:</strong> entrega, com endereço completo, ou retirada.</li>
    <li><strong>Quanto:</strong> o total com a taxa de entrega, calculado antes de confirmar.</li>
    <li><strong>Como paga:</strong> Pix, cartão ou dinheiro, e se precisa de troco.</li>
  </ul>
  <p>
    Pela conversa, isso vira um questionário que você repete o dia inteiro. Num formulário de
    pedido, o cliente responde sozinho, na ordem certa, e não consegue esquecer o endereço. Você
    recebe o pedido pronto para aceitar.
  </p>
  <figure class="shot">
    <Phone width={250}>
      <Screen key="pedido" sizes="(max-width: 560px) 62vw, 250px" />
    </Phone>
    <figcaption>
      Um pedido no app da Venduá, como a Nena recebe na Bolos da Nena: itens, total, cliente e o
      botão para aceitar.
    </figcaption>
  </figure>

  <h2 id="pix">Pix sem caçar comprovante</h2>
  <p>
    Comprovante por print é o ponto mais frágil da venda pelo WhatsApp. Ele chega fora de ordem, às
    vezes é de outro dia, e conferir cada um no app do banco toma tempo justamente na hora de mais
    movimento.
  </p>
  <p>
    Há dois jeitos de sair disso. O mais simples é ter uma chave Pix só da loja e conferir os
    recebimentos de uma vez, em vez de pedido por pedido. O mais tranquilo é usar um Pix que se
    confirma sozinho: o pedido já chega marcado como pago, e você só começa a preparar o que foi
    pago.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Com a sua conta do Mercado Pago conectada, o Pix cai direto nela e o pedido se confirma
      sozinho. Sem o Mercado Pago, o cliente paga na sua chave Pix e o pedido fica em “Pix para
      conferir” até você marcar como pago. Cartão e dinheiro também entram, se você ligar.
    </p>
  </aside>

  <h2 id="horarios">Horários claros, inclusive para dizer não</h2>
  <p>
    Pelo WhatsApp, a loja está sempre aberta, porque a conversa está. O cliente manda mensagem às
    23h e espera resposta. Deixar os horários escritos e visíveis tira essa pressão: o que chega
    fora do horário espera a abertura, e ninguém fica no vácuo achando que você sumiu.
  </p>
  <p>
    Vale o mesmo para os dias cheios. Quando a cozinha não dá conta, é melhor avisar que o preparo
    vai demorar, ou parar de receber por um tempo, do que aceitar tudo e atrasar todo mundo. Um
    recado curto resolve: “Hoje estamos com muitos pedidos, o preparo está levando mais tempo.”
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Os horários de cada dia, os feriados e os dias especiais ficam no app. Em dia apertado, pause
      a loja por 15 minutos, uma hora ou o resto do dia, com um recado para quem entrar, ou ligue
      “Muitos pedidos agora”. Encomendas podem continuar entrando com a loja fechada, se você
      quiser.
    </p>
  </aside>

  <h2 id="respostas">Responder rápido sem viver no celular</h2>
  <p>
    Quem pergunta pelo WhatsApp quer resposta rápida, e quem cozinha não pode largar o fogão a cada
    notificação. Três hábitos ajudam:
  </p>
  <ul>
    <li>
      <strong>Respostas prontas</strong> para o que mais perguntam: horário, onde entrega, quanto é a
      taxa, se tem opção sem lactose. Escreva uma vez e use sempre.
    </li>
    <li>
      <strong>O link da loja na primeira resposta.</strong> Boa parte das perguntas some quando o cliente
      vê o cardápio.
    </li>
    <li>
      <strong>Avisos de andamento</strong> no lugar do “já está pronto?”: quando o cliente acompanha o
      pedido por uma página, ele não precisa perguntar.
    </li>
  </ul>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      No Venduá Bandeira, o Duá, o vendedor com IA no WhatsApp da loja, responde os seus clientes e
      fecha o pedido com eles, sempre com os preços, os horários e as taxas da loja. Ele se
      apresenta como assistente virtual da loja, nunca como uma pessoa, e chama você quando o
      cliente pede para falar com alguém. Você pode assumir qualquer conversa e devolver depois.
      <a href="/#demo-vendedor">Veja uma conversa com o Duá</a>.
    </p>
  </aside>

  <h2 id="divulgar">Onde divulgar o link</h2>
  <p>
    O link só funciona se o cliente encontrar. Ponha-o onde as pessoas já procuram por você: na
    descrição do perfil do WhatsApp, na bio do Instagram, no status quando o cardápio do dia mudar e
    na mensagem automática de boas-vindas. Na entrega, um QR code impresso na sacola ou na caixa
    leva o cliente direto para o próximo pedido.
  </p>
  <p>
    Aos poucos, o cliente aprende o caminho: em vez de mandar “oi, tem o quê hoje?”, ele abre o link
    e pede. A conversa continua existindo, para o que é conversa de verdade.
  </p>

  <h2 id="resumo">Para fazer esta semana</h2>
  <ul>
    <li>Escreva o cardápio com preços, sabores e tamanhos num lugar só.</li>
    <li>Defina os horários e os bairros onde entrega, com a taxa de cada um.</li>
    <li>Escolha como vai conferir o Pix e deixe isso claro para o cliente.</li>
    <li>Crie respostas prontas para as cinco perguntas que mais chegam.</li>
    <li>Coloque o link do pedido no perfil, na bio e no status.</li>
  </ul>
  <p>
    Se quiser fazer tudo isso de uma vez, a Venduá monta a loja com você em 8 perguntas, pelo
    celular. Veja <a href="/#veja">como funciona</a>.
  </p>
</Article>
