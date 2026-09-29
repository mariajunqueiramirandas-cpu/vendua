import { MagnifyingGlass } from '@phosphor-icons/react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { isoDate } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, Loading } from '../../ui/feedback.tsx';
import { Chips, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { OrderRowView } from './OrderRowView.tsx';

type Period = 'hoje' | '7d' | '30d' | 'tudo';
type St = '' | 'active' | 'delivered' | 'cancelled';

export default function History() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [period, setPeriod] = useState<Period>('7d');
  const [state, setState] = useState<St>('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const from =
    period === 'tudo'
      ? undefined
      : isoDate(
          new Date(Date.now() - (period === 'hoje' ? 0 : period === '7d' ? 6 : 29) * 86_400_000),
        );
  const params = { q: debounced, state, from };
  const list = useInfiniteQuery({
    queryKey: ['orders', 'list', params],
    queryFn: ({ pageParam }) =>
      api.orders({ ...params, ...(pageParam ? { before: pageParam } : {}) }),
    initialPageParam: '' as string,
    getNextPageParam: (p) => p.next ?? undefined,
    // a new search or filter keeps the old rows up (dimmed) instead of flashing to a spinner
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.pages.flatMap((p) => p.orders) ?? [];
  return (
    <PageBody>
      <PageHeader title="Histórico de pedidos" back="/pedidos" />
      <div className="mb-4 space-y-3">
        <TextInput
          type="search"
          aria-label="buscar pedido"
          placeholder="Número, nome ou telefone"
          lead={<MagnifyingGlass className="size-5" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="scroll-row -mx-4 px-4">
          <div className="flex w-max gap-4">
            <Chips
              label="período"
              value={period}
              onChange={setPeriod}
              className="flex-nowrap"
              options={[
                { value: 'hoje', label: 'hoje' },
                { value: '7d', label: '7 dias' },
                { value: '30d', label: '30 dias' },
                { value: 'tudo', label: 'tudo' },
              ]}
            />
            <Chips
              label="situação"
              value={state}
              onChange={(v) => setState(v === state ? '' : v)}
              className="flex-nowrap"
              options={[
                { value: 'active', label: 'em andamento' },
                { value: 'delivered', label: 'entregues' },
                { value: 'cancelled', label: 'cancelados' },
              ]}
            />
          </div>
        </div>
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Loading />
      ) : rows.length ? (
        <>
          <Card
            as="section"
            aria-busy={list.isPlaceholderData}
            className={cn(
              'overflow-hidden transition-opacity',
              list.isPlaceholderData && 'opacity-60',
            )}
          >
            <ul>
              {rows.map((o) => (
                <OrderRowView key={o.id} o={o} />
              ))}
            </ul>
          </Card>
          {list.hasNextPage ? (
            <Button
              variant="secondary"
              block
              className="mt-4"
              loading={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              carregar mais
            </Button>
          ) : null}
        </>
      ) : (
        <EmptyState
          art={<Mascote pose="sem-resultados" />}
          title={debounced ? `Nenhum pedido com "${debounced}"` : 'Nenhum pedido nesse período'}
          body="Tente outro período ou tire os filtros."
        />
      )}
    </PageBody>
  );
}
