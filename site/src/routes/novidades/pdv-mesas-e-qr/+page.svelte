<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Cobrar from '$lib/posts/pdv-mesas-e-qr/Cobrar.svelte';
  import Fechamento from '$lib/posts/pdv-mesas-e-qr/Fechamento.svelte';
  import QrMesa from '$lib/posts/pdv-mesas-e-qr/QrMesa.svelte';
  import Salao from '$lib/posts/pdv-mesas-e-qr/Salao.svelte';

  const outline = [
    { id: 'balcao', title: 'A venda do balcão vira um pedido como os outros' },
    { id: 'pagamento', title: 'Pix, dinheiro com troco e o cartão na sua maquininha' },
    { id: 'mesas', title: 'Cada mesa com a sua comanda' },
    { id: 'qr', title: 'O cliente pede pelo QR da mesa' },
    { id: 'caixa', title: 'Fechar o caixa contando, não adivinhando' },
    { id: 'como', title: 'Como a gente fez' },
  ];
</script>

<Article
  path="/novidades/pdv-mesas-e-qr/"
  pose="pagamento"
  lede="Sábado, quatro da tarde: fila no balcão, as mesas do salão cheias e o celular tocando com pedido do cardápio online. A Venduá agora tem um PDV para esse momento. Você vende no balcão, abre a comanda de cada mesa, fecha o caixa contando cada forma de pagamento, e o cliente ainda pode pedir pelo QR da mesa. Tudo no mesmo app em que chegam os seus pedidos."
  {outline}
  closing="Balcão, salão e loja online numa conta só."
