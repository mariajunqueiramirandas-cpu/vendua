/**
 * agent/sim-scenarios — the cast of the negotiation simulator. Each scenario
 * seeds a lead (with the dossier a real discovery/triage would have produced)
 * plus the persona an LLM plays on the other end of the WhatsApp thread, and
 * the success criteria the judge scores against.
 *
 * Personas are written in PT-BR to match what the negotiation agent sees.
 * `hidden` is the truth the agent does NOT get — the persona only reveals it
 * if the agent earns it (good questions, actual listening). That gap is what
 * makes the sim a negotiation test instead of a chat test.
 */
export interface SimScenario {
  name: string;
  /** one line — what this scenario is testing */
  description: string;
  /** lead fields (leadInsert camelCase) + agentGoal; agentMode forced 'auto' */
  lead: Record<string, unknown>;
  /** research notes seeded as lead_activities — becomes DOSSIÊ in context */
  dossier: string[];
  /** who answers — personality, situation, how they behave on WhatsApp */
  persona: string;
  /** hidden facts the agent can surface by asking well */
  hidden: string;
  /** what a good run achieves — judge scores against this */
  success: string;
  maxTurns?: number;
}

const SP = '+5511999';

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
      'Padaria Pão Quente — 4.8★ no Maps (212 avaliações), Centro de Fortaleza. Sem site, sem link de pedidos; Instagram parado desde 2023.',
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
      segment: 'moda',
      fitScore: 7,
      fitReason: 'loja de bairro com Instagram ativo mas sem e-commerce',
      agentGoal: 'negotiation',
    },
    dossier: [
      'Boutique Camila — Instagram @boutiquecamila com 8k seguidores, posts diários, bio com link-in-bio quebrado. Vende por DM hoje.',
      'Camila é a dona, responde DM sozinha à noite. Comentários de cliente pedindo "tem site?" aparecem toda semana.',
    ],
    persona:
      'Você é Camila, 34 anos, dona da Boutique Camila. Animada, usa emoji, manda várias mensagens curtas seguidas. Você quer vender online MAS trava em duas coisas: preço (vai perguntar "quanto custa?" rápido) e medo de dar trabalho (já tentou Shopify e abandonou em 2 dias). Elogios genuínos sobre o Instagram te amolecem. Se a resposta sobre preço for honesta e simples, você continua; se enrolar, você some.',
    hidden:
      'Seu orçamento real é até R$300/mês e você quer ver exatamente o que sai disso. Você já vende ~R$8k/mês por DM e o gargalo é responder tudo sozinha. Uma prova concreta (exemplo de loja parecida, print, demo de 5 min) te convence mais que promessa.',
    success:
      'O agente responde preço de forma honesta e enquadrada sem esquivar, usa o link quebrado/DM-overload como gancho, e fecha um próximo passo concreto (demo ou proposta). Falha: não responde preço, ou empurra call quando o lead quer texto.',
    maxTurns: 8,
  },
  {
    name: 'restaurante-pragmatico',
    description: 'decisor que quer resolver rápido — testa o flip pro commit',
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
      'Você decide sozinho e pode começar essa semana. O número que te convence: iFood comeu R$6.400 mês passado. Se o agente propuser call, você aceita horário amanhã às 15h — mas se ele NÃO perceber que você já tá vendido e continuar "educando", você esfria.',
    success:
      'O agente percebe a compra rápida, para de vender e fecha — pede o próximo passo/call/proposta cedo em vez de continuar pitchando. Falha clássica: seguir o script quando o lead já queria comprar.',
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
      'O agente para IMEDIATAMENTE quando você pede — chama unsubscribe e não manda mais nada, nunca uma terceira tentativa. Qualquer resposta após "para" é falha.',
    maxTurns: 4,
  },
];

export function getScenario(name: string): SimScenario | null {
  return SIM_SCENARIOS.find((s) => s.name === name) ?? null;
}
