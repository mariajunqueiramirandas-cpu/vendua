<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import { plans } from '$lib/content';
  import AddonRule from '$lib/posts/dua-fecha-o-pedido/AddonRule.svelte';
  import ConversationClock from '$lib/posts/dua-fecha-o-pedido/ConversationClock.svelte';
  import Frame from '$lib/posts/dua-fecha-o-pedido/Frame.svelte';
  import OrderGate from '$lib/posts/dua-fecha-o-pedido/OrderGate.svelte';
  import OrderLanding from '$lib/posts/dua-fecha-o-pedido/OrderLanding.svelte';

  const outline = [
    { id: 'conversa', title: 'Do “oi” ao Pix, sem sair do WhatsApp' },
    { id: 'conta', title: 'O Duá conversa, a loja faz a conta' },
    { id: 'sim', title: 'Só vira pedido depois do sim' },
    { id: 'cozinha', title: 'Na cozinha, é só mais um pedido' },
    { id: 'sugestao', title: 'Uma sugestão, e só uma' },
    { id: 'conversas', title: 'Como as conversas são contadas' },
    { id: 'pessoa', title: 'Ele não finge ser gente' },
  ];
  const bandeira = plans.bandeira;
</script>

<Article
  path="/novidades/dua-fecha-o-pedido/"
  pose="pagamento"
  lede="“Oi, tem bolo de chocolate hoje?” chega às 17h40, bem quando a cozinha está a todo vapor. O Duá, o vendedor com IA no WhatsApp da loja, responde, monta o pedido, manda o resumo e o Pix. Ele conduz a conversa; a conta, do primeiro centavo ao total, é a Venduá que faz."
  {outline}
  closing="O cliente conversa no WhatsApp. O pedido chega pronto para você aceitar."
