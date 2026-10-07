<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Assumir from '$lib/posts/dua-chama-voce/Assumir.svelte';
  import Aviso from '$lib/posts/dua-chama-voce/Aviso.svelte';
  import Gatilhos from '$lib/posts/dua-chama-voce/Gatilhos.svelte';
  import Numero from '$lib/posts/dua-chama-voce/Numero.svelte';
  import Relogio from '$lib/posts/dua-chama-voce/Relogio.svelte';

  const outline = [
    { id: 'hora', title: 'Você escolhe a hora dele' },
    { id: 'chamar', title: 'O que é seu, ele passa para você' },
    { id: 'aviso', title: 'O aviso chega, e insiste' },
    { id: 'assumir', title: 'Você entra quando quiser' },
    { id: 'numero', title: 'O seu número também é seu' },
    { id: 'caixa', title: 'Todas as conversas num lugar só' },
    { id: 'como', title: 'Como a gente fez' },
  ];
</script>

<Article
  path="/novidades/dua-chama-voce/"
  pose="horarios"
  lede="Seis da tarde, a hora mais cheia do dia, e o WhatsApp não para. O Duá, o vendedor com IA no WhatsApp da loja, segura as conversas que você não alcança. Mas ele sabe a hora de entrar, a hora de chamar você e a hora de ficar quieto. E quem define cada uma delas é você."
  {outline}
  closing="O Duá cuida do balcão. A decisão continua sua."
