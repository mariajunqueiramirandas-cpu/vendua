export const site = {
  brandName: 'Venduá',
  tagline: 'Software sob medida.',
  instagramUrl: 'https://www.instagram.com/vendua.digital/',
  instagramDmUrl: 'https://ig.me/m/vendua.digital',
  emails: ['vinicius.junquira@vendua.com.br', 'jorge.andre@vendua.com.br'],
  publicDomain: '',
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
    title: 'Renderização & edge',
    text: 'A superfície: SSR, ilhas de interação e shaders no cliente.',
    detail:
      'Front em SvelteKit com SSR e hidratação seletiva: o que é estático chega pronto do edge, o que é interativo hidrata por ilha. Visual em WebGL2 com shaders GLSL compilados em runtime e fallback quando o contexto falha. Rotas com code splitting, fontes variáveis auto-hospedadas e first paint abaixo de um segundo em 4G.',
    specs: [
      ['Framework', 'SvelteKit · SSR'],
      ['Gráficos', 'WebGL2 + GLSL'],
      ['Hydration', 'por ilha'],
      ['Status', 'em build'],
    ],
  },
  {
    id: 'S-02',
    title: 'Núcleo de operação',
    text: 'Domínio como código: catálogo, pedido e entrega como módulos.',
    detail:
      'O domínio é modelado em módulos independentes — catálogo, pedido, entrega — comunicando por eventos, com o servidor como fonte autoritativa de estado. Cada loja compõe só os módulos de que precisa; a mesma engenharia gera resultados diferentes. Regras de negócio vivem no domínio, não espalhadas em componentes.',
    specs: [
      ['Modelo', 'eventos + servidor autoritativo'],
      ['Módulos', 'catálogo · pedido · entrega'],
      ['Composição', 'por operação'],
      ['Status', 'especificação ativa'],
    ],
  },
  {
    id: 'S-03',
    title: 'Plataforma & deploy',
    text: 'Edge-first, dados perto do cliente, operação observável.',
    detail:
      'Topologia edge-first: renderização e dados próximos de quem acessa, deploys atômicos e rollback instantâneo. Cada loja roda isolada; observabilidade com tracing ponta a ponta do request ao evento de domínio. Infraestrutura como código — o ambiente inteiro sobe de um repositório.',
    specs: [
      ['Topologia', 'edge-first'],
      ['Isolamento', 'por loja'],
      ['Observabilidade', 'tracing E2E'],
      ['Status', 'em build'],
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
    'Nosso motor próprio de lojas, em desenvolvimento. Clientes de serviço veem de perto — e entram primeiro.',
  ],
  [
    'E depois do lançamento?',
    'Plano de operação opcional para manter e evoluir. Sem lock-in: o sistema continua seu.',
  ],
];