>
  <h2 id="conversa">Do “oi” ao Pix, sem sair do WhatsApp</h2>
  <p>
    Sexta-feira, fim de tarde, a hora mais cheia da Bolos da Nena. A Nena está com a mão na massa, o
    forno apitando, e o celular da loja vibra: “Oi, tem bolo de chocolate hoje?”. Antes, essa
    mensagem esperava. Ou a Nena largava tudo para responder, depois para perguntar o endereço,
    depois para mandar a chave Pix, depois para conferir se a conta batia. Quatro paradas para um
    bolo.
  </p>
  <p>
    Agora quem responde é o Duá. E ele não para no “tem sim”: leva a conversa inteira até o pedido
    feito, no ritmo do cliente.
  </p>
  <ul>
    <li>
      <strong>O cardápio.</strong> Procura no seu cardápio o que o cliente pediu e diz o que tem hoje.
      Se acabou, diz que acabou e oferece algo parecido ou a lista de espera.
    </li>
    <li>
      <strong>As opções.</strong> Tamanho, sabor, cobertura: o que o produto pede para escolher, ele pergunta,
      uma coisa de cada vez.
    </li>
    <li>
      <strong>Entrega ou retirada.</strong> Anota o endereço e usa a taxa daquele endereço. Fora da sua
      área de entrega, oferece a retirada.
    </li>
    <li>
      <strong>O pagamento.</strong> Pix, cartão, dinheiro: só as formas que a sua loja aceita.
    </li>
    <li>
      <strong>O resumo.</strong> Cada item, a entrega e o total, num cartão só, com a pergunta: posso
      confirmar?
    </li>
    <li>
      <strong>O Pix.</strong> Com o sim, o pedido é feito e o código Pix chega na mesma conversa, pronto
      para copiar e colar.
    </li>
  </ul>
  <p>
    Tudo no WhatsApp da própria loja, o número que os seus clientes já têm salvo. Ninguém baixa app,
    ninguém cria conta. Loja fechada e você aceita encomendas? Ele combina uma data. O cliente quer
    o mesmo da última vez? Ele refaz o pedido com os preços de hoje.
  </p>

  <h2 id="conta">O Duá conversa, a loja faz a conta</h2>
  <p>
    Vendedor que inventa preço é pior que vendedor nenhum. Por isso o Duá trabalha com uma divisão
    rígida: ele escreve as palavras, e todo número vem da Venduá. Preço de cada item, taxa de
    entrega, desconto, total, troco, prazo e código Pix saem da mesma conta que fecha os pedidos do
    seu site, com os preços do seu cardápio naquele minuto.
  </p>
  <p>
    Na prática, o Duá nem consegue digitar um valor. Quando quer dizer quanto custa o bolo, ele
    escreve a frase com um espaço reservado, e a Venduá preenche o espaço com o número certo antes
    de a mensagem sair. Se uma resposta aparece com um valor, um horário ou uma promessa que a conta
    da loja não sustenta (“chega em 20 minutos”, “te dou um desconto”), ela é barrada antes de
    chegar ao cliente.
  </p>
  <p>
    O resumo e o Pix nem são mensagens dele: são cartões que a Venduá monta e manda, com a marca
    “calculado pela loja”. O cliente lê o mesmo total que aparece no seu painel, centavo por
    centavo.
  </p>
  <p>
    Na simulação abaixo, a Bia está pedindo um bolo. Ligue “Ver o rascunho do Duá” para ver a
    conversa como ele escreve: no lugar de cada número, um buraco que só a conta da loja preenche.
  </p>
  <Frame
    label="Simulação: a Bia pede um bolo pelo WhatsApp da Bolos da Nena"
    note="Simulação com a Bolos da Nena. O sim é lido com a mesma regra do Duá."
  >
    {#snippet children({ live, reduced })}<OrderGate {live} {reduced} />{/snippet}
  </Frame>

  <h2 id="sim">Só vira pedido depois do sim</h2>
  <p>
    O momento mais delicado de uma venda pelo WhatsApp é o “fechou?”. O Duá tem uma regra que não
    negocia: o pedido só é feito depois que o cliente responde sim ao resumo mais recente. Não ao
    anterior, nem a uma frase solta lá em cima na conversa.
  </p>
  <p>
    E o sim é lido por uma regra fixa, não pela interpretação do modelo. “Sim”, “pode fechar”,
    “fechado”, “isso mesmo” e um joinha valem. “Sim, mas vou buscar” não vale: tem um “mas”, e “mas”
    quer dizer que alguma coisa mudou. O mesmo vale para “tira”, “troca”, “sem”, “com”, “quanto”,
    “espera” e outras palavras de dúvida ou de mudança. Resposta comprida também não passa por sim.
    Na simulação, escreva como a Bia e veja o que passa.
  </p>
  <p>
    Qualquer mudança gera um resumo novo, e o resumo novo precisa de um sim novo. Trocou entrega por
    retirada, colocou uma fatia, tirou um item: a conta é refeita, o resumo anterior deixa de valer
    e o Duá pergunta de novo. O total que o cliente aprovou é sempre o total do pedido. E um pedido
    fora do comum, com mais de dez unidades de um item ou mais de quatro vezes o ticket médio da
    loja, pede um “sim” puro, sem enfeite.
  </p>
  <p>
    <strong>Como a gente fez.</strong> Antes de mostrar o resumo, a Venduá passa a sacola pelo checkout
    de verdade, num ensaio que não grava nada, e guarda uma espécie de impressão digital do resumo: itens,
    opções, preços, entrega, desconto, total e forma de pagamento. O sim só vale para um resumo que o
    WhatsApp entregou. Quando ele chega, a sacola é trancada e a impressão digital é conferida de novo;
    se qualquer coisa mudou no meio do caminho, o pedido não sai. Se o total do pedido criado não for
    exatamente o do resumo, tudo é desfeito. E o mesmo sim nunca cria dois pedidos, nem se a mensagem
    chegar duas vezes.
  </p>

  <h2 id="cozinha">Na cozinha, é só mais um pedido</h2>
  <p>
    Quando a Bia diz sim, o pedido nasce no mesmo checkout do seu site. Não existe uma fila separada
    “do WhatsApp” para você vigiar. Ele entra em Novos, no quadro de Pedidos, e o seu celular avisa:
    “Pedido #31 chegou”.
  </p>
  <p>
    E você continua no comando. O Duá fecha a venda, mas quem aceita o pedido é você, como sempre.
    Daí em diante, o caminho é o de qualquer pedido: a tela da cozinha mostra os itens, a comanda
    sai na impressora, o estoque baixa e o cartão fidelidade da cliente ganha o selo quando o pedido
    é entregue. Os avisos de andamento que o cliente recebe no WhatsApp também são os mesmos.
  </p>
  <Frame
    label="Para onde vai um pedido feito pelo WhatsApp"
    note="Exemplo com a Bolos da Nena. Troque a origem: o caminho é o mesmo."
    restart={false}
  >
    {#snippet children({ live })}<OrderLanding {live} />{/snippet}
  </Frame>
  <p>
    Isso também quer dizer que o que você já configurou vale para os pedidos do Duá sem você mexer
    em nada: horários, áreas de entrega, pedido mínimo, cupons. Ele vende com as regras da sua loja
    porque passa pelo mesmo caminho que o site.
  </p>

  <h2 id="sugestao">Uma sugestão, e só uma</h2>
  <p>
    Um bom balconista oferece a fatia que combina com o bolo. Um chato oferece três coisas, duas
    vezes. O Duá foi feito para ser o primeiro.
  </p>
  <p>
    Ele oferece no máximo um adicional por pedido, depois dos itens principais e antes do resumo, em
    uma frase, sem insistir. E a sugestão não vem do gosto dele: é a conta da loja que encontra, a
    partir de quatro fontes.
  </p>
  <ul>
    <li>
      <strong>Um par que você fixou</strong>, como “quem pede bolo, ofereça um café”. Dá para fixar
      até 20.
    </li>
    <li>
      <strong>O que os seus clientes pedem junto.</strong> Só conta quando aconteceu em pelo menos 3 pedidos
      e em pelo menos 10% dos pedidos com aqueles itens.
    </li>
    <li>
      <strong>Um combo que sai mais barato</strong> que os itens separados, com a economia exata.
    </li>
    <li><strong>O de costume</strong> daquele cliente, quando ele sempre leva a mesma coisa.</li>
  </ul>
  <p>
    E há momentos em que ele simplesmente não oferece: quando o cliente está reclamando, quando
    disse “só isso” e quando já recusou. Se preferir, você desliga as sugestões de vez nas
    configurações do Duá. Mexa nas respostas abaixo e veja onde o caminho para.
  </p>
  <Frame
    label="A regra da sugestão, passo a passo"
    note="Feito com as regras reais do Duá."
    restart={false}
  >
    {#snippet children({ live })}<AddonRule {live} />{/snippet}
  </Frame>

  <h2 id="conversas">Como as conversas são contadas</h2>
  <p>
    O Duá vem com um número de conversas por mês, e vale entender o que é uma conversa, porque não é
    uma mensagem.
  </p>
  <p>
    Uma conversa é um cliente falando com o Duá durante 24 horas, contadas a partir da primeira
    mensagem. A Bia pode mandar uma mensagem ou trinta, perguntar, mudar o pedido duas vezes, mandar
    áudio: dentro dessas 24 horas, é uma conversa só. Se ela voltar depois que as 24 horas passaram,
    conta uma nova.
  </p>
  <p>
    O mês é o do calendário, pelo horário de Brasília, e as conversas do plano são usadas primeiro.
    Se acabarem, entram os pacotes de conversas extras que você comprou no app, começando pelo que
    vence antes. A sua própria conversa em “Testar como cliente” não conta, e o Cliente oculto, que
    testa o Duá com clientes simulados no seu cardápio, também não.
  </p>
  <Frame
    label="Dois dias de mensagens e as conversas que elas contam"
    note="Contado com a regra real das 24 horas. As mensagens e as conversas já usadas são um exemplo."
    restart={false}
  >
    {#snippet children({ live })}<ConversationClock {live} />{/snippet}
  </Frame>
  <p>
    E se acabar tudo? Uma conversa que já começou segue até o fim das suas 24 horas. Quem abrir uma
    conversa nova recebe uma única mensagem, “Vou chamar alguém da loja para te ajudar.”, e a
    conversa fica esperando por você em Conversas. Você e seus gerentes recebem no celular o aviso
    “O Duá ficou sem conversas”, e quem é dono da loja encontra ali mesmo o botão para comprar mais.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      O Duá está no {bandeira.name}, com {bandeira.conversations} conversas por mês e
      {bandeira.trialConversations} durante o teste de {bandeira.trial}, sem cartão. O Venduá Mirim
      não tem o Duá.
    </p>
  </aside>

  <h2 id="pessoa">Ele não finge ser gente</h2>
  <p>
    O Duá se apresenta como o que é: “Oi! Sou o Duá, assistente virtual da Bolos da Nena.” Você pode
    trocar a apresentação para “o Duá, da Bolos da Nena”, mas, se o cliente perguntar, a resposta é
    a mesma: é o assistente virtual da loja. Ele nunca diz que é humano, dono, gerente ou
    funcionário.
  </p>
  <p>
    Quando o cliente pede uma pessoa, ele chama você. E a qualquer momento você pode assumir: basta
    responder do celular da loja, e o Duá pausa naquela conversa sozinho. O Duá usa o WhatsApp da
    sua loja conectado como um aparelho, do mesmo jeito que o WhatsApp Web, então o celular da loja
    precisa ficar ligado e com internet.
  </p>
  <p>
    Para começar sem susto, ligue o Duá em Ensaio: ele escreve o que responderia em cada conversa,
    mas não manda nada, e você compara com o que você mesmo respondeu. Depois, faça um pedido em
    “Testar como cliente”, que não vai para a cozinha, ou rode o Cliente oculto. Quando as respostas
    estiverem do seu jeito, escolha quando ele atende: quando você demorar, fora do horário ou
    sempre. A partir daí, o “oi, tem bolo?” das 17h40 vira pedido enquanto o bolo está no forno.
  </p>
</Article>
