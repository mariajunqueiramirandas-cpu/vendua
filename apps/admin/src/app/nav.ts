import {
  ChartLineUp,
  CookingPot,
  ForkKnife,
  House,
  IdentificationCard,
  Lifebuoy,
  Megaphone,
  PaintBrush,
  Printer,
  Receipt,
  Storefront,
  Users,
  UsersThree,
  Wallet,
  WhatsappLogo,
  type Icon,
} from '@phosphor-icons/react';
import type { Role } from '../lib/api.ts';

export interface NavItem {
  to: string;
  label: string;
  Icon: Icon;
  min: Role;
  /** in the phone bottom bar (the rest live under "Mais") */
  primary?: boolean;
}

// Plain pt-BR, no platform words (§2.2.8). Order = the sidebar; `primary` ones make the phone
// bar and the rest fill "Mais" in the same order.
export const NAV: NavItem[] = [
  { to: '/', label: 'Início', Icon: House, min: 'attendant', primary: true },
  { to: '/pedidos', label: 'Pedidos', Icon: Receipt, min: 'attendant', primary: true },
  { to: '/cozinha', label: 'Cozinha', Icon: CookingPot, min: 'attendant' },
  { to: '/cardapio', label: 'Cardápio', Icon: ForkKnife, min: 'manager', primary: true },
  { to: '/loja', label: 'Loja', Icon: Storefront, min: 'manager', primary: true },
  { to: '/pagamentos', label: 'Pagamentos', Icon: Wallet, min: 'manager' },
  { to: '/whatsapp', label: 'WhatsApp', Icon: WhatsappLogo, min: 'manager' },
  { to: '/impressoras', label: 'Impressoras', Icon: Printer, min: 'manager' },
  { to: '/clientes', label: 'Clientes', Icon: Users, min: 'manager' },
  { to: '/marketing', label: 'Marketing', Icon: Megaphone, min: 'manager' },
  { to: '/aparencia', label: 'Aparência', Icon: PaintBrush, min: 'manager' },
  { to: '/relatorios', label: 'Relatórios', Icon: ChartLineUp, min: 'manager' },
  { to: '/equipe', label: 'Equipe', Icon: UsersThree, min: 'manager' },
  { to: '/conta', label: 'Conta e plano', Icon: IdentificationCard, min: 'owner' },
  { to: '/ajuda', label: 'Ajuda', Icon: Lifebuoy, min: 'attendant' },
];

// Phones stack screens left to right (§3.3): tab and "Mais" roots are depth 0, a drill-down
// is depth 1 with the root it belongs to. `title` names the screen in the next one's back button.
const DEEP: { match: RegExp; parent: string; title: string }[] = [
  { match: /^\/pedidos\/historico$/, parent: '/pedidos', title: 'Histórico' },
  { match: /^\/pedidos\/agendados$/, parent: '/pedidos', title: 'Encomendas' },
  { match: /^\/pedidos\/[^/]+$/, parent: '/pedidos', title: 'Pedido' },
  { match: /^\/cardapio\/produto\/[^/]+$/, parent: '/cardapio', title: 'Produto' },
  { match: /^\/cardapio\/importar$/, parent: '/cardapio', title: 'Importar' },
  { match: /^\/cardapio\/estoque$/, parent: '/cardapio', title: 'Estoque' },
  { match: /^\/clientes\/[^/]+$/, parent: '/clientes', title: 'Cliente' },
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

export const rootLabel = (root: string) => NAV.find((n) => n.to === root)?.label ?? 'Voltar';
