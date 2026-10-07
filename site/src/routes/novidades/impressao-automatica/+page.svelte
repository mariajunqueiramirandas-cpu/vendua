<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Comanda from '$lib/posts/impressao-automatica/Comanda.svelte';
  import Conexoes from '$lib/posts/impressao-automatica/Conexoes.svelte';
  import Offline from '$lib/posts/impressao-automatica/Offline.svelte';
  import Parear from '$lib/posts/impressao-automatica/Parear.svelte';
  import Quando from '$lib/posts/impressao-automatica/Quando.svelte';

  const outline = [
    { id: 'cozinha', title: 'A comanda sai sozinha' },
    { id: 'quando', title: 'Ao aceitar ou assim que chega' },
    { id: 'conectar', title: 'Um app, um código, pronto' },
    { id: 'impressora', title: 'Serve a térmica que você já tem' },
    { id: 'internet', title: 'Caiu a internet? A comanda espera' },
    { id: 'limites', title: 'O que ela ainda não faz' },
    { id: 'como', title: 'Como a gente fez' },
  ];
</script>

<Article
  path="/novidades/impressao-automatica/"
  pose="sucesso"
  lede="Você toca em aceitar no celular e, lá na cozinha, a impressora já está soltando a comanda. Com o app Venduá Impressora num computador ou tablet da loja, cada pedido sai numa térmica de 58 ou 80 mm sem ninguém apertar nada. E se a internet cair, ela imprime o que ficou para trás quando a conexão voltar."
  {outline}
  closing="Você aceita o pedido. A comanda já está saindo."
