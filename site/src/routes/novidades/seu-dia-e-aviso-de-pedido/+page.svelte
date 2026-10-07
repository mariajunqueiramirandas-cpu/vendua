<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import AlertLock from '$lib/posts/seu-dia-e-aviso-de-pedido/AlertLock.svelte';
  import DayRecap from '$lib/posts/seu-dia-e-aviso-de-pedido/DayRecap.svelte';
  import FallbackLane from '$lib/posts/seu-dia-e-aviso-de-pedido/FallbackLane.svelte';
  import Funnel from '$lib/posts/seu-dia-e-aviso-de-pedido/Funnel.svelte';
  import PeriodReport from '$lib/posts/seu-dia-e-aviso-de-pedido/PeriodReport.svelte';

  const outline = [
    { id: 'aviso', title: 'O pedido acende a tela' },
    { id: 'app', title: 'Um app que mora na tela do celular' },
    { id: 'reserva', title: 'Se o aviso não chegar, o WhatsApp chega' },
    { id: 'seu-dia', title: 'Quando a loja fecha, o dia vira um resumo' },
    { id: 'relatorios', title: 'Para olhar mais longe: os relatórios' },
    { id: 'como', title: 'Como a gente fez' },
    { id: 'hoje', title: 'Deixe tudo pronto antes do próximo pedido' },
  ];
</script>

<Article
  path="/novidades/seu-dia-e-aviso-de-pedido/"
  pose="horarios"
  lede="São 19h12 de uma terça. O celular da Nena está na bancada, entre a batedeira e a forma, e a tela acende: “Pedido #29 chegou”. Um toque em aceitar e o pedido do Luiz entra na fila. Às 20h a loja fecha, e o mesmo app troca o movimento pelo resumo do dia: quanto vendeu, o que mais saiu e a que horas a cozinha mais correu."
  {outline}
  closing="O pedido avisa quando chega. O dia se conta quando acaba."
