<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import BumpBar from '$lib/posts/tela-da-cozinha/BumpBar.svelte';
  import Panel from '$lib/posts/tela-da-cozinha/Panel.svelte';
  import Rail from '$lib/posts/tela-da-cozinha/Rail.svelte';
  import Sounds from '$lib/posts/tela-da-cozinha/Sounds.svelte';
  import Stations from '$lib/posts/tela-da-cozinha/Stations.svelte';

  const outline = [
    { id: 'relogio', title: 'Cada pedido com o próprio relógio' },
    { id: 'fila', title: 'A fila se arruma sozinha' },
    { id: 'sons', title: 'Dá para cozinhar sem olhar para a tela' },
    { id: 'estacoes', title: 'Uma tela para cada estação' },
    { id: 'teclado', title: 'Mão suja não precisa tocar no vidro' },
    { id: 'painel', title: 'O número chamado no balcão' },
    { id: 'como', title: 'Como a gente fez' },
  ];
</script>

<Article
  path="/novidades/tela-da-cozinha/"
  pose="horarios"
  lede="Seis da tarde, a hora mais cheia do dia. Três comandas presas no trilho, uma encomenda de aniversário no forno e alguém perguntando no balcão se o bolo já saiu. A partir de agora a cozinha da sua loja tem uma tela: cada pedido aparece com um relógio, muda de cor antes de atrasar e diz em palavras o que está acontecendo."
  {outline}
  closing="Cada pedido com o seu relógio. A cozinha vê o atraso antes de ele chegar."
