import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useOrder, useStore } from '@vendua/kernel';
import type { Order } from '@vendua/kernel';
import { Shell } from '../components/shell.tsx';
import { getLastOrder } from '../components/last-order.ts';
import { useResetSession } from '../components/session.tsx';
import { brl, ORDER_STATE_LABELS, PAYMENT_LABELS, resumeLabel } from '../components/format.ts';

/** /pedido/:id — instant paint from router state/local cache; useOrder re-reads it from Core. */
export default function PedidoPage() {
  const { id } = useParams();
  const { state } = useLocation() as { state: { order?: Order } | null };
  const { store, resumesAt } = useStore();
  const resetSession = useResetSession();
  const navigate = useNavigate();

  const { order: fresh, error } = useOrder(id ?? '');
  const order = fresh ?? state?.order ?? getLastOrder(id);
  const phase = order ? 'ready' : error ? 'error' : 'loading';

  const newBag = () => {
    resetSession();
    navigate('/');
  };

  const tz = store?.hours.timezone ?? 'America/Sao_Paulo';
  const pickupEta =
    store?.status === 'closed' && resumesAt
      ? `a partir de ${resumeLabel(resumesAt, tz)} · +${store.prepTimeMinutes} min de bancada`
      : `~${store?.prepTimeMinutes ?? 15} min no balcão`;

  return (
    <Shell>
      {phase === 'loading' ? (
        <div className="comanda">
          <div className="comanda-body" aria-hidden="true">
            <div
              className="skeleton-bar"
              style={{ width: '40%', height: 26, margin: '10px auto' }}
            />
            <div className="skeleton-bar" style={{ width: '70%', margin: '18px auto 8px' }} />
          </div>
        </div>
      ) : phase === 'error' || !order ? (
        <div className="err-panel">
          <h2>a comanda saiu do quadro</h2>
          <p>
            O pedido foi anotado, mas não conseguimos reabrir a comanda agora. Guarda o número que
            apareceu — ou chama no zap que a gente confere.
          </p>
          {store?.whatsapp ? (
            <a
              className="link-btn"
              href={`https://wa.me/${store.whatsapp}`}
              target="_blank"
              rel="noreferrer"
            >
              chamar no whatsapp
            </a>
          ) : (
            <Link to="/" className="link-btn ghost">
              voltar pra vitrine
            </Link>
          )}
        </div>
      ) : (
        <div className="confirm-wrap">
          <span className="stamp" aria-hidden="true">
            anotado
          </span>
          <h1 className="order-no">nº {String(order.number).padStart(2, '0')}</h1>
          <p className="confirm-sub">
            {order.customer.name.split(' ')[0]}, seu pedido entrou pra comanda
            {store?.status === 'closed' ? ' da próxima fornada' : ''}.
          </p>

          <div className="confirm-facts">
            <div className="f-row">
              <span className="k">retirada</span>
              <span className="v">
                {order.delivery.mode === 'pickup' ? `balcão — ${store?.address ?? ''}` : 'entrega'}
              </span>
            </div>
            <div className="f-row">
              <span className="k">pronto</span>
              <span className="v">{pickupEta}</span>
            </div>
            <div className="f-row">
              <span className="k">pagamento</span>
              <span className="v">
                {PAYMENT_LABELS[order.payment.method] ?? order.payment.method}
              </span>
            </div>
            {order.payment.instructions ? (
              <div className="f-row">
                <span className="k">instruções</span>
                <span className="v" style={{ fontStyle: 'italic' }}>
                  {order.payment.instructions}
                </span>
              </div>
            ) : null}
            <div className="f-row">
              <span className="k">total</span>
              <span className="v mono" style={{ fontWeight: 600 }}>
                {brl(order.totalCents)}
              </span>
            </div>
            <div className="f-row">
              <span className="k">comanda</span>
              <ul className="timeline">
                {order.timeline.map((e, i) => (
                  <li key={i}>
                    <span className="mono">{ORDER_STATE_LABELS[e.to] ?? e.to}</span>
                    <span className="mono">
                      {new Date(e.at).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="confirm-actions">
            <button type="button" className="link-btn" onClick={newBag}>
              montar outra sacola
            </button>
            {store?.whatsapp ? (
              <a
                className="link-btn ghost"
                href={`https://wa.me/${store.whatsapp}?text=${encodeURIComponent(`pedido nº ${order.number}`)}`}
                target="_blank"
                rel="noreferrer"
              >
                falar com o balcão
              </a>
            ) : null}
          </div>
        </div>
      )}
    </Shell>
  );
}
