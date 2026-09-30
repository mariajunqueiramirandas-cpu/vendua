import type { PageTab } from '@/components/Page.tsx';

export const STORES_TABS: PageTab[] = [
  { to: '/lojas', label: 'Lojas', end: true },
  { to: '/lojas/planos', label: 'Planos' },
  { to: '/lojas/incidentes', label: 'Incidentes' },
  { to: '/lojas/frota', label: 'Frota' },
];
