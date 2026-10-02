import {
  CalendarBlank,
  ClockCounterClockwise,
  CookingPot,
  ShareNetwork,
  SunDim,
  X,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { orderPath } from '@vendua/kernel/rules';
import { api, type Board, type Order, type OrderState } from '../../lib/api.ts';
import { markOrdersSeen, usePollWhenOffline } from '../../lib/live.ts';
import { useWakeLock, wakeLockSupported } from '../../lib/wakeLock.ts';
import { qk } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, Hint } from '../../ui/feedback.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { Mascote } from '../../ui/Mascote.tsx';
import { OrderCard } from '../../ui/OrderCard.tsx';
import { HelpButton } from '../../ui/Page.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { nextStep } from '../../ui/StateChip.tsx';
import { useStoreQuery } from '../store/StatusPill.tsx';
import { orderWhatsappUrl, usePrintOrder, useTransition } from './actions.ts';
import { CancelSheet, OrderDetail } from './OrderDetail.tsx';
import { usePreload } from '../../app/routes.ts';

type LaneId = 'novos' | 'preparo' | 'prontos' | 'concluidos';

const LANES: {
  id: LaneId;
  label: string;
  short?: string;
  states: OrderState[];
  drop?: OrderState;
}[] = [
  { id: 'novos', label: 'Novos', states: ['placed'] },
  {
    id: 'preparo',
    label: 'Em preparo',
    short: 'Preparo',
    states: ['confirmed', 'preparing'],
    drop: 'confirmed',
  },
  { id: 'prontos', label: 'Prontos', states: ['ready', 'out_for_delivery'], drop: 'ready' },
  {
    id: 'concluidos',
    label: 'Concluídos',
    states: ['delivered', 'cancelled', 'refunded'],
    drop: 'delivered',
  },
];

