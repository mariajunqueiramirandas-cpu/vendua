import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { qk } from '../../lib/query.ts';
import { ErrorState, Skeleton } from '../../ui/feedback.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { useStoreQuery } from '../store/StatusPill.tsx';
import { OrderDetail } from './OrderDetail.tsx';

export default function OrderPage() {
  const { id = '' } = useParams();
  const { data, error, refetch } = useQuery({
    queryKey: qk.order(id),
    queryFn: () => api.order(id),
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
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
          <Skeleton className="h-40" />
        </div>
      )}
    </PageBody>
  );
}
