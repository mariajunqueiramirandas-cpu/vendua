import {
  Bot,
  CalendarDays,
  Home,
  Inbox,
  KanbanSquare,
  Settings,
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

export const HUBS: Hub[] = [
  { to: '/', label: 'Hoje', icon: Home, k: 'h', badge: 'overdue' },
  { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare, k: 'p' },
  { to: '/inbox', label: 'Inbox', icon: Inbox, k: 'i', badge: 'drafts' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, k: 'a' },
  { to: '/agente', label: 'Agente', icon: Bot, k: 'g' },
  { to: '/lojas', label: 'Lojas', icon: Store, k: 'l' },
];

export const CONFIG: Hub = { to: '/config', label: 'Config', icon: Settings, k: 'c' };

/** Every destination, for the command palette. */
export const DESTINATIONS: { to: string; label: string; group: string }[] = [
  { to: '/', label: 'Hoje', group: 'Hoje' },
  { to: '/?t=tarefas', label: 'Tarefas', group: 'Hoje' },
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
  { to: '/agente/planos', label: 'Planos', group: 'Agente' },
  { to: '/agente/descoberta', label: 'Descoberta', group: 'Agente' },
  { to: '/agente/estudio', label: 'Estúdio', group: 'Agente' },
  { to: '/lojas', label: 'Lojas', group: 'Lojas' },
  { to: '/lojas?f=atencao', label: 'Lojas com cobrança pendente', group: 'Lojas' },
  { to: '/lojas?f=dominios', label: 'Domínios para ativar', group: 'Lojas' },
  { to: '/lojas?f=sites', label: 'Pedidos de site', group: 'Lojas' },
  { to: '/lojas/planos', label: 'Planos de assinatura', group: 'Lojas' },
  { to: '/lojas/incidentes', label: 'Incidentes', group: 'Lojas' },
  { to: '/lojas/frota', label: 'Frota (versões, sondas, alertas)', group: 'Lojas' },
  { to: '/lojas/frota?f=falhando', label: 'Lojas com sonda falhando', group: 'Lojas' },
  { to: '/config', label: 'Config', group: 'Config' },
];

export const SHORTCUTS: [string, string][] = [
  ['h p i a g l c', 'trocar de hub'],
  ['⌘K  ou  /', 'buscar e navegar'],
  ['n', 'novo lead'],
  ['ctrl + enter', 'enviar mensagem (inbox)'],
  ['shift + ctrl + enter', 'salvar rascunho (inbox)'],
  ['?', 'esta ajuda'],
];
