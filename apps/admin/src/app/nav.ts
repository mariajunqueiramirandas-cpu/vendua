import {
  ChartLineUp,
  ForkKnife,
  House,
  IdentificationCard,
  Lifebuoy,
  Megaphone,
  PaintBrush,
  Receipt,
  Storefront,
  Users,
  UsersThree,
  Wallet,
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

// Plain pt-BR, no platform words (§2.2.8). Order = the phone bar, then "Mais".
export const NAV: NavItem[] = [
  { to: '/', label: 'Início', Icon: House, min: 'attendant', primary: true },
  { to: '/pedidos', label: 'Pedidos', Icon: Receipt, min: 'attendant', primary: true },
  { to: '/cardapio', label: 'Cardápio', Icon: ForkKnife, min: 'manager', primary: true },
  { to: '/loja', label: 'Loja', Icon: Storefront, min: 'manager', primary: true },
  { to: '/pagamentos', label: 'Pagamentos', Icon: Wallet, min: 'manager' },
  { to: '/clientes', label: 'Clientes', Icon: Users, min: 'manager' },
  { to: '/marketing', label: 'Marketing', Icon: Megaphone, min: 'manager' },
  { to: '/aparencia', label: 'Aparência', Icon: PaintBrush, min: 'manager' },
  { to: '/relatorios', label: 'Relatórios', Icon: ChartLineUp, min: 'manager' },
  { to: '/equipe', label: 'Equipe', Icon: UsersThree, min: 'manager' },
  { to: '/conta', label: 'Conta e plano', Icon: IdentificationCard, min: 'owner' },
  { to: '/ajuda', label: 'Ajuda', Icon: Lifebuoy, min: 'attendant' },
];
