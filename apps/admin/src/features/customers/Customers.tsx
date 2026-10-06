import { MagnifyingGlass, Tag } from '@phosphor-icons/react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.ts';
import { ago, money, num, phone } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { Chips, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { usePreload } from '../../app/routes.ts';

const SORTS = ['recent', 'value', 'orders'] as const;
type Sort = (typeof SORTS)[number];
const ALL = '';

// a chip chosen from the address may sit past the row's edge: bring it into view once, sideways only
const revealChecked = (row: HTMLElement | null) => {
  const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
  if (!row || !chip) return;
  const r = row.getBoundingClientRect();
  const c = chip.getBoundingClientRect();
  if (c.left < r.left || c.right > r.right)
    row.scrollLeft += c.left - r.left - (r.width - c.width) / 2;
};

export default function Customers() {
  // search, order and tag live in the address: back from a customer lands on the same list
  const [params, setParams] = useSearchParams();
  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
        return next;
      },
      { replace: true },
    );
  const o = params.get('ordem');
  const sort: Sort = (SORTS as readonly string[]).includes(o ?? '') ? (o as Sort) : 'recent';
  const tag = params.get('etiqueta') ?? ALL;
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q.trim());
  const preload = usePreload();
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      update({ q: q.trim() || null });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const list = useInfiniteQuery({
    // no tag keeps the key the route warm-up uses (app/routes.ts)
    queryKey: ['customers', tag ? { q: debounced, sort, tag } : { q: debounced, sort }],
    queryFn: ({ pageParam }) =>
      api.customers({ q: debounced, sort, ...(tag ? { tag } : {}), offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (p) => p.next ?? undefined,
    // a new search or filter keeps the old rows up (dimmed) instead of flashing to a spinner
    placeholderData: keepPreviousData,
  });
  const first = list.data?.pages[0];
  const stats = first?.stats;
  const tags = first?.tags ?? [];
  const rows = list.data?.pages.flatMap((p) => p.customers) ?? [];
  const repeatRate =
    stats && stats.customers ? Math.round((stats.repeat / stats.customers) * 100) : 0;
  // the chosen tag stays a chip even when the list it came from no longer has it
  const tagOptions = [
    { value: ALL, label: 'todos' as ReactNode },
    ...(tag && !tags.some((t) => t.tag === tag) ? [{ value: tag, label: tagLabel(tag) }] : []),
    ...tags.map((t) => ({ value: t.tag, label: tagLabel(t.tag, t.customers) })),
  ];
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
          maxLength={80}
          onChange={(e) => setQ(e.target.value)}
        />
        <div ref={revealChecked} className="scroll-row -mx-4 px-4 md:mx-0 md:px-0">
          <Chips
            label="ordenar por"
            value={sort}
            onChange={(v) => update({ ordem: v === 'recent' ? null : v })}
            className="w-max flex-nowrap md:w-auto md:flex-wrap"
            options={[
              { value: 'recent', label: 'mais recentes' },
              { value: 'value', label: 'quem mais gastou' },
              { value: 'orders', label: 'mais pedidos' },
            ]}
          />
        </div>
        {tagOptions.length > 1 ? (
          <div ref={revealChecked} className="scroll-row -mx-4 px-4 md:mx-0 md:px-0">
            <Chips
              label="etiqueta"
              value={tag}
              onChange={(v) => update({ etiqueta: v === tag ? null : v })}
              className="w-max flex-nowrap md:w-auto md:flex-wrap"
              options={tagOptions}
            />
          </div>
        ) : null}
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : list.isPending ? (
        <RowsSkeleton rows={6} />
      ) : rows.length ? (
        <>
          <Card
            aria-busy={list.isPlaceholderData}
            className={cn(
              'divide-y divide-line overflow-hidden transition-opacity',
              list.isPlaceholderData && 'opacity-60',
            )}
          >
            {rows.map((c) => (
              <Link
                key={c.phone}
                to={`/clientes/${c.phone}`}
                {...preload(`/clientes/${c.phone}`)}
                data-vt-src={`customer:${c.phone}`}
                className="press-row flex min-h-18 items-center gap-3 px-4 py-3 hover:bg-hover"
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
                  {c.tags?.length ? <TagList tags={c.tags} /> : null}
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
          art={<Mascote pose="carinho" />}
          title={
            debounced
              ? `Ninguém com "${debounced}"`
              : tag
                ? `Ninguém com a etiqueta "${tag}"`
                : 'Seus clientes aparecem aqui'
          }
          body={
            debounced
              ? 'Tente parte do nome ou os últimos números do telefone.'
              : tag
                ? 'Coloque etiquetas na página de cada cliente para separar quem é quem.'
                : 'Cada pedido traz o nome e o WhatsApp de quem comprou.'
          }
          {...(tag && !debounced
            ? {
                action: (
                  <Button variant="secondary" onClick={() => update({ etiqueta: null })}>
                    ver todos os clientes
                  </Button>
                ),
              }
            : {})}
        />
      )}
    </PageBody>
  );
}

const tagLabel = (t: string, n?: number) => (
  <span className="inline-flex items-center gap-1.5">
    <Tag className="size-4" aria-hidden />
    {n === undefined ? t : `${t} · ${num(n)}`}
  </span>
);

/** a customer's tags on a row: the first three, then how many more */
function TagList({ tags }: { tags: string[] }) {
  const shown = tags.slice(0, 3);
  return (
    <span className="mt-1 flex min-w-0 flex-wrap gap-1">
      {shown.map((t) => (
        <span
          key={t}
          className="t-caption inline-flex max-w-40 items-center gap-1 truncate rounded-full bg-sunken px-2 py-0.5 text-ink"
        >
          <Tag className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{t}</span>
        </span>
      ))}
      {tags.length > 3 ? (
        <span className="t-caption rounded-full px-1 py-0.5 text-muted">+{tags.length - 3}</span>
      ) : null}
    </span>
  );
}
