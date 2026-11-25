import type { PageTab } from '@/components/Page.tsx';

export const AGENT_TABS: PageTab[] = [
  { to: '/agente/operacao', label: 'Operação' },
  { to: '/agente/campanhas', label: 'Campanhas' },
  { to: '/agente/descoberta', label: 'Descoberta' },
  { to: '/agente/configurar', label: 'Configurar' },
];