>
  <h2 id="cozinha">A comanda sai sozinha</h2>
  <p>
    Terça, meio-dia e quatro. O celular da Nena apita: pedido #29, do Luiz, para entrega. Ela toca
    em aceitar com a mão ainda suja de massa e, antes de chegar na pia, a impressora em cima da
    bancada já está soltando o papel. Número grande, como o pedido sai, cada bolo com o que o Luiz
    escolheu, o recado sobre o interfone e o que fazer com o dinheiro na porta.
  </p>
  <p>
    Até aqui, isso dependia de alguém. Abrir o pedido, tocar em imprimir, escolher a impressora na
    janela do navegador, torcer para ela estar ligada. Na correria, a comanda ficava para depois e o
    pedido ia de cabeça para a cozinha. Agora a Venduá manda a comanda direto para a impressora da
    loja, no momento que você escolheu, sem ninguém apertar nada.
  </p>
  <p>
    Mexa na impressora aqui embaixo. Troque o papel de 80 para 58 mm e veja a comanda se rearrumar,
    aumente as cópias, tire os acentos, desligue o corte. A quebra das linhas é a mesma que a Venduá
    calcula antes de mandar cada comanda: 48 letras por linha no papel de 80 mm, 32 no de 58.
  </p>

  <Comanda />

  <p>
    O que vem escrito foi pensado para quem lê de pé, com pressa, a um braço de distância do papel:
  </p>
  <ul>
    <li>
      <strong>O número do pedido em letra dobrada</strong> e, logo embaixo, como ele sai: entrega, retirada
      ou o nome da mesa, quando o pedido é para comer no local.
    </li>
    <li>
      <strong>Quem pediu e para onde vai.</strong> O nome, o telefone e, na entrega, o endereço com o
      bairro e a previsão que o cliente recebeu. Encomenda vem com o dia marcado em destaque.
    </li>
    <li>
      <strong>Cada item em letra alta</strong>, com as escolhas do cliente logo abaixo e a
      observação do item em negrito, para o “sem granulado” não passar batido.
    </li>
    <li>
      <strong>O recado do pedido</strong> separado do resto, também em letra alta.
    </li>
    <li>
      <strong>O total e o que fazer com o dinheiro:</strong> “PAGO”, “cobrar na entrega”, “cobrar na retirada”
      ou “aguardando pagamento online - não cobrar”. Se o cliente pediu troco, o valor do troco vem em
      negrito.
    </li>
  </ul>
  <p>
    E no balcão também. Quem usa o PDV da Venduá imprime na mesma impressora a conferência da conta
    da mesa, com o serviço, o que já foi pago e a divisão por pessoa, e o relatório do caixa,
    parcial ou de fechamento, com o que entrou em cada forma de pagamento e a diferença contada.
  </p>

  <h2 id="quando">Ao aceitar ou assim que chega</h2>
  <p>
    Em Impressoras, no app da loja, a opção <strong>Quando imprimir</strong> decide o momento. Ela
    vale para todas as impressoras com <strong>Imprimir pedidos sozinha</strong> ligado, e tem duas respostas.
  </p>
  <p>
    <strong>Ao aceitar o pedido</strong> é o padrão. A comanda sai quando você toca em aceitar, então
    a cozinha só vê o que você decidiu fazer. Pedido recusado, porque o endereço é longe demais ou o bolo
    acabou, não gasta papel e não deixa ninguém começando uma receita à toa.
  </p>
  <p>
    <strong>Assim que chega</strong> imprime no instante em que o cliente fecha o pedido. É para a loja
    que aceita praticamente tudo e quer a cozinha começando um pouco antes. A conta vem no papel dos pedidos
    que você acaba recusando, que saem impressos do mesmo jeito.
  </p>

  <Quando />

  <p>
    Nos dois casos, cada pedido sai uma vez só em cada impressora. Se você troca a opção no meio do
    expediente, nada sai repetido: o pedido que já imprimiu quando chegou não imprime de novo quando
    você aceita. E o que chegou antes da troca, e ainda não tinha saído, sai uma vez, quando você
    aceitar.
  </p>

  <h2 id="conectar">Um app, um código, pronto</h2>
  <p>
    A impressora não conversa com a internet sozinha. Quem faz a ponte é o
    <strong>Venduá Impressora</strong>, um app pequeno que você instala no aparelho ligado à
    impressora: um computador com Windows ou um tablet Android, que fique ligado no horário da loja.
  </p>
  <p>
    Você abre o app e ele mostra um código de 8 letras e números. No app da loja, em Impressoras,
    alguém com acesso de gerente digita o código, confere o nome do aparelho que apareceu e toca em
    conectar. Pronto. Nada de senha para digitar no tablet, nada de conta nova. No Android dá até
    para ler um QR code com o celular onde o painel está aberto.
  </p>

  <Parear />

  <p>
    O código vale por 10 minutos e, passado isso, o app gera outro. Depois de conectado, o aparelho
    imprime para a sua loja até alguém desconectar ele no painel, o que vale na hora: as comandas
    param de sair ali e, para voltar, só com um código novo.
  </p>

  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      A impressão automática está no Venduá Bandeira, junto com a tela da cozinha e o PDV, e dá para
      testar com a sua impressora nos 14 dias grátis do plano. No Venduá Mirim, o pedido toca no
      celular, mas a comanda não sai impressa.
    </p>
  </aside>

  <h2 id="impressora">Serve a térmica que você já tem</h2>
  <p>
    Serve qualquer impressora térmica de 58 ou 80 mm que fale ESC/POS, a língua das impressoras de
    cupom: Epson, Elgin, Bematech no modo ESC/POS, Daruma e as genéricas sem marca que se compram em
    qualquer loja de informática. Se ela imprime cupom, muito provavelmente serve. O que muda é o
    cabo, e cada aparelho tem os seus:
  </p>

  <Conexoes />

  <p>
    Cada impressora ganha a sua própria configuração no painel, e dá para dar um nome a ela, como
    Cozinha ou Balcão:
  </p>
  <ul>
    <li>
      <strong>Imprimir pedidos sozinha</strong> liga a impressão automática naquela impressora. Sem ela,
      a impressora fica no manual e só imprime quando você pede.
    </li>
    <li><strong>Largura do papel</strong>, 58 ou 80 mm.</li>
    <li>
      <strong>Cópias</strong>, de 1 a 3 de cada pedido: uma fica na cozinha, outra vai junto com a
      sacola.
    </li>
    <li>
      <strong>Cortar o papel</strong>, para desligar quando a impressora não tem guilhotina.
    </li>
    <li>
      <strong>Acentos.</strong> Se sair um símbolo no lugar do ç ou do ã, troque aqui e toque em imprimir
      teste.
    </li>
  </ul>
  <p>
    O teste imprime o nome da loja e da impressora, o papel e quantas letras cabem na linha, uma
    linha com todos os acentos do português e uma frase no fim: “Se você leu tudo certinho, está
    pronta.”
  </p>

  <h2 id="internet">Caiu a internet? A comanda espera</h2>
  <p>
    Internet de loja cai. O roteador reinicia, o tablet descarrega, alguém tira o computador da
    tomada para ligar a batedeira. Os pedidos continuam chegando no celular, e você aceita
    normalmente. A comanda de cada um fica na fila da Venduá, esperando o aparelho voltar.
  </p>
  <p>
    Quando ele volta, imprime o que ficou para trás. Se uma comanda sai mais de 10 minutos depois de
    entrar na fila, ela vem com “IMPRESSÃO ATRASADA” no topo e o horário em que entrou, para a
    cozinha saber que aquele cliente está esperando faz tempo. Duas regras evitam bagunça: comanda
    com mais de 2 horas de fila não sai mais, porque a essa altura o pedido já foi resolvido de
    outro jeito, e pedido cancelado enquanto esperava não imprime, para ninguém fazer um bolo que
    não vai sair.
  </p>

  <Offline />

  <p>
    Em cada pedido, o app da loja conta o que aconteceu com a comanda: “Impressa às 12:05”,
    “Esperando o aparelho ligar” ou “A comanda não saiu”, com o motivo. E em qualquer pedido,
    <strong>imprimir comanda</strong> manda de novo quando você quiser. Com mais de uma impressora, dá
    para escolher só uma.
  </p>
  <p>
    O app foi feito para ficar de pé sozinho. No Windows, ele se instala no computador, vira um
    ícone perto do relógio e abre sozinho quando o computador liga. No Android, ele roda com uma
    notificação fixa de impressão automática ativa, volta sozinho quando o tablet reinicia e a cada
    15 minutos confere se continua funcionando. Se o Android não deixar ele voltar, a notificação
    pede um toque para reativar. O único ajuste que fica com você é deixar a bateria do app em “Não
    otimizar”, para o Android não fechá-lo com a tela apagada. O próprio app mostra a lista de
    ajustes e leva você até a tela certa.
  </p>

  <h2 id="limites">O que ela ainda não faz</h2>
  <p>A gente prefere que você saiba antes de comprar uma impressora:</p>
  <ul>
    <li>
      <strong>Não separa por setor.</strong> Toda impressora com impressão automática recebe a comanda
      inteira. Não dá para a cozinha receber só a comida e o bar só as bebidas: com duas impressoras automáticas,
      as duas imprimem o pedido todo. Para dividir o trabalho, a tela da cozinha já mostra cada estação
      só com as categorias dela.
    </li>
    <li>
      <strong>Não imprime em impressora comum.</strong> Jato de tinta ou laser de folha A4 não servem,
      só térmica ESC/POS.
    </li>
    <li>
      <strong>Não emite nota fiscal.</strong> A comanda e a conta da mesa são papéis de trabalho. Não
      tem NFC-e.
    </li>
    <li>
      <strong>No Windows, um aviso na primeira vez.</strong> O app ainda não tem assinatura digital, então
      o Windows mostra “O Windows protegeu o computador” quando você abre o arquivo baixado. Toque em
      Mais informações e depois em Executar assim mesmo. Depois de instalado, ele não pergunta mais. Em
      computadores com Windows 11 configurados para bloquear todo app sem assinatura, ele não abre: nesses,
      use um tablet Android.
    </li>
    <li>
      <strong>No Android, fora da Play Store.</strong> O app é instalado pelo arquivo, e o Android pede
      para você permitir a instalação vinda do navegador. É um toque a mais, uma vez só.
    </li>
  </ul>

  <h2 id="como">Como a gente fez</h2>
  <p>
    A decisão que mais pesa: quem desenha a comanda é a Venduá, no servidor, não o app. O app é só
    um cano. Ele recebe a comanda pronta, já na língua da impressora, entrega para ela e avisa como
    foi. Por isso a gente melhora o layout, acerta um acento ou cria um papel novo, como a conta da
    mesa, sem você atualizar nada no tablet. E por isso dois apps tão diferentes, um para Windows e
    outro para Android, imprimem exatamente igual.
  </p>
  <p>
    A comanda usa só os comandos que toda térmica entende: alinhar, negrito, letra dobrada, avançar
    o papel e cortar. É o que faz ela funcionar da Epson à genérica sem marca. Os acentos vão pela
    tabela CP850, a que a maioria entende; para as teimosas, tem a CP860 e a opção sem acento
    nenhum, em que o “ã” vira “a” em vez de virar um rabisco.
  </p>
  <p>
    A fila mora na Venduá, não no aparelho. A comanda entra na fila no mesmo passo em que o pedido é
    aceito (ou em que ele chega, se for o caso), e se algo der errado com a impressão, o pedido
    segue: imprimir nunca trava um pedido. Cada impressora tem uma vaga só por pedido e por momento,
    e é isso que garante que nada sai em dobro. O app mantém uma conexão aberta e é acordado no
    instante em que uma comanda entra na fila. Se ele não confirma em um minuto, a comanda vai de
    novo, e o app reconhece a que já imprimiu.
  </p>
  <p>
    Na conexão, o aparelho guarda uma chave só dele, e a Venduá guarda apenas uma impressão digital
    dessa chave, nunca a chave. Quem conecta um aparelho é sempre alguém da sua loja, no painel, com
    o código que está na tela à sua frente.
  </p>
</Article>
