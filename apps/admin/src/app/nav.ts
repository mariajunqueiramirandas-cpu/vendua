import {
  CashRegister,
  ChartLineUp,
  ChatsCircle,
  CookingPot,
  ForkKnife,
  House,
  Lifebuoy,
  Megaphone,
  Receipt,
  Sparkle,
  Storefront,
  Users,
  Wallet,
  type Icon,
} from '@phosphor-icons/react';
import type { PlanFeature, Role } from '../lib/api.ts';

export type NavGroup = 'dia' | 'loja' | 'vender' | 'ajuda';

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
  { id: 'ajuda' },
];

// Plain pt-BR, no platform words (§2.2.8). Order = the sidebar, grouped by GROUPS; `primary`
// ones make the phone bar (in BAR's order) and the rest fill "Mais" in the same groups. Every
// setting of the store lives under Loja (its hub), so the list holds only places to work in.
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
  // the money that came in (checking a Pix is daily work); how the store takes it is Loja's
  { to: '/pagamentos', label: 'Pagamentos', Icon: Wallet, min: 'manager', group: 'dia' },
  {
    to: '/cardapio',
    label: 'Cardápio',
    Icon: ForkKnife,
    min: 'manager',
    group: 'loja',
    primary: true,
  },
  { to: '/loja', label: 'Loja', Icon: Storefront, min: 'manager', group: 'loja', primary: true },
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

// An area's tabs (PageTabs) are its views side by side: the depth of the area's root, swapped
// with a cross-fade. `title` names the view in a drill-down's back button. An area that is a
// screen of Loja (Equipe) has `parent`: its views sit one level down, with Loja's back button.
const SIBLINGS: { match: RegExp; root: string; title: string; parent?: string }[] = [
  { match: /^\/pedidos\/agendados$/, root: '/pedidos', title: 'Encomendas' },
  { match: /^\/pedidos\/historico$/, root: '/pedidos', title: 'Histórico' },
  { match: /^\/cardapio\/estoque$/, root: '/cardapio', title: 'Estoque' },
  { match: /^\/cardapio\/insumos$/, root: '/cardapio', title: 'Insumos' },
  { match: /^\/cardapio\/festa$/, root: '/cardapio', title: 'Festa' },
  { match: /^\/cardapio\/planos$/, root: '/cardapio', title: 'Planos' },
  { match: /^\/marketing\/divulgar$/, root: '/marketing', title: 'Divulgar' },
  { match: /^\/marketing\/lembretes$/, root: '/marketing', title: 'Lembretes' },
  { match: /^\/equipe$/, root: '/equipe', title: 'Equipe', parent: '/loja' },
  { match: /^\/equipe\/atividade$/, root: '/equipe', title: 'Atividade', parent: '/loja' },
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
  // Loja is a hub: each part of the store's setup is its own screen, back to Loja. Some keep the
  // address they had as areas of their own (Core's pushes and e-mails link to them)
  { match: /^\/loja\/perfil$/, parent: '/loja', title: 'Perfil da loja' },
  { match: /^\/loja\/horarios$/, parent: '/loja', title: 'Horários' },
  { match: /^\/loja\/entrega$/, parent: '/loja', title: 'Entrega' },
  { match: /^\/loja\/preparo$/, parent: '/loja', title: 'Tempo de preparo' },
  { match: /^\/loja\/encomendas$/, parent: '/loja', title: 'Encomendas' },
  { match: /^\/loja\/site$/, parent: '/loja', title: 'Site e endereço' },
  { match: /^\/loja\/pagamentos$/, parent: '/loja', title: 'Formas de pagamento' },
  { match: /^\/aparencia$/, parent: '/loja', title: 'Aparência' },
  { match: /^\/whatsapp$/, parent: '/loja', title: 'WhatsApp' },
  { match: /^\/impressoras(\/parear)?$/, parent: '/loja', title: 'Impressoras' },
  { match: /^\/conta$/, parent: '/loja', title: 'Conta e plano' },
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
  if (sib)
    return sib.parent
      ? { depth: 1, root: sib.parent, title: sib.title }
      : { depth: 0, root: sib.root, title: sib.title };
  const deep = DEEP.find((d) => d.match.test(pathname));
  if (deep) return { depth: 1, root: deep.parent, title: deep.title };
  const top = NAV.find((n) => n.to === pathname);
  return top ? { depth: 0, root: top.to, title: top.label } : null;
}

/**
 * The nav entry a screen belongs to, lit in the sidebar and the bar: up its parents to the area
 * (/whatsapp → Loja, /marketing/cartao → Marketing). Off the tables, the longest entry it starts with.
 */
export function areaOf(pathname: string): string | null {
  let at = pathname;
  for (let i = 0; i < 4; i++) {
    if (NAV.some((n) => n.to === at)) return at;
    const p = placeOf(at);
    if (!p || p.root === at) break;
    at = p.root;
  }
  const hit = NAV.filter(
    (n) => n.to !== '/' && (pathname === n.to || pathname.startsWith(`${n.to}/`)),
  ).sort((a, b) => b.to.length - a.to.length)[0];
  return hit?.to ?? null;
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
