<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import Estados from '$lib/posts/pausar-a-loja/Estados.svelte';
  import Porta from '$lib/posts/pausar-a-loja/Porta.svelte';
  import Semana from '$lib/posts/pausar-a-loja/Semana.svelte';

  const outline = [
    { id: 'placa', title: 'A plaquinha da porta, agora no celular' },
    { id: 'pausar', title: 'Pausar: de 15 minutos a até você voltar' },
    { id: 'cheia', title: 'Cheia, mas vendendo' },
    { id: 'fechada', title: 'Fechada não é porta trancada' },
    { id: 'horarios', title: 'A semana, os feriados e o dia que fugiu da regra' },
    { id: 'como', title: 'Como a gente fez' },
  ];
</script>

<Article
  path="/novidades/pausar-a-loja/"
  pose="horarios"
  lede="O forno atrasou, o entregador sumiu, a fila de pedidos não para de crescer. Toda loja tem hora em que precisa de um respiro. Na Venduá, você pausa a loja por 15 minutos ou até voltar, deixa um recado no topo dela, avisa que a cozinha está cheia sem parar de vender e deixa o cliente montar a sacola mesmo de porta fechada."
  {outline}
  closing="Pausa, recado e horário: a sua loja diz a verdade sobre o seu dia."
>
  <h2 id="placa">A plaquinha da porta, agora no celular</h2>
  <p>
    Sábado, uma e meia da tarde. A Nena, da Bolos da Nena, tirou a última fornada de bolo de cenoura
    e percebeu que a cobertura de brigadeiro ainda está quente demais para cortar. Tem três pedidos
    na bancada, dois esperando o motoboy, e a loja continua aberta na internet, recebendo mais.
  </p>
  <p>
    Numa loja de rua, o problema se resolve com uma plaquinha pendurada na porta: vira de “aberto”
    para “volto já” e pronto. Quem passa entende, ninguém fica bravo, ninguém paga por um bolo que
    vai sair daqui a uma hora. Na loja on-line, essa plaquinha não existia. Ou a loja estava aberta
    e aceitando tudo, ou alguém precisava mexer no horário da semana inteira para fechar por meia
    hora.
  </p>
  <p>
    Agora ela existe, e faz mais do que virar. O status da loja fica sempre lá em cima no app
    (“Aberta”, “Pausada até 14:30”, “Abre amanhã às 08:00”). Um toque nele abre uma folha com tudo o
    que mexe na porta: pausar, avisar que a cozinha está cheia e mudar o horário de hoje. No Início,
    os mesmos atalhos aparecem como dois botões, <strong>pausar</strong> e
    <strong>muitos pedidos?</strong>, no topo da tela, antes das vendas do dia.
  </p>
  <figure class="shot">
    <Phone width={250}>
      <Screen
        key="pausar"
        alt="A folha Pausar a loja no app da Bolos da Nena: 15 min, 1 hora, resto do dia, até eu voltar, o recado e a prévia de como fica na loja"
        sizes="(max-width: 560px) 62vw, 250px"
      />
    </Phone>
    <figcaption>
      A folha de pausar no app da Bolos da Nena, com a prévia do que o cliente vai ver.
    </figcaption>
  </figure>

  <h2 id="pausar">Pausar: de 15 minutos a até você voltar</h2>
  <p>
    Na folha de pausar, você escolhe por quanto tempo: <strong>15 min</strong>,
    <strong>1 hora</strong>, <strong>resto do dia</strong> ou <strong>até eu voltar</strong>. As
    três primeiras acabam sozinhas. Ninguém precisa lembrar de reabrir a loja depois da correria,
    porque na hora marcada ela volta a vender. O “resto do dia” vai até a meia-noite e, dali em
    diante, a loja segue o horário de sempre. Só o “até eu voltar” espera você tocar em
    <strong>voltar a aceitar pedidos</strong>.
  </p>
  <p>
    Embaixo, um campo para o recado, com até 200 caracteres. Ele aparece no topo da loja, bem onde o
    cliente olha primeiro: “Fornada nova saindo do forno! Voltamos às 14h30 com bolo quentinho.” é
    muito melhor do que um botão que não funciona. Se você não escrever nada numa pausa com hora
    para acabar, a loja diz sozinha quando volta. E a folha mostra uma prévia do aviso enquanto você
    digita, para não ter surpresa.
  </p>
  <p>Experimente aqui: a folha como ela é no app e a porta da loja, com a plaquinha que vira.</p>

  <Porta />

  <p>
    Repare no que muda para o cliente. Com a loja pausada, ele continua vendo o cardápio, as fotos e
    o seu recado, mas o botão <strong>Adicionar</strong> desliga e ninguém consegue finalizar pedido.
    O aviso de pausa é o único que fica fixo: o cliente não consegue fechar, porque ele explica por que
    o botão não funciona.
  </p>
  <p>
    Do seu lado, nada se perde. Os pedidos que já estavam em andamento continuam no quadro, seguindo
    para preparo, pronto e entrega. Pausou sem querer? Logo depois de tocar em
    <strong>pausar agora</strong>, o aviso “Loja pausada. Ninguém consegue pedir até você voltar.”
    traz um <strong>desfazer</strong> que fica na tela por 6 segundos. E não precisa ser você: quem entra
    no app como atendente também pausa a loja, então quem está no balcão resolve na hora.
  </p>

  <h2 id="cheia">Cheia, mas vendendo</h2>
  <p>
    Pausar é para quando não dá. Mas tem um momento antes disso, o mais comum de todos: a cozinha
    está dando conta, só que mais devagar. Fechar a loja nessa hora é jogar venda fora. Deixar tudo
    como está é ter cliente reclamando que o bolo demorou.
  </p>
  <p>
    Para isso existe o <strong>Muitos pedidos agora</strong>. Você liga por
    <strong>30 min</strong>, <strong>1 hora</strong>, <strong>2 horas</strong> ou pelo
    <strong>resto do dia</strong>, e a loja continua vendendo normalmente. A diferença é que, no
    topo, quem entra lê: “O preparo está levando mais que os ~30 min de sempre. Seu pedido entra na
    fila normalmente.” Os 30 minutos não são um número fixo: é o tempo de preparo que você
    configurou para a sua loja.
  </p>
  <p>
    O aviso sempre tem hora para acabar. Ele desliga sozinho, e o botão no Início mostra até quando
    vale (“muitos pedidos até 15:30”). Se a fila apertou de vez, um toque estica o prazo. Se acalmou
    antes, <strong>desligar o aviso</strong> resolve. Ninguém esquece um alerta de cozinha cheia ligado
    numa terça-feira tranquila.
  </p>
  <p>
    E o cliente decide sabendo. Quem está com pressa vê o aviso e escolhe; quem quer o bolo da Nena
    espera feliz, porque foi avisado antes de pagar, e não depois. Esse aviso o cliente pode fechar
    com um toque, ao contrário do de pausa: ele informa, não impede.
  </p>

  <h2 id="fechada">Fechada não é porta trancada</h2>
  <p>
    Fora do horário, a loja fica fechada, mas não fica inútil. Às sete da noite, depois que a Nena
    fechou às 18h, alguém abre a loja no celular, escolhe as fatias para levar amanhã cedo e monta a
    sacola inteira. No topo, a loja avisa “Fechado agora” e quando abre de novo, com uma frase que
    convida em vez de expulsar: “Você já pode montar sua sacola.”
  </p>
  <p>
    Na hora de finalizar, a sacola explica: “Estamos fechados — abrimos amanhã às 08:00. Seus itens
    ficam na sacola até lá.” O cliente não perde o que escolheu, e o pedido entra quando você está
    lá para recebê-lo.
  </p>
  <p>
    As encomendas são a exceção que faz sentido. Bolo de aniversário, kit festa, torta para domingo:
    ninguém precisa da loja aberta para encomendar algo de daqui a três dias. Com
    <strong>Encomendas com a loja fechada</strong> ligado, em Loja › Horários, uma sacola feita só de
    encomendas entra a qualquer hora, inclusive de madrugada. Uma sacola que mistura encomenda com pedido
    para agora espera a loja abrir. Desligou? A loja fechada não recebe nada.
  </p>
  <p>Os quatro estados lado a lado, do jeito que o cliente vive cada um:</p>

  <Estados />

  <p>
    Os recados são seus. Em Loja › Mensagens, você escreve o da pausa e o da loja fechada, cada um
    com até 200 caracteres. O da pausa já vem escrito na folha de pausar, e você muda ali mesmo se o
    dia pedir outro. Sem recado de loja fechada, a loja mostra quando abre de novo. Na aparência da
    loja dá para pôr ainda o bloco
    <strong>Avise quando voltar</strong>: o cliente deixa o número e, quando a loja abre, recebe uma
    única mensagem pelo WhatsApp da loja, “Abrimos agora, como você pediu para avisar”, com o link
    para pedir. Para isso, o WhatsApp da loja precisa estar conectado.
  </p>

  <h2 id="horarios">A semana, os feriados e o dia que fugiu da regra</h2>
  <p>
    A base de tudo é o horário da semana, em Loja › Horários: um dia por linha, com a chave para
    abrir ou fechar e um toque para mudar a hora. É o horário em que a loja aceita pedidos para
    agora. A Bolos da Nena, por exemplo, abre de terça a sábado das 8h às 18h, no domingo até o
    meio-dia, e descansa na segunda.
  </p>
  <p>
    Só que nenhuma semana é igual à outra. Para isso existem os
    <strong>Feriados e dias especiais</strong>: dias fechados ou com horário diferente, sem mexer na
    semana. Dá para marcar um dia só ou vários seguidos (as férias, a semana do Natal, até 62 dias),
    dar um nome e pedir para repetir todo ano. E os próximos feriados nacionais já aparecem prontos:
    um toque em “Natal” ou “Carnaval” marca a loja fechada na data. Os feriados que mudam de data
    todo ano, como Carnaval, Sexta-feira Santa e Corpus Christi, a Venduá calcula a partir da
    Páscoa.
  </p>
  <p>
    E tem o dia que foge da regra sem aviso. A Nena precisa sair às duas da tarde na quinta? Na
    folha do status, <strong>Mudar o horário de hoje</strong> deixa escolher entre
    <strong>abrir hoje</strong> e <strong>não abrir hoje</strong>, com a hora de abrir e de fechar.
    “Só vale para hoje. Amanhã volta o horário de sempre.” Mudou de ideia? Um toque em
    <strong>voltar ao horário de sempre</strong> desfaz. E, se tiver um dia especial chegando nos próximos
    sete dias, a folha já avisa, para você pausar ou mudar o dia sabendo o que vem pela frente.
  </p>
  <p>
    Abaixo, a semana da Nena desenhada como ela funciona. Arraste o agora pelos dias e veja o que a
    plaquinha diz e o que a sacola responde. Ligue e desligue os feriados e a mudança de quinta:
  </p>

  <Semana />

  <p>
    Experimente pôr o agora na quinta, às 15h30, com tudo ligado. Pela semana normal, a loja estaria
    aberta até as 18h. Com o “só hoje” até as 14h, ela já fechou. E, como sexta é Consciência Negra,
    a plaquinha pula direto para sábado de manhã. É essa conta que a loja refaz sozinha toda vez que
    alguém olha, para nenhum cliente ouvir “aberto” de uma loja fechada.
  </p>

  <h2 id="como">Como a gente fez</h2>
  <p>
    O segredo é ter uma resposta só. O status da loja não fica guardado num campo que alguém precisa
    lembrar de atualizar: ele é calculado na hora, sempre do mesmo jeito, a partir de quatro coisas.
    Existe uma pausa valendo? Ela tem hora para acabar, e essa hora já passou? Qual é o horário da
    semana? E existe algum dia especial para hoje? Por isso uma pausa de 15 minutos acaba exatamente
    no minuto quinze, mesmo que ninguém toque em nada.
  </p>
  <p>Todo mundo que precisa saber se a loja está aberta pergunta para essa mesma resposta:</p>
  <ul>
    <li>
      <strong>A loja na internet</strong> lê o status de novo no instante em que ele muda: a pausa que
      acaba, a hora de fechar, a hora de abrir. O cliente que deixou a página aberta vê a plaquinha virar
      sem recarregar.
    </li>
    <li>
      <strong>O pagamento</strong> confere de novo antes de criar o pedido. Se a loja pausou entre a sacola
      e o “finalizar”, o pedido não entra, e a página explica por quê. Nenhuma aba esquecida aberta passa
      um pedido por baixo da porta.
    </li>
    <li>
      <strong>O seu app</strong> se atualiza no momento exato da mudança, em todos os aparelhos da equipe.
      Se a Nena pausa no celular, o balcão vê “Pausada” na hora.
    </li>
    <li>
      <strong>O Duá, o vendedor com IA no WhatsApp da loja</strong>, consulta a mesma resposta antes
      de falar de horário. Ele sabe se a loja está aberta, pausada ou fechada, quando abre, quais
      dias especiais vêm aí e qual recado você deixou. Quem pergunta no WhatsApp “vocês estão
      abertos?” ouve o mesmo que a plaquinha diz.
    </li>
  </ul>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Pausar, o recado, os horários, os feriados e dias especiais, o “Muitos pedidos agora” e as
      encomendas com a loja fechada estão em todos os planos, a partir do Venduá Mirim. O Duá, que
      lê tudo isso para responder no WhatsApp, está no Venduá Bandeira.
    </p>
  </aside>
  <p>
    Para começar, abra Loja › Horários e confira a sua semana. Depois, passe pelos feriados que vêm
    aí e marque os que a loja não abre. Por fim, escreva os dois recados em Loja › Mensagens, um
    para a pausa e um para a loja fechada. Da próxima vez que o forno atrasar, pausar a loja é um
    toque.
  </p>
</Article>
