<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Fallback from '$lib/posts/entrega-por-distancia/Fallback.svelte';
  import FeeCurve from '$lib/posts/entrega-por-distancia/FeeCurve.svelte';
  import MapSim from '$lib/posts/entrega-por-distancia/MapSim.svelte';
  import ZonesVsDistance from '$lib/posts/entrega-por-distancia/ZonesVsDistance.svelte';

  const outline = [
    { id: 'porta', title: 'O cliente marca a porta, não o bairro' },
    { id: 'conta', title: 'A conta, quilômetro por quilômetro' },
    { id: 'regras', title: 'Cinco números e uma escada' },
    { id: 'caminho', title: 'Pelo caminho de carro, não em linha reta' },
    { id: 'estimativa', title: 'Quando a rota não vem' },
    { id: 'cobra', title: 'O cliente paga o que viu' },
    { id: 'ligar', title: 'Como ligar na sua loja' },
  ];
</script>

<Article
  path="/novidades/entrega-por-distancia/"
  pose="entrega"
  lede="Taxa por bairro é um chute educado: quem mora na esquina paga o mesmo que quem mora no fim do bairro. Agora a sua loja pode cobrar pela distância de verdade. O cliente confirma no mapa onde fica a porta dele, a Venduá traça o caminho de carro até lá e a taxa sai pelos quilômetros que o entregador vai rodar."
  {outline}
  closing="Cada entrega pelo caminho que ela faz de verdade."
