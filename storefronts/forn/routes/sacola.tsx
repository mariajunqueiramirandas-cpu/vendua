import { Link, useNavigate } from 'react-router-dom';
import { QuantityStepper, useCart, useStore } from '@vendua/kernel';
import { Shell } from '../components/shell.tsx';
import { BagMark } from '../components/marks.tsx';
import { brl } from '../components/format.ts';

/** /sacola — the comanda: a kraft-paper ticket listing what goes in the bag. */
export default function SacolaPage() {
  const { cart } = useCart();
  const { store } = useStore();
  const navigate = useNavigate();

  const completed = cart?.status === 'completed';
  const items = cart && !completed ? cart.items : [];

  return (
    <Shell>
      <div className="comanda">
        <div className="comanda-body">
          <div className="comanda-title">
            <h2>sua sacola</h2>
            <span className="mono microcaps" style={{ color: 'var(--mute)' }}>
              {items.length === 0 ? 'vazia' : `${items.reduce((s, i) => s + i.qty, 0)} ite${items.length === 1 ? 'm' : 'ns'}`}
            </span>
          </div>

          {items.length === 0 ? (
            <div className="empty-panel" style={{ border: 'none', margin: '10px 0 0' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, color: 'var(--mute)' }}>
                <BagMark size={54} />
              </div>
              <h2>{completed ? 'pedido já anotado' : 'a sacola está vazia'}</h2>
              <p>
                {completed
                  ? 'Essa sacola já virou pedido. Abre outra pra próxima fornada.'
                  : 'A vitrine está cheia — pão de fermentação natural, doce de padoca, café coado.'}
              </p>
              <Link to="/" className="link-btn">
                ver a vitrine
              </Link>
            </div>
          ) : (
            <>
              {items.map((it) => (
                <div className="bag-line" key={it.id}>
                  <span className="qty mono">{String(it.qty).padStart(2, '0')}×</span>
                  <span className="name">
                    {it.name}
                    {it.modifiers.length > 0 ? (
                      <small className="mono">{it.modifiers.map((m) => m.name).join(' + ')}</small>
                    ) : null}
                  </span>
                  <span className="price mono">{brl(it.lineTotalCents)}</span>
                  <span className="stepper">
                    <QuantityStepper itemId={it.id} qty={it.qty} />
                  </span>
                </div>
              ))}

              <div className="totals mono">
                <div className="t-row">
                  <span>subtotal</span>
                  <span>{brl(cart!.totals.subtotalCents)}</span>
                </div>
                <div className="t-row">
                  <span>retirada no balcão</span>
                  <span>{cart!.totals.deliveryFeeCents === 0 ? 'sem taxa' : brl(cart!.totals.deliveryFeeCents)}</span>
                </div>
                <div className="t-row grand">
                  <span>total</span>
                  <span>{brl(cart!.totals.totalCents)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {items.length > 0 ? (
          <div className="comanda-foot">
            {cart!.totals.belowMinOrder ? (
              <p className="comanda-hint" style={{ color: 'var(--brick)' }}>
                Falta {brl(cart!.totals.minOrderCents - cart!.totals.subtotalCents)} pro mínimo de{' '}
                {brl(cart!.totals.minOrderCents)}.
              </p>
            ) : null}
            <button type="button" className="big-cta" onClick={() => navigate('/finalizar')}>
              fechar pedido
            </button>
            <p className="comanda-hint">
              {store?.status === 'closed'
                ? 'a forn está fechada — seu pedido entra na fila da próxima fornada.'
                : `retirada no balcão · ~${store?.prepTimeMinutes ?? 15} min`}
            </p>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
