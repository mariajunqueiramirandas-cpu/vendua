// Registry of the real admin screens the site shows. `scripts/assets.ts screens` captures each one from a
// running admin (the fictional store Bolos da Nena), in Creme and Noite, and writes
// static/screens/<key>-<theme>-<width>.webp. Components render them with <Screen key=…>.

export type ScreenKind = 'phone' | 'desktop';

export const KINDS: Record<ScreenKind, { width: number; height: number; widths: number[] }> = {
  // 375×812 CSS px at 2× — the admin's phone viewport
  phone: { width: 750, height: 1624, widths: [420, 750] },
  // 1440×900 CSS px at 2×
  desktop: { width: 2880, height: 1800, widths: [960, 1600, 2880] },
};

export const SCREENS = {
  inicio: {
    kind: 'phone',
    what: 'Início com a loja aberta: Bom dia, Nena; R$ 718,00 em vendas hoje',
  },
  pedidos: { kind: 'phone', what: 'Pedidos no celular: os novos, com o botão aceitar' },
  pedido: { kind: 'phone', what: 'Um pedido aberto: itens, total, cliente e o botão aceitar' },
  pausar: {
    kind: 'phone',
    what: 'Pausar a loja: 15 min, 1 hora, resto do dia, com recado para o cliente',
  },
  cardapio: { kind: 'phone', what: 'O cardápio: 14 produtos em 4 categorias' },
  loja: { kind: 'phone', what: 'Horários da loja, dia a dia' },
  boasVindas: { kind: 'phone', what: 'O Duá começando a montar a loja com a Nena' },
  seuDia: { kind: 'phone', what: 'Seu dia: o resumo de quando a loja fecha' },
  quadro: { kind: 'desktop', what: 'O quadro de pedidos: novos, em preparo, prontos e concluídos' },
  inicioDesktop: { kind: 'desktop', what: 'O início no computador' },
  relatorios: { kind: 'desktop', what: 'Relatórios: vendas por dia, funil e horários de pico' },
  boasVindasDesktop: {
    kind: 'desktop',
    what: 'O Duá conversando com a Nena, e a loja aparecendo ao lado',
  },
} as const satisfies Record<string, { kind: ScreenKind; what: string }>;

export type ScreenKey = keyof typeof SCREENS;
export const THEMES = ['creme', 'noite'] as const;

export const screenSrc = (key: ScreenKey, theme: (typeof THEMES)[number], width: number) =>
  `/screens/${key}-${theme}-${width}.webp`;
