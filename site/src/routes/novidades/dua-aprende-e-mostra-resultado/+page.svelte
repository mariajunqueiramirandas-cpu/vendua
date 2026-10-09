<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Apresentacao from '$lib/posts/dua-aprende-e-mostra-resultado/Apresentacao.svelte';
  import ClienteOculto from '$lib/posts/dua-aprende-e-mostra-resultado/ClienteOculto.svelte';
  import Lembrete from '$lib/posts/dua-aprende-e-mostra-resultado/Lembrete.svelte';
  import Painel from '$lib/posts/dua-aprende-e-mostra-resultado/Painel.svelte';
  import Regras from '$lib/posts/dua-aprende-e-mostra-resultado/Regras.svelte';

  const outline = [
    { id: 'treinar', title: 'Como se ensina um vendedor novo' },
    { id: 'regras', title: 'Regra que trava, regra que orienta' },
    { id: 'jeito', title: 'O jeito de falar é seu, o nome é Duá' },
    { id: 'prova', title: 'A prova antes do primeiro cliente' },
    { id: 'sacola', title: 'Sacola parada, Pix vencido e o cupom certo' },
    { id: 'boletim', title: 'O boletim: o que ele fechou e o que ajudou' },
    { id: 'como', title: 'Como a gente fez' },
  ];
</script>

<Article
  path="/novidades/dua-aprende-e-mostra-resultado/"
  pose="personalizar"
  lede="Ninguém deixa um vendedor novo sozinho no balcão no primeiro dia. Você mostra o cardápio, conta as regras da casa, olha ele atender os primeiros clientes e, no fim da semana, quer saber como foi. Com o Duá, o vendedor com IA no WhatsApp da loja, as três coisas estão no app: ensinar, testar com clientes de mentira e ver num painel o que ele vendeu."
  {outline}
  closing="Ensine uma vez, confira na prova, acompanhe no boletim."
