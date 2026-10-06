import { Faders, MagnifyingGlass, X } from '@phosphor-icons/react';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type PayMethod } from '../../lib/api.ts';
import { isoDate } from '../../lib/format.ts';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState } from '../../ui/feedback.tsx';
import { Chips, Field, TextInput } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { PageBody, PageHeader } from '../../ui/Page.tsx';
import { METHOD_LABEL } from '../../ui/PaymentChip.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { RowsSkeleton } from '../../ui/skeletons.tsx';
import { OrderRowView } from './OrderRowView.tsx';

type Period = 'hoje' | '7d' | '30d' | 'tudo';
type St = '' | 'active' | 'delivered' | 'cancelled';
type Mode = '' | 'delivery' | 'pickup' | 'scheduled';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'hoje', label: 'hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'tudo', label: 'tudo' },
];
const STATES: { value: Exclude<St, ''>; label: string }[] = [
  { value: 'active', label: 'em andamento' },
  { value: 'delivered', label: 'entregues' },
  { value: 'cancelled', label: 'cancelados' },
];
const MODES: { value: Exclude<Mode, ''>; label: string }[] = [
  { value: 'delivery', label: 'entrega' },
  { value: 'pickup', label: 'retirada' },
  { value: 'scheduled', label: 'encomenda' },
];
const METHODS: PayMethod[] = ['pix', 'card_online', 'card_on_delivery', 'cash', 'meal_voucher'];
const METHOD_SHORT: Record<PayMethod, string> = {
  ...METHOD_LABEL,
  card_online: 'Cartão pelo site',
};

const oneOf = <T extends string>(v: string | null, list: readonly { value: T }[] | readonly T[]) =>
  (list as readonly (T | { value: T })[])
    .map((x) => (typeof x === 'string' ? x : x.value))
    .find((x) => x === v);

/**
 * Every filter lives in the address (`?periodo=30d&pagamento=pix&entrega=retirada…`): opening an
 * order and coming back, or a refresh, finds the list as it was.
 */
function useFilters() {
  const [sp, setSp] = useSearchParams();
  const f = {
    q: sp.get('q') ?? '',
    period: oneOf(sp.get('periodo'), PERIODS) ?? '7d',
    state: (oneOf(sp.get('situacao'), STATES) ?? '') as St,
    method: (oneOf(sp.get('pagamento'), METHODS) ?? '') as PayMethod | '',
    mode: (oneOf(sp.get('entrega'), MODES) ?? '') as Mode,
    unpaid: sp.get('naopagos') === '1',
  };
  const set = (patch: Partial<typeof f>) => {
    const n = { ...f, ...patch };
    const next = new URLSearchParams();
    if (n.q) next.set('q', n.q);
    if (n.period !== '7d') next.set('periodo', n.period);
    if (n.state) next.set('situacao', n.state);
    if (n.method) next.set('pagamento', n.method);
    if (n.mode) next.set('entrega', n.mode);
    if (n.unpaid) next.set('naopagos', '1');
    // the same entry: "back" leaves the list instead of stepping through filters
    setSp(next, { replace: true });
  };
  return [f, set] as const;
}

