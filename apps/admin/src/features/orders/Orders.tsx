import { CalendarBlank, ClockCounterClockwise, ShareNetwork, X } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Order, type OrderState } from '../../lib/api.ts';
import { markOrdersSeen } from '../../lib/live.ts';
import { qk } from '../../lib/query.ts';
import { useSession } from '../../lib/session.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { cn } from '../../ui/cn.ts';
import { EmptyState, ErrorState, Hint, Skeleton } from '../../ui/feedback.tsx';
import { Segmented } from '../../ui/fields.tsx';
import { ArtBell, ArtSparkle } from '../../ui/illustrations.tsx';
import { OrderCard } from '../../ui/OrderCard.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { nextStep } from '../../ui/StateChip.tsx';
import { useStoreQuery } from '../store/StatusPill.tsx';
import { printTicket, useTransition, whatsappUrl } from './actions.ts';
import { CancelSheet, OrderDetail } from './OrderDetail.tsx';

type LaneId = 'novos' | 'preparo' | 'prontos' | 'concluidos';

const LANES: { id: LaneId; label: string; states: OrderState[]; drop?: OrderState }[] = [
  { id: 'novos', label: 'Novos', states: ['placed'] },
  { id: 'preparo', label: 'Em preparo', states: ['confirmed', 'preparing'], drop: 'confirmed' },
  { id: 'prontos', label: 'Prontos', states: ['ready', 'out_for_delivery'], drop: 'ready' },
  {
    id: 'concluidos',
    label: 'Concluídos',
    states: ['delivered', 'cancelled', 'refunded'],
    drop: 'delivered',
  },
];

// the path an order walks to reach a lane it was dropped on
const PATH: OrderState[] = ['placed', 'confirmed', 'preparing', 'ready'];

function useNow(ms = 15_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Orders() {
  const { data, error, refetch, isPending } = useQuery({
    queryKey: qk.board,
    queryFn: api.board,
    refetchInterval: 30_000,
  });
  const store = useStoreQuery().data;
  const s = useSession();
  const nav = useNavigate();
  const now = useNow();
  const move = useTransition();
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
    // walk the states in order (a transition skips none): novo → aceito → preparando → pronto → entregue
    const target = l.drop;
    let cur: Order = o;
    const steps: OrderState[] = [];
    if (target === 'delivered') {
      const i = PATH.indexOf(cur.state);
      steps.push(...(i >= 0 ? PATH.slice(i + 1) : []));
      if (cur.state !== 'out_for_delivery' && o.delivery.mode === 'delivery')
        steps.push('out_for_delivery');
      steps.push('delivered');
    } else {
      const i = PATH.indexOf(cur.state);
      const j = PATH.indexOf(target);
      if (i < 0 || j <= i) return;
      steps.push(...PATH.slice(i + 1, j + 1));
    }
    for (const to of steps) {
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
        art={<ArtBell />}
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
      <EmptyState art={<ArtSparkle />} title="Nada concluído hoje ainda" />
    ) : (
      <p className="t-body px-2 py-8 text-center text-muted">Nada aqui agora.</p>
    );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-32 pt-4 md:px-8 md:pb-10 md:pt-8">
      <header className="mb-4 flex items-center gap-2 md:mb-6 md:gap-3">
        <h1 className="t-title-1 flex-1">Pedidos</h1>
        <Link
          to="/pedidos/agendados"
          aria-label="Encomendas"
          className="t-label inline-flex min-h-11 items-center gap-2 rounded-md px-3 ring-1 ring-line hover:bg-hover"
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
          aria-label="Histórico"
          className="t-label inline-flex min-h-11 items-center gap-2 rounded-md px-3 ring-1 ring-line hover:bg-hover"
        >
          <ClockCounterClockwise className="size-5" />{' '}
          <span className="hidden sm:inline">Histórico</span>
        </Link>
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
              options={LANES.map((l) => ({ value: l.id, label: l.label, count: counts[l.id] }))}
            />
            {isPending ? (
              <div className="space-y-3">
                <Skeleton className="h-56" />
                <Skeleton className="h-56" />
              </div>
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
                      <Skeleton className="h-48" />
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
              href={whatsappUrl(more, s.store.name)}
              target="_blank"
              rel="noreferrer"
              className="t-label flex min-h-14 items-center justify-center rounded-lg bg-[#1f7a4d] text-white"
            >
              chamar no WhatsApp
            </a>
            <Button
              variant="secondary"
              size="lg"
              block
              onClick={() => printTicket(more, s.store.name)}
            >
              imprimir comanda
            </Button>
            {!['delivered', 'cancelled', 'refunded'].includes(more.state) ? (
              <Button
                variant="ghost"
                size="lg"
                block
                className="text-danger"
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
  const { data, error, refetch } = useQuery({
    queryKey: qk.order(id),
    queryFn: () => api.order(id),
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
            prepDefault={prepDefault}
            inPanel
          />
        ) : error ? (
          <ErrorState error={error} retry={() => void refetch()} />
        ) : (
          <Skeleton className="h-96" delay={0} />
        )}
      </div>
    </aside>
  );
}