>
  <h2 id="hora">Você escolhe a hora dele</h2>
  <p>
    Na Bolos da Nena, o movimento aperta às 18h. É quando a Nena está com a mão na massa, o
    entregador chamando na porta e três clientes perguntando se ainda tem fatia de cenoura com
    brigadeiro. É a hora em que ela mais precisa de ajuda, e também a hora em que menos quer alguém
    falando pela loja sem ela saber o quê.
  </p>
  <p>
    Por isso o Duá não atende do jeito dele. Atende do jeito que você escolhe, numa tela do app
    chamada “Quando o Duá atende”. São quatro opções, cada uma dita numa frase:
  </p>
  <ul>
    <li>
      <strong>Ensaio.</strong> Ele escreve o que diria, mas não manda nada. Você responde do seu jeito
      e depois compara.
    </li>
    <li>
      <strong>Quando eu demorar.</strong> A loja tem a vez. Se ninguém responder em 1, 2 ou 5 minutos,
      ou se a loja estiver fechada, ele entra.
    </li>
    <li>
      <strong>Fora do horário.</strong> Só com a loja fechada. E ele agenda pedidos para quando ela abrir.
    </li>
    <li><strong>Sempre.</strong> Responde tudo na hora. Você assume quando quiser.</li>
  </ul>
  <p>
    O Duá começa no “Quando eu demorar”, com 2 minutos de espera. É um bom meio-termo: o cliente que
    sempre fala com você continua falando com você, e quem mandou mensagem enquanto você tirava o
    bolo do forno não fica sem resposta. Arraste a hora no relógio abaixo e veja quem responde
    primeiro uma conversa nova, hora por hora.
  </p>

  <Relogio />

  <p>
    Repare em duas coisas. Com a loja fechada, “Quando eu demorar” vira atendimento na hora: não faz
    sentido esperar dois minutos por alguém que já foi dormir. E a espera vale para quem acabou de
    chegar. Uma conversa que o Duá já pegou continua com ele, para o cliente não ficar pulando de
    mão em mão no meio do pedido.
  </p>
  <p>
    Quer um período inteiro sem o Duá? Não precisa procurar ajuste escondido: escolha “Fora do
    horário”, ou use a pausa, que aparece mais abaixo.
  </p>

  <h2 id="chamar">O que é seu, ele passa para você</h2>
  <p>
    Tem conversa que não é para o Duá. O cliente bravo porque o pedido atrasou. A mãe perguntando se
    o bolo leva amendoim. Alguém que simplesmente quer falar com gente. Nesses casos, o certo é a
    loja responder, e o Duá sabe disso.
  </p>
  <p>
    Duas regras estão sempre ligadas e não têm botão: quando o cliente pede uma pessoa, e quando o
    assunto é pagamento, seja um comprovante mandado em foto, seja uma cobrança contestada. Foto de
    comprovante não prova pagamento, e quem confirma é você.
  </p>
  <p>
    As outras você liga e desliga em “Passe para mim quando”. Reclamação ou atraso e alergia ou
    restrição já vêm ligadas. Pedido grande e cliente novo pagando em dinheiro vêm desligadas: ligue
    se fizer sentido para a sua loja.
  </p>

  <Gatilhos />

  <p>
    No pedido grande, você escolhe o valor, de R$ 1,00 a R$ 100.000,00, e o Duá passa a conversa
    para você antes de fechar qualquer pedido acima dele. No cliente novo pagando em dinheiro, o
    pedido entra normalmente e a conversa vem para você conferir o troco e o endereço.
  </p>
  <p>
    Quando um desses casos acontece, o cliente lê uma frase só, sempre a mesma: “Vou chamar alguém
    da loja para te ajudar com isso.” Se a loja estiver fechada, ele avisa isso também. Depois, o
    Duá fica em silêncio naquela conversa. Nada de improvisar desculpas nem prometer o que a loja
    não combinou.
  </p>

  <h2 id="aviso">O aviso chega, e insiste</h2>
  <p>
    Chamar você não adianta se você não ficar sabendo. No momento em que o Duá passa a conversa,
    três coisas acontecem juntas: o cliente recebe a frase, a conversa aparece em “Precisa de você”
    no app, e o seu celular avisa com o nome do cliente, o motivo e a última mensagem dele, com um
    botão para assumir.
  </p>
  <p>
    Se ninguém responder, o celular avisa de novo aos 5 minutos e aos 15. E se nenhum desses avisos
    chegou a um aparelho da loja (bateria acabou, internet caiu, avisos desligados), a dona e quem
    gerencia a loja recebem uma mensagem no WhatsApp, uma vez por conversa.
  </p>

  <Aviso />

  <p>
    A primeira resposta da loja encerra tudo: os avisos param na hora. E depois do aviso dos 15
    minutos o celular para de insistir. A ideia é simples: o cliente não fica esperando sem ninguém
    saber, e o seu celular não vira um alarme.
  </p>

  <h2 id="assumir">Você entra quando quiser</h2>
  <p>
    Às vezes você quer entrar numa conversa mesmo sem o Duá chamar. A cliente de sempre, uma
    encomenda de aniversário, um bolo com nome escrito em cima. Tem dois jeitos, e o mais simples
    nem passa pelo app: responda pelo celular da loja, como sempre fez. O Duá percebe que você
    respondeu e pausa sozinho naquela conversa. O outro jeito é tocar em “assumir” na conversa, no
    app.
  </p>
  <p>
    E quando ele volta? Quando você mandar. Toque em “devolver ao Duá” e ele volta na hora. Ou deixe
    o relógio fazer isso: se você ficar 30 minutos sem escrever naquela conversa, ele volta sozinho.
    Cada mensagem sua recomeça a conta, então ele não atravessa uma conversa que você está levando.
    No app, você troca esse tempo para 15 minutos, 1 hora ou 2 horas.
  </p>

  <Assumir />

  <p>
    E se o dia estiver daqueles em que você quer tudo nas suas mãos? Tem o botão de pausar: o Duá
    para de responder em todas as conversas por 1 hora, ou até amanhã, que quer dizer até as 6h da
    manhã no horário da loja. Ele volta sozinho, sem você precisar lembrar de religar.
  </p>
  <p>
    E quando ele volta, ninguém é enganado. O Duá se apresenta como assistente virtual da loja e
    nunca diz que é uma pessoa, nem quando assume uma conversa que começou com você.
  </p>

  <h2 id="numero">O seu número também é seu</h2>
  <p>
    Muita loja pequena tem um número só. É nele que chega o pedido de bolo, e é nele que a sua irmã
    manda foto do sobrinho. Ninguém quer um vendedor oferecendo cardápio para a tia.
  </p>
  <p>
    Por isso, antes de responder um número que nunca pediu na loja, o Duá descobre quem é. As
    perguntas têm uma ordem:
  </p>
  <ol>
    <li>Esse número já fez pedido na loja? Então é cliente, e ele responde.</li>
    <li>
      O que você escolheu em “Quem o Duá atende”: “Clientes e números novos” (o padrão), “Só quem já
      é cliente” ou “Todo mundo”, que é para quando o número é só da loja.
    </li>
    <li>
      No padrão, ele lê as últimas 10 mensagens daquela conversa, e só dela. Se é conversa de
      cliente, responde. Se é pessoal, fica quieto. Se não dá para saber, pergunta a você.
    </li>
  </ol>

  <Numero />

  <p>
    Quando ele não sabe, quem decide é você. O celular mostra “Novo contato no WhatsApp” com o nome
    da pessoa e a pergunta “é cliente?”, no máximo uma vez por dia em cada conversa. Enquanto isso,
    o contato não recebe nada do Duá. E dá para decidir sem abrir o app: na própria conversa, mande
    #cliente, #pessoal ou #dua. A palavra some na hora, para você e para a pessoa.
  </p>
  <p>
    A leitura existe só para chegar a uma resposta. As mensagens lidas são apagadas assim que ele
    decide, e em no máximo 10 minutos mesmo sem decisão. Ele não vê o número de telefone, não abre a
    sua lista de contatos e não passeia pelas outras conversas: lê só a que acabou de chegar, uma
    vez. O que um amigo seu escreveu não fica guardado para a equipe da loja. Um detalhe honesto:
    essa checagem pode levar cerca de um minuto na primeira mensagem de um número novo.
  </p>

  <h2 id="caixa">Todas as conversas num lugar só</h2>
  <p>
    Tudo o que o Duá conversa fica numa caixa no app, com filtros para o que importa: precisa de
    você, para decidir, com pedido, Duá atendendo, pessoais e outros. Conversa com mensagem que você
    ainda não leu aparece em destaque. A busca acha qualquer uma pelo nome, pelo telefone, pelo
    número do pedido ou por um pedaço da mensagem.
  </p>
  <p>
    Quando você está atendendo, as suas respostas prontas ficam a um toque: até 30 frases suas, como
    o endereço de retirada ou a chave do Pix. O toque coloca a frase na caixa de texto, e você
    confere antes de mandar.
  </p>
  <p>
    Na página de cada cliente, “O que o Duá sabe” mostra o que ele lembra daquela pessoa, com um
    botão para esquecer cada item. Você também pode anotar para o Duá, em até 200 caracteres:
    “prefere retirar”, “sempre pede sem cobertura”. Alergia ele só guarda com a concordância do
    cliente, e confirma de novo a cada pedido.
  </p>
  <p>
    E se um cliente pedir para ser esquecido, “apagar dados do cliente” apaga as conversas, os
    áudios e as fotos que ele mandou e o que o Duá lembrava dele. Os pedidos continuam nos seus
    relatórios, sem nome, telefone e endereço. É o que a LGPD pede, num passo só, com confirmação.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      O Duá está no Venduá Bandeira. Tudo o que você viu aqui fica na tela Configurar do Duá, no
      app: “Quando o Duá atende”, “Quem o Duá atende” e “Passe para mim quando”. Se quiser ver como
      ele responderia antes de deixar ele falar, comece pelo Ensaio.
    </p>
  </aside>

  <h2 id="como">Como a gente fez</h2>
  <p>
    A regra de ouro do Duá é a mesma do resto da Venduá: o sistema decide, a IA conversa. Quem
    responde cada conversa não é uma escolha da IA. É uma conta que o sistema refaz a cada mensagem,
    olhando a opção que você escolheu, se a loja está aberta, se alguém da loja pegou a conversa e
    até quando, se o Duá está pausado e se aquele número é de cliente. O relógio lá de cima faz essa
    mesma conta.
  </p>
  <p>
    Os avisos também não dependem da IA. Antes de qualquer modelo ler a mensagem, o sistema procura
    as palavras de reclamação, de alergia e de quem pede uma pessoa. Achou, a conversa vem para você
    na hora, sem a IA ter a chance de achar que dá conta sozinha. O que essas palavras não pegam, o
    próprio Duá percebe e chama você.
  </p>
  <p>
    Para saber quem é cada número, um modelo rápido recebe o nome da loja, o que ela vende e as
    últimas mensagens daquela conversa, marcadas como dados, nunca como ordens. Ele só pode dar três
    respostas: pessoal, cliente ou não sei. O resto é regra. Se ele errar, o erro cai em perguntar a
    você, nunca numa resposta para um amigo que você não consiga parar: #pessoal funciona em
    qualquer conversa.
  </p>
  <p>
    O Duá entra no WhatsApp da loja como um aparelho conectado, do mesmo jeito que o WhatsApp no
    computador. Para ler a conversa anterior, ele pede ao seu celular, que precisa estar ligado e
    com internet. Se o celular não responder em um minuto, ele decide só pela mensagem nova.
  </p>
  <p>
    Para começar, abra o Duá no app e escolha quando ele atende. Se o seu número também é pessoal,
    confira “Quem o Duá atende”. E deixe ligados os avisos do celular: é por eles que o Duá chama
    você.
  </p>
</Article>