>
  <h2 id="balcao">A venda do balcão vira um pedido como os outros</h2>
  <p>
    Na Bolos da Nena, a tarde de sábado tem três frentes ao mesmo tempo. Tem gente na fila para
    levar uma fatia de cenoura com brigadeiro, tem a Mesa 5 pedindo mais um café e tem o pedido de
    entrega do Luiz chegando pelo cardápio online. Até aqui, só a terceira frente passava pela
    Venduá. O balcão e o salão ficavam no caderno, na calculadora, ou num segundo sistema com outro
    cardápio, que alguém precisava manter igual ao primeiro.
  </p>
  <p>
    O PDV acaba com essa segunda loja. Ele mora dentro do app da Venduá, com três telas:
    <strong>Vender</strong>, <strong>Mesas</strong> e <strong>Caixa</strong>. É o mesmo login, o
    mesmo cardápio, os mesmos produtos esgotados. Qualquer pessoa da equipe vende, cuida das
    comandas e do caixa. O que mexe no dinheiro de um jeito mais sério fica com quem é gerente: dar
    desconto, estornar um pagamento, cancelar uma comanda, criar as mesas e mudar a taxa de serviço.
  </p>
  <p>
    Em Vender, você toca nos produtos (o que tem opções pede as opções antes, como no cardápio
    online), escolhe <strong>para levar</strong> ou <strong>comer aqui</strong> e toca em cobrar. No computador
    do balcão, dá para ir só no teclado: é digitar para buscar, Enter na busca põe o primeiro produto
    e Enter fora dela cobra.
  </p>
  <p>
    O detalhe que muda o resto do dia: cada venda do balcão vira um pedido de verdade, com número na
    mesma sequência dos pedidos do cardápio online. Ela aparece em Pedidos, vai para a tela da
    cozinha, sai na impressora e entra nos relatórios. Ninguém precisa somar “o do balcão” com “o do
    site” no fim do dia, porque é tudo a mesma lista. E para o que sai na hora, como um café que já
    está pronto na garrafa, a opção <strong>entregar agora</strong> fecha a venda sem mandar nada para
    a cozinha.
  </p>
  <p>
    O telefone também cabe aqui. Pedido por telefone para entrega é feito no balcão, com o endereço:
    a taxa sai das suas zonas de entrega, como no cardápio online, e o pedido pode sair para cobrar
    na entrega, com o troco que o entregador precisa levar. Quando ele volta, o dinheiro entra no
    caixa.
  </p>
  <p>
    E o preço é sempre o da loja. A tela do balcão guarda só o que foi escolhido; quem calcula cada
    centavo é o servidor da Venduá, com os preços do seu cardápio. Se alguém mudou o preço de um
    produto entre a tela mostrar o total e você cobrar, a venda não passa com o valor velho: volta
    com o total novo para você conferir. O cliente que quer o carimbo do cartão fidelidade também
    ganha no balcão, é só digitar o telefone dele na venda.
  </p>

  <h2 id="pagamento">Pix, dinheiro com troco e o cartão na sua maquininha</h2>
  <p>
    O PDV recebe em cinco formas: dinheiro, Pix, crédito, débito e vale-refeição. Cada uma do jeito
    que o balcão já trabalha.
  </p>
  <ul>
    <li>
      <strong>Dinheiro:</strong> você marca quanto o cliente entregou, com botões das notas que passam
      do valor, e o troco sai calculado pela loja. Quem está no caixa não faz conta de cabeça com a fila
      olhando.
    </li>
    <li>
      <strong>Pix:</strong> o QR da chave Pix da loja aparece na tela já com o valor da venda. O cliente
      aponta o celular e paga, e o dinheiro cai direto na sua conta. Confira no banco antes de confirmar,
      como você já faz hoje.
    </li>
    <li>
      <strong>Crédito, débito e vale-refeição:</strong> aqui vale dizer com todas as letras. A Venduá
      não se conecta à maquininha. Você passa o cartão na sua maquininha, como sempre, e registra no PDV
      a forma e o valor. A cobrança é da maquininha; o registro serve para o caixa bater no fim do dia.
    </li>
  </ul>
  <p>
    Quando o cliente paga metade no Pix e metade em dinheiro, toque em
    <strong>dividir em formas</strong>. Cada forma que você escolhe já vem com o que falta, e você
    ajusta os valores. São até 10 formas por venda, e a venda só fecha quando elas somam exatamente
    o total. Experimente:
  </p>

  <Cobrar />

  <p>
    Desconto também existe, com regra. Quem é gerente dá um valor fixo ou uma porcentagem, sempre
    com um motivo escrito, e o motivo fica registrado junto da venda. O desconto ou acréscimo por
    forma de pagamento que você configurou no cardápio online não vale no balcão: lá, desconto é
    decisão de quem é gerente, e fica anotado.
  </p>

  <h2 id="mesas">Cada mesa com a sua comanda</h2>
  <p>
    A tela Mesas mostra o salão inteiro de uma vez. Mesa livre aparece tracejada; mesa ocupada
    mostra o total da comanda, há quanto tempo está aberta e quantas rodadas já saíram. Um toque
    numa mesa livre abre a comanda. Quem é gerente cria as mesas de uma vez só, como Mesa 1 a Mesa
    20, e a loja pode ter até 200. Para quem não tem mesa (a ficha do balcão, o cliente que pediu
    pelo nome), dá para abrir comanda sem mesa.
  </p>
  <p>
    Cada vez que você adiciona itens, sai uma <strong>rodada</strong> para a cozinha e para a impressora,
    com o número da mesa no ticket. A mesa pede o bolo, depois o café, depois mais uma fatia: são três
    rodadas, cada uma no seu tempo, e a cozinha vê cada uma como um pedido. Uma mesa tem uma comanda aberta
    por vez, então ninguém lança o café da Mesa 5 numa comanda esquecida.
  </p>
  <p>
    A taxa de serviço, os famosos 10% do garçom, é sua: de 0 a 20%, e entra nas comandas abertas
    dali em diante. Ela é calculada sobre o consumo, já com o desconto, e o cliente pode recusar. É
    só desligar na comanda dele. Na hora de pagar, cada um paga quando quiser: a comanda aceita
    pagamentos parciais. E quando a mesa pede para dividir, você escolhe em quantas partes, de 2 a
    20. Como dinheiro não se parte em pedaços menores que um centavo, o centavo que sobra vai para
    as primeiras partes, e a soma bate sempre com o total.
  </p>
  <p>
    Quando não falta mais nada, a comanda fecha sozinha: as rodadas ficam pagas e entregues, e a
    mesa volta a ficar livre no salão. Toque nas mesas abaixo, divida a conta da Mesa 5 e receba as
    partes até ela fechar:
  </p>

  <Salao />

  <p>
    Se a mesa quer conferir antes de pagar, a conta sai na impressora: a <strong>conferência</strong
    >, com as rodadas, o serviço, o que já foi pago, o que falta e a divisão em partes, se você
    dividiu. Ela é marcada como “não é documento fiscal”, porque não é.
  </p>

  <h2 id="qr">O cliente pede pelo QR da mesa</h2>
  <p>
    A outra metade do salão é o celular do cliente. Cada mesa tem o seu QR: em Mesas, toque em
    <strong>editar mesas</strong> e em <strong>imprimir todos</strong>, e sai uma folha com o QR de
    cada mesa, pronta para recortar. O cliente aponta a câmera, vê o seu cardápio e pede para aquela
    mesa. No fim, ele não preenche endereço nem telefone: só o primeiro nome. E escolhe se paga na
    hora, por Pix ou cartão pelo Mercado Pago, ou se deixa na comanda com
    <strong>pagar na mesa</strong>.
  </p>
  <p>
    A decisão mais importante aqui foi a do aceite. Todo pedido pelo QR chega em Pedidos e só vai
    para a cozinha quando alguém da equipe aceita. Assim, quem tirou foto do QR e foi para casa não
    manda bolo para uma mesa vazia. E para a fila de aceite não virar bagunça, cada mesa pode ter no
    máximo cinco pedidos pelo QR esperando a equipe ao mesmo tempo. Tente passar disso:
  </p>

  <QrMesa />

  <p>
    O QR também tem dono. Se um QR sumiu, foi fotografado ou foi parar onde não devia, quem é
    gerente gera um novo para aquela mesa, e o antigo para de funcionar na hora. O horário da loja e
    a pausa valem para o QR como valem para o cardápio online; o pedido mínimo e as opções de
    entrega e retirada, não, porque o cliente está sentado ali. E se um dia você quiser só a equipe
    anotando, o interruptor <strong>pedidos pelo QR da mesa</strong> fica em Mesas, ligado desde o começo.
  </p>
  <p>
    Uma coisa que o pedido pelo QR não faz: como o cliente não deixa telefone, ele não recebe as
    mensagens do pedido no WhatsApp e não ganha carimbo de fidelidade. O que foi pago online aparece
    na comanda como <strong>pago online</strong>, fora do que falta receber. A conta da mesa inteira
    continua sendo paga para a equipe, que recebe pelo caixa.
  </p>

  <h2 id="caixa">Fechar o caixa contando, não adivinhando</h2>
  <p>
    O dia no balcão começa abrindo o caixa com o troco que está na gaveta. Sem caixa aberto, o PDV
    não recebe pagamento nenhum, e a loja tem um caixa aberto por vez. Durante o dia, o dinheiro que
    sai da gaveta é uma <strong>sangria</strong> (um depósito no banco, um pagamento a fornecedor) e
    o que entra é um <strong>suprimento</strong> (mais troco), cada um com o motivo escrito. Até o pedido
    do cardápio online que é pago no balcão entra nesse caixa.
  </p>
  <p>
    Para fechar, você conta cada forma: as notas e moedas da gaveta, o Pix que entrou no banco, o
    total de cada cartão no relatório da maquininha. A Venduá compara com o esperado. No dinheiro, o
    esperado é o troco inicial, mais o que entrou em dinheiro, mais os suprimentos, menos as
    sangrias; nas outras formas, é a soma do que foi recebido. O fechamento mostra a diferença de
    cada uma: conferido, faltou ou sobrou.
  </p>
  <p>
    E tem o fechamento às cegas. Quem é atendente conta sem ver o esperado: digita o que tem em cada
    forma, e as diferenças aparecem no relatório do fechamento. Quem é gerente vê o esperado
    enquanto conta. É o jeito antigo dos bons caixas, de contar primeiro e comparar depois, agora
    feito pela tela. Troque de visão no exemplo:
  </p>

  <Fechamento />

  <p>
    O relatório de cada caixa fechado fica guardado, com o que foi contado, as sangrias, os
    suprimentos, o troco dado e o serviço das comandas, e pode ser impresso. Com o tempo, a lista de
    caixas fechados mostra se a diferença é um acidente de sábado ou um hábito.
  </p>

  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      O PDV, as mesas com comanda e o QR da mesa estão no Venduá Bandeira, junto com a tela da
      cozinha e a impressão automática da comanda. O Venduá Mirim não inclui o PDV. Para
      experimentar com a sua loja, o Bandeira começa com 14 dias grátis.
    </p>
  </aside>

  <h2 id="como">Como a gente fez</h2>
  <p>
    A regra que guiou tudo: o PDV não podia ser uma segunda loja escondida dentro da primeira. Por
    isso, cada venda do balcão e cada rodada de comanda é um pedido no mesmo caminho dos pedidos do
    cardápio online, com o número da mesma sequência. A cozinha, a impressão e os relatórios já
    sabiam lidar com pedidos; agora eles recebem esses também, sem nenhum caso especial. A rodada é
    um pedido, e não uma linha a mais num pedido aberto, porque pedido feito não muda: a cozinha, a
    impressora e o estoque contam com isso.
  </p>
  <ul>
    <li>
      <strong>O dinheiro é calculado num lugar só.</strong> A tela do balcão manda só o que foi escolhido.
      O servidor da Venduá calcula o preço com as mesmas regras do cardápio online, confere de novo na
      hora de cobrar e recusa um total que mudou. Desconto, taxa de serviço, troco e divisão da conta
      também são calculados lá, sempre em centavos inteiros.
    </li>
    <li>
      <strong>O QR não é o número da mesa.</strong> Ele leva uma assinatura que só vale para aquela mesa
      daquela loja. Por isso ninguém adivinha o QR da mesa ao lado trocando um número no endereço, e um
      QR novo derruba o antigo sem você renumerar nada. O endereço impresso não expira.
    </li>
    <li>
      <strong>O caixa tem o seu próprio livro.</strong> Cada pagamento, sangria e suprimento fica registrado
      com quem fez e quando. Um pagamento estornado pelo gerente sai do caixa e volta a faltar na comanda.
    </li>
  </ul>
  <p>
    E o que ele não faz, para você planejar o seu balcão: o PDV não emite NFC-e, não se conecta à
    maquininha de cartão e não deixa o cliente pagar a conta da mesa inteira pelo celular. Se a sua
    loja emite nota fiscal no balcão, essa parte continua fora da Venduá.
  </p>
  <p>
    Para começar, abra o PDV no app, crie as mesas do salão, abra o caixa com o troco da gaveta e
    faça a primeira venda. Se quiser o QR, imprima a folha de QR das mesas e deixe uma em cada mesa.
  </p>
</Article>