function useNow(ms = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Orders() {
  const poll = usePollWhenOffline(30_000, 5 * 60_000);
  const { data, error, refetch, isPending } = useQuery({
    queryKey: qk.board,
    queryFn: api.board,
    refetchInterval: poll,
  });
  const store = useStoreQuery().data;
  const s = useSession();
  const printing = usePrintOrder(s.store.name);
  const nav = useNavigate();
  const now = useNow();
  const preload = usePreload();
  const move = useTransition();
  const awake = useWakeLock();
  const [lane, setLane] = useState<LaneId>('novos');
  const [selected, setSelected] = useState<string | null>(null);
  const [more, setMore] = useState<Order | null>(null);
  const [cancel, setCancel] = useState<Order | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const prepDefault = store?.operations.prepTimeMinutes ?? 30;

  const orders = data?.orders ?? [];
  const byLane = useMemo(() => {
    const out = Object.fromEntries(LANES.map((l) => [l.id, [] as Order[]])) as Record<
      LaneId,
      Order[]
    >;
    for (const o of orders) {
      const l = LANES.find((x) => x.states.includes(o.state));
      if (l) out[l.id].push(o);
    }
    out.concluidos.reverse();
    return out;
  }, [orders]);

  // arrivals: ids we hadn't seen since the board mounted get the drop-in
  const arriving = useMemo(() => {
    if (!data) return new Set<string>();
    if (!known.current) {
      known.current = new Set(orders.map((o) => o.id));
      return new Set<string>();
    }
    const fresh = new Set(orders.filter((o) => !known.current!.has(o.id)).map((o) => o.id));
    for (const id of fresh) known.current.add(id);
    return fresh;
  }, [data, orders]);

  // on screen = seen: the chime stops repeating
  useEffect(() => {
    if (document.visibilityState === 'visible') markOrdersSeen();
  }, [data]);
  // Novos is the default lane whenever anything waits (§8 Pedidos)
  useEffect(() => {
    if (byLane.novos.length && lane !== 'novos' && arriving.size) setLane('novos');
  }, [arriving, byLane.novos.length, lane]);

  const advance = (o: Order, prepMinutes?: number) => {
    const n = nextStep(o.state, o.delivery.mode);
    if (n)
      move.mutate({
        order: o,
        to: n.to,
        ...(prepMinutes ? { prepMinutes } : {}),
        idem: `adv-${o.id}-${n.to}`,
      });
  };
  const dropOn = async (l: (typeof LANES)[number], id: string) => {
    const o = orders.find((x) => x.id === id);
    if (!o || !l.drop || l.states.includes(o.state)) return;
    // walk the order's own path to the lane (a transition skips none; pickup never "sai")
    const path = orderPath(o.delivery.mode) as OrderState[];
    const i = path.indexOf(o.state);
    const j = path.indexOf(l.drop);
    if (i < 0 || j <= i) return;
    let cur: Order = o;
    for (const to of path.slice(i + 1, j + 1)) {
      const r = await move.mutateAsync({
        order: cur,
        to,
        ...(to === 'confirmed' ? { prepMinutes: prepDefault } : {}),
        idem: `drag-${o.id}-${to}`,
      });
      cur = r.order;
    }
  };

  const open = (o: Order) => {
    if (window.matchMedia('(min-width: 1200px)').matches) setSelected(o.id);
    else nav(`/pedidos/${o.id}`);
  };
  const card = (o: Order, compact?: boolean) => (
    <OrderCard
      key={o.id}
      order={o}
      now={now}
      acceptTarget={data?.acceptTargetMinutes ?? 5}
      prepDefault={prepDefault}
      arriving={arriving.has(o.id)}
      selected={selected === o.id}
      compact={compact}
      onAdvance={advance}
      onMore={setMore}
      onOpen={open}
    />
  );

  const counts = Object.fromEntries(LANES.map((l) => [l.id, byLane[l.id].length])) as Record<
    LaneId,
    number
  >;
  const empty = (id: LaneId) =>
    id === 'novos' ? (
      <EmptyState
        art={<Mascote pose="sem-pedidos" />}
        title="Nenhum pedido novo agora"
        body="Quando chegar, você ouve o sino e ele aparece aqui."
        action={
          <Button
            variant="secondary"
            icon={<ShareNetwork />}
            onClick={() => nav('/marketing#compartilhar')}
          >
            divulgar a loja
          </Button>
        }
      />
    ) : id === 'concluidos' ? (
      <EmptyState art={<Mascote pose="sucesso" />} title="Nada concluído hoje ainda" />
    ) : (
      <p className="t-body px-2 py-8 text-center text-muted">Nada aqui agora.</p>
    );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-4 md:px-8 md:pb-10 md:pt-8">
      <header className="mb-4 flex items-center gap-2 md:mb-6 md:gap-3">
        <h1 className="t-title-1 flex-1">Pedidos</h1>
        {wakeLockSupported() ? (
          <button
            type="button"
            aria-pressed={awake.on}
            onClick={awake.toggle}
            title={awake.on ? 'A tela fica ligada nesta página' : 'Manter a tela ligada'}
            className={cn(
              'press t-label inline-flex min-h-11 items-center gap-2 rounded-md px-3 ring-1',
              awake.on ? 'bg-spark-soft ring-spark' : 'ring-line hover:bg-hover',
            )}
          >
            <SunDim weight={awake.held ? 'fill' : 'regular'} className="size-5" aria-hidden />
            <span className="hidden sm:inline">Tela ligada</span>
            <span className="sr-only sm:hidden">manter a tela ligada</span>
          </button>
        ) : null}
        <Link
          to="/cozinha"
          {...preload('/cozinha')}
          aria-label="Cozinha"
          className="press t-label inline-flex min-h-11 items-center gap-2 rounded-md px-3 ring-1 ring-line hover:bg-hover max-sm:hidden"
        >
          <CookingPot className="size-5" /> Cozinha
        </Link>
        <Link
          to="/pedidos/agendados"
          {...preload('/pedidos/agendados')}
          aria-label="Encomendas"
          className="press t-label inline-flex min-h-11 items-center gap-2 rounded-md px-3 ring-1 ring-line hover:bg-hover"
        >
          <CalendarBlank className="size-5" /> <span className="hidden sm:inline">Encomendas</span>
          {data?.scheduledUpcoming ? (
            <span className="tnum rounded-full bg-info-soft px-2 text-info">
              {data.scheduledUpcoming}
            </span>
          ) : null}
        </Link>
        <Link
          to="/pedidos/historico"
          {...preload('/pedidos/historico')}
          aria-label="Histórico"
          className="press t-label inline-flex min-h-11 items-center gap-2 rounded-md px-3 ring-1 ring-line hover:bg-hover"
        >
          <ClockCounterClockwise className="size-5" />{' '}
          <span className="hidden sm:inline">Histórico</span>
        </Link>
        <HelpButton className="-mr-2 md:mr-0" />
      </header>

      <Hint id="orders-swipe" className="mb-4 md:hidden">
        Arraste um pedido para a direita para avançar, ou para a esquerda para ver mais opções.
      </Hint>

      {error && !data ? (
        <ErrorState error={error} retry={() => void refetch()} />
      ) : (
        <>
          {/* phones: one lane at a time */}
          <div className="lg:hidden">
            <Segmented
              label="etapa"
              value={lane}
              onChange={setLane}
              className="sticky top-[72px] z-20 mb-4 md:top-2"
              options={LANES.map((l) => ({
                value: l.id,
                // phones: four lanes share 375px, so every label must fit one line
                label: l.short ? (
                  <>
                    <span className="sm:hidden">{l.short}</span>
                    <span className="max-sm:hidden">{l.label}</span>
                  </>
                ) : (
                  l.label
                ),
                count: counts[l.id],
              }))}
            />
            {isPending ? (
              <SkeletonGroup className="grid gap-3 md:grid-cols-2">
                <OrderCardSkeleton />
                <OrderCardSkeleton />
              </SkeletonGroup>
            ) : byLane[lane].length ? (
              <div className="grid gap-3 md:grid-cols-2">{byLane[lane].map((o) => card(o))}</div>
            ) : (
              empty(lane)
            )}
          </div>

          {/* desktop: the board, drag between lanes, detail on the right */}
          <div className="hidden gap-5 lg:flex">
            <div
              className={cn('grid min-w-0 flex-1 gap-4', selected ? 'grid-cols-3' : 'grid-cols-4')}
            >
              {LANES.filter((l) => !selected || l.id !== 'concluidos').map((l) => (
                <section
                  key={l.id}
                  aria-label={`${l.label}: ${counts[l.id]}`}
                  onDragOver={(e) => l.drop && e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData('text/plain');
                    setDragging(null);
                    void dropOn(l, id);
                  }}
                  className={cn(
                    'flex min-h-[60vh] flex-col rounded-lg bg-sunken/60 p-3 transition-colors',
                    dragging && l.drop && 'ring-2 ring-dashed ring-line-strong',
                  )}
                >
                  <h2 className="t-label mb-3 flex items-center justify-between px-1">
                    {l.label}
                    <span
                      className={cn(
                        'tnum rounded-full px-2',
                        l.id === 'novos' && counts.novos
                          ? 'bg-spark text-on-spark'
                          : 'bg-line text-muted',
                      )}
                    >
                      {counts[l.id]}
                    </span>
                  </h2>
                  <div className="flex-1 space-y-3">
                    {isPending ? (
                      <OrderCardSkeleton />
                    ) : byLane[l.id].length ? (
                      byLane[l.id].map((o) => (
                        <div
                          key={o.id}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', o.id);
                            setDragging(o.id);
                          }}
                          onDragEnd={() => setDragging(null)}
                        >
                          {card(o, l.id === 'concluidos')}
                        </div>
                      ))
                    ) : (
                      empty(l.id)
                    )}
                  </div>
                </section>
              ))}
            </div>
            {selected ? (
              <Panel id={selected} prepDefault={prepDefault} onClose={() => setSelected(null)} />
            ) : null}
          </div>
        </>
      )}

      <Sheet
        open={!!more}
        onOpenChange={(v) => !v && setMore(null)}
        title={more ? `Pedido #${more.number}` : ''}
      >
        {more ? (
          <div className="grid gap-2 pt-1">
            <Button variant="secondary" size="lg" block onClick={() => nav(`/pedidos/${more.id}`)}>
              ver detalhes
            </Button>
            <a
              href={orderWhatsappUrl(more, s.store.name)}
              target="_blank"
              rel="noreferrer"
              className="press t-label flex min-h-14 items-center justify-center rounded-lg bg-whatsapp text-on-whatsapp"
            >
              chamar no WhatsApp
            </a>
            <Button
              variant="secondary"
              size="lg"
              block
              loading={printing.pending}
              onClick={() => printing.print(more)}
            >
              imprimir comanda
            </Button>
            {!['delivered', 'cancelled', 'refunded'].includes(more.state) ? (
              <Button
                variant="ghost"
                size="lg"
                block
                className="text-danger!"
                onClick={() => {
                  setCancel(more);
                  setMore(null);
                }}
              >
                cancelar pedido
              </Button>
            ) : null}
          </div>
        ) : null}
      </Sheet>
      {cancel ? (
        <CancelSheet order={cancel} open onOpenChange={(v) => !v && setCancel(null)} />
      ) : null}
    </div>
  );
}

function Panel({
  id,
  prepDefault,
  onClose,
}: {
  id: string;
  prepDefault: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data, error, refetch } = useQuery({
    queryKey: qk.order(id),
    queryFn: () => api.order(id),
    placeholderData: () => {
      const order = qc.getQueryData<Board>(qk.board)?.orders.find((o) => o.id === id);
      return order ? { order, customer: null } : undefined;
    },
  });
  return (
    <aside
      aria-label="detalhe do pedido"
      className="animate-panel-in sticky top-6 flex max-h-[calc(100dvh-48px)] w-[440px] shrink-0 flex-col rounded-lg bg-surface depth-2"
    >
      <div className="flex justify-end p-2">
        <IconButton label="fechar detalhe" size="sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-0">
        {data ? (
          <OrderDetail
            order={data.order}
            customer={data.customer}
            payments={data.payments}
            prepDefault={prepDefault}
            inPanel
          />
        ) : error ? (
          <ErrorState error={error} retry={() => void refetch()} />
        ) : (
          <DetailSkeleton />
        )}
      </div>
    </aside>
  );
}
import { DetailSkeleton, OrderCardSkeleton, SkeletonGroup } from '../../ui/skeletons.tsx';
