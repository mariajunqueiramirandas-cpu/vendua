import { MagnifyingGlass } from '@phosphor-icons/react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { ago, money, num, phone } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { EmptyState, ErrorState, Loading } from '../../ui/feedback.tsx';
import { Chips, TextInput } from '../../ui/fields.tsx';
import { ArtPeople } from '../../ui/illustrations.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';

type Sort = 'recent' | 'value' | 'orders';

export default function Customers() {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  const list = useInfiniteQuery({
    queryKey: ['customers', { q: debounced, sort }],
    queryFn: ({ pageParam }) => api.customers({ q: debounced, sort, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (p) => p.next ?? undefined,
  });
  const stats = list.data?.pages[0]?.stats;
  const rows = list.data?.pages.flatMap((p) => p.customers) ?? [];
  const repeatRate =
    stats && stats.customers ? Math.round((stats.repeat / stats.customers) * 100) : 0;
  return (
    <PageBody>
      <PageHeader title="Clientes" subtitle="Todo mundo que já pediu, pelo telefone." />
      {stats ? (
        <div className="mb-5 grid grid-cols-3 gap-3">
          <Card className="p-4">
            <p className="tnum font-display text-2xl font-semibold">{num(stats.customers)}</p>
            <p className="t-caption text-muted">clientes</p>
          </Card>
          <Card className="p-4">
            <p className="tnum font-display text-2xl font-semibold">{repeatRate}%</p>
            <p className="t-caption text-muted">voltaram a pedir</p>
          </Card>
          <Card className="p-4">
            <p className="tnum font-display text-2xl font-semibold">{num(stats.newThisMonth)}</p>
            <p className="t-caption text-muted">novos em 30 dias</p>
          </Card>
        </div>
      ) : null}
      <div className="mb-4 space-y-3">
        <TextInput
          type="search"
          aria-label="buscar cliente"
          placeholder="Nome ou telefone"
          lead={<MagnifyingGlass className="size-5" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Chips
          label="ordenar por"
          value={sort}
          onChange={setSort}
          options={[
            { value: 'recent', label: 'mais recentes' },
            { value: 'value', label: 'quem mais gastou' },
            { value: 'orders', label: 'mais pedidos' },
          ]}
        />
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : list.isPending ? (
        <Loading />
      ) : rows.length ? (
        <>
          <Card className="divide-y divide-line overflow-hidden">
            {rows.map((c) => (
              <Link
                key={c.phone}
                to={`/clientes/${c.phone}`}
                className="flex min-h-18 items-center gap-3 px-4 py-3 hover:bg-hover"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sunken font-display font-semibold">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="t-caption block truncate text-muted">
                    {phone(c.phone)}
                    <span className="max-sm:hidden"> · último pedido {ago(c.lastAt)}</span>
                  </span>
                  <span className="t-caption block truncate text-muted sm:hidden">
                    último pedido {ago(c.lastAt)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tnum block font-semibold">{money(c.spentCents)}</span>
                  <span className="t-caption text-muted">
                    {c.orders} {c.orders === 1 ? 'pedido' : 'pedidos'}
                  </span>
                </span>
              </Link>
            ))}
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
          art={<ArtPeople />}
          title={debounced ? `Ninguém com "${debounced}"` : 'Seus clientes aparecem aqui'}
          body={
            debounced
              ? 'Tente parte do nome ou os últimos números do telefone.'
              : 'Cada pedido traz o nome e o WhatsApp de quem comprou.'
          }
        />
      )}
    </PageBody>
  );
}
