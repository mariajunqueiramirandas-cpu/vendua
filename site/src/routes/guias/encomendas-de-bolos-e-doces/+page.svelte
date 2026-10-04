<script lang="ts">
  import Article from '$lib/components/Article.svelte';

  const outline = [
    { id: 'por-que', title: 'Por que o caderno não dá conta' },
    { id: 'o-que-perguntar', title: 'O que perguntar em toda encomenda' },
    { id: 'precos', title: 'Tamanho, recheio e decoração com preço fechado' },
    { id: 'agenda', title: 'Antecedência e capacidade da sua agenda' },
    { id: 'sinal', title: 'Sinal ou pagamento antecipado' },
    { id: 'confirmar', title: 'Confirmar, lembrar e lidar com mudanças' },
    { id: 'producao', title: 'O plano de produção da semana' },
    { id: 'checklist', title: 'Antes da próxima encomenda' },
  ];
</script>

<Article
  path="/guias/encomendas-de-bolos-e-doces/"
  pose="horarios"
  lede="O bolo de aniversário para sábado, o cento de docinhos para domingo, um recheio que mudou na quinta. Encomendas de bolos e doces chegam em dias diferentes para datas diferentes, e o caderno não avisa quando duas festas caem no mesmo dia. Este guia mostra como organizar tudo."
  {outline}
  closing="Cada encomenda no dia certo, sem abrir o caderno."
