import { useQuery } from '@tanstack/react-query';
import { withBadges } from '../../app/tabs.ts';
import { api, type Product } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { PageTabs } from '../../ui/Tabs.tsx';

/** products to restock: counted down to zero, or under their low mark */
export const restockOf = (all: Product[]) =>
  all.filter(
    (p) =>
      p.status !== 'archived' && p.stockQuantity != null && (p.stockQuantity === 0 || p.lowStock),
  ).length;

/** Cardápio's views, with how many products need restocking beside Estoque. */
export function MenuTabs() {
  const { data } = useQuery({ queryKey: qk.catalog, queryFn: api.catalog });
  const restock = restockOf((data?.categories ?? []).flatMap((c) => c.products));
  return (
    <PageTabs tabs={withBadges('cardapio', { '/cardapio/estoque': restock })} label="Cardápio" />
  );
}
