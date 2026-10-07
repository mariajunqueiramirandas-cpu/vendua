<script lang="ts">
  import Article from '$lib/components/Article.svelte';
  import Comparativo from '$lib/posts/cupons-e-cartao-fidelidade/Comparativo.svelte';
  import Oficina from '$lib/posts/cupons-e-cartao-fidelidade/Oficina.svelte';
  import Selos from '$lib/posts/cupons-e-cartao-fidelidade/Selos.svelte';

  const outline = [
    { id: 'cupom', title: 'Um código e as regras que você quiser' },
    { id: 'ordem', title: 'As mesmas perguntas, sempre na mesma ordem' },
    { id: 'conta', title: 'A conta é da Venduá, até o centavo' },
    { id: 'cartao', title: 'O cartão fidelidade se preenche sozinho' },
    { id: 'premio', title: 'O prêmio é um cupom só da cliente' },
    { id: 'entregue', title: 'Selo é pedido entregue, e só' },
    { id: 'comecar', title: 'Por onde começar' },
  ];
</script>

<Article
  path="/novidades/cupons-e-cartao-fidelidade/"
  pose="pagamento"
  lede="Domingo à tarde é parado na Bolos da Nena. A Nena quer um empurrão: um desconto para quem nunca pediu, que não vire bagunça no caixa. Na Venduá, isso é um cupom com regras que a própria loja confere. E para quem já é freguês, um cartão de selos que se completa sozinho e vira prêmio."
  {outline}
  closing="Cupom para chamar gente nova, cartão para fazer voltar. A conta fica com a Venduá."
