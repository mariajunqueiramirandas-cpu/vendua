<script lang="ts">
  import Article from '$lib/components/Article.svelte';

  const outline = [
    { id: 'audio', title: 'O cliente fala, o Duá anota' },
    { id: 'privacidade', title: 'O áudio não sai da Venduá' },
    { id: 'rapido', title: 'Menos de um segundo por áudio' },
    { id: 'cardapio', title: 'Ele conhece o seu cardápio' },
    { id: 'duvida', title: 'Na dúvida, ele confirma' },
    { id: 'como', title: 'Como a gente fez' },
  ];
</script>

<Article
  path="/novidades/dua-entende-audios/"
  pose="avatar-feliz"
  lede="No WhatsApp, muita gente não digita: aperta o microfone e fala. O Duá, o vendedor com IA no WhatsApp da loja, entende esses áudios e responde como se o cliente tivesse escrito. E quem ouve é a própria Venduá, num motor de reconhecimento de voz que a gente construiu para isso."
  {outline}
  closing="Seu cliente fala do jeito dele. O pedido chega escrito."
>
  <h2 id="audio">O cliente fala, o Duá anota</h2>
  <p>
    “Oi, me vê um x-tudo e uma coca de dois litros, entrega aqui na rua de cima.” Num áudio, o
    cliente diz em dez segundos o que levaria um minuto para digitar. Para a cozinha, era o pior
    tipo de pedido: alguém precisava parar, ouvir e escrever.
  </p>
  <p>
    Agora o Duá ouve o áudio, entende o pedido e segue a conversa: confirma os itens, pergunta o que
    faltou e manda o link para pagar. Você vê a conversa no app, com o texto de cada áudio ao lado.
  </p>

  <h2 id="privacidade">O áudio não sai da Venduá</h2>
  <p>
    Transcrever áudio costuma significar mandá-lo para uma empresa de fora, que cobra por minuto e
    guarda uma cópia sob as regras dela. Aqui, o áudio vai do WhatsApp da loja para os servidores da
    Venduá e de lá para lugar nenhum.
  </p>
  <p>
    O serviço que transcreve não guarda o áudio nem registra o que foi dito. O texto vai direto para
    o Duá responder o seu cliente.
  </p>

  <h2 id="rapido">Menos de um segundo por áudio</h2>
  <p>
    Um áudio de 15 segundos vira texto em menos de um segundo, contando o tempo de abrir o arquivo
    do WhatsApp. Medimos com frases em português do Brasil gravadas por pessoas de verdade:
  </p>
  <ul>
    <li>
      <strong>2,4 vezes mais rápido</strong> que a versão pronta do mesmo modelo de voz, num servidor
      de 4 núcleos. Quando vários áudios chegam juntos, eles são ouvidos em grupo, e a conta sobe para
      4,8 vezes.
    </li>
    <li>
      <strong>Áudios longos sem perder o fio.</strong> Áudio de mais de 30 segundos é dividido nas pausas
      da fala. Em áudios de 2 minutos, os erros caíram de 5,4% para 3,0% das palavras, e um áudio de 3
      minutos fica pronto 1,6 vez mais rápido.
    </li>
    <li>
      <strong>Silêncio não conta.</strong> O silêncio do começo e do fim é cortado antes de ouvir: 11%
      menos áudio para processar, e os erros caíram de 5,1% para 4,7% das palavras.
    </li>
  </ul>

  <h2 id="cardapio">Ele conhece o seu cardápio</h2>
  <p>
    Toda loja vende coisas com nome próprio: o bolo da casa, o lanche com o nome do bairro, a
    marmita que só você faz. Um reconhecimento de voz genérico nunca ouviu esses nomes e tenta
    adivinhar.
  </p>
  <p>
    O Duá ouve com o seu cardápio na mão. Os nomes dos seus produtos ganham preferência quando o som
    bate com eles. Num teste com 150 frases cheias de nomes próprios, os nomes certos subiram de
    75,7% para 81,3%, sem nenhum nome inventado e sem ficar mais lento.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Não precisa configurar nada: o Duá usa os produtos ativos do seu cardápio. Produto novo
      cadastrado no app já vale no próximo áudio.
    </p>
  </aside>

  <h2 id="duvida">Na dúvida, ele confirma</h2>
  <p>
    Áudio com barulho de moto, liquidificador ou criança no fundo às vezes não dá para entender
    direito. Em vez de chutar, o Duá mede a própria certeza palavra por palavra. Quando fica
    inseguro, repete o que entendeu e pede para o cliente confirmar.
  </p>
  <p>
    Os áudios que ele separa para confirmar são justamente os difíceis: neles, o texto erra três
    vezes mais palavras do que nos outros. Melhor uma pergunta a mais do que um pedido errado saindo
    da cozinha.
  </p>

  <h2 id="como">Como a gente fez</h2>
  <p>
    O ponto de partida é o Parakeet TDT 0.6B v3, um modelo de reconhecimento de voz aberto da
    NVIDIA, publicado sob a licença CC-BY-4.0. Ele entende português e 24 outras línguas, já escreve
    com pontuação e maiúsculas, e não costuma inventar frases no silêncio, um defeito comum em
    modelos parecidos.
  </p>
  <p>Em volta dele, a Venduá construiu o motor que faz o modelo rodar rápido em servidor comum:</p>
  <ul>
    <li>
      <strong>Uma compressão nova do modelo.</strong> A versão compactada que existia era mais lenta que
      a original e errava mais. Refizemos a compactação: a parte mais pesada ficou 3,5 vezes mais rápida
      e muito mais fiel ao modelo original.
    </li>
    <li>
      <strong>Um decodificador que só refaz o que mudou.</strong> O texto sai palavra por palavra, e a
      cada passo o nosso decodificador recalcula só o necessário. Ele chega ao mesmo texto que o decodificador
      original, letra por letra, fazendo bem menos conta.
    </li>
    <li>
      <strong>Áudio do WhatsApp aberto direto,</strong> sem chamar outro programa: três vezes mais rápido
      para abrir cada arquivo.
    </li>
  </ul>
  <p>
    E continua: estamos testando uma versão do modelo treinada com conversas em português do Brasil.
    Em fala espontânea ela erra 39% menos palavras. Ela entra quando passar no teste mais
    importante: os áudios de verdade das nossas lojas.
  </p>
</Article>