>
  <h2 id="relogio">Cada pedido com o próprio relógio</h2>
  <p>
    Comanda de papel não avisa nada. Ela fica pendurada no trilho do jeito que chegou, e quem olha
    precisa fazer a conta de cabeça: esse entrou quando? Prometi quanto tempo? Já passou? Num dia
    calmo dá certo. Às seis da tarde, com o salão cheio e o motoboy esperando, a conta escapa, e
    quem descobre o atraso é o cliente.
  </p>
  <p>
    Na tela da cozinha, a conta é feita por ela. O relógio de cada pedido começa no momento em que
    você aceita, e corre contra o tempo de preparo que você escolheu ali mesmo. Na hora de aceitar
    aparecem 15, 30 e 45 minutos, mais o tempo de preparo de sempre da sua loja, que já vem marcado.
    Se você nunca mudou, ele é de 30 minutos.
  </p>
  <p>
    Enquanto o pedido está dentro do prazo, ele aparece como <strong>no tempo</strong>. Quando passa
    de 60% do tempo de preparo, fica âmbar e ganha a palavra <strong>atenção</strong>. Quando
    estoura, fica vermelho, com listras andando na barra, e a palavra muda para
    <strong>atrasado</strong>. A cor nunca vem sozinha: tem sempre a palavra junto, para quem
    enxerga pouco cor, para quem olha de longe e para a tela que pega o sol da tarde.
  </p>
  <p>
    Arraste a hora abaixo e veja o trilho da Bolos da Nena entre 18h e 19h. Troque o tempo de um
    pedido e repare como a linha de atenção e a de atraso andam junto com ele:
  </p>

  <Rail />

  <p>
    Encomenda tem uma regra própria. Um bolo de aniversário aceito na segunda para sábado não pode
    começar a contar atraso na segunda. Por isso ele aparece como <strong>encomenda</strong>, e o
    relógio só começa quando a cozinha começa a fazer.
  </p>

  <h2 id="fila">A fila se arruma sozinha</h2>
  <p>
    Repare no trilho de cima: o pedido que entrou primeiro não fica, necessariamente, na frente. A
    tela ordena pelo que vence antes. Um pedido de duas fatias aceito com 15 minutos passa na frente
    de um bolo inteiro aceito antes com 45, porque é ele que vai estourar primeiro. Quando um pedido
    não pode esperar (o cliente já está no balcão, a entrega é para um hospital), você marca
    <strong>passar na frente</strong> e ele sobe para o topo com a etiqueta
    <strong>prioridade</strong>.
  </p>
  <p>
    Dentro de cada pedido, cada item é um botão grande. Fez as fatias? Toca nelas e elas ficam
    riscadas. A primeira marca já muda o pedido para “preparando”, então quem está no balcão sabe
    que a cozinha pegou aquele pedido sem precisar perguntar. Embaixo, um botão só faz o próximo
    passo:
    <strong>começar</strong>, depois <strong>pronto</strong>. Numa cozinha dividida em estações,
    aparece também <strong>minha parte pronta</strong>, que você vai ver mais abaixo.
  </p>
  <p>
    E o dedo escorrega. Por isso o “pronto” não vai na hora: ele espera 4,5 segundos em cima do
    próprio pedido, com uma barra esvaziando e o botão <strong>desfazer</strong> exatamente onde o dedo
    estava. Passados os 4,5 segundos, o pedido segue o mesmo caminho de quando você move ele na tela de
    Pedidos: o cliente é avisado, a impressão e o quadro acompanham. Se você sair da tela nesse meio-tempo,
    o que estava esperando é enviado.
  </p>
  <p>Em volta dos pedidos, a tela ainda tem três coisas que a cozinha pedia:</p>
  <ul>
    <li>
      <strong>Chegando:</strong> uma faixa no alto com os pedidos que ainda não foram aceitos. Dá para
      aceitar dali mesmo, já escolhendo o tempo de preparo. O pedido que espera aceite há mais tempo que
      o combinado pela loja (no padrão, 5 minutos) ganha uma borda âmbar.
    </li>
    <li>
      <strong>Prontos:</strong> uma coluna com o que já saiu da cozinha e espera o cliente ou o entregador.
      Um toque marca “retirado” ou “saiu para entrega”, e quando o pagamento é no balcão ela avisa, por
      exemplo, “Cobrar na retirada: dinheiro”.
    </li>
    <li>
      <strong>Tudo junto:</strong> todos os pedidos abertos viram uma lista de preparo só, prato por prato.
      Seis fatias de cenoura espalhadas em quatro pedidos aparecem como seis fatias, para cortar de uma
      vez. Combo conta pelas partes, porque a cozinha faz as partes. Tocando num item, os pedidos que
      não têm ele ficam apagados.
    </li>
  </ul>

  <h2 id="sons">Dá para cozinhar sem olhar para a tela</h2>
  <p>
    Quem está com a mão na massa não fica encarando tela. Então ela fala com a cozinha em sons
    curtos, diferentes entre si, para dar para saber o que aconteceu sem levantar a cabeça. Pedido
    novo são duas batidas rápidas na mesma nota, como a campainha do balcão. Pedido que atrasou é um
    tom que desce, grave o bastante para passar pelo barulho da coifa, e toca uma vez só por pedido.
    Os que já estavam atrasados quando a tela abriu não tocam: o som avisa o que mudou, não o que
    você já sabe.
  </p>

  <Sounds />

  <p>
    E se o cliente cancela no meio do preparo, a tela não deixa passar: aparece o aviso “Pedido #31
    foi cancelado. Pode parar o preparo.”, junto com o tom de atraso. É a diferença entre parar a
    tempo e jogar um bolo de milho fora.
  </p>
  <p>
    Se quiser, a tela também lê os pedidos em voz alta, com a voz do próprio aparelho: “Pedido 33. 2
    Fatia de cenoura com brigadeiro. 1 Bolo de fubá, sem erva-doce.” Não tem nada para baixar e nada
    sai do aparelho. A qualidade da voz depende do tablet ou do computador, e no Chrome a tela pede
    um toque antes de começar a falar, porque o navegador só libera som depois de um toque.
  </p>
  <p>
    Duas coisas sempre ganham destaque, porque são as que mais dão problema. O que o cliente pediu
    para tirar (“sem erva-doce”, “tirar o granulado”) aparece em vermelho, separado do que foi
    acrescentado. E nas observações, palavras como alergia, glúten, lactose, amendoim, castanha e
    camarão ficam marcadas, e o pedido ganha a etiqueta <strong>alergia</strong>. Você vê isso na
    prática no teclado mais abaixo.
  </p>

  <h2 id="estacoes">Uma tela para cada estação</h2>
  <p>
    Cozinha pequena geralmente tem uma tela só, e tudo bem: ela mostra tudo. Mas quando a
    confeitaria fica de um lado e o café do outro, cada canto quer ver só o que é seu. Para isso
    existem as estações. Você cria as estações da sua cozinha (até 12) e diz quais categorias do
    cardápio cada uma faz. Cada categoria vai para uma estação só, para nunca ter dois cantos
    fazendo a mesma coisa.
  </p>
  <p>
    Depois, cada aparelho escolhe a estação que mostra, e a escolha fica salva nele. Tem ainda uma
    opção especial, <strong>Tudo</strong>, que é a expedição: a tela de quem confere e entrega, com
    o pedido inteiro. E uma regra para nada cair no vão entre duas estações: categoria que nenhuma
    estação pegou aparece em todas.
  </p>

  <Stations />

  <p>
    Repare no botão de cada tela. Na Confeitaria, enquanto a Copa ainda tem item aberto, ele diz
    <strong>minha parte pronta</strong>. Depois que você marca a sua parte, a estação espera, e só a
    última estação a terminar, ou a expedição, chama o pedido inteiro de pronto. As marcas são as
    mesmas em todas as telas, então cada canto sabe o que os outros já fizeram sem gritar pela
    cozinha.
  </p>
  <p>
    Quem cria e edita as estações é quem gerencia a loja. Para abrir a tela, qualquer pessoa da
    equipe serve: ela fica no mesmo app de sempre, com o mesmo login.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      A tela da cozinha e o painel de retirada estão no Venduá Bandeira. Não tem nada para instalar:
      é só abrir a Cozinha no app da loja, num tablet, num computador ou no celular que fica na
      bancada.
    </p>
  </aside>

  <h2 id="teclado">Mão suja não precisa tocar no vidro</h2>
  <p>
    Mão com farinha, glacê ou óleo não combina com tela de toque. Então tudo o que você faz com o
    dedo também dá para fazer pelo teclado, ou por um bump bar, aquele teclado de poucas teclas
    grandes que muita cozinha profissional usa, ligado no computador. As teclas de 1 a 9 escolhem o
    pedido, as setas andam entre pedidos e itens, Espaço marca o item como feito, Enter começa ou dá
    pronto, e Z desfaz o último pronto. P passa na frente, T abre o Tudo junto, E troca a estação, S
    liga e desliga o som e F põe em tela cheia. Esqueceu alguma? A tecla de interrogação mostra a
    lista.
  </p>
  <p>
    Experimente aqui. Clique na mini cozinha e use o seu teclado de verdade, ou toque nas teclas:
  </p>

  <BumpBar />

  <p>
    Repare também no que o pedido não mostra. Na cozinha aparece só o primeiro nome do cliente: nada
    de telefone e nada de preço. Quem cozinha precisa saber o que fazer e para quem chamar, não
    quanto o pedido custou.
  </p>

  <h2 id="painel">O número chamado no balcão</h2>
  <p>
    A outra ponta da cozinha é o balcão, onde o cliente da retirada espera olhando para a porta da
    cozinha e perguntando “o meu já saiu?”. Para ele existe o painel de retirada: uma segunda tela,
    numa TV ou num tablet virado para o salão, com os mesmos pedidos vistos do lado de fora. De um
    lado, os números que estão sendo preparados. Do outro, os que estão prontos.
  </p>
  <p>
    Quando um pedido fica pronto, o número dele toma o painel inteiro por 7 segundos, com o dim-dom
    clássico e uma voz chamando: “Pedido 38. Pronto para retirada!”. Se dois ficam prontos juntos,
    um espera o outro terminar. Depois, o número vai para a coluna de prontos, com o mais recente em
    destaque.
  </p>

  <Panel />

  <p>
    Por padrão, o painel mostra só números. Mostrar o primeiro nome e incluir os pedidos de entrega
    são escolhas de cada aparelho, que você liga se quiser. E o painel nunca toca o som de pedido
    novo, que é assunto da cozinha, não do salão.
  </p>

  <h2 id="como">Como a gente fez</h2>
  <p>
    A primeira decisão foi não fazer outro aplicativo. A tela da cozinha é mais uma tela do app que
    você já usa para os pedidos: mesmo login, mesmas atualizações ao vivo, a mesma fila que segura
    as ações quando a internet cai e manda tudo quando ela volta. Ao abrir a Cozinha, o app esconde
    os menus e deixa a tela inteira para os pedidos.
  </p>
  <p>
    A segunda foi não criar um caminho paralelo para o pedido. Aceitar, dar pronto e entregar passam
    pelo mesmo lugar que na tela de Pedidos. Por isso a cozinha e o quadro de pedidos nunca
    discordam: os dois leem e movem o mesmo pedido, e o aviso ao cliente sai igual, venha o “pronto”
    de onde vier.
  </p>
  <p>
    A terceira foi tratar a estação como um filtro, não como uma linha de montagem. Ela é decidida
    pela categoria do cardápio, e só. Uma cozinha pequena não precisa de regras de roteamento
    complicadas, e as marcas de cada item já contam para cada tela o que as outras fizeram.
  </p>
  <p>
    E o resto foi pensado para quem está de avental: números e relógio grandes, legíveis a um metro
    de distância, botões do tamanho de um dedo molhado, desfazer em vez de “tem certeza?”, e
    palavras junto de toda cor. Para começar, aceite o próximo pedido escolhendo o tempo de preparo,
    abra a Cozinha no tablet da bancada e, se a cozinha tiver mais de um canto, crie as estações.
    Quando o primeiro relógio ficar âmbar, você vai entender por que ele existe.
  </p>
</Article>
