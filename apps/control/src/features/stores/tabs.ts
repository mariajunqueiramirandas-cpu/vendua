import type { PageTab } from '@/components/Page.tsx';
import { useSiteTasksBadge } from '@/lib/queries.ts';

export const STORES_TABS: PageTab[] = [
  { to: '/lojas', label: 'Lojas', end: true },
  { to: '/lojas/sites', label: 'Sites' },
  { to: '/lojas/planos', label: 'Planos' },
  { to: '/lojas/incidentes', label: 'Incidentes' },
  { to: '/lojas/frota', label: 'Frota' },
];

/** The Lojas tabs, with the site tasks waiting on a person counted on "Sites". */
export function useStoresTabs(): PageTab[] {
  const sites = useSiteTasksBadge();
  return STORES_TABS.map((t) => (t.to === '/lojas/sites' ? { ...t, count: sites } : t));
}
