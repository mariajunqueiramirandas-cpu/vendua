<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Phone from '$lib/components/Phone.svelte';
  import Screen from '$lib/components/Screen.svelte';
  import ColarLista from '$lib/posts/importar-cardapio-por-link/ColarLista.svelte';
  import Esteira from '$lib/posts/importar-cardapio-por-link/Esteira.svelte';
  import LinkCheck from '$lib/posts/importar-cardapio-por-link/LinkCheck.svelte';
  import Perguntas from '$lib/posts/importar-cardapio-por-link/Perguntas.svelte';
  import VemFica from '$lib/posts/importar-cardapio-por-link/VemFica.svelte';

  const outline = [
    { id: 'link', title: 'Um link no lugar de uma noite digitando' },
    { id: 'previa', title: 'Nada muda antes da prévia' },
    { id: 'preco', title: 'Preço que não bate fica escondido' },
    { id: 'fica', title: 'O que vem e o que fica' },
    { id: 'lista', title: 'Sem link? Cole a lista' },
    { id: 'como', title: 'Como a gente fez' },
    { id: 'comecar', title: 'Para trazer o seu' },
  ];
</script>

<Article
  path="/novidades/importar-cardapio-por-link/"
  pose="catalogo"
  lede="Começar numa loja nova costumava ser digitar tudo de novo: cada bolo, cada foto, cada horário. Agora você cola o link do cardápio que já tem, e a Venduá lê categorias, produtos, fotos, opções, horários, entrega e pagamento de sete plataformas de cardápio. Antes de gravar qualquer coisa, você confere tudo numa prévia."
  {outline}
  closing="Seu cardápio já existe. Traga ele com um link."
