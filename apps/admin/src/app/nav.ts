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
  { to: '/pagamentos', label: 'Pagamentos', Icon: Wallet, min: 'manager', group: 'loja' },
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

// An area's tabs (PageTabs) are its views side by side: depth 0 like the area's root, swapped
// with a cross-fade, and no back button. `title` names the view in a drill-down's back button.
const SIBLINGS: { match: RegExp; root: string; title: string }[] = [
  { match: /^\/pedidos\/agendados$/, root: '/pedidos', title: 'Encomendas' },
  { match: /^\/pedidos\/historico$/, root: '/pedidos', title: 'Histórico' },
  { match: /^\/cardapio\/estoque$/, root: '/cardapio', title: 'Estoque' },
  { match: /^\/cardapio\/festa$/, root: '/cardapio', title: 'Festa' },
  { match: /^\/cardapio\/planos$/, root: '/cardapio', title: 'Planos' },
  { match: /^\/pagamentos\/formas$/, root: '/pagamentos', title: 'Formas de pagamento' },
  { match: /^\/marketing\/divulgar$/, root: '/marketing', title: 'Divulgar' },
  { match: /^\/marketing\/lembretes$/, root: '/marketing', title: 'Lembretes' },
  { match: /^\/equipe\/atividade$/, root: '/equipe', title: 'Atividade' },
  // Meu perfil lives in the person's menu, not the nav: its views are siblings all the same
  { match: /^\/perfil$/, root: '/perfil', title: 'Meu perfil' },
  { match: /^\/perfil\/avisos$/, root: '/perfil', title: 'Avisos' },
  { match: /^\/perfil\/aparelhos$/, root: '/perfil', title: 'Aparelhos' },
];

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
  { match: /^\/pedidos\/[^/]+$/, parent: '/pedidos', title: 'Pedido' },
  { match: /^\/cardapio\/produto\/[^/]+$/, parent: '/cardapio', title: 'Produto' },
  { match: /^\/cardapio\/importar$/, parent: '/cardapio', title: 'Importar' },
  // Loja is a hub: each part of the store's setup is its own screen
  { match: /^\/loja\/perfil$/, parent: '/loja', title: 'Perfil da loja' },
  { match: /^\/loja\/horarios$/, parent: '/loja', title: 'Horários' },
  { match: /^\/loja\/entrega$/, parent: '/loja', title: 'Entrega' },
  { match: /^\/loja\/preparo$/, parent: '/loja', title: 'Tempo de preparo' },
  { match: /^\/loja\/encomendas$/, parent: '/loja', title: 'Encomendas' },
  { match: /^\/loja\/site$/, parent: '/loja', title: 'Site e endereço' },
  { match: /^\/marketing\/cartao$/, parent: '/marketing/divulgar', title: 'Cartão da sacola' },
  { match: /^\/marketing\/status$/, parent: '/marketing/divulgar', title: 'Status do dia' },
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
  // before DEEP: /pedidos/agendados is a tab of Pedidos, not an order
  const sib = SIBLINGS.find((d) => d.match.test(pathname));
  if (sib) return { depth: 0, root: sib.root, title: sib.title };
  const deep = DEEP.find((d) => d.match.test(pathname));
  if (deep) return { depth: 1, root: deep.parent, title: deep.title };
  const top = NAV.find((n) => n.to === pathname);
  return top ? { depth: 0, root: top.to, title: top.label } : null;
}

// a drill-down's parent is a tab or "Mais" root, or another drill-down (a conversation's list)
export const rootLabel = (root: string) =>
  NAV.find((n) => n.to === root)?.label ??
  SIBLINGS.find((d) => d.match.test(root))?.title ??
  DEEP.find((d) => d.match.test(root))?.title ??
  'Voltar';

// Sections that became screens of their own: links from before (Core's checklist and Início
// rows, notifications already sent, the help) land where the section lives now.
const MOVED: Record<string, Record<string, string>> = {
  '/loja': {
    perfil: '/loja/perfil',
    horarios: '/loja/horarios',
    'dias-especiais': '/loja/horarios#dias-especiais',
    mensagens: '/loja/horarios#mensagens',
    entrega: '/loja/entrega',
    freio: '/loja/preparo#freio',
    encomendas: '/loja/encomendas',
  },
  '/conta': { enderecos: '/loja/site', dominio: '/loja/site#dominio', site: '/loja/site#site' },
  '/marketing': { compartilhar: '/marketing/divulgar' },
  '/perfil': { avisos: '/perfil/avisos' },
};

/** Where an old `path#section` address lives now, or null when it hasn't moved. */
export function movedTo(pathname: string, hash: string): string | null {
  return MOVED[pathname]?.[hash.replace(/^#/, '')] ?? null;
}
