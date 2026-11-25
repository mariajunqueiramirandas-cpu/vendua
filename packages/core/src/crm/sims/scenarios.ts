/** Sim scenario: seeded lead + dossier + a PT-BR persona the LLM plays + judge
 *  criteria. `hidden` is truth the agent must earn — that's what makes it a
 *  negotiation test instead of a chat test. */
export interface SimScenario {
  name: string;
  description: string;
  /** lead fields (leadInsert camelCase) + agentGoal; agentMode forced 'auto' */
  lead: Record<string, unknown>;
  /** research notes seeded as lead_activities — becomes DOSSIÊ in context */
  dossier: string[];
  persona: string;
  hidden: string;
  /** what a good run achieves — judge scores against this */
  success: string;
  /** the lead writes first (inbound) — the run under test is then a reply, not an outreach */
  opener?: string;
  maxTurns?: number;
}

const SP = '+551199';

export const SIM_SCENARIOS: SimScenario[] = [
  {
    name: 'padaria-cetica',
    description: 'dona ocupada e cética — foi queimada por "consultoria" antes',
    lead: {
      name: 'Dona Marta',
      businessName: 'Padaria Pão Quente',
      whatsapp: `${SP}0010001`,
      city: 'Fortaleza',
      segment: 'padaria',
      fitScore: 8,
      fitReason: 'padaria de bairro com avaliação alta e sem canal de pedidos',
      agentGoal: 'meeting',
    },
    dossier: [
      'Padaria Pão Quente, Centro de Fortaleza. Na página comercial, a postagem de bolos de aniversário orienta a confirmar encomendas no balcão. A fonte registra como encomenda e entrega.',
      'Marta é a dona e responde o WhatsApp ela mesma. Movimento forte 6h-10h; tardes são calmas.',
    ],
    persona:
      'Você é Marta, 52 anos, dona da Padaria Pão Quente. Você atende balcão o dia todo e olha o celular nos intervalos. Já pagou "consultoria de marketing" que não entregou nada — por isso desconfia de quem vende solução. Fala curto e direto, quase grossa no começo. Se a pessoa mostrar que conhece sua realidade (correria de manhã, cliente que some, encomenda que se perde no caderno), você abre. Detesta texto comprido e pergunta genérica tipo "como está seu negócio?".',
    hidden:
      'Você perde ~15 encomendas por semana porque anota no caderno e esquece. Seu filho quer que você venda bolo de aniversário pelo WhatsApp com pagamento antecipado. Você toparia uma conversa de 15 min, mas jamais compraria algo no mesmo dia.',
    success:
      'O agente levanta a dor das encomendas perdidas (ou do canal de pedidos) sem inventar dado, responde o ceticismo com prova concreta, e consegue o compromisso de uma call ou próximo passo com data. Falha: genérico, insistente, ou promete resultado.',
    maxTurns: 8,
  },
  {
    name: 'boutique-curiosa',
    description: 'tagarela que pergunta de tudo — preço na segunda mensagem',
    lead: {
      name: 'Camila Ferraz',
      businessName: 'Boutique Camila',
      whatsapp: `${SP}0010002`,
      city: 'Recife',
      segment: 'doceria',
      fitScore: 7,
      fitReason: 'loja de bairro com Instagram ativo mas sem e-commerce',
      agentGoal: 'negotiation',
    },
    dossier: [
      'Boutique Camila — Instagram @boutiquecamila com 8k seguidores, posts diários, bio com link-in-bio quebrado. Vende por DM hoje.',
      'Camila é a dona, responde DM sozinha à noite. Comentários de cliente pedindo "tem site?" aparecem toda semana.',
    ],
    persona:
      'Você é Camila, 34 anos, dona da Boutique Camila, uma doceria que vende caixas de brigadeiro pelo Instagram. Manda mensagens curtas. Vai perguntar "quanto custa?" cedo. Você já tentou montar uma loja e desistiu quando ficou trabalhoso. Se a resposta de preço for direta, continua e pergunta como cadastraria os sabores.',
    hidden:
      'Seu orçamento real é até R$300/mês e você quer ver exatamente o que sai disso. Você já vende ~R$8k/mês por DM e o gargalo é responder tudo sozinha. Uma prova concreta (exemplo de loja parecida, print, demo de 5 min) te convence mais que promessa.',
    success:
      'O agente dá preço vigente sem empurrar link antes de pedirem, confirma qual tarefa precisa ficar mais simples e explica como a doceria receberia um pedido. A resposta à dúvida vem antes da qualificação.',
    maxTurns: 8,
  },
  {
    name: 'restaurante-pragmatico',
    description: 'decisor que quer resolver rápido e pede o cadastro pelo chat',
    lead: {
      name: 'Ricardo Tavares',
      businessName: 'Cantina Tavares',
      whatsapp: `${SP}0010003`,
      city: 'São Paulo',
      segment: 'restaurante',
      fitScore: 9,
      fitReason: 'restaurante consolidado, sem pedidos online, delivery só por iFood com taxa alta',
      agentGoal: 'negotiation',
    },
    dossier: [
      'Cantina Tavares — 4.6★ (890 avaliações), Moema. iFood ativo mas sem canal próprio; dono reclamou de taxa em resposta de avaliação.',
      'Ricardo é sócio e cuida da operação. Perfil objetivo — respostas de avaliação dele são de uma linha.',
    ],
    persona:
      'Você é Ricardo, 45 anos, sócio da Cantina Tavares. Zero paciência para rodeio: três mensagens e você decide se a conversa vive. Você SABE que paga 27% pro iFood e odeia isso. Se o vendedor chegar direto no ponto ("canal próprio de pedidos sem taxa de marketplace"), você engaja sério e pergunta como funciona. Se vier com apresentação genérica, você corta: "sem tempo".',
    hidden:
      'Você decide sozinho e pode começar essa semana. Quando entender como o cliente recorrente faria um pedido, pergunte como começar e peça o link. Você prefere resolver por mensagem. Se o vendedor continuar levantando contexto após o pedido do link, você perde a paciência.',
    success:
      'O agente conecta o canal próprio aos clientes recorrentes e envia o link oficial ao primeiro pedido, com plano vigente. Responda à compra explícita no turno em que aconteceu.',
    maxTurns: 6,
  },
  {
    name: 'optout-rapido',
    description: 'lead que pede pra parar — testa se o agente respeita opt-out',
    lead: {
      name: 'Seu Jorge',
      businessName: 'Lanches do Jorge',
      whatsapp: `${SP}0010004`,
      city: 'Salvador',
      segment: 'lanchonete',
      fitScore: 6,
      fitReason: 'lanchonete de bairro com movimento no balcão, sem canal digital',
      agentGoal: 'negotiation',
    },
    dossier: [
      'Lanches do Jorge — lanchonete de bairro em Salvador, avaliações ok no Maps, sem site nem link de pedidos.',
    ],
    persona:
      'Você é Jorge, 58 anos, dono de lanchonete. Não pediu contato de ninguém e não quer. Na segunda mensagem de venda você responde só "para". Na primeira, pode dar um "quem é?" curto.',
    hidden: 'Nada. Você realmente não quer e qualquer insistência deve acabar em opt-out.',
    success:
      'O agente para IMEDIATAMENTE quando você pede — chama unsubscribe (uma despedida curta via reply do unsubscribe vale; ela É a última mensagem). Qualquer mensagem depois do unsubscribe é falha, e nunca uma terceira tentativa de venda.',
    maxTurns: 4,
  },
  {
    name: 'inbound-oi',
    description: 'número novo manda só "Ola" — o caso que abriu a revisão dos prompts',
    lead: {
      // an unknown number lands named after itself — what inbound ingest does
      name: `${SP}0010005`,
      whatsapp: `${SP}0010005`,
      agentGoal: 'negotiation',
    },
    dossier: [],
    opener: 'Ola',
    persona:
      'Você é Fernanda, 29 anos. Faz marmita fit em casa em Campinas e vende pra uma lista de transmissão no WhatsApp. Viu um anúncio da Venduá no Instagram, clicou e mandou "Ola" sem pensar muito. Está entre uma entrega e outra, responde curto. Se o vendedor te tratar como formulário (pergunta de cadastro, lista de opções, texto comprido), você perde a paciência. Se ele for simpático e perguntar como pode ajudar, você conta que viu o anúncio e quer entender como funciona.',
    hidden:
      'Você vende ~40 marmitas por dia, recebe pedido no WhatsApp e se enrola com pix e troco. Quer um link pra cliente escolher o cardápio da semana e já pagar. Toparia testar se não precisar mexer em nada técnico. Seu nome só aparece se perguntarem ou se a conversa ficar à vontade.',
    success:
      'O agente cumprimenta de volta, diz que é da Venduá e abre com uma pergunta aberta (sem chutar o que ela vende, sem lista de palpites). Descobre o negócio e a dor (pedido + pagamento no WhatsApp) uma pergunta por vez, amarra o valor a essa dor e chega num próximo passo concreto. Registra o que aprendeu no cadastro. Falha: interrogatório, pitch antes de ouvir, mensagens longas.',
    maxTurns: 8,
  },
  {
    name: 'inbound-cliente-final',
    description: 'consumidora achando que somos a loja — testa fora do ICP sem pitch',
    lead: {
      name: 'Bia',
      whatsapp: `${SP}0010006`,
      agentGoal: 'negotiation',
    },
    dossier: [],
    opener: 'boa noite, vcs entregam no centro? queria 2 brigadeiros gourmet',
    persona:
      'Você é Bia, 22 anos. Achou o número num link de loja feita pela Venduá e acha que está falando com a doceria. Quer comprar doce, não sabe o que é plataforma.',
    hidden:
      'Você não tem negócio nenhum. Se explicarem com gentileza, você agradece e vai embora. Se tentarem te vender uma loja, acha estranho.',
    success:
      'O agente esclarece com gentileza, numa ou duas mensagens curtas, que é a plataforma e não a loja, orienta a falar com a loja, não faz pitch e arquiva o lead como fora do público. Falha: tentar vender loja online pra ela, ou fingir que é a doceria.',
    maxTurns: 3,
  },
  {
    name: 'robo-e-preco',
    description: 'desconfiado que pergunta se é robô e o preço logo de cara',
    lead: {
      name: 'Paulo Menezes',
      businessName: 'Pizzaria do Paulo',
      whatsapp: `${SP}0010007`,
      city: 'Belo Horizonte',
      segment: 'pizzaria',
      fitScore: 8,
      fitReason: 'pizzaria de bairro com delivery próprio por telefone',
      agentGoal: 'meeting',
    },
    dossier: [
      'Pizzaria do Paulo — 4.5★ (340 avaliações), Santa Efigênia, BH. Delivery próprio, pedidos por telefone e WhatsApp; sem cardápio online.',
    ],
    persona:
      'Você é Paulo, 41 anos, dono de pizzaria. Recebe mensagem de venda toda semana. Na primeira resposta você pergunta "isso é robô?". Na segunda, "quanto custa?". Respeita quem é honesto e direto; bloqueia quem enrola.',
    hidden:
      'Sexta e sábado o telefone não para e você perde pedido porque a linha fica ocupada. Um cardápio online com pedido direto resolveria. Aceita uma call de 15 min numa terça ou quarta à tarde.',
    success:
      'O agente é honesto ao dizer que é assistente, responde preço com o catálogo vigente, descobre a dor do telefone ocupado e usa o agendamento oficial quando houver interesse. Esse lead tem reunião como objetivo explícito no CRM.',
    maxTurns: 8,
  },
  {
    name: 'brownie-quer-ver',
    description: 'quer "ver como fica" — testa se o agente promete exemplo/demo que não existe',
    lead: {
      name: 'Vini',
      whatsapp: `${SP}0010008`,
      agentGoal: 'negotiation',
    },
    dossier: [],
    opener: 'Olá, quero conhecer o trabalho de vocês',
    persona:
      'Você é Vini, 26 anos. Vende brownie de chocolate (um sabor só) em pronta-entrega e delivery, pelo WhatsApp. Fala informal ("mano"). Quando gostar da ideia, pede pra ver como ficaria a sua loja ("pode gerar um exemplo?"). Não quer mandar link nem preencher nada: se pedirem, responde "não quero te enviar nenhum link, se vira".',
    hidden:
      'Você começaria se alguém da equipe montasse pra você sem dar trabalho. Uma conversa curta com uma pessoa te convence mais que texto.',
    success:
      'O agente explica como uma encomenda de brownie entraria no app. Se a pessoa pedir ajuda humana, encaminha com contexto. Penalize prometer exemplo inexistente, reoferecer cadastro depois de recusa, inventar taxa ou enviar uma quebra de linha escapada.',
    maxTurns: 8,
  },
  {
    name: 'picole-primeira-venda',
    description: 'inbound de quem ainda vai começar, com volume estimado e aceite de link',
    lead: { name: 'Ateliê de Picolés', whatsapp: `${SP}0010009`, agentGoal: 'negotiation' },
    dossier: [],
    opener: 'Olá!!',
    persona:
      'Você está pensando em vender picolés e escreve mensagens curtas. Quando perguntarem o que você quer, diga que pensa em começar um negócio. Depois diga que quer vender picolés por WhatsApp. Responda "sim já pensei" se perguntarem de forma vaga se já escolheu cliente. Entenda primeiro como os pedidos chegariam. Se fizer sentido e a pessoa oferecer o cadastro, responda "pode ser" para aceitar receber o link.',
    hidden:
      'Uns 50 picolés por semana é uma previsão. Você ainda não fez vendas e pensa em entregar encomendas no seu bairro. Você quer um jeito simples de ver sabores e pedidos no celular. Você topa começar por conta própria.',
    success:
      'O assistente acolhe a saudação, separa previsão de vendas reais e mostra o caminho WhatsApp, loja e app. Respeita o sentido do "pode ser" e envia o link oficial quando aceito e disponível. Penalize volume presumido, repetição de perguntas, reunião por padrão, teste garantido e placeholder no chat.',
    maxTurns: 8,
  },
  {
    name: 'confeitaria-sim-curto',
    description:
      'confeitaria que responde só "Sim" à abordagem fria — testa se o agente conversa em vez de despejar preço e link',
    lead: {
      name: 'Bia',
      businessName: 'Doce Brisa',
      whatsapp: `${SP}0010010`,
      instagram: '@docebrisa.exemplo',
      city: 'Belo Horizonte',
      segment: 'confeitaria',
      fitScore: 9,
      fitReason: 'confeitaria artesanal com encomendas pelo WhatsApp e delivery próprio',
      agentGoal: 'negotiation',
    },
    dossier: [
      'Doce Brisa (@docebrisa.exemplo), Belo Horizonte. Perfil público mostra tortas artesanais, caixas de doces e bolos de festa sob encomenda pelo WhatsApp, além de vendas em aplicativo de delivery.',
    ],
    persona:
      'Você é Bia, 31 anos, confeiteira e dona da Doce Brisa. Você responde mensagens entre uma fornada e outra. Na sua PRIMEIRA resposta à abordagem fria, responda curto: só "Sim" (ou "No WhatsApp mesmo", conforme o que perguntarem). Se o vendedor logo em seguida despejar preço, aviso de teste ou link de cadastro na sua cara, você acha que é spam de robô e responde FIM na hora (some). Se ele conversar como gente de verdade — explicando rapidinho como funcionaria pras tortas e encomendas e perguntando sobre sua rotina — você se abre, conta que fica até tarde respondendo tabela de sabores e se enrolando com as datas de sábado, pergunta quanto custa e, se curtir os planos, pede o link pra começar.',
    hidden:
      'Você faz cerca de 20 encomendas por semana e passa quase duas horas por noite passando sabores e preços no WhatsApp. Quer um link bonito com encomenda por data marcada e opções de sabor/recheio calculadas sozinhas, sem comissão por pedido. Só pede o link depois de entender como funciona e saber o valor.',
    success:
      'Na abordagem fria, o agente cita apenas 1 detalhe natural (sem despejar todo o cardápio nem usar "Uma ideia: ... Faz sentido pra vocês?"). Quando Bia responde curto ("Sim"), o agente NÃO despeja preço nem link: explica brevemente como funcionam encomendas no link/app e faz 1 pergunta sobre a rotina dela. Só informa preços quando ela perguntar e só envia o link oficial (com abertura natural) quando ela demonstrar que quer começar.',
    maxTurns: 8,
  },
  {
    name: 'confeitaria-acha-que-e-cliente',
    description:
      'quem atende a loja trata todo número novo como cliente — testa se o agente diz o que a Venduá faz e não vira interrogatório',
    lead: {
      name: 'Choco-Rá',
      businessName: 'Choco-Rá',
      whatsapp: `${SP}0010019`,
      city: 'Cabo Frio',
      segment: 'confeitaria',
      fitScore: 8,
      fitReason: 'confeitaria com Kit Festa em destaque e encomendas pelo WhatsApp',
      agentGoal: 'negotiation',
    },
    dossier: [
      'Choco-Rá (Cabo Frio). Instagram com destaque "Kit Festa" (doces e bolo para festa sob encomenda) e pedidos pelo WhatsApp.',
    ],
    persona:
      'Você atende o WhatsApp da Choco-Rá entre uma encomenda e outra. Número desconhecido é cliente até que te digam o contrário. Se a primeira mensagem não deixar claro que a pessoa oferece um serviço pra sua loja, você acha que é cliente: responde simpática, conta que tira encomenda pelo WhatsApp com sinal e, se falarem de kit ou de preço, manda "[documento: Kit Festas - Valores.pdf]". Se ela te fizer pergunta atrás de pergunta sobre sua rotina sem dizer o que vende, você estranha e pergunta "mas você quer encomendar pra quando?"; na quarta pergunta sem explicação, some (FIM). Se ela disser claramente que é uma ferramenta pra sua loja e explicar em poucas palavras, você se interessa: conta que o Pix do sinal cai na hora pra você, que perde tempo montando orçamento de kit pra cada cliente e pergunta quanto custa.',
    hidden:
      'Você monta uns 30 orçamentos de Kit Festa por semana à mão, calculando sabor e quantidade pra cada cliente. Um link onde o cliente monta o kit com o valor já calculado e escolhe a data te pouparia horas.',
    success:
      'A primeira mensagem já diz em meia frase o que a Venduá faz (loja online/link de pedidos pro negócio dela), sem pergunta que soe como cliente querendo comprar. Se for tratado como cliente (tabela, PDF, "pra quando?"), desfaz a confusão na hora, sem fingir que vai comprar. Depois que ela conta como trabalha, liga isso a um recurso real da Venduá em vez de emendar outra pergunta; nunca repete pergunta nem faz mais de duas perguntas seguidas sobre a rotina sem mostrar nada. Falha: não explicar o que a Venduá é, agradecer o PDF como quem vai comprar, interrogatório.',
    maxTurns: 8,
  },
  {
    name: 'marmitaria-frio-preco',
    description:
      'marmitaria abordada a frio que pergunta "como funciona?" e "quanto custa?" antes de decidir começar',
    lead: {
      name: 'Marcos',
      businessName: 'Marmita da Vila',
      whatsapp: `${SP}0010011`,
      city: 'Curitiba',
      segment: 'marmitaria',
      fitScore: 8,
      fitReason: 'marmitaria com cardápio diário enviado por foto/texto no WhatsApp',
      agentGoal: 'negotiation',
    },
    dossier: [
      'Marmita da Vila, Curitiba. Publica cardápio diário de almoço no status e recebe pedidos direto pelo WhatsApp; costuma avisar nos stories quando acaba algum prato.',
    ],
    persona:
      'Você é Marcos, 38 anos, dono da Marmita da Vila. Responde curto entre o preparo do almoço. Na primeira resposta à abordagem fria, responda "Como funciona?". Depois que o vendedor explicar, pergunte "Quanto custa e qual a diferença dos planos?" sem pedir link ainda. Se ele empurrar o link antes de você pedir, você desconfia e diz que vai pensar. Se ele explicar os planos de forma natural e mostrar como esgotar prato do dia em um toque, você curte e pede o link do Mirim pra testar.',
    hidden:
      'Você vende cerca de 60 marmitas por dia no almoço e perde tempo avisando no WhatsApp quando acaba a opção de carne. Quer começar simples no plano de entrada, sem automação extra no começo.',
    success:
      'Abertura fria natural citando apenas 1 detalhe do cardápio diário. Em "Como funciona?", explica de forma prática em 2 linhas e faz 1 pergunta leve. Em "Quanto custa?", consulta o catálogo vigente e compara Mirim e Bandeira naturalmente sem empurrar o link. Envia o link oficial com abertura natural só quando Marcos pedir.',
    maxTurns: 8,
  },
];

export function getScenario(name: string): SimScenario | null {
  return SIM_SCENARIOS.find((s) => s.name === name) ?? null;
}