>
  <h2 id="treinar">Como se ensina um vendedor novo</h2>
  <p>
    Pense na Nena, da Bolos da Nena, contratando alguém para o balcão. No primeiro dia ela não
    entrega um manual de cem páginas. Ela mostra a vitrine, avisa que o bolo de fubá acaba cedo,
    explica que encomenda de festa é com ela e fica perto nos primeiros atendimentos. Depois de uns
    dias, solta.
  </p>
  <p>Treinar o Duá segue esse mesmo caminho, em quatro partes, nesta ordem:</p>
  <ol>
    <li>
      <strong>Conhecer.</strong> Você liga o WhatsApp da loja, conta se o número é só da loja ou também
      seu, e escolhe como ele fala.
    </li>
    <li>
      <strong>Ensinar.</strong> Ele mostra o que já leu da loja e o que não ficou claro, faz uma entrevista
      com você e pergunta quando deve passar a conversa para você.
    </li>
    <li>
      <strong>Testar.</strong> Você pede para ele como se fosse cliente, e depois roda o cliente oculto.
    </li>
    <li><strong>Começar.</strong> Você decide quando ele atende, e pronto.</li>
  </ol>
  <p>
    A primeira tela de Ensinar já é uma surpresa boa: o Duá não começa do zero. Ele lê o seu
    cardápio, o horário, as áreas de entrega e as formas de pagamento direto da loja, na hora. Se
    você muda um preço amanhã, ele já sabe, sem ninguém precisar avisar. O que ele não entendeu
    aparece numa lista chamada “Não ficou claro”, com um botão para arrumar o produto e outro para
    deixar como está.
  </p>
  <p>
    Depois vem a entrevista. São de 5 a 8 perguntas sobre o que só você sabe: como funcionam as
    encomendas, o que nunca prometer, quando chamar você. Cada resposta vira uma sugestão, e só vale
    depois do seu ok. Parou no meio para atender alguém? Seu progresso fica salvo, e dá para
    continuar no celular ou no computador, de onde parou.
  </p>
  <p>
    E o ensino não acaba no primeiro dia. Quando um cliente pergunta algo que o Duá não sabe, a
    pergunta vai para “Perguntas sem resposta” na tela Ensinar. Perguntas parecidas viram uma só,
    com a conta de quantas vezes apareceram. Você responde uma vez, ele responde sozinho dali pra
    frente, e ainda dá para marcar “Mandar também para quem perguntou e ainda espera”. Quando é você
    que atende uma conversa que ele passou, a sua resposta volta como proposta, num cartão chamado
    “Aprendi com você”. Você confere e aceita.
  </p>

  <h2 id="regras">Regra que trava, regra que orienta</h2>
  <p>
    Toda loja tem regras. Umas são de valor: dinheiro só até certo total, Pix acima de outro. Outras
    são de jeito: sempre oferecer vela para bolo de aniversário, nunca prometer entrega antes das
    14h. Você escreve as duas do mesmo modo, com as suas palavras, e o app mostra na hora como cada
    uma vai valer.
  </p>
  <p>
    Quando a regra fala de valor ou de quantidade de um jeito que o sistema reconhece, ela vira uma
    trava, marcada como <strong>sempre cumprida</strong>. Quem confere é a Venduá, no momento do
    pedido: se a regra diz dinheiro só até R$ 200, um pedido de R$ 350 em dinheiro não passa, e o
    Duá oferece outra forma de pagamento. O resto vira <strong>orientação</strong>: o Duá segue como
    seguiria um bom funcionário, e a tela diz isso com essa palavra, sem prometer mais.
  </p>
  <Regras />
  <p>
    São cinco tipos de trava, e só esses: limite para pagar em dinheiro, só Pix acima de um valor,
    nenhum cupom abaixo de um valor, e passar para você acima de um valor ou acima de uma
    quantidade. Preferimos poucas travas que funcionam sempre a muitas que funcionam quase sempre.
    Se você escreve algo que fica como orientação e queria uma trava, o próprio app dá a dica: fale
    de valor ou quantidade.
  </p>

  <h2 id="jeito">O jeito de falar é seu, o nome é Duá</h2>
  <p>
    Uma doceria de bairro e uma confeitaria de festa não falam igual. Por isso você escolhe entre
    três jeitos de falar, <strong>descontraído</strong>, <strong>equilibrado</strong> ou
    <strong>formal</strong>, e ainda pode descrever a voz da casa num texto livre de até 1.000
    caracteres: as gírias que vocês usam, o que nunca dizer, como chamar o cliente.
  </p>
  <Apresentacao />
  <p>
    O nome não muda. Em toda loja ele é o Duá, o mascote da Venduá. E ele nunca diz que é uma
    pessoa. Com a opção “Dizer que é assistente virtual” ligada, que já vem assim, ele se apresenta
    como assistente virtual da loja. Se o dono desligar, ele se apresenta só como o Duá da loja, e
    conta a verdade se alguém perguntar. Essa opção é só do dono: ninguém da equipe muda.
  </p>

  <h2 id="prova">A prova antes do primeiro cliente</h2>
  <p>
    Ensinar é metade do trabalho. A outra metade é saber se ele aprendeu, antes de um cliente de
    verdade descobrir por você. O primeiro teste é o mais simples: em “Peça para mim”, você escreve
    como um cliente escreveria. O pedido passa pela loja como qualquer outro, mas para antes de
    existir. Nada vai para a cozinha e nada é cobrado.
  </p>
  <p>
    O segundo teste é o <strong>cliente oculto</strong>, e é aqui que a coisa fica séria. A Venduá
    monta até 20 clientes de teste a partir do seu próprio cardápio: os mais vendidos, os produtos
    com opção obrigatória, as suas áreas de entrega, alguém que mora longe demais e alguém que só
    quer falar com uma pessoa. Cada um recebe um pedido escondido e um jeito de escrever, do
    apressado que abrevia tudo ao educado que escreve “gostaria”. Todos conversam com o Duá ao mesmo
    tempo, de verdade, e no fim cada pedido é comparado com o escondido, item por item.
  </p>
  <ClienteOculto />
  <p>
    Repare no erro da rodada acima. A Júlia queria a cobertura “Chocolate”, e o Duá fechou
    “Brigadeiro de chocolate”. Os dois nomes têm a mesma palavra, e um cliente de verdade teria
    recebido o bolo errado. Quase sempre é assim: o erro aponta um detalhe do cardápio, não um
    defeito do Duá. Um nome mais claro resolve. E você não precisa lembrar de rodar de novo: depois
    que o cardápio muda, o cliente oculto roda sozinho, no máximo uma vez por dia.
  </p>
  <p>
    Quer ver o Duá trabalhar com os seus clientes sem arriscar nada? Existe ainda o
    <strong>Ensaio</strong>. Nele o Duá escreve a resposta para cada mensagem que chega e não manda
    nenhuma. Você atende normalmente e, no dia seguinte, vê quantas das respostas dele você mandaria
    iguais. Onde ele pensou diferente, um toque ensina como você fez.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      O Duá está no Venduá Bandeira, que começa com 14 dias grátis, sem cartão. Treinar, pedir como
      cliente, o Ensaio e o cliente oculto não gastam as conversas do plano: só contam as conversas
      com clientes de verdade.
    </p>
  </aside>

  <h2 id="sacola">Sacola parada, Pix vencido e o cupom certo</h2>
  <p>
    Todo mundo já fez isso: montou a sacola, foi atender a porta e esqueceu. No balcão, a Nena
    lembraria o cliente. No WhatsApp, quem lembra é o Duá, com regras que protegem o cliente de
    virar alvo de mensagem. Ele escreve só uma vez por dia em cada conversa, só para quem escreveu
    nas últimas 24 horas e só com a loja aberta. A sacola precisa ter itens, e ele só lembra quem
    parou de responder depois de uma mensagem dele. O lembrete vem ligado, depois de 15 minutos de
    silêncio, e você muda o tempo.
  </p>
  <Lembrete />
  <p>
    Mexa no tempo com a última mensagem às 18:50 e veja a regra da loja aberta trabalhando: com 5
    minutos, o lembrete sai antes de fechar. Com 15, ele espera a loja abrir no dia seguinte. Com a
    loja fechada, ninguém recebe lembrete.
  </p>
  <p>
    Mais duas situações seguem a mesma ideia. Se o Pix de um pedido vence sem pagamento, o Duá
    oferece o pagamento de novo, uma vez. E quando um produto esgotado volta ao estoque, ele avisa
    quem estava na lista de espera e conversou com a loja nas últimas 24 horas.
  </p>
  <p>
    E o cupom? Ele vem desligado, e só o dono liga. Você escolhe até 10 cupons da loja que o Duá
    pode oferecer, e em quais momentos: sacola parada, primeiro pedido ou cliente em dúvida. Define
    o limite do mês, e o mesmo cliente só ganha outro cupom do Duá depois de 30 dias. Quer um pedido
    mínimo? É uma regra em Ensinar: “não dê cupom em pedido abaixo de R$ 60” vira trava. O Duá nunca
    inventa desconto: quem cria o cupom é a Venduá, com código começando em DUA, válido por 48
    horas, para uma única compra e preso ao telefone daquele cliente. O limite do mês conta o máximo
    que cada cupom poderia descontar, então a conta nunca estoura. Pode ser um cupom que zera a
    entrega, um valor ou uma porcentagem: os mesmos cupons que você já cria em Marketing.
  </p>

  <h2 id="boletim">O boletim: o que ele fechou e o que ajudou</h2>
  <p>
    Fim de semana, hora de olhar o boletim. A tela Resultados separa duas contas que muita gente
    mistura. <strong>Vendido pelo Duá</strong> é o pedido fechado ali, na conversa.
    <strong>Ajudou a vender</strong> é o pedido que o cliente fez no site até 24 horas depois de o Duá
    mandar o link da sacola. As duas aparecem lado a lado, nunca somadas num número só, e a janela de
    24 horas está escrita na própria tela.
  </p>
  <Painel />
  <p>
    Abaixo das duas contas vem o resto do boletim. O funil mostra quantas conversas montaram sacola,
    quantas viram o resumo e quantas fecharam. Ao lado, o ticket médio do Duá e o do site, para você
    comparar. Depois, as sugestões oferecidas e aceitas, com o que elas somaram, os pedidos
    recuperados de sacolas paradas, e quanto tempo ele levou para responder: na metade das vezes e
    quase sempre. Por último, quantas vezes ele passou a conversa para você, e por quê.
  </p>
  <p>
    Escolha <strong>hoje</strong> no exemplo e veja o aviso: com menos de 20 conversas no período, a tela
    diz que os números ainda são poucos. Um dia sozinho engana. Uma semana de conversas já conta uma história.
  </p>
  <p>
    E o boletim não só dá a nota, ele sugere a lição de casa. Em “Para esta semana” aparecem até
    três propostas: ensinar a resposta de uma pergunta que se repetiu, parar de sugerir um produto
    oferecido dez vezes ou mais em 30 dias sem ninguém aceitar, ou lembrar a sacola parada mais cedo
    quando quase ninguém volta depois do lembrete. Cada uma vem com a prova e um botão para agir.
  </p>

  <h2 id="como">Como a gente fez</h2>
  <p>
    A regra de ouro do Duá vale aqui também: a IA conversa, quem decide é a loja. Preço, taxa de
    entrega, total e o código do Pix saem do sistema da Venduá, por isso o cliente oculto já marca
    “Preço certo em todos os pedidos” sem precisar perguntar a ninguém.
  </p>
  <ul>
    <li>
      <strong>A nota é dada por código, não por outra IA.</strong> O cliente de teste é uma IA fazendo
      papel de cliente, mas quem corrige é uma comparação exata entre o pedido escondido e o pedido que
      o Duá fecharia: quantidade, produto, opções, entrega ou retirada, forma de pagamento. Se a IA não
      responde numa conversa, essa conversa fica fora da nota em vez de baixar a média.
    </li>
    <li>
      <strong>O teste usa o caminho de verdade.</strong> O cliente oculto passa pelo mesmo Duá, com as
      mesmas ferramentas, e o pedido de teste é conferido como no checkout. Ele só para um passo antes
      de o pedido existir.
    </li>
    <li>
      <strong>As travas são lidas uma vez, quando você salva.</strong> A frase vira uma regra com valor
      e tipo, e a conferência acontece no pedido, toda vez. A mesma leitura alimenta a prévia “Como fica”
      enquanto você escreve, e o quadro de regras deste texto usa uma cópia dela.
    </li>
    <li>
      <strong>O boletim conta o que aconteceu.</strong> Pedidos cancelados ou estornados ficam fora. Um
      pedido só conta como recuperado se veio até 24 horas depois do lembrete. O funil nunca cresce de
      uma etapa para a outra: uma conversa que pediu duas vezes é uma conversa que fechou.
    </li>
  </ul>
  <p>
    O próximo passo é seu: abra Treinar no app, deixe o Duá ler a loja, responda a entrevista e rode
    o cliente oculto antes de ligar. Cada erro da prova aponta o que arrumar, e o boletim mostra o
    que mudou.
  </p>
</Article>
