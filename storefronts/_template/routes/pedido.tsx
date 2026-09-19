import { Link, useParams } from 'react-router-dom';
import { formatCents, useOrder, useStore } from '@vendua/kernel';

/**
 * Pedido — confirmation + live state. `useOrder(id)` rides the checkout-time
 * token the Kernel keeps per order, so refetch stays authorized after the
 * session rotates onto a fresh cart.
 */

const STATE_LABEL: Record<string, string> = {
  placed: 'Recebido',
  confirmed: 'Confirmado',
  preparing: 'Em preparo',
  ready: 'Pronto',
  out_for_delivery: 'A caminho',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  refunded: 'Estornado',
};

const PAYMENT_LABEL: Record<string, string> = {
  pix: 'Pix',
  card_on_delivery: 'Cartão na entrega/retirada',
  cash: 'Dinheiro',
};

export function OrderPage() {
  const { id = '' } = useParams();
  const { order, loading, error, refetch } = useOrder(id);
  const { store } = useStore();

  if (loading && !order) {
    return (
      <main className="container page page--narrow" aria-busy="true" aria-label="Carregando pedido">
        <p className="sk-line" />
        <p className="sk-line" />
      </main>
    );
  }

  if (!order) {
    return (
      <main className="container page">
        <div className="empty" role={error ? 'alert' : undefined}>
          <h1>{error ? 'Não foi possível carregar o pedido.' : 'Pedido não encontrado.'}</h1>
          {error ? (
            <button type="button" className="btn" onClick={() => refetch()}>
              Tentar novamente
            </button>
          ) : (
            <Link to="/" className="btn">
              Voltar ao cardápio
            </Link>
          )}
        </div>
      </main>
    );
  }

  const eta =
    order.delivery.etaMin != null && order.delivery.etaMax != null
      ? `${order.delivery.etaMin}–${order.delivery.etaMax} min`
      : null;

  return (
    <main className="container page page--narrow">
      <header className="page-head">
        <p className="muted">Pedido #{order.number}</p>
        <h1>Obrigado, {order.customer.name.trim().split(/\s+/)[0]}.</h1>
        <p className="flag" role="status" aria-live="polite">
          {STATE_LABEL[order.state] ?? order.state}
        </p>
        {eta ? <p className="muted">Previsão: {eta}</p> : null}
        <button type="button" className="btn-ghost" onClick={() => refetch()}>
          Atualizar
        </button>
      </header>

      {order.payment.method === 'pix' && order.payment.instructions ? (
        <section className="summary">
          <h2>Pague com Pix</h2>
          <p>{order.payment.instructions}</p>
        </section>
      ) : null}

      <section className="summary">
        <h2>Resumo</h2>
        <div className="summary-row">
          <span>Recebimento</span>
          <span>
            {order.delivery.mode === 'delivery' ? 'Entrega' : 'Retirada'}
            {order.delivery.neighborhood ? ` · ${order.delivery.neighborhood}` : ''}
          </span>
        </div>
        {typeof order.delivery.address === 'string' && order.delivery.address ? (
          <div className="summary-row">
            <span>Endereço</span>
            <span>{order.delivery.address}</span>
          </div>
        ) : null}
        <div className="summary-row">
          <span>Pagamento</span>
          <span>
            {PAYMENT_LABEL[order.payment.method] ?? order.payment.method}
            {order.payment.status === 'paid' ? ' · pago' : ''}
          </span>
        </div>
        <div className="summary-row">
          <span>Subtotal</span>
          <span>{formatCents(order.subtotalCents, store?.currency)}</span>
        </div>
        {order.deliveryFeeCents > 0 ? (
          <div className="summary-row">
            <span>Entrega</span>
            <span>{formatCents(order.deliveryFeeCents, store?.currency)}</span>
          </div>
        ) : null}
        <div className="summary-row summary-total">
          <span>Total</span>
          <span>{formatCents(order.totalCents, store?.currency)}</span>
        </div>
      </section>

      {order.timeline.length > 0 ? (
        <section className="summary">
          <h2>Acompanhamento</h2>
          <ol className="timeline">
            {order.timeline.map((ev, i) => (
              <li key={i}>
                <span>{STATE_LABEL[ev.to] ?? ev.to}</span>
                <time dateTime={ev.at} className="muted">
                  {new Intl.DateTimeFormat('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(ev.at))}
                </time>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <p>
        <Link to="/" className="back-link">
          ← Voltar ao cardápio
        </Link>
      </p>
    </main>
  );
}
