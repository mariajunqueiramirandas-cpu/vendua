import { useQuery } from '@tanstack/react-query';
import { withBadges } from '../../app/tabs.ts';
import { api } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { PageTabs } from '../../ui/Tabs.tsx';

/** Pedidos' views: the board, the encomendas calendar (with how many are coming) and the past. */
export function OrdersTabs() {
  // the board knows how many encomendas are ahead; the other views read its cache
  const { data } = useQuery({ queryKey: qk.board, queryFn: api.board });
  return (
    <PageTabs
      tabs={withBadges('pedidos', { '/pedidos/agendados': data?.scheduledUpcoming })}
      label="Pedidos"
    />
  );
}