>
  <h2 id="link">Um link no lugar de uma noite digitando</h2>
  <p>
    A Nena vende bolo há anos, e o cardápio dela já mora em outro app: quatro categorias, catorze
    produtos, cada um com a sua foto, o bolo de aniversário com a escolha do recheio, os horários de
    terça a domingo, as duas regiões de entrega, a chave Pix. Mudar de casa costumava custar uma
    noite inteira com o celular numa mão e o cardápio antigo na outra, copiando nome, preço,
    descrição, foto por foto.
  </p>
  <p>
    Agora a mudança começa com um link. Você abre a sua loja no celular, copia o endereço da barra
    do navegador e cola na Venduá. Ela lê o cardápio público, do mesmo jeito que o celular do seu
    cliente lê, e traz o que encontrar: categorias, produtos com preço e descrição, fotos, grupos de
    opções, horários, entrega e retirada, pedido mínimo, formas de pagamento e a chave Pix.
  </p>
  <p>
    Hoje são sete plataformas de cardápio que a Venduá lê: Instadelivery, Cardápio Web, OlaClick,
    Takeat, Delivery Direto, Saipos e Goomer. Na maioria, a leitura leva alguns segundos. No Goomer,
    que mostra um produto de cada vez, pode levar alguns minutos, e a tela avisa antes. Se a sua
    loja tem endereço próprio, com o nome dela, cole esse mesmo: a Venduá descobre qual plataforma
    está por trás.
  </p>
  <p>
    Experimente aqui. Cole um link ou toque num exemplo: a caixa reconhece o endereço com as mesmas
    regras que a Venduá usa na hora de importar.
  </p>

  <LinkCheck />

  <p>
    Dois nomes ficam de fora, e é melhor dizer logo: a Venduá não lê cardápios do anota.ai nem do
    iFood. Quando ela tenta, essas páginas não deixam, e a Venduá não insiste nem se disfarça de
    navegador para entrar. Se o seu cardápio está num desses, tem outro caminho, e ele é rápido:
    <a href="#lista">colar a lista de produtos</a>, que a gente mostra mais abaixo.
  </p>

  <h2 id="previa">Nada muda antes da prévia</h2>
  <p>
    Ler não é gravar. Terminada a leitura, a Venduá mostra uma prévia: quantos produtos e categorias
    encontrou, o cardápio inteiro com os preços, e o que mais dá para trazer, em quatro partes que
    você marca ou desmarca: <strong>Perfil e visual</strong>, <strong>Horários</strong>,
    <strong>Entrega e retirada</strong> e <strong>Pagamentos</strong>. No cadastro de uma loja nova,
    as quatro já vêm marcadas. Numa loja que já está vendendo, vêm desmarcadas: você marca só o que
    quer trocar, e o resto fica como está.
  </p>
  <p>
    Se você já tem produtos, a prévia pergunta “E o cardápio de agora?”. <strong>Somar</strong> põe
    os produtos novos junto dos que você já tem, e categorias com o mesmo nome recebem os produtos.
    <strong>Trocar</strong> tira os de agora do cardápio e guarda arquivados, para que os pedidos antigos
    continuem certinhos.
  </p>
  <p>
    E antes do botão de importar há uma chave: <strong>Essa loja é minha</strong>. Enquanto ela está
    desligada, o botão não anda. A importação existe para trazer a sua loja, não a do vizinho. Os
    pagamentos, com a chave Pix, só quem é dono da loja traz.
  </p>
  <p>
    Veja a esteira inteira com a Bolos da Nena: toque em “Ler o cardápio”, acompanhe cada parte
    chegando, confira a prévia e ligue a chave para importar.
  </p>

  <Esteira />

  <p>
    Depois do “Importar”, o cardápio aparece na hora e as fotos vêm em seguida, quatro de cada vez.
    Você pode seguir mexendo na loja enquanto elas chegam. E uma prévia que fica esperando mais de
    um dia vence: os preços de ontem podem não ser os de hoje, e a Venduá prefere ler de novo a
    gravar coisa velha.
  </p>

  <h2 id="preco">Preço que não bate fica escondido</h2>
  <p>
    Esta é a regra que mais pesou no desenho da importação: preço exato ou nada. Cada plataforma
    monta preço do seu jeito. Uma cobra cada sabor da pizza pelo mais caro, outra cobra embalagem à
    parte, outra vende por quilo, outra tem dois preços para o mesmo produto. Quando a Venduá
    consegue reproduzir a conta centavo por centavo, o produto chega pronto para vender. Quando não
    consegue, ele chega oculto, com um aviso dizendo o porquê.
  </p>
  <p>
    Produto oculto está no seu cardápio, com nome, foto e preço, só que o cliente ainda não vê. Você
    confere, acerta o que precisa e mostra quando quiser. O que nunca acontece é a sua loja abrir
    cobrando um valor diferente do que você cobrava, sem você saber. Alguns avisos, com as palavras
    da própria tela:
  </p>
  <ul>
    <li>“Torta de limão” tem um desconto que não conseguimos ler. Confira o preço.</li>
    <li>“Pizza de calabresa” tem preço por tamanho. Confira os tamanhos em Opções.</li>
    <li>O combo “Kit festa” usa itens que não vieram. Monte o combo de novo.</li>
    <li>“Açaí montado” tem mais de 12 grupos de opções.</li>
  </ul>
  <p>
    E muita coisa que parece difícil vem certa. Preço de promoção chega com o valor antigo riscado.
    Tamanhos viram um grupo “Tamanho”, com o mais barato como base e a diferença em cada opção.
    Pizza que cobra cada sabor pelo mais caro vem com a mesma conta. Produto que aparecia como “a
    partir de” continua “a partir de” na sua loja.
  </p>

  <h2 id="fica">O que vem e o que fica</h2>
  <p>
    O link traz o que está na página pública da sua loja. O que não está lá, ele não tem como ver:
    os seus clientes, o histórico de pedidos, o saldo de pontos de cada um, as avaliações. E mesmo
    que estivesse, dado de cliente é pessoal. Levar isso de um lugar para outro pede a autorização
    de cada pessoa, não uma leitura de página.
  </p>

  <VemFica />

  <p>
    Cupons e programas de pontos também não vêm, e a prévia avisa. Os cupons você cria de novo em
    Marketing, com as regras da Venduá: porcentagem, valor fixo, cupom que zera a entrega, pedido
    mínimo, só no primeiro pedido. No lugar dos pontos entra o cartão fidelidade, com selos que
    viram prêmio.
  </p>
  <p>
    Algumas coisas chegam um pouco diferentes, porque a Venduá funciona de outro jeito. Taxa de
    entrega calculada endereço por endereço vira um aviso para você cadastrar as regiões. Produto
    que era só para comer no local fica de fora: aqui é entrega e retirada. Nome comprido demais é
    encurtado. Tudo isso aparece na prévia, frase por frase, em “O que não vem igual”: para você
    saber antes, e acertar depois se quiser.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Importar o cardápio está em todos os planos, no Venduá Mirim e no Venduá Bandeira, e aparece
      logo no cadastro. O cartão fidelidade, que entra no lugar dos pontos, é do Venduá Bandeira.
    </p>
  </aside>

  <h2 id="lista">Sem link? Cole a lista</h2>
  <p>
    Nem todo cardápio mora numa plataforma que a Venduá lê. Às vezes ele está no anota.ai ou no
    iFood, às vezes numa mensagem fixada no WhatsApp, num bloco de notas, num papel colado na
    geladeira. Para esses existe o <strong>colar lista</strong>: em Cardápio, toque em “colar
    lista”, cole as linhas e escolha a categoria. Cada linha com nome e preço no fim, como “Pudim -
    12,50”, vira um produto.
  </p>
  <p>
    A leitura é generosa com o jeito que cada um escreve. Bolinha, traço ou número no começo da
    linha some. O preço pode vir com ou sem “R$”, com vírgula ou ponto, com “reais” no fim, separado
    por traço, dois-pontos ou barra. Linha sem preço no fim fica de fora, e você vê qual foi antes
    de criar. Cabem até 100 produtos por vez. Mexa à vontade na lista abaixo:
  </p>

  <ColarLista />

  <p>
    Os produtos chegam sem foto, e o painel lembra: “Adicione as fotos quando puder.” Descrição,
    opções e foto você completa em cada produto, no seu tempo.
  </p>
  <p>
    Uma curiosidade: o cardápio da Bolos da Nena que aparece nas telas deste site foi montado assim,
    colando quatro listas, uma por categoria.
  </p>
  <figure class="shot">
    <Phone width={250}>
      <Screen
        key="cardapio"
        alt="O cardápio da Bolos da Nena no painel: 14 produtos em 4 categorias"
        sizes="(max-width: 560px) 62vw, 250px"
      />
    </Phone>
    <figcaption>
      O cardápio da Bolos da Nena: 14 produtos em 4 categorias, de quatro listas coladas.
    </figcaption>
  </figure>

  <h2 id="como">Como a gente fez</h2>
  <p>
    A Venduá lê a mesma página que o navegador do seu cliente abre. Nada de senha, login ou acesso
    especial: só o que a loja já mostra para qualquer pessoa. A cada pergunta, ela se apresenta com
    o próprio nome, e espera pelo menos 250 milésimos de segundo entre uma pergunta e a seguinte ao
    mesmo site, para não pesar em ninguém. Se uma plataforma diz não, a leitura para ali e a tela
    avisa: nada de insistir, nada de se passar por navegador.
  </p>
  <p>
    Cada plataforma entrega o cardápio de um jeito. No Instadelivery, uma pergunta traz a loja
    inteira. No Delivery Direto, é uma por categoria. No Goomer, as opções de cada produto moram num
    endereço separado, então é uma pergunta por produto, e é por isso que a tela dele fala em
    minutos. Mexa no tamanho do cardápio e veja a diferença:
  </p>

  <Perguntas />

  <p>
    Toda leitura tem teto: 300 perguntas e um minuto, ou 600 perguntas e dois minutos e meio no
    Goomer. Um cardápio com mais de 1.000 produtos não vem de uma vez. E cada loja faz até cinco
    importações por hora, o bastante para tentar de novo depois de acertar alguma coisa lá na
    plataforma antiga.
  </p>
  <p>
    Dois cuidados que você não vê, mas que contam. As fotos são baixadas e guardadas na Venduá, em
    vez de apontar para o endereço antigo: quando você cancelar o plano na outra plataforma, as
    imagens somem de lá, e as suas continuam aqui. E todo preço vira centavos inteiros uma vez só,
    no servidor da Venduá, durante a leitura. Daí em diante ninguém refaz essa conta: o preço que
    você conferiu na prévia é o que vai para a loja.
  </p>

  <h2 id="comecar">Para trazer o seu</h2>
  <p>
    Se você ainda não tem loja na Venduá, crie a sua: nas primeiras perguntas para montar a loja vem
    “Já vende em outro app de cardápio?”, com o lugar para colar o link. Se a loja já está no ar, o
    caminho é Cardápio, botão “importar”. Confira a prévia com calma, marque o que quer trazer,
    ligue “Essa loja é minha” e toque em Importar. Se o seu cardápio está numa lista, ao lado do
    mesmo botão tem o “colar lista”.
  </p>
  <p>
    Depois, passe os olhos nos produtos ocultos, se houver algum, e mostre cada um quando o preço
    estiver do jeito que você quer. O resto da noite fica livre para outra coisa.
  </p>
</Article>