>
  <h2 id="aviso">O pedido acende a tela</h2>
  <p>
    Todo pedido feito na sua loja vira um aviso no celular, na hora. Não é um e-mail para ler depois
    nem uma mensagem perdida no meio dos grupos: é o aviso do app da sua loja, com o número do
    pedido, o nome do cliente, o total e se é entrega ou retirada. “Pedido #29 chegou. Luiz,
    R$&nbsp;219,00, entrega.” Dá para saber o tamanho do pedido sem destravar a tela.
  </p>
  <p>
    E dá para resolver ali mesmo. O aviso traz um botão, <strong>aceitar</strong>. Um toque e o
    pedido vai para “aceitos” sem você abrir o app, e um segundo aviso confirma: “Pedido aceito. Já
    está em ‘aceitos’. Bom trabalho!”. É o jeito de aceitar com a mão suja de massa e o celular
    apoiado no balcão.
  </p>
  <p>
    Quando você quer escolher o tempo de preparo, toque no aviso em vez do botão. O app abre no
    cartão do pedido, com três opções embaixo de “Fica pronto em (minutos)”: 15, 30 e 45. O tempo de
    sempre da sua loja já vem marcado, e quem nunca mexeu nele começa com 30. Num dia calmo, 15. Com
    o forno cheio, 45. O cliente vê a previsão mudar junto, porque ela passa a ser o tempo que você
    escolheu mais o tempo de entrega até o bairro dele.
  </p>

  <AlertLock />

  <p>
    Com o app aberto, o resto do caminho fica a um gesto. Arrastar o cartão para a direita leva o
    pedido adiante: aceito, em preparo, pronto, saiu para entrega, entregue. Para a esquerda,
    aparecem as outras opções, como cancelar. Cada passo avisa o cliente, e você não precisa digitar
    nada para isso.
  </p>

  <h2 id="app">Um app que mora na tela do celular</h2>
  <p>
    O painel da Venduá abre no navegador, mas não precisa ficar perdido entre as abas. No Android, o
    próprio navegador oferece instalar. No iPhone, é pelo Safari: <strong>Compartilhar</strong>,
    depois <strong>Adicionar à Tela de Início</strong>. O painel mostra o passo a passo quando
    percebe que você ainda não instalou. A partir daí, a loja abre num toque, ao lado do WhatsApp e
    do app do banco.
  </p>
  <p>Instalar muda duas coisas que fazem diferença no balcão:</p>
  <ul>
    <li>
      <strong>O aviso toca e vibra mesmo com o app fechado.</strong> No iPhone, avisos assim só chegam
      para o app instalado. Sem instalar, ele fica mudo.
    </li>
    <li>
      <strong>Ele abre sem internet.</strong> Os últimos dados ficam guardados no celular, então o app
      abre com os pedidos como estavam da última vez, em vez de uma tela em branco esperando o sinal voltar.
    </li>
  </ul>
  <p>
    Com o app aberto, cada pedido novo também toca um som. O navegador só libera o som depois do
    primeiro toque na tela, então vale tocar uma vez em qualquer lugar do painel quando você começa
    o dia, e usar <strong>testar som</strong> em Meu perfil para conferir. Em Pedidos, o botão
    <strong>Tela ligada</strong> impede o celular de apagar enquanto os pedidos chegam. E deixe o aparelho
    fora do silencioso: nenhum aviso vence o botão do lado do celular.
  </p>

  <h2 id="reserva">Se o aviso não chegar, o WhatsApp chega</h2>
  <p>
    Aviso de celular falha por motivos que nenhuma loja controla. O aparelho ficou sem bateria, a
    economia de energia fechou o app, alguém desligou as notificações sem querer. O pior jeito de
    descobrir é o cliente perguntando, meia hora depois, onde está o bolo.
  </p>
  <p>
    Por isso a Venduá não confia num caminho só. Cada aviso de pedido fica registrado, aparelho por
    aparelho: chegou ou falhou. Se um pedido novo passa de 5 minutos sem ninguém aceitar e o aviso
    não chegou em nenhum aparelho, os donos e gerentes da loja recebem uma mensagem no WhatsApp, com
    o número do pedido e o link para aceitar. Uma mensagem por pedido, não uma por minuto.
  </p>

  <FallbackLane />

  <p>
    Repare num detalhe da regra: se o aviso chegou em pelo menos um celular, o WhatsApp não vai.
    Alguém da loja já sabe do pedido, e se ainda não aceitou, o cartão fica marcado como atrasado no
    app. O WhatsApp é a reserva para quando ninguém foi avisado, não um segundo alarme para o mesmo
    pedido.
  </p>
  <p>
    E você vê tudo isso acontecendo. Em Meu perfil, <strong>Seus avisos</strong> lista cada aparelho
    que recebe avisos e se o último chegou, com um botão <strong>testar aviso</strong> para conferir na
    hora. Quando um aviso falha, o Início também mostra: “O aviso de 1 pedido não chegou em nenhum aparelho”.
    Quem não quiser a mensagem de reserva desliga “WhatsApp se o aviso falhar” no próprio perfil.
  </p>

  <h2 id="seu-dia">Quando a loja fecha, o dia vira um resumo</h2>
  <p>
    Durante o expediente, o Início é sobre o agora: as vendas de hoje, os pedidos esperando, o que
    precisa de você. Quando a loja fecha, ele muda de cara. O cartão do topo escurece como o céu lá
    fora e passa a se chamar <strong>Seu dia</strong>.
  </p>
  <p>
    É o fechamento do caixa sem caderno: quanto você vendeu, quantos pedidos, o ticket médio, o
    produto campeão e a hora mais movimentada. E a comparação mais justa que dá para fazer: com o
    mesmo dia da semana passada, até a mesma hora. Terça com terça, não terça com sábado. Do lado,
    um gráfico pequeno dos últimos 7 dias, para ver a semana de uma vez. E logo abaixo, o
    <strong>Resumo do dia</strong> junta o essencial numa frase só: o campeão e quantas unidades saíram,
    a hora mais movimentada e quantos pedidos tinham entrado no mesmo dia da semana anterior.
  </p>

  <figure class="shot">
    <Phone width={250}>
      <Screen
        key="seuDia"
        alt="O Início do app da Bolos da Nena depois de fechar: Seu dia, R$&nbsp;718,00, 151% a mais que a terça passada, 6 pedidos, ticket médio de R$&nbsp;120 e o resumo do dia"
      />
    </Phone>
    <figcaption>O Seu dia da Bolos da Nena, numa terça, depois das 20h.</figcaption>
  </figure>

  <p>
    Na terça da Bolos da Nena, o resumo diz: R$&nbsp;718,00 em 6 pedidos, ticket médio de
    R$&nbsp;120, a fatia de cenoura com brigadeiro saiu 5 vezes e o movimento apertou às 18h. Na
    terça anterior, até a mesma hora, tinham sido R$&nbsp;286,00. Daí os 151% a mais. Abaixo, o
    mesmo dia aberto em gráfico: arraste o sol pelas horas para ver cada uma, e passe pelos dias da
    semana.
  </p>

  <DayRecap />

  <p>
    Cada número responde a uma pergunta que quem toca uma loja pequena se faz toda noite. Valeu a
    pena abrir hoje? O que precisa sair mais do forno amanhã? Em que hora vale ter mais uma mão na
    cozinha? A Nena olha o 18h e já sabe quando separar as caixas de entrega.
  </p>
  <p>
    O resumo não chega como notificação nem marca hora para ser visto. Ele está lá quando você abre
    o app depois de fechar, e dá lugar ao dia seguinte quando chega a hora de abrir de novo.
  </p>

  <h2 id="relatorios">Para olhar mais longe: os relatórios</h2>
  <p>
    O Seu dia conta um dia. Para entender uma semana ou um mês, tem <strong>Relatórios</strong>.
    Escolha o período (hoje, ontem, 7 dias, 30 dias, este mês, mês passado ou personalizado) e a
    tela mostra vendas, pedidos, ticket médio, clientes novos e quantos clientes voltaram a pedir,
    cada número com a comparação com o período anterior.
  </p>
  <p>
    “Período anterior” tem regra clara. Sete dias se comparam com os sete dias antes deles. Este mês
    se compara com o mês passado até o mesmo dia, para um setembro pela metade não perder para um
    agosto inteiro. Mês passado se compara com o mês antes dele. Experimente:
  </p>

  <PeriodReport />

  <p>
    Abaixo dos números vêm as respostas para quem já vende há um tempo. <strong
      >Mais vendidos</strong
    >, do primeiro ao último. <strong>Horários de pico</strong>, num mapa dos dias da semana pelas
    horas do dia. <strong>Formas de pagamento</strong>. <strong>Cupons usados</strong>, com quanto
    cada um vendeu e quanto deu de desconto. E o funil <strong>Do olhar ao pedido</strong>: quantas
    pessoas visitaram a loja, viram um produto, montaram sacola, foram pagar e pediram.
  </p>

  <Funnel />

  <p>
    O funil mostra onde as pessoas desistem. Muita gente vendo produto e pouca montando sacola
    costuma ser foto, preço ou descrição. Muita gente indo pagar e pouca pedindo pede um olhar na
    entrega e nas formas de pagamento.
  </p>
  <p>
    Para quem entrega, tem <strong>Entrega por área</strong>: quanto cada área vendeu, quantas
    pessoas consultaram o frete ali e quantas dessas consultas viraram pedido. E uma lista que vale
    ouro,
    <strong>Onde pediram e você não entrega</strong>: os bairros em que alguém quis comprar e não
    achou uma área sua. Se o mesmo bairro aparece toda semana, talvez seja a hora de abrir uma área
    nova.
  </p>
  <p>
    Quando precisar levar os números para o contador ou para uma planilha sua, tem o botão
    <strong>baixar planilha</strong>: os pedidos do período, um por linha, com itens, entrega e
    forma de pagamento.
  </p>

  <h2 id="como">Como a gente fez</h2>
  <p>
    O aviso sai no momento em que o pedido é criado, e cada pedido tem um único registro de aviso:
    mesmo que o sistema tente mandar duas vezes, o celular toca uma. Cada tentativa fica gravada,
    aparelho por aparelho, com o resultado. É esse registro que aparece em Seus avisos e que decide
    se o WhatsApp de reserva precisa sair.
  </p>
  <p>
    A reserva confere a loja a cada minuto. Ela procura pedidos que continuam sem aceite depois do
    tempo de aceite e que nenhum aparelho recebeu, e marca cada um antes de mandar a mensagem. Assim
    o mesmo pedido nunca vira dois WhatsApps, nem se duas conferências se cruzarem.
  </p>
  <p>
    O Seu dia e os relatórios são calculados na hora, direto dos pedidos, sem um resumo guardado da
    véspera. Pedido cancelado não entra na conta. O “até esta hora” pega a semana passada até o
    mesmo minuto do dia de hoje, no fuso da sua loja. E a hora mais movimentada é a hora com mais
    pedidos, não a de maior valor: um bolo de festa grande às 15h não esconde o aperto das 18h.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Está no Venduá Mirim e no Venduá Bandeira: o aviso com aceitar, o WhatsApp de reserva, o Seu
      dia e os relatórios. Não tem nada para contratar à parte nem para configurar: o pedido de hoje
      já entra nas contas.
    </p>
  </aside>

  <h2 id="hoje">Deixe tudo pronto antes do próximo pedido</h2>
  <p>Leva poucos minutos, e é melhor fazer agora do que no meio do movimento:</p>
  <ol>
    <li>
      Abra o painel no celular que fica no balcão e instale o app (no iPhone, pelo Safari:
      Compartilhar, depois Adicionar à Tela de Início).
    </li>
    <li>
      Em Meu perfil, ligue <strong>Avisos no celular</strong> e toque em
      <strong>testar aviso</strong>. Confira se o aparelho aparece com “chegou”.
    </li>
    <li>Com o celular fora do silencioso, toque em <strong>testar som</strong>.</li>
    <li>Hoje à noite, depois de fechar, abra o Início e veja o seu dia.</li>
  </ol>
</Article>
