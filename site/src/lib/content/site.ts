export const site = {
  brandName: 'Venduá',
  tagline: 'Software sob medida.',
  instagramUrl: 'https://www.instagram.com/vendua.digital/',
  instagramDmUrl: 'https://ig.me/m/vendua.digital',
  instagramHandle: '@vendua.digital',
  emails: ['vinicius.junquira@vendua.com.br', 'jorge.andre@vendua.com.br'],
  publicDomain: 'https://vendua.com.br',
  publicCaseUrl: '',
  whatsappNumber: '',
  analyticsEnabled: false,
  contactMode: 'instagram',
};
export const signals = [
  [
    'Produtos web.',
    'Sites, lojas e aplicações com identidade própria — projetados para a sua operação, não para um template.',
  ],
  [
    'Ferramentas internas.',
    'Automação, painéis e integrações que tiram trabalho manual da sua equipe.',
  ],
  [
    'Arquitetura contínua.',
    'O sistema evolui junto com o negócio. Entrega incremental, código seu desde o primeiro commit.',
  ],
];
export const manifesto =
  'Prateleira serve a todos e não resolve ninguém. Software sob medida é quando a operação dita o sistema — e não o contrário.';
export const transmissions = [
  {
    id: 'S-01',
    title: 'Ingestão do negócio',
    text: 'A operação entra como dado bruto e sai como modelo de domínio.',
    detail:
      'O cliente descreve o que vende — produtos, cardápio, variações, preços, horários, regras de pedido — e o pipeline estrutura isso num modelo de domínio tipado. Categorias, modificadores, disponibilidade e restrições viram entidades e invariantes, não campos de um formulário. É essa modelagem que decide o que a vitrine pode fazer.',
    specs: [
      ['Entrada', 'descrição livre da operação'],
      ['Saída', 'modelo de domínio tipado'],
      ['Regras', 'invariantes no domínio'],
      ['Status', 'em build'],
    ],
  },
  {
    id: 'S-02',
    title: 'Geração da vitrine',
    text: 'Cada loja é gerada do zero — não é tema aplicado sobre template.',
    detail:
      'A partir do modelo, o construtor gera a vitrine inteira: layout, fluxo de pedido, identidade, conteúdo. Não existe um template sendo recolorido — cada negócio recebe um build próprio, composto pelo sistema. Um restaurante e uma ótica saem com estruturas fundamentalmente diferentes, porque o domínio é diferente. É isso que nenhum builder de prateleira faz.',
    specs: [
      ['Geração', 'build único por negócio'],
      ['Template', 'nenhum'],
      ['Composição', 'dirigida pelo domínio'],
      ['Status', 'em build'],
    ],
  },
  {
    id: 'S-03',
    title: 'Operação viva',
    text: 'Cardápio que muda com o turno, pedido que flui sem intervenção.',
    detail:
      'Depois do ar, a vitrine continua viva: cardápio respeita horários e disponibilidade, itens esgotados saem do fluxo sozinhos, pedidos seguem a regra do negócio sem ninguém tocar em nada. Atualizar o cardápio é atualizar dado, não republicar site. A loja não dorme — e não precisa de ninguém acordado.',
    specs: [
      ['Disponibilidade', 'por horário e estoque'],
      ['Atualização', 'dado, sem redeploy'],
      ['Pedidos', 'fluxo contínuo'],
      ['Status', 'especificação ativa'],
    ],
  },
];
export const ritual = [
  [
    'Descoberta.',
    'Uma conversa técnica sobre a operação: o que você vende, onde dói, o que precisa existir.',
  ],
  [
    'Escopo e protótipo.',
    'Proposta fechada com arquitetura, prazo e preço — e um protótipo navegável antes de qualquer build.',
  ],
  [
    'Build e handoff.',
    'Entregas semanais, repositório e infraestrutura na sua conta, documentação incluída.',
  ],
];
export const teaserFaqs = [
  [
    'Quanto custa um projeto?',
    'Escopo fechado por projeto, preço definido antes do build. Sem hora aberta, sem surpresa.',
  ],
  [
    'O código é meu?',
    'Sim. Repositório, infraestrutura e contas ficam no seu nome desde o primeiro dia.',
  ],
  [
    'Quanto tempo leva?',
    'Sites e vitrines em semanas. Sistemas maiores vão em fases, cada uma entregue e utilizável.',
  ],
  [
    'O que é a plataforma Venduá?',
    'Um construtor automatizado de vitrines e cardápios sob medida, em desenvolvimento. Clientes de serviço veem de perto — e entram primeiro.',
  ],
  [
    'E depois do lançamento?',
    'Plano de operação opcional para manter e evoluir. Sem lock-in: o sistema continua seu.',
  ],
];
