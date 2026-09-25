import {
  Bot,
  CalendarDays,
  Home,
  Inbox,
  KanbanSquare,
  Settings,
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
];

export const CONFIG: Hub = { to: '/config', label: 'Config', icon: Settings, k: 'c' };

/** Every destination, for the command palette. */
export const DESTINATIONS: { to: string; label: string; group: string }[] = [
  { to: '/', label: 'Hoje', group: 'Hoje' },
  { to: '/?t=tarefas', label: 'Tarefas', group: 'Hoje' },
  { to: '/pipeline', label: 'Leads (lista)', group: 'Pipeline' },
  { to: '/pipeline?v=board', label: 'Funil (quadro)', group: 'Pipeline' },
  { to: '/pipeline/relatorios', label: 'Relatórios', group: 'Pipeline' },
  { to: '/inbox', label: 'Inbox', group: 'Inbox' },
  { to: '/inbox?f=rascunhos', label: 'Rascunhos para aprovar', group: 'Inbox' },
  { to: '/agenda', label: 'Agenda', group: 'Agenda' },
  { to: '/agente/atividade', label: 'Atividade do agente', group: 'Agente' },
  { to: '/agente/planos', label: 'Planos', group: 'Agente' },
  { to: '/agente/descoberta', label: 'Descoberta', group: 'Agente' },
  { to: '/agente/estudio', label: 'Estúdio', group: 'Agente' },
  { to: '/config', label: 'Config', group: 'Config' },
];

export const SHORTCUTS: [string, string][] = [
  ['h p i a g c', 'trocar de hub'],
  ['⌘K  ou  /', 'buscar e navegar'],
  ['n', 'novo lead'],
  ['ctrl + enter', 'enviar mensagem (inbox)'],
  ['shift + ctrl + enter', 'salvar rascunho (inbox)'],
  ['?', 'esta ajuda'],
];
