import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, type Board } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { ErrorState } from '../../ui/feedback.tsx';
import { DetailSkeleton } from '../../ui/skeletons.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { useStoreQuery } from '../store/StatusPill.tsx';
import { OrderDetail } from './OrderDetail.tsx';

export default function OrderPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: qk.order(id),
    queryFn: () => api.order(id),
    // the board already has this order: show it at once, the customer card fills in after
    placeholderData: () => {
      const order = qc.getQueryData<Board>(qk.board)?.orders.find((o) => o.id === id);
      return order ? { order, customer: null } : undefined;
    },
  });
  const prep = useStoreQuery().data?.operations.prepTimeMinutes ?? 30;
  return (
    <PageBody>
      <PageHeader title="Pedido" back="/pedidos" />
      {data ? (
        <OrderDetail order={data.order} customer={data.customer} prepDefault={prep} />
      ) : error ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : (
        <DetailSkeleton />
      )}
    </PageBody>
  );
}
