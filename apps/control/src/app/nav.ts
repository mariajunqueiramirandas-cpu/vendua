import {
  Bot,
  CalendarDays,
  Handshake,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  Settings,
  Sparkles,
  Store,
  type LucideIcon,
} from 'lucide-react';

export type BadgeKey = 'drafts' | 'overdue';

export interface Hub {
  to: string;
  label: string;
  icon: LucideIcon;
  /** bare-key shortcut (only when not typing) */
  k: string;
  badge?: BadgeKey;
}

/** The fleet console: what the sidebar and the tab bar lead with. */
export const HUBS: Hub[] = [
  { to: '/', label: 'Visão', icon: LayoutDashboard, k: 'h' },
  { to: '/lojas', label: 'Lojas', icon: Store, k: 'l' },
  { to: '/ia', label: 'IA', icon: Sparkles, k: 'd' },
];

/** The sales side, folded into one "Vendas" group. */
export const SALES: Hub[] = [
  { to: '/vendas', label: 'Hoje', icon: ListChecks, k: 'v', badge: 'overdue' },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare, k: 'p' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, k: 'i', badge: 'drafts' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, k: 'a' },
  { to: '/agente', label: 'Agente', icon: Bot, k: 'g' },
];

export const SALES_GROUP = { to: '/vendas', label: 'Vendas', icon: Handshake };

export const CONFIG: Hub = { to: '/config', label: 'Config', icon: Settings, k: 'c' };

export const isSalesPath = (path: string) =>
  SALES.some((h) => path === h.to || path.startsWith(`${h.to}/`));

export const salesBadge = (badges: Record<string, number>) =>
  SALES.reduce((n, h) => n + (h.badge ? (badges[h.badge] ?? 0) : 0), 0);

/** Every destination, for the command palette. */
export const DESTINATIONS: { to: string; label: string; group: string }[] = [
  { to: '/', label: 'Visão geral da frota', group: 'Visão' },
  { to: '/lojas', label: 'Lojas', group: 'Lojas' },
  { to: '/lojas?f=atencao', label: 'Lojas com cobrança pendente', group: 'Lojas' },
  { to: '/lojas?f=dominios', label: 'Domínios para ativar', group: 'Lojas' },
  { to: '/lojas?f=sites', label: 'Pedidos de site', group: 'Lojas' },
  { to: '/lojas/planos', label: 'Planos de assinatura', group: 'Lojas' },
  { to: '/lojas/incidentes', label: 'Incidentes', group: 'Lojas' },
  { to: '/lojas/frota', label: 'Frota (versões, sondas, alertas)', group: 'Lojas' },
  { to: '/lojas/frota?f=falhando', label: 'Lojas com sonda falhando', group: 'Lojas' },
  { to: '/ia', label: 'Uso da IA (Duá)', group: 'IA' },
  { to: '/ia/modelos', label: 'Modelos e orçamentos', group: 'IA' },
  { to: '/ia/voz', label: 'Voz: áudios dos clientes', group: 'IA' },
  { to: '/vendas', label: 'Hoje', group: 'Vendas' },
  { to: '/vendas?t=tarefas', label: 'Tarefas', group: 'Vendas' },
  { to: '/pipeline', label: 'Leads (lista)', group: 'Pipeline' },
  { to: '/pipeline?v=board', label: 'Funil (quadro)', group: 'Pipeline' },
  { to: '/pipeline/relatorios', label: 'Relatórios', group: 'Pipeline' },
  { to: '/pipeline/analytics', label: 'Analytics do site', group: 'Pipeline' },
  { to: '/pipeline/analytics?p=painel', label: 'Analytics do painel', group: 'Pipeline' },
  { to: '/pipeline/analytics?p=lojas', label: 'Analytics das lojas (funil)', group: 'Pipeline' },
  { to: '/inbox', label: 'Inbox', group: 'Inbox' },
  { to: '/inbox?f=rascunhos', label: 'Rascunhos para aprovar', group: 'Inbox' },
  { to: '/agenda', label: 'Agenda', group: 'Agenda' },
  { to: '/agente/atividade', label: 'Atividade do agente', group: 'Agente' },
  { to: '/agente/planos', label: 'Planos do agente', group: 'Agente' },
  { to: '/agente/descoberta', label: 'Descoberta', group: 'Agente' },
  { to: '/agente/estudio', label: 'Estúdio', group: 'Agente' },
  { to: '/config', label: 'Config', group: 'Config' },
];

export const SHORTCUTS: [string, string][] = [
  ['h l d', 'visão, lojas, IA'],
  ['v p i a g', 'vendas: hoje, pipeline, inbox, agenda, agente'],
  ['c', 'config'],
  ['⌘K  ou  /', 'buscar e navegar'],
  ['n', 'novo lead'],
  ['ctrl + enter', 'enviar mensagem (inbox)'],
  ['shift + ctrl + enter', 'salvar rascunho (inbox)'],
  ['⌘.', 'recolher menu'],
  ['?', 'esta ajuda'],
];
