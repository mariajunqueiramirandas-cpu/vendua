export const project = {
  name: 'Quero Pudim Gourmet',
  slug: 'quero-pudim-gourmet',
  summary:
    'Uma loja de pudins de família foi o ponto de partida para conectar identidade, compra, atendimento e gestão.',
  context:
    'A primeira loja do portfólio da Venduá é a confeitaria da mãe do Vini. O trabalho parte de uma rotina concreta: apresentar os doces, receber pedidos e organizar o que precisa ser preparado.',
  capabilities: [
    'Pronta-entrega e encomendas',
    'Disponibilidade e antecedência',
    'Atendimento no WhatsApp',
    'Pedidos, estoque e produção',
  ],
  views: [
    {
      id: 'compra',
      label: 'Para quem compra',
      title: 'O cuidado da marca começa na vitrine.',
      text: 'Identidade própria, cardápio e um caminho claro até o pedido.',
      benefits: ['Visual personalizado', 'Escolha de produtos', 'Retirada e entrega'],
      src: '/assets/projetos/storefront-web.webp',
      original: '/assets/projetos/storefront-original.png',
      width: 1920,
      height: 991,
      alt: 'Página inicial do Quero Pudim Gourmet com apresentação dos doces e acesso ao cardápio.',
      caption:
        'Página inicial do Quero Pudim Gourmet. Captura fornecida pelo responsável pelo projeto.',
    },
    {
      id: 'gestao',
      label: 'Para quem vende',
      title: 'A operação também faz parte do projeto.',
      text: 'Um painel reúne atalhos para acompanhar pedidos, estoque e produção.',
      benefits: ['Pedidos', 'Disponibilidade', 'Rotina de produção'],
      src: '/assets/projetos/admin-web.webp',
      original: '/assets/projetos/admin-original.png',
      width: 1920,
      height: 993,
      alt: 'Visão geral da gestão do Quero Pudim Gourmet com pedidos, estoque e atalhos de produção.',
      caption: 'Visão geral da gestão do Quero Pudim Gourmet. Dados do momento da captura.',
    },
  ],
};