>
  <h2 id="por-que">Por que o caderno não dá conta</h2>
  <p>
    O caderno funciona enquanto as encomendas cabem numa página. Depois, começa a escapar: a
    encomenda combinada na conversa e nunca anotada, o recheio que mudou por áudio, as duas festas
    no mesmo sábado que você só percebe na sexta à noite.
  </p>
  <p>
    O problema não é a sua memória. É que cada encomenda tem muitas partes, e cada parte chega num
    momento. A data vem na primeira mensagem, o sabor na terceira, o endereço na véspera e o
    comprovante quando der. Organizar encomendas de bolo é juntar essas partes num lugar só, na hora
    do pedido, e enxergar as datas como uma agenda, não como uma lista.
  </p>

  <h2 id="o-que-perguntar">O que perguntar em toda encomenda</h2>
  <p>
    Monte uma lista fixa e não feche nenhuma encomenda sem ela. Para bolos e doces, costuma ter:
  </p>
  <ul>
    <li>
      <strong>Data e horário:</strong> o dia da festa e a hora em que o cliente retira ou recebe.
    </li>
    <li>
      <strong>Retirada ou entrega:</strong> se for entrega, o endereço completo, com ponto de referência.
    </li>
    <li>
      <strong>Massa, recheio e cobertura:</strong> um recheio ou dois, e qual vai em cada camada.
    </li>
    <li><strong>Tamanho ou peso:</strong> em quilos, em fatias ou para quantas pessoas.</li>
    <li>
      <strong>Decoração:</strong> tema, cores, nome e idade no topo, e uma foto de referência.
    </li>
    <li><strong>Docinhos:</strong> quais sabores, quantos de cada e em que forminha.</li>
    <li><strong>Restrições:</strong> lactose, glúten, castanhas.</li>
    <li><strong>Pagamento:</strong> como paga, quanto já pagou e quanto falta.</li>
  </ul>
  <p>
    Quando as perguntas são sempre as mesmas, dá para transformar a lista numa mensagem pronta ou,
    melhor ainda, num pedido que o cliente preenche sozinho. Ninguém esquece o endereço, e você não
    precisa caçar o recheio no meio da conversa.
  </p>

  <h2 id="precos">Tamanho, recheio e decoração com preço fechado</h2>
  <p>Encomenda boa sai com preço fechado. O jeito mais seguro é ter uma base e somar os extras:</p>
  <ul>
    <li>
      <strong>Base:</strong> o bolo de massa e recheio simples, com cobertura lisa, por tamanho ou por
      quilo.
    </li>
    <li>
      <strong>Recheios especiais:</strong> frutas vermelhas, nozes, pistache, cada um com o seu valor
      a mais.
    </li>
    <li>
      <strong>Decoração:</strong> topo de bolo, flores, pasta americana, escrita com nome. Cada uma com
      o seu preço.
    </li>
    <li><strong>Embalagem e entrega:</strong> caixa especial, base firme, a taxa até a festa.</li>
  </ul>
  <p>
    Escreva esses valores e use sempre os mesmos. Desconto dado na hora, para uma cliente sim e para
    outra não, vira saia justa quando elas se conhecem. Se o pedido foge do cardápio, como um bolo
    temático com personagem, faça um orçamento à parte antes de reservar a data. Para fotos e
    descrições que ajudam a vender, veja o guia
    <a href="/guias/cardapio-digital/">cardápio digital: o que é e como montar o seu</a>.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Em Opções, cada escolha tem o seu preço: o recheio de frutas vermelhas, o topo personalizado,
      o tamanho maior. Os adicionais somam, e você pode deixar o grupo obrigatório, para nenhuma
      encomenda chegar sem recheio. O cliente vê o total antes de pedir, e a conta é sempre da loja.
    </p>
  </aside>

  <h2 id="agenda">Antecedência e capacidade da sua agenda</h2>
  <p>
    Antecedência mínima é com quantos dias você precisa saber. Depende do produto: um bolo simples
    pode pedir dois dias, um bolo decorado com pasta americana, uma semana, e os doces de um
    casamento, bem mais. Decida produto por produto e deixe escrito, para não negociar cada pedido
    de véspera.
  </p>
  <p>
    A outra metade é a capacidade: quantas encomendas cabem num dia e numa semana com o seu forno, a
    sua geladeira e as suas mãos. Conte em horas de trabalho, não em pedidos, porque um bolo de três
    andares vale por vários bolos simples. Quando a data encher, feche a data. Aceitar uma encomenda
    a mais é o caminho mais curto para entregar todas pior.
  </p>
  <p>
    Para enxergar isso, a agenda de encomendas precisa ser um calendário. Olhando o mês, você vê na
    hora o sábado lotado e a terça vazia, e pode oferecer outra data antes de dizer não.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Marque o bolo como “só por encomenda” e escolha a antecedência mínima, em dias: na hora de
      pedir, o cliente só consegue escolher datas a partir dela. Os pedidos caem em Encomendas, um
      calendário com as datas que os clientes escolheram. Tocando num dia, você vê as encomendas
      dele e quanto somam.
    </p>
  </aside>

  <h2 id="sinal">Sinal ou pagamento antecipado</h2>
  <p>
    Encomenda sem nada pago antes é risco todo seu. Se a festa é cancelada, o ingrediente comprado e
    as horas de forno ficam com você. Por isso vale escolher uma regra e usar com todo mundo:
  </p>
  <ul>
    <li>
      <strong>Pagamento antecipado:</strong> o valor inteiro na hora de encomendar. É o mais simples de
      controlar.
    </li>
    <li>
      <strong>Sinal:</strong> uma parte para reservar a data, por exemplo metade, e o restante na retirada
      ou na entrega.
    </li>
  </ul>
  <p>
    Seja qual for, diga claramente quando a data está garantida: só depois do pagamento ou do sinal
    da encomenda. Com sinal, anote os dois valores em cada encomenda, o que foi pago e o que falta,
    para cobrar o restante no dia sem reler a conversa.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Encomenda se paga pelo Pix, no próprio pedido: o pagamento antecipado já vem resolvido. Com a
      sua conta do Mercado Pago conectada, o Pix cai direto nela e a encomenda se confirma paga
      sozinha. Sem ela, o pedido espera em “Pix para conferir” até você ver o dinheiro no banco.
    </p>
  </aside>

  <h2 id="confirmar">Confirmar, lembrar e lidar com mudanças</h2>
  <p>
    Toda encomenda merece uma confirmação por escrito, com o resumo: data, horário, sabor, tamanho,
    decoração, valor e o que já foi pago. O cliente confere, você também, e o erro aparece agora,
    não no dia da festa.
  </p>
  <p>
    Na véspera, mande um lembrete curto: “Seu bolo fica pronto amanhã às 15h, retirada aqui,
    combinado?”. Ele confirma o horário, lembra quem vai buscar e dá tempo de corrigir um endereço
    errado.
  </p>
  <p>
    Mudança e cancelamento acontecem. Combine as regras junto com o pagamento: até quando dá para
    trocar sabor ou tamanho, até quando dá para mudar a data e o que acontece com o valor pago se o
    cliente desistir. Depois que o ingrediente foi comprado e a massa foi para o forno, a regra
    precisa proteger o seu trabalho. Com ela escrita, você responde com a regra, sem
    constrangimento.
  </p>
  <aside class="tip">
    <h3>Na Venduá</h3>
    <p>
      Com “Encomendas com a loja fechada” ligado, um pedido feito só de encomendas entra a qualquer
      hora, mesmo fora do horário da loja. Quem lembra do aniversário à meia-noite pede na hora, e
      depois acompanha o pedido pela página dele, sem precisar perguntar se você viu.
    </p>
  </aside>

  <h2 id="producao">O plano de produção da semana</h2>
  <p>
    Com as encomendas numa agenda, o plano da semana sai quase pronto. No primeiro dia da semana,
    olhe os próximos dias e transforme as encomendas em tarefas:
  </p>
  <ul>
    <li>o que assar em cada dia, contando o tempo de esfriar;</li>
    <li>o que rechear e cobrir, e o que precisa descansar na geladeira de um dia para o outro;</li>
    <li>os docinhos que dá para enrolar antes;</li>
    <li>as compras de ingredientes e embalagens, todas juntas, para não ir ao mercado todo dia;</li>
    <li>o que sai para entrega e o que é retirado, com os horários.</li>
  </ul>
  <p>
    Uma planilha de encomendas simples dá conta: uma linha por encomenda, com data, horário, o que
    é, o que foi pago e o que falta. Se as encomendas já chegam organizadas por data, a planilha
    vira só a folha colada na geladeira com as tarefas de cada dia.
  </p>
  <p>
    E deixe uma folga na semana. Sempre aparece quem esqueceu o aniversário da mãe, e uma folga
    planejada vira venda em vez de madrugada.
  </p>

  <h2 id="checklist">Antes da próxima encomenda</h2>
  <ul>
    <li>Escreva a lista fixa de perguntas.</li>
    <li>Monte a tabela de preços: a base por tamanho e cada extra.</li>
    <li>Defina a antecedência mínima de cada produto.</li>
    <li>Decida quantas encomendas cabem por dia e por semana.</li>
    <li>Escolha entre pagamento antecipado e sinal, e escreva a regra de cancelamento.</li>
    <li>Confirme por escrito e lembre o cliente na véspera.</li>
    <li>Olhe a agenda no começo da semana e faça o plano de produção.</li>
  </ul>
  <p>
    Para ver encomendas, cardápio e Pix juntos numa loja de bolos, conheça a
    <a href="/para/doceiras/">loja online para doceiras e confeitarias</a>.
  </p>
</Article>
