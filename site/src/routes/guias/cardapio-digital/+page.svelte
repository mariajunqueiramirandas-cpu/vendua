<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';

  const outline = [
    { id: 'o-que-e', title: 'O que é um cardápio digital' },
    { id: 'o-que-ter', title: 'O que não pode faltar' },
    { id: 'nomes', title: 'Nomes e descrições que respondem antes da pergunta' },
    { id: 'fotos', title: 'Fotos boas com o celular' },
    { id: 'categorias', title: 'Categorias na ordem em que o cliente pensa' },
    { id: 'opcoes', title: 'Tamanhos, sabores e adicionais com preço' },
    { id: 'divulgar', title: 'Divulgar o link e manter tudo em dia' },
    { id: 'checklist', title: 'Para montar o seu' },
  ];
</script>

<Article
  path="/guias/cardapio-digital/"
  pose="catalogo"
  lede="Cardápio digital é o link que o cliente abre para ver o que você vende, quanto custa e o que tem hoje, e pedir dali mesmo. Este guia mostra o que ele precisa ter e como montar o seu, da foto do prato ao QR code na sacola."
  {outline}
  closing="Seu cardápio num link, pronto para o cliente pedir."
>
  <h2 id="o-que-e">O que é um cardápio digital</h2>
  <p>
    Um cardápio digital, ou cardápio online, é uma página na internet com tudo o que a sua cozinha
    vende: cada produto com foto, descrição e preço, separado por categorias. O cliente abre pelo
    link, no celular, sem baixar nada. Saber como fazer um cardápio digital bom é, no fundo, saber
    responder pelo cardápio o que hoje você responde pela conversa.
  </p>
  <p>
    Ele não é a foto do cardápio impresso nem um PDF mandado no WhatsApp. Foto e PDF mostram o que
    você vendia no dia em que foram feitos. Não avisam que o brigadeiro acabou, não somam o
    adicional de bacon e não recebem pedido. O cliente lê, fecha e pergunta tudo de novo.
  </p>
  <p>
    Um cardápio digital para delivery está vivo: o que acabou aparece como esgotado, o preço novo
    vale na hora, e o cliente monta o pedido e vê o total antes de enviar. É isso que separa um
    cardápio que vende de uma vitrine bonita.
  </p>

  <h2 id="o-que-ter">O que não pode faltar</h2>
  <p>
    Antes de pensar em cores, garanta o básico. Quem abre o seu cardápio quer saber, sem precisar
    perguntar:
  </p>
  <ul>
    <li><strong>O que tem:</strong> os produtos separados por categoria, cada um com foto.</li>
    <li><strong>Como é:</strong> um nome claro e uma descrição curta do que vem.</li>
    <li>
      <strong>Quanto custa:</strong> o preço de cada item e de cada escolha, como tamanho, sabor e adicionais.
    </li>
    <li><strong>O que acabou:</strong> o que esgotou hoje, antes de o cliente escolher.</li>
    <li><strong>Quando:</strong> os dias e horários em que a loja recebe pedidos.</li>
    <li>
      <strong>Quanto fica a entrega:</strong> a taxa e o tempo para o bairro dele, ou se dá para retirar.
    </li>
    <li><strong>O pedido mínimo,</strong> se você trabalha com um.</li>
  </ul>
  <p>
    Cada item que fica de fora vira uma mensagem no seu WhatsApp. Se a taxa não aparece, alguém
    pergunta. Se o horário não aparece, alguém pede às onze da noite e fica esperando resposta.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Se o seu cardápio já mora numa mensagem do WhatsApp, cole a lista no app: uma linha por
      produto, com o nome, um traço e o preço, e cada linha vira um produto. Depois você põe as
      fotos e arruma as categorias. Horários, áreas de entrega com as taxas e o pedido mínimo ficam
      na loja, e o cliente vê tudo antes de pedir.
    </p>
  </aside>

  <h2 id="nomes">Nomes e descrições que respondem antes da pergunta</h2>
  <p>
    O nome é a primeira coisa que o cliente lê, então ele precisa dizer o que é. “Especial da casa”
    não diz nada. “Bolo de cenoura com cobertura de chocolate” diz tudo. Se a casa tem nomes
    próprios, junte o que é logo depois: “Marmita da vó: carne de panela, arroz, feijão e farofa”.
  </p>
  <p>A descrição responde o que chegaria pelo WhatsApp. Uma boa descrição conta:</p>
  <ul>
    <li>o que vem, na ordem em que o cliente vê ou come;</li>
    <li>quanto serve: fatias, gramas ou para quantas pessoas;</li>
    <li>o que pode surpreender: pimenta, lactose, glúten, castanhas;</li>
    <li>como chega: gelado, para esquentar, num pote que vai ao micro-ondas.</li>
  </ul>
  <p>
    Duas ou três linhas bastam. Escreva como você falaria no balcão, sem adjetivo vazio. “Massa
    fofinha e recheio de brigadeiro feito no dia” vende mais que “delicioso e irresistível”, porque
    o cliente consegue imaginar.
  </p>

  <h2 id="fotos">Fotos boas com o celular</h2>
  <p>
    A foto é o que faz o cliente parar no produto. Não precisa de câmera profissional, precisa de
    luz e de um pouco de cuidado.
  </p>
  <ul>
    <li>
      <strong>Luz:</strong> perto de uma janela, de dia, sem flash. A luz que vem de lado mostra a textura
      da massa, do molho, da cobertura.
    </li>
    <li>
      <strong>Fundo:</strong> limpo e sempre o mesmo, como uma tábua, uma toalha lisa ou o balcão. O fundo
      repetido dá ao cardápio cara de loja.
    </li>
    <li>
      <strong>Ângulo:</strong> de cima para pratos, marmitas e pizzas; de frente, na altura da mesa, para
      bolos, lanches e copos, que têm altura para mostrar.
    </li>
    <li>
      <strong>Enquadramento:</strong> o produto ocupando quase a foto toda, na embalagem em que o cliente
      vai receber.
    </li>
    <li>
      <strong>Verdade:</strong> fotografe o que você entrega. Se o pote é menor que o da foto, o cliente
      percebe na primeira entrega.
    </li>
  </ul>
  <p>
    Separe uma manhã para fotografar tudo de uma vez, com a mesma luz e o mesmo fundo, e produto
    novo ganha foto no dia em que entra. Antes de começar, limpe a lente do celular na barra da
    camiseta: é o truque mais simples e o mais esquecido.
  </p>

  <h2 id="categorias">Categorias na ordem em que o cliente pensa</h2>
  <p>
    Categorias são as prateleiras do cardápio. Separe como o cliente procura, não como a cozinha
    produz: “Marmitas”, “Bebidas”, “Sobremesas”, em vez de “Produção de terça”.
  </p>
  <ul>
    <li>Comece pelo que mais vende. A primeira categoria é a mais vista.</li>
    <li>Use poucas categorias, com nomes curtos. Se uma tem um produto só, junte com outra.</li>
    <li>
      Deixe bebidas e sobremesas para o fim: são o complemento, e o cliente chega nelas com o prato
      já escolhido.
    </li>
    <li>
      Dê aos itens de época uma categoria própria enquanto durarem, como “Páscoa” ou “Festa junina”.
    </li>
  </ul>
  <figure class="shot">
    <Phone width={250}>
      <Screen
        key="cardapio"
        alt="O cardápio da Bolos da Nena no app da Venduá, com os produtos separados por categoria"
        sizes="(max-width: 560px) 62vw, 250px"
      />
    </Phone>
    <figcaption>
      O cardápio da Bolos da Nena no app da Venduá: 14 produtos em 4 categorias.
    </figcaption>
  </figure>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Cada produto pode ter os seus dias e horários. Fora deles, ele aparece como indisponível ou
      some do cardápio, você escolhe. É assim que o almoço aparece só no almoço e a janta só à
      noite, como mostra a página de
      <a href="/para/marmitarias/">cardápio digital e pedidos para marmitarias</a>.
    </p>
  </aside>

  <h2 id="opcoes">Tamanhos, sabores e adicionais com preço</h2>
  <p>
    Preço confuso é a maior fonte de pergunta: “e se for o grande?”, “quanto é o bacon a mais?”. No
    cardápio digital, toda escolha que muda o preço mostra o próprio preço.
  </p>
  <p>Pense em três tipos de escolha:</p>
  <ul>
    <li>
      <strong>Tamanho:</strong> pequeno, médio e grande, ou meia e inteira. O cliente escolhe um, e cada
      um tem o seu valor.
    </li>
    <li>
      <strong>Sabor e ponto:</strong> escolhas que não mudam o preço, mas não podem faltar, como o sabor
      do suco ou o ponto da carne. Torne obrigatórias e o pedido nunca chega pela metade.
    </li>
    <li>
      <strong>Adicionais:</strong> o que soma ao preço, como queijo extra, bacon ou granulado. Diga quantos
      o cliente pode escolher.
    </li>
  </ul>
  <p>
    Em combos, mostre o que entra e o que o cliente escolhe em cada parte: um lanche, um
    acompanhamento, uma bebida. E se você vende meio a meio, decida antes como cobra, pela média dos
    dois sabores ou pelo mais caro, e deixe isso escrito. Numa hamburgueria, adicional e combo são
    boa parte do pedido, como mostra a página de
    <a href="/para/hamburguerias/">cardápio digital para hamburguerias</a>, mas qualquer cozinha com
    escolhas ganha com a mesma clareza.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Em Opções, cada grupo de escolhas tem o seu jeito de cobrar: somar os adicionais, tirar a
      média (bom para meio a meio) ou cobrar pelo mais caro. Você marca se o grupo é obrigatório e
      quantas escolhas cabem nele. Combos viram um Kit, em etapas para o cliente montar, e o total
      aparece antes do pedido, calculado pela loja.
    </p>
  </aside>

  <h2 id="divulgar">Divulgar o link e manter tudo em dia</h2>
  <p>Com o cardápio pronto, o link precisa estar onde o cliente já procura por você:</p>
  <ul>
    <li>no perfil do WhatsApp e na primeira resposta a quem pergunta “tem o quê hoje?”;</li>
    <li>na bio do Instagram e nos destaques;</li>
    <li>no status, sempre que entrar novidade ou o prato do dia mudar;</li>
    <li>num QR code impresso no balcão, na sacola, na caixa ou num ímã de geladeira.</li>
  </ul>
  <p>
    E o cardápio só ajuda se estiver certo. Um produto que aparece mas acabou frustra mais do que um
    que nem aparece. Crie o hábito: ao abrir a cozinha, confira o que tem; quando algo acabar,
    marque na hora; quando um preço mudar, mude no cardápio antes de mudar na conversa. Uma vez por
    mês, abra o link no celular e leia tudo como se fosse cliente.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Vendeu a última fatia? Marque “esgotado hoje” e o produto volta sozinho à meia-noite. Quem
      queria pode entrar na lista de espera e fica sabendo quando você fizer mais. Em Compartilhar a
      loja, você copia o link, manda pelo WhatsApp ou baixa o QR code para imprimir.
    </p>
  </aside>

  <h2 id="checklist">Para montar o seu</h2>
  <ul>
    <li>Liste os produtos com nome claro, descrição curta e preço.</li>
    <li>Fotografe tudo numa manhã, com a mesma luz e o mesmo fundo.</li>
    <li>Agrupe em poucas categorias, com o que mais vende primeiro.</li>
    <li>Defina tamanhos, sabores e adicionais, cada escolha com o seu preço.</li>
    <li>Escreva os horários, as taxas de entrega e o pedido mínimo.</li>
    <li>Ponha o link no perfil, na bio, no status e num QR code.</li>
    <li>Reserve um minuto por dia para marcar o que acabou.</li>
  </ul>
  <p>
    Com o cardápio no ar, o passo seguinte é receber os pedidos por um link só seu. Veja o guia
    <a href="/guias/delivery-proprio/"
      >delivery próprio: como ter a sua loja online e vender direto</a
    >.
  </p>
</Article>
