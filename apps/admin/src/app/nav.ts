import {
  CashRegister,
  ChartLineUp,
  ChatsCircle,
  CookingPot,
  ForkKnife,
  House,
  IdentificationCard,
  Lifebuoy,
  Megaphone,
  PaintBrush,
  Printer,
  Receipt,
  Sparkle,
  Storefront,
  Users,
  UsersThree,
  Wallet,
  WhatsappLogo,
  type Icon,
} from '@phosphor-icons/react';
import type { PlanFeature, Role } from '../lib/api.ts';

export type NavGroup = 'dia' | 'loja' | 'vender' | 'ajustes' | 'ajuda';

export interface NavItem {
  to: string;
  label: string;
  Icon: Icon;
  min: Role;
  group: NavGroup;
  /** in the phone bottom bar (the rest live under "Mais") */
  primary?: boolean;
  /** the plan feature the screen needs: without it the entry shows a lock (and the screen the plan) */
  feature?: PlanFeature;
}

// the sidebar's and Mais's headings; Ajuda closes the list without one
export const GROUPS: { id: NavGroup; label?: string }[] = [
  { id: 'dia', label: 'Dia a dia' },
  { id: 'loja', label: 'Sua loja' },
  { id: 'vender', label: 'Vender mais' },
  { id: 'ajustes', label: 'Ajustes' },
  { id: 'ajuda' },
];

// Plain pt-BR, no platform words (§2.2.8). Order = the sidebar, grouped by GROUPS; `primary`
// ones make the phone bar (in BAR's order) and the rest fill "Mais" in the same groups.
export const NAV: NavItem[] = [
  { to: '/', label: 'Início', Icon: House, min: 'attendant', group: 'dia', primary: true },
  {
    to: '/pedidos',
    label: 'Pedidos',
    Icon: Receipt,
    min: 'attendant',
    group: 'dia',
    primary: true,
  },
  // the counter, the mesas and the caixa (ADR 0035)
  { to: '/pdv', label: 'PDV', Icon: CashRegister, min: 'attendant', group: 'dia', feature: 'pdv' },
  {
    to: '/cozinha',
    label: 'Cozinha',
    Icon: CookingPot,
    min: 'attendant',
    group: 'dia',
    feature: 'kds',
  },
  // Duá Copilot: the store's people ask him in the admin (on phones, in "Mais" and the header)
  {
    to: '/copiloto',
    label: 'Copiloto',
    Icon: ChatsCircle,
    min: 'manager',
    group: 'dia',
    feature: 'copilot',
  },
  {
    to: '/cardapio',
    label: 'Cardápio',
    Icon: ForkKnife,
    min: 'manager',
    group: 'loja',
    primary: true,
  },
  { to: '/loja', label: 'Loja', Icon: Storefront, min: 'manager', group: 'loja', primary: true },
  { to: '/aparencia', label: 'Aparência', Icon: PaintBrush, min: 'manager', group: 'loja' },
  // in the bar while it's on, in "Mais" before (navFor)
  {
    to: '/vendedor',
    label: 'Duá',
    Icon: Sparkle,
    min: 'attendant',
    group: 'vender',
    feature: 'vendedor',
  },
  { to: '/clientes', label: 'Clientes', Icon: Users, min: 'manager', group: 'vender' },
  { to: '/marketing', label: 'Marketing', Icon: Megaphone, min: 'manager', group: 'vender' },
  { to: '/relatorios', label: 'Relatórios', Icon: ChartLineUp, min: 'manager', group: 'vender' },
  { to: '/pagamentos', label: 'Pagamentos', Icon: Wallet, min: 'manager', group: 'ajustes' },
  { to: '/whatsapp', label: 'WhatsApp', Icon: WhatsappLogo, min: 'manager', group: 'ajustes' },
  {
    to: '/impressoras',
    label: 'Impressoras',
    Icon: Printer,
    min: 'manager',
    group: 'ajustes',
    feature: 'printing',
  },
  { to: '/equipe', label: 'Equipe', Icon: UsersThree, min: 'manager', group: 'ajustes' },
  {
    to: '/conta',
    label: 'Conta e plano',
    Icon: IdentificationCard,
    min: 'owner',
    group: 'ajustes',
  },
  { to: '/ajuda', label: 'Ajuda', Icon: Lifebuoy, min: 'attendant', group: 'ajuda' },
];

// the phone bar's order, whichever four of these are primary (§3.1)
const BAR = ['/', '/pedidos', '/vendedor', '/cardapio', '/loja'];

/**
 * The nav for this store: once Duá (the AI seller) is on, the phone bar is Início · Pedidos · Duá
 * · Cardápio · Mais and Loja heads "Mais" (sales-agent-ux §2); before, Duá waits in Mais.
 */