>
  <h2 id="cupom">Um código e as regras que você quiser</h2>
  <p>
    No caderninho, desconto é combinado de boca: “fala que viu no Instagram que eu faço por menos”.
    Funciona até a terceira pessoa pedir o mesmo desconto para um pedido de duas fatias, ou alguém
    usar o mesmo combinado toda semana. Aí o desconto deixa de chamar cliente e começa a comer o
    lucro.
  </p>
  <p>
    Na Venduá, o desconto tem nome e regra. Em Marketing, a Nena toca em “novo cupom”, escreve o
    código que o cliente vai digitar e escolhe o tipo:
  </p>
  <ul>
    <li>
      <strong>Porcentagem</strong>, de 1% a 100%, sobre o valor dos itens.
    </li>
    <li>
      <strong>Valor fixo</strong>, como R$ 10,00 a menos no pedido.
    </li>
    <li>
      <strong>Cupom que zera a entrega</strong>: os itens ficam no preço de sempre e a taxa de
      entrega sai da conta.
    </li>
  </ul>
  <p>
    O código tem de 3 a 32 caracteres, letras e números (hífen e sublinhado também valem), e a loja
    guarda em maiúsculas: quem digita “domingo” usa o DOMINGO. Depois vêm as regras, todas
    opcionais. Pedido mínimo, para o desconto não sair num pedido pequeno demais. Data para acabar,
    em “Vale até”, e o cupom para sozinho no fim daquele dia. Só no primeiro pedido, para que ele
    sirva de convite e não de desconto permanente. E uma vez por cliente, que já vem marcada, porque
    é o que quase todo mundo quer.
  </p>
  <p>
    Com o cupom no ar, ainda dá para ajustar o que muda sem mudar a promessa: o nome que o cliente
    vê, a data para acabar e um limite de usos no total. Chegou no limite, ele para sozinho. Na
    lista, cada cupom mostra quantas vezes foi usado e quanto somaram os pedidos que vieram com ele.
    Gostou do resultado? “Duplicar” cria outro igual, só com o código novo. Apagou sem querer? O
    aviso tem “desfazer”.
  </p>
  <p>
    Monte um cupom aqui embaixo e jogue na sacola de exemplo. Mude o pedido mínimo, tire uma fatia,
    troque quem está pedindo:
  </p>

  <Oficina />

  <h2 id="ordem">As mesmas perguntas, sempre na mesma ordem</h2>
  <p>
    Quando o cliente digita o código, a Venduá faz as perguntas que você viu na simulação, nesta
    ordem: o cupom está ligado, ainda está na validade, ainda tem usos, o pedido chegou no mínimo. A
    primeira que falhar encerra a conversa, e o cliente lê o motivo na hora, em português de gente:
    “Esse cupom expirou”, “Esse cupom esgotou”, “Cupom válido só no primeiro pedido”.
  </p>
  <p>
    O pedido mínimo é tratado com mais carinho. Se faltar pouco, o cupom não é recusado: ele fica na
    sacola, sem desconto, e a loja avisa quanto falta. “Faltam R$ 4,50 para usar este cupom.” O
    cliente põe mais uma fatia e o desconto aparece sozinho. É a regra trabalhando a seu favor: o
    mínimo vira motivo para o pedido crescer, em vez de motivo para desistir.
  </p>
  <p>
    As regras que dependem de quem está pedindo (uma vez por cliente, só no primeiro pedido) usam o
    telefone. Por isso elas são conferidas de novo na finalização, quando o cliente já informou o
    número dele. E não é só na hora de aplicar: o cupom é conferido outra vez a cada vez que a
    sacola muda e de novo antes de o pedido nascer. Se o cupom venceu enquanto o cliente escolhia a
    cobertura, a sacola mostra isso antes de ele pagar, e não depois.
  </p>

  <h2 id="conta">A conta é da Venduá, até o centavo</h2>
  <p>
    Desconto parece conta de padaria, mas tem armadilha. Quanto é 15% de R$ 75,50? R$ 11,325.
    Ninguém paga meio centavo, então alguém precisa decidir para onde arredondar, e precisa decidir
    sempre do mesmo jeito. Na Venduá, a porcentagem arredonda para baixo, no centavo: R$ 11,32. Toda
    vez, em todo lugar.
  </p>
  <p>
    E esse “todo lugar” é importante. A loja no navegador, o seu painel e o Duá, o vendedor com IA
    no WhatsApp da loja, nunca calculam o desconto por conta própria. Todos perguntam para o mesmo
    lugar, os servidores da Venduá, que contam o dinheiro em centavos inteiros. O total que o
    cliente vê na sacola é o total que vai no pedido, que é o total que aparece no seu relatório.
  </p>
  <p>Algumas regras da conta que valem a pena saber:</p>
  <ul>
    <li>
      <strong>A porcentagem é sobre os itens.</strong> A taxa de entrega não entra na base do desconto.
    </li>
    <li>
      <strong>O valor fixo para no valor dos itens.</strong> Um cupom de R$ 10,00 num pedido de uma fatia
      de R$ 9,00 desconta R$ 9,00, e o pedido nunca fica negativo.
    </li>
    <li>
      <strong>O cupom que zera a entrega tira exatamente a taxa.</strong> Na retirada não há taxa, então
      ele passa, mas não desconta nada.
    </li>
  </ul>
  <p>
    Qual dos três sai mais caro para a loja? Depende do tamanho da sacola. Arraste e veja: numa
    sacola pequena, R$ 10,00 fixos pesam mais que 10%. A partir de R$ 100,00 em itens, a porcentagem
    passa na frente, e continua crescendo enquanto o valor fixo fica parado.
  </p>

  <Comparativo />

  <p>
    Não existe resposta certa, existe a que combina com o seu caixa. Porcentagem acompanha o pedido
    e premia quem compra muito. Valor fixo é fácil de anunciar (“R$ 10 no primeiro pedido”) e tem
    custo previsível. E o cupom que zera a entrega costuma ser o argumento que faltava para quem
    hesita entre pedir e ir buscar.
  </p>

  <h2 id="cartao">O cartão fidelidade se preenche sozinho</h2>
  <p>
    O cartãozinho de papel com carimbo tem dois problemas: o cliente esquece em casa, e o carimbo
    depende de alguém lembrar de carimbar na correria. No fim, quem é fiel de verdade fica sem o
    prêmio, e o cartão vira enfeite de carteira.
  </p>
  <p>
    Na Venduá, o cartão fidelidade mora no telefone do cliente. A Nena liga o cartão em Marketing,
    escolhe quantos selos valem um prêmio (de 2 a 50; vem com 10) e qual é o prêmio: um valor, que
    começa em R$ 15,00, uma porcentagem, de 5% a 100%, ou a entrega zerada. Pronto. Daí em diante,
    cada pedido entregue vale um selo, sem ninguém carimbar nada.
  </p>
  <p>
    O cliente vê o próprio cartão na loja, na página do pedido: “A cada 10 pedidos entregues”, o
    prêmio, e os selos cheios e vazios. A vitrine da loja também pode anunciar o cartão, para quem
    ainda nem pediu saber que vale a pena voltar. E você vê o cartão de cada cliente na página dele,
    em Clientes, com quantos selos faltam.
  </p>
  <p>Faça a Bia pedir. Entregue, cancele, estorne, complete o cartão e deixe o tempo passar:</p>

  <Selos />

  <h2 id="premio">O prêmio é um cupom só da cliente</h2>
  <p>
    Quando o último selo entra, a Venduá cria o prêmio na mesma hora: um cupom com código começando
    por FIEL, seguido de seis letras e números sorteados (sem as letras e números que se confundem,
    como O e 0). Ele tem três travas que um cupom comum não tem:
  </p>
  <ul>
    <li>
      <strong>É pessoal.</strong> Vale só para o telefone de quem ganhou. Se a Bia mandar o código para
      a vizinha, a vizinha lê “Esse cupom é de outro cliente”.
    </li>
    <li>
      <strong>É de uso único.</strong> Usou num pedido, ele sai do cartão.
    </li>
    <li>
      <strong>Tem prazo.</strong> Vale 60 dias a partir do dia em que foi ganho. Prêmio vencido some do
      cartão, e os selos que viraram aquele prêmio não voltam.
    </li>
  </ul>
  <p>
    Se ele é pessoal, como a loja sabe que é a Bia mesmo? Na Venduá o cliente não tem conta nem
    senha. Ele prova quem é com o que já tem: o WhatsApp e o número de um pedido que já foi entregue
    a ele. Com isso, o aparelho ganha uma chave que vale 90 dias, ligada àquele telefone, e passa a
    ver os pedidos, o cartão e os prêmios dele. Digitar o telefone de outra pessoa não basta para
    usar o prêmio dela.
  </p>
  <p>
    No WhatsApp é ainda mais simples. Quando a Bia pede pelo Duá, ele confere se o telefone dela tem
    um prêmio guardado e aplica o melhor sozinho, antes de mostrar o resumo do pedido. A Bia não
    precisa lembrar do código, e a Nena não precisa lembrar da Bia.
  </p>

  <h2 id="entregue">Selo é pedido entregue, e só</h2>
  <p>
    Esta é a regra que protege o seu prêmio: o selo só entra quando o pedido chega em
    <strong>entregue</strong>. Pedido aceito, na cozinha ou a caminho ainda não conta. Pedido
    cancelado nunca conta. E se um pedido entregue for estornado depois, o selo dele sai do cartão.
    Ninguém junta selo com pedido que não aconteceu.
  </p>
  <p>
    A contagem também não depende de memória: o cartão é calculado a partir dos pedidos entregues
    daquele telefone. Por isso ele não se perde, não duplica e não precisa de ninguém conferindo.
    Dois pedidos entregues no mesmo instante não geram dois prêmios onde só cabia um.
  </p>
  <p>
    E se a loja mudar de plano? O cartão fidelidade faz parte do Venduá Bandeira. Num plano sem ele,
    o cartão para: não dá para ligar, o cliente não vê selos e nenhum prêmio é criado. Mas a
    configuração fica guardada, e os pedidos entregues continuam sendo pedidos entregues. Na volta
    ao Bandeira, os selos aparecem de novo, contados do histórico.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Cupons estão em todos os planos, a partir do Venduá Mirim. O cartão fidelidade está no Venduá
      Bandeira, junto com o Duá aplicando os prêmios no WhatsApp, e já vale durante os 14 dias
      grátis do teste.
    </p>
  </aside>

  <h2 id="comecar">Por onde começar</h2>
  <p>
    Se a loja ainda não tem nenhum cupom, a própria tela sugere o primeiro: “BEMVINDO”, com 10% de
    desconto. Marque “Só no primeiro pedido”, deixe “Uma vez por cliente” como está e coloque um
    pedido mínimo perto do seu ticket médio. Mande o código junto com o link da loja, no WhatsApp ou
    no QR code do balcão, que ficam na mesma tela de Marketing.
  </p>
  <p>
    Para os dias fracos, um cupom com data para acabar faz o serviço: “DOMINGO”, vale até domingo,
    com limite de usos se você quiser controlar quantos saem. Na semana seguinte, olhe na lista
    quantas vezes ele foi usado e quanto vendeu. Funcionou? Duplique para o próximo domingo.
  </p>
  <p>
    E ligue o cartão fidelidade com um prêmio que você daria com gosto. Dez selos para R$ 15,00 é o
    ponto de partida da tela; ajuste ao tamanho do seu pedido. Em Marketing você acompanha quantos
    prêmios já foram ganhos e quantos foram usados. O resto o cartão faz sozinho, um pedido entregue
    de cada vez.
  </p>
</Article>
