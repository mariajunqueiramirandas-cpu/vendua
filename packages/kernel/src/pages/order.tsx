import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { money, ORDER_STATE_LABEL } from '@vendua/ui-defaults';
import { useOrder, useOrderHistory, useStore } from '../hooks.ts';
import { Slot } from '../slot.tsx';
import { KLink } from '../sdk/sections.tsx';
import { KERNEL_PATHS } from '../config.ts';

// /pedido/:id and /pedidos — Kernel pages. Order history is the first Kernel
// page that exists purely as platform surface (roadmap 1b-iii): every store gets
// it on its next rebuild, no store code involved.

const TERMINAL = new Set(['delivered', 'cancelled', 'refunded']);

export function OrderPage() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  const { order, loading, error, refetch } = useOrder(id);
  const { store } = useStore();
  const currency = store?.currency ?? 'BRL';
  const isNew = new URLSearchParams(search).has('novo');

  // storefront-driven polling (03 — useOrder semantics); stops once terminal
  useEffect(() => {
    if (!order || TERMINAL.has(order.state)) return;
    const t = setInterval(refetch, 20_000);
    return () => clearInterval(t);
  }, [order, refetch]);

  return (
    <main id="main" className="v-page" data-vendua-page="order">
      {loading && !order ? (
        <div className="v-panel" aria-busy="true" aria-label="Carregando pedido" />
      ) : !order ? (
        <Slot
          name="system.ErrorFallback"
          error={{
            code: error?.code ?? 'ORDER_NOT_FOUND',
            message:
              error?.code === 'ORDER_NOT_FOUND' || error?.status === 400
                ? 'Pedido não encontrado neste aparelho.'
                : 'O pedido não carregou.',
          }}
          retry={refetch}
        />
      ) : (
        <>
          {isNew ? <Slot name="checkout.SuccessPage" order={order} currency={currency} /> : null}
          <Slot
            name="order.StatusPage"
            order={order}
            currency={currency}
            timeline={<Slot name="order.Timeline" events={order.timeline} />}
          />
          <p style={{ marginTop: 24 }}>
            <KLink href={KERNEL_PATHS.orders} className="v-btn v-btn-ghost">
              Meus pedidos
            </KLink>
          </p>
        </>
      )}
    </main>
  );
}

export function OrderHistoryPage() {
  const { orders, loading } = useOrderHistory();
  const { store } = useStore();
  const currency = store?.currency ?? 'BRL';
  return (
    <main id="main" className="v-page" data-vendua-page="orders">
      <h1 className="v-page-title">Meus pedidos</h1>
      <p className="v-muted">Pedidos feitos neste aparelho.</p>
      {loading && orders.length === 0 ? (
        <div className="v-panel" aria-busy="true" aria-label="Carregando pedidos" />
      ) : orders.length === 0 ? (
        <div className="v-panel v-empty" data-part="empty">
          <p className="v-panel-title">Nenhum pedido por aqui ainda.</p>
          <KLink href="/" className="v-btn v-btn-accent">
            Fazer um pedido
          </KLink>
        </div>
      ) : (
        <ol className="v-order-list" data-part="list">
          {orders.map((o) => (
            <li key={o.id}>
              <KLink href={KERNEL_PATHS.order.replace(':id', o.id)} data-state={o.state}>
                <span>
                  <strong>Pedido #{o.number}</strong>{' '}
                  <span className="v-muted">
                    {new Date(o.placedAt).toLocaleDateString('pt-BR')}
                  </span>
                </span>
                <span>
                  {ORDER_STATE_LABEL[o.state] ?? o.state} ·{' '}
                  <span className="v-num">{money(o.totalCents, currency)}</span>
                </span>
              </KLink>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