export default function History() {
  const [f, setF] = useFilters();
  const [q, setQ] = useState(f.q);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => q.trim() !== f.q && setF({ q: q.trim() }), 250);
    return () => clearTimeout(t);
    // only typing writes the address; setF reads the rest from it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  const from =
    f.period === 'tudo'
      ? undefined
      : isoDate(
          new Date(
            Date.now() - (f.period === 'hoje' ? 0 : f.period === '7d' ? 6 : 29) * 86_400_000,
          ),
        );
  const params = {
    q: f.q,
    state: f.state,
    from,
    method: f.method || undefined,
    mode: f.mode || undefined,
    unpaid: f.unpaid ? ('1' as const) : undefined,
  };
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

  // what's narrowing the list beyond the period, each removable in one tap
  const active: { key: string; label: string; clear: () => void }[] = [
    ...(f.state
      ? [
          {
            key: 'state',
            label: STATES.find((s) => s.value === f.state)!.label,
            clear: () => setF({ state: '' }),
          },
        ]
      : []),
    ...(f.method
      ? [{ key: 'method', label: METHOD_SHORT[f.method], clear: () => setF({ method: '' }) }]
      : []),
    ...(f.mode
      ? [
          {
            key: 'mode',
            label: MODES.find((m) => m.value === f.mode)!.label,
            clear: () => setF({ mode: '' }),
          },
        ]
      : []),
    ...(f.unpaid
      ? [{ key: 'unpaid', label: 'não pagos', clear: () => setF({ unpaid: false }) }]
      : []),
  ];

  return (
    <PageBody>
      <PageHeader title="Histórico de pedidos" back="/pedidos" />
      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              type="search"
              aria-label="buscar pedido"
              placeholder="Nº, nome ou telefone"
              lead={<MagnifyingGlass className="size-5" />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button
            variant="secondary"
            icon={<Faders />}
            aria-haspopup="dialog"
            onClick={() => setSheet(true)}
            className="shrink-0"
          >
            filtros
            {active.length ? (
              <span className="tnum grid min-w-6 place-items-center rounded-full bg-primary px-1.5 text-xs text-on-primary">
                {active.length}
              </span>
            ) : null}
          </Button>
        </div>
        <div className="scroll-row -mx-4 px-4">
          <div className="flex w-max items-center gap-2">
            <Chips
              label="período"
              value={f.period}
              onChange={(v) => setF({ period: v })}
              className="flex-nowrap"
              options={PERIODS}
            />
            {active.length ? <span aria-hidden className="mx-1 h-6 w-px bg-line" /> : null}
            {active.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={a.clear}
                aria-label={`tirar o filtro ${a.label}`}
                className="press t-label inline-flex min-h-12 items-center gap-1.5 rounded-full bg-primary pl-4 pr-3 text-on-primary"
              >
                {a.label} <X weight="bold" className="size-4" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      </div>
      {list.error ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : list.isPending ? (
        <RowsSkeleton rows={7} avatar={false} />
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
          title={f.q ? `Nenhum pedido com "${f.q}"` : 'Nenhum pedido com esses filtros'}
          body="Tente outro período ou tire os filtros."
          {...(active.length
            ? {
                action: (
                  <Button
                    variant="secondary"
                    onClick={() => setF({ state: '', method: '', mode: '', unpaid: false })}
                  >
                    tirar os filtros
                  </Button>
                ),
              }
            : {})}
        />
      )}

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Filtrar pedidos"
        footer={
          <Button size="lg" block onClick={() => setSheet(false)}>
            ver pedidos
          </Button>
        }
      >
        <div className="space-y-6 pt-2">
          <Field label="Situação">
            <Chips
              label="situação"
              value={f.state}
              onChange={(v) => setF({ state: v === f.state ? '' : v })}
              options={STATES}
            />
          </Field>
          <Field label="Pagamento">
            <div className="space-y-3">
              <Chips
                label="forma de pagamento"
                value={f.method}
                onChange={(v) => setF({ method: v === f.method ? '' : v })}
                options={METHODS.map((m) => ({ value: m, label: METHOD_SHORT[m] }))}
              />
              <Chips
                label="pagamento pendente"
                multi
                value={f.unpaid ? ['unpaid'] : []}
                onChange={() => setF({ unpaid: !f.unpaid })}
                options={[{ value: 'unpaid', label: 'só os não pagos' }]}
              />
            </div>
          </Field>
          <Field label="Entrega">
            <Chips
              label="entrega"
              value={f.mode}
              onChange={(v) => setF({ mode: v === f.mode ? '' : v })}
              options={MODES}
            />
          </Field>
        </div>
      </Sheet>
    </PageBody>
  );
}