export function navFor(vendedorOn: boolean): NavItem[] {
  if (!vendedorOn) return NAV;
  return NAV.map((n) =>
    n.to === '/vendedor'
      ? { ...n, primary: true }
      : n.to === '/loja'
        ? { ...n, primary: false }
        : n,
  );
}

export const barOf = (items: NavItem[]) =>
  items.filter((n) => n.primary).sort((a, b) => BAR.indexOf(a.to) - BAR.indexOf(b.to));

export interface NavSection {
  id: NavGroup;
  label?: string;
  items: NavItem[];
}

/** Items under their headings, empty groups dropped. */
export const sectionsOf = (items: NavItem[]): NavSection[] =>
  GROUPS.map((g) => ({ ...g, items: items.filter((n) => n.group === g.id) })).filter(
    (g) => g.items.length,
  );

/** What "Mais" holds, by group: Sua loja first when Duá took Loja's place in the bar. */
export function moreOf(items: NavItem[], vendedorOn: boolean): NavSection[] {
  const more = sectionsOf(items.filter((n) => !n.primary));
  const loja = more.findIndex((g) => g.items.some((n) => n.to === '/loja'));
  if (vendedorOn && loja > 0) more.unshift(...more.splice(loja, 1));
  return more;
}

// Phones stack screens left to right (§3.3): tab and "Mais" roots are depth 0, a drill-down
// is depth 1 with the root it belongs to. `title` names the screen in the next one's back button.
const DEEP: { match: RegExp; parent: string; title: string }[] = [
  // opened from any screen (the header's Duá): one level down, back returns there
  { match: /^\/copiloto$/, parent: '/', title: 'Copiloto' },
  // Vender, Mesas and Caixa are the PDV's own tabs; their drill-downs go one level down
  { match: /^\/pdv\/mesas$/, parent: '/pdv', title: 'Mesas' },
  { match: /^\/pdv\/caixa$/, parent: '/pdv', title: 'Caixa' },
  { match: /^\/pdv\/mesas\/qr$/, parent: '/pdv/mesas', title: 'QR das mesas' },
  { match: /^\/pdv\/comanda\/[^/]+$/, parent: '/pdv/mesas', title: 'Comanda' },
  { match: /^\/pdv\/caixa\/[^/]+$/, parent: '/pdv/caixa', title: 'Fechamento' },
  { match: /^\/pedidos\/historico$/, parent: '/pedidos', title: 'Histórico' },
  { match: /^\/pedidos\/agendados$/, parent: '/pedidos', title: 'Encomendas' },
  { match: /^\/pedidos\/[^/]+$/, parent: '/pedidos', title: 'Pedido' },
  { match: /^\/cardapio\/produto\/[^/]+$/, parent: '/cardapio', title: 'Produto' },
  { match: /^\/cardapio\/importar$/, parent: '/cardapio', title: 'Importar' },
  { match: /^\/cardapio\/estoque$/, parent: '/cardapio', title: 'Estoque' },
  { match: /^\/clientes\/[^/]+$/, parent: '/clientes', title: 'Cliente' },
  { match: /^\/vendedor\/conversas\/[^/]+$/, parent: '/vendedor/conversas', title: 'Conversa' },
  { match: /^\/vendedor\/conversas$/, parent: '/vendedor', title: 'Conversas' },
  { match: /^\/vendedor\/comecar$/, parent: '/vendedor', title: 'Treinar' },
  { match: /^\/vendedor\/ensinar$/, parent: '/vendedor', title: 'Ensinar' },
  { match: /^\/vendedor\/ensaio$/, parent: '/vendedor', title: 'Ensaio' },
  { match: /^\/vendedor\/cliente-oculto$/, parent: '/vendedor', title: 'Cliente oculto' },
  { match: /^\/vendedor\/resultados$/, parent: '/vendedor', title: 'Resultados' },
  { match: /^\/vendedor\/configurar$/, parent: '/vendedor', title: 'Configurar' },
  { match: /^\/vendedor\/testar$/, parent: '/vendedor', title: 'Testar' },
];

export interface Place {
  depth: 0 | 1;
  /** the tab (or Mais) root this screen lives under */
  root: string;
  title?: string;
}

export function placeOf(pathname: string): Place | null {
  const deep = DEEP.find((d) => d.match.test(pathname));
  if (deep) return { depth: 1, root: deep.parent, title: deep.title };
  const top = NAV.find((n) => n.to === pathname);
  return top ? { depth: 0, root: top.to, title: top.label } : null;
}

// a drill-down's parent is a tab or "Mais" root, or another drill-down (a conversation's list)
export const rootLabel = (root: string) =>
  NAV.find((n) => n.to === root)?.label ?? DEEP.find((d) => d.match.test(root))?.title ?? 'Voltar';
