import type { PageTab } from '../ui/Tabs.tsx';

// The views of each area that has more than one (PageTabs), shared by the screens and their
// loading skeletons. Each is its own address; nav.ts holds them as siblings of the area's root.

export const TABS = {
  pedidos: [
    { to: '/pedidos', label: 'Agora' },
    { to: '/pedidos/agendados', label: 'Encomendas' },
    { to: '/pedidos/historico', label: 'Histórico' },
  ],
  cardapio: [
    { to: '/cardapio', label: 'Produtos' },
    { to: '/cardapio/estoque', label: 'Estoque' },
    { to: '/cardapio/festa', label: 'Festa' },
    { to: '/cardapio/planos', label: 'Planos' },
  ],
  pagamentos: [
    { to: '/pagamentos', label: 'Recebimentos' },
    { to: '/pagamentos/formas', label: 'Formas de pagamento' },
  ],
  marketing: [
    { to: '/marketing', label: 'Ofertas' },
    { to: '/marketing/divulgar', label: 'Divulgar' },
    { to: '/marketing/lembretes', label: 'Lembretes' },
  ],
  equipe: [
    { to: '/equipe', label: 'Pessoas' },
    { to: '/equipe/atividade', label: 'Atividade' },
  ],
  perfil: [
    { to: '/perfil', label: 'Você' },
    { to: '/perfil/avisos', label: 'Avisos' },
    { to: '/perfil/aparelhos', label: 'Aparelhos' },
  ],
} satisfies Record<string, PageTab[]>;

export type Area = keyof typeof TABS;

/** An area's tabs with a badge on some ("3" beside Estoque). */
export const withBadges = (area: Area, badges: Record<string, number | null | undefined>) =>
  TABS[area].map((t) => (badges[t.to] ? { ...t, badge: badges[t.to] } : t));