>
  <h2 id="porta">O cliente marca a porta, não o bairro</h2>
  <p>
    Fim de tarde na Bolos da Nena. Chega um pedido de bolo de cenoura com brigadeiro para a Vila
    Nova. Pela tabela antiga, Vila Nova é R$ 10,00. Só que esse cliente mora na última rua do
    bairro, quase saindo da cidade, e o motoboy vai rodar o dobro do que roda para a cliente da
    primeira quadra, que pagou os mesmos R$ 10,00 ontem. Na mesma semana, alguém do outro lado do
    rio pagou a taxa do bairro vizinho, porque no mapa parecia perto. Para chegar lá, o entregador
    teve de dar a volta até a ponte.
  </p>
  <p>
    Quem faz entrega conhece essa conta torta. A tabela por bairro foi feita num dia qualquer, com
    os bairros que a gente lembrava, e envelhece. Bairro tem nome escrito de três jeitos, CEP que
    cai no lugar errado, rua que divide dois bairros no meio.
  </p>
  <p>
    Com a entrega por distância, a pergunta deixa de ser “qual é o seu bairro?” e passa a ser “onde
    fica a sua porta?”. No checkout, a loja abre um mapa já na região do endereço que o cliente
    digitou, com a instrução <strong
      >“Arraste o mapa até o pino ficar na sua porta e confirme.”</strong
    >
    Dá para usar a localização do celular, aproximar, afastar e mover com as setas do teclado. Quando
    o cliente toca em <strong>Confirmar local</strong>, a Venduá calcula o caminho de carro da loja
    até aquele ponto e mostra a distância e a taxa ali mesmo, antes do pagamento. Se ele marcar
    “Lembrar meus dados”, o pino fica guardado e o próximo pedido nem pergunta de novo.
  </p>
  <p>
    Por que pedir para o cliente confirmar no mapa, em vez de achar tudo pelo endereço? Porque os
    serviços abertos de endereço ainda erram muito número de casa no Brasil. O endereço digitado
    serve para abrir o mapa no lugar certo. Quem sabe onde fica a porta é quem mora nela.
  </p>

  <h2 id="conta">A conta, quilômetro por quilômetro</h2>
  <p>
    A regra cabe numa linha: <strong>taxa de saída mais um valor por quilômetro começado</strong>,
    nunca abaixo da taxa mínima. Se a sacola passa do valor que você escolheu, a entrega fica por
    conta da loja. Se a porta fica mais longe que o seu limite, a loja não entrega ali. Mexa no
    simulador abaixo: ele faz exatamente essa conta, com os mesmos arredondamentos.
  </p>

  <MapSim />

  <p>
    Repare no “km começado”. Rodou 2,3 km? Contam 3. Cada quilômetro que o entregador começa a rodar
    entra inteiro na conta, do mesmo jeito que você pensaria se fizesse a conta de cabeça. E tem um
    cuidado a mais: a distância aparece para o cliente com uma casa decimal, e é essa mesma
    distância que entra na conta. Um caminho de 3,04 km aparece como 3,0 km e paga 3 km. Nunca
    acontece de a tela dizer “3,0 km” e a taxa cobrar um quarto quilômetro que o cliente não viu.
  </p>
  <p>
    Na porta da Rita, do outro lado do rio, o simulador mostra o outro lado da regra. Em linha reta
    ela fica a 4,4 km da Nena, mas o caminho passa pela ponte e dá 9,8 km. Com o limite em 8 km, a
    loja não entrega lá, e o cliente lê no mapa “Esse local fica fora da área de entrega.” antes de
    pagar qualquer coisa. Ninguém descobre depois, no WhatsApp, que a entrega não sai.
  </p>

  <h2 id="regras">Cinco números e uma escada</h2>
  <p>
    No app da loja, em Loja › Entrega, o cartão “Cobrar pela distância” tem cinco campos. Cada um
    responde a uma pergunta que você já se faz quando monta a taxa:
  </p>
  <ul>
    <li>
      <strong>Taxa de saída.</strong> Cobrada em toda entrega. É o custo de o entregador sair da loja,
      por perto que seja.
    </li>
    <li>
      <strong>Por km.</strong> O valor de cada quilômetro começado no caminho de carro.
    </li>
    <li>
      <strong>Taxa mínima.</strong> Nenhuma entrega sai por menos que isso. Serve para a entrega da esquina
      não sair barata demais. É opcional.
    </li>
    <li>
      <strong>O valor a partir do qual a loja paga a entrega.</strong> Pedidos desse valor para cima não
      pagam taxa. A conta usa a sacola antes de qualquer cupom. Também é opcional.
    </li>
    <li>
      <strong>Entrega até.</strong> A distância máxima pelo caminho. Mais longe que isso, a loja não entrega.
      Vem em 8 km, e você ajusta de 1 a 50 km.
    </li>
  </ul>
  <p>
    Juntos, eles desenham uma escada. A taxa começa num patamar (a mínima), sobe um degrau a cada
    quilômetro começado e para num corte, onde a loja deixa de entregar. O gráfico abaixo usa os
    valores do simulador: mexa nos controles lá em cima e a escada muda aqui.
  </p>

  <FeeCurve />

  <p>
    Abaixo do cartão, o app escreve a sua regra numa frase, para conferir de relance: a taxa de
    saída, quanto por km, a mínima, até quantos km e a partir de quanto a loja paga a entrega. Se a
    frase não parece com o que você cobraria no balcão, é só mexer nos números. Toda taxa é
    calculada pela Venduá, no servidor, com a mesma regra para a vitrine, para o checkout e para o
    pedido que chega no seu celular.
  </p>

  <h2 id="caminho">Pelo caminho de carro, não em linha reta</h2>
  <p>
    Já existia na Venduá a entrega por raio: círculos em volta da loja, cada um com a sua taxa. O
    problema é que círculo mede em linha reta, e moto não voa. Com um rio, uma lagoa ou uma rodovia
    no meio, o caminho pode ter o dobro da distância do círculo, e a loja cobra o preço curto.
  </p>
  <p>
    Por isso a entrega por distância mede o caminho de carro, rua por rua, da loja até a porta. No
    simulador lá em cima, os círculos tracejados são a linha reta e a mancha clara é onde o caminho
    chega dentro do limite. Do lado da loja, a mancha vira um losango, porque o carro anda pelas
    ruas. Do outro lado do rio, ela encolhe e se apoia na ponte. Ela não é um círculo.
  </p>
  <p>Compare, na mesma vizinhança, a tabela por bairro com a conta por distância:</p>

  <ZonesVsDistance />

  <p>
    A Duda, no começo da Vila Nova, pagava mais do que a conta pela distância dá. O Caio, no fim do
    mesmo bairro, pagava menos. E a Rita recebia por R$ 9,00 uma entrega de quase 10 km. Com a
    distância, cada um paga pela própria viagem, e a lista de bairros some da sua rotina.
  </p>

  <h2 id="estimativa">Quando a rota não vem</h2>
  <p>
    O caminho de carro vem de um serviço de rotas aberto, de fora da Venduá. Como todo serviço de
    fora, às vezes ele não responde. Para isso existe um plano B, e ele nunca segura o checkout:
    quando não dá para ter a rota na hora, a Venduá mede a linha reta da loja até a porta e soma
    30%, porque rua nunca é reta. Essa distância vai marcada como estimativa. Para o cliente, ela
    aparece como “cerca de 5,8 km”, e o pedido guarda que a taxa veio de uma estimativa, não de uma
    rota.
  </p>

  <Fallback />

  <p>
    A estimativa chega perto onde as ruas vão mais ou menos direto e fica longe da verdade onde há
    um rio no meio. Por isso ela é o plano B, não a regra. Sem rota, o tempo de entrega também é
    estimado: o tempo de preparo da loja mais o trajeto a 25 km/h, que é um ritmo de moto na cidade.
    Quando um pedido de rota falha, a Venduá espera um minuto antes de tentar de novo e, nesse
    meio-tempo, segue com a estimativa. Um caminho já calculado fica guardado por 30 dias, então a
    mesma porta não precisa perguntar de novo.
  </p>
  <p>
    O mapa do checkout também foi feito pela Venduá: umas 300 linhas, sem biblioteca de mapas. Um
    mapa pronto, dos que desenham tudo em vetor, acrescentaria uns 220 KB à página e dependeria da
    parte gráfica do celular. O checkout precisa abrir leve em qualquer aparelho.
  </p>

  <h2 id="cobra">O cliente paga o que viu</h2>
  <p>
    Uma taxa que muda entre a tela e o pagamento é a pior experiência de checkout que existe. Por
    isso a Venduá calcula o caminho uma vez, quando o cliente confirma a porta, e guarda essa
    distância na sacola. Na hora de fechar o pedido, ela usa o que está guardado, mesmo que o
    serviço de rotas esteja fora do ar ou fosse responder outra coisa naquele minuto. A distância
    que o cliente viu é a distância cobrada.
  </p>
  <p>
    O resto do checkout continua igual. O pedido mínimo vale, o cupom que zera a entrega vale e o
    valor a partir do qual a loja paga a entrega também. E cada pedido guarda se a taxa veio de uma
    rota ou de uma estimativa.
  </p>
  <p>
    No WhatsApp é a mesma regra. O Duá, o vendedor com IA no WhatsApp da loja, sabe que a sua
    entrega é pela distância e até quantos quilômetros. Quando só o bairro não basta, ele pede para
    o cliente mandar a localização pelo próprio WhatsApp e calcula a taxa a partir daquele ponto,
    antes de dizer que não entrega.
  </p>
  <p>
    E quem ficou de fora vira informação. Em Relatórios, o quadro “Entrega por área” mostra quantas
    pessoas consultaram o frete e quantas dessas consultas viraram pedido. Quando alguém pede
    entrega onde você não chega, a consulta entra em “Onde pediram e você não entrega”, contada pelo
    bairro que o cliente digitou. Se o mesmo bairro aparece toda semana, talvez seja a hora de subir
    o seu limite de quilômetros.
  </p>

  <h2 id="ligar">Como ligar na sua loja</h2>
  <p>
    A entrega por distância vem desligada, e nada muda na sua loja até você ligar. Para ligar, abra
    o app em Loja › Entrega:
  </p>
  <ol>
    <li>
      <strong>Marque a loja no mapa.</strong> Toque em “pelo endereço” para o mapa achar a sua rua e em
      “marcar loja” para tocar no ponto exato. É desse pino que a distância é medida, e sem ele a opção
      nem liga.
    </li>
    <li>
      <strong>Ligue “Cobrar pela distância”.</strong> O cliente passa a confirmar no mapa onde entregar.
    </li>
    <li>
      <strong>Preencha os valores.</strong> Taxa de saída, valor por km e a distância máxima. A mínima
      e o valor a partir do qual a loja paga a entrega são opcionais.
    </li>
    <li>
      <strong>Confira as áreas de reserva.</strong> Suas áreas por bairro, raio ou desenho no mapa não
      são apagadas: cada uma continua com a sua taxa, o seu tempo, o seu pedido mínimo e o seu valor para
      a loja pagar a entrega. Elas passam a valer só para o endereço que chega sem o local no mapa.
    </li>
  </ol>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      A entrega por distância está em todos os planos abertos, do Venduá Mirim ao Venduá Bandeira. O
      Duá calculando a entrega pela localização no WhatsApp está no Venduá Bandeira.
    </p>
  </aside>
  <p>
    Uma dica para começar: pegue três pedidos de entrega da semana passada, um perto, um médio e um
    longe, e veja quanto cada um pagaria com os seus números. Se a entrega da esquina ficou barata
    demais, suba a mínima. Se a mais longe não cobre a gasolina, suba o valor por km. Pronto: a sua
    tabela de bairros vira uma regra que acompanha a rua.
  </p>
</Article>
