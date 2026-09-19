import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useKernel, useStore } from '@vendua/kernel';
import type { Order } from '@vendua/kernel';
import { cents } from './_ui';

const STATE_LABEL: Record<string, string> = {
  placed: 'na chapa',
  confirmed: 'confirmado',
  preparing: 'prensando',
  ready: 'pronto pra retirada',
  out_for_delivery: 'na rota',
  delivered: 'entregue',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

/**
 * Pedido — the dispatch receipt: giant order number like a called senha.
 * Order data arrives via router state from checkout; on a bare reload we ask
 * the Kernel client for it (currently 401 — no auth header on api.order;
 * see OBSERVATIONS.md — so we degrade to the "off the hook" state).
 */
export function Pedido() {
  const { id = '' } = useParams();
  const { state } = useLocation() as { state: { order?: Order } | null };
  const { api } = useKernel();
  const { store } = useStore();
  const [order, setOrder] = useState<Order | undefined>(state?.order);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'dead'>('idle');

  useEffect(() => {
    if (order || !id) return;
    setLookup('loading');
    api
      .order(id)
      .then(setOrder)
      .catch(() => setLookup('dead'));
  }, [api, id, order]);

  return (
    <main className="page">
      <header className="pagehead">
        <span className="code">DESPACHO · REGISTRO</span>
        <h1>Pedido</h1>
      </header>

      {order ? (
        <>
          <section className="order-hero">
            <div className="hazard" aria-hidden="true" />
            <span className="state-chip">{STATE_LABEL[order.state] ?? order.state}</span>
            <div className="order-num">{String(order.number).padStart(3, '0')}</div>
            <p
              className="dim mono"
              style={{
                fontSize: 12,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              escuta o número — a chapa chama pelo alto
            </p>

            <dl className="kv">
              <dt>cliente</dt>
              <dd>{order.customer.name}</dd>
              <dt>rota</dt>
              <dd>
                {order.delivery.mode === 'delivery'
                  ? `entrega — ${order.delivery.neighborhood ?? ''}`
                  : `retirada — ${store?.address ?? ''}`}
              </dd>
              {order.delivery.etaMin && order.delivery.etaMax ? (
                <>
                  <dt>janela</dt>
                  <dd>
                    {order.delivery.etaMin}–{order.delivery.etaMax} min
                  </dd>
                </>
              ) : null}
              <dt>pagamento</dt>
              <dd>
                {order.payment.method}
                {order.payment.instructions ? (
                  <span className="dim"> — {order.payment.instructions}</span>
                ) : null}
              </dd>
              <dt>total</dt>
              <dd className="mono">
                {cents(order.totalCents)}
                {order.deliveryFeeCents ? (
                  <span className="dim"> (entrega {cents(order.deliveryFeeCents)})</span>
                ) : null}
              </dd>
            </dl>
          </section>

          {order.timeline.length ? (
            <section className="ck-section" style={{ marginTop: 18 }}>
              <div className="sechead">
                <span className="idx">TL</span>
                <h2>Traço</h2>
              </div>
              {order.timeline.map((e, i) => (
                <p key={i} className="mono dim" style={{ fontSize: 12, margin: '4px 0' }}>
                  {new Date(e.at).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  — {STATE_LABEL[e.to] ?? e.to}
                </p>
              ))}
            </section>
          ) : null}

          <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
            <Link to="/" className="cta" style={{ textAlign: 'center', textDecoration: 'none' }}>
              Voltar ao quadro
            </Link>
            {store?.whatsapp ? (
              <a
                className="cta ghost"
                style={{ textAlign: 'center', textDecoration: 'none' }}
                href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(`pedido ${order.number}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                Chamar no zap
              </a>
            ) : null}
          </div>
        </>
      ) : (
        <div className="ticket">
          <div className="empty">
            <div className="big">{lookup === 'dead' ? 'Saiu do gancho' : 'Localizando…'}</div>
            <p>
              {lookup === 'dead'
                ? 'a comanda foi registrada, mas esta sessão não guarda o número. fala com a chapa no zap se precisar.'
                : 'procurando seu registro na chapa…'}
            </p>
            <Link
              to="/"
              className="cta ghost"
              style={{
                display: 'inline-block',
                padding: '10px 22px',
                textDecoration: 'none',
                marginTop: 8,
              }}
            >
              Ao quadro →
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
