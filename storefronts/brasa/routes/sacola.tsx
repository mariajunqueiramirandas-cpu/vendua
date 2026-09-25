import { Link } from 'react-router-dom';
import { QuantityStepper, useCart, useStore } from '@vendua/kernel';
import { cents } from './_ui';

// every price on the ticket is Core-computed (unitPriceCents / lineTotalCents / totals)
export function Sacola() {
  const { cart } = useCart();
  const { store } = useStore();
  // items only count while the cart is open; useCart().loading never resolves
  // before a session exists, so the empty ticket doubles as the loading state
  const items = cart?.status === 'open' ? cart.items : [];
  const totals = cart?.totals;
  const belowMin = totals?.belowMinOrder ?? false;
  const missing = totals?.remainingMinOrderCents ?? 0;

  return (
    <main className="page">
      <header className="pagehead">
        <span className="code">RAIL · COMANDA</span>
        <h1>Sua comanda</h1>
      </header>

      <div className="ticket" role="region" aria-label="comanda">
        <div className="ticket-head">
          <div className="brand">{store?.name ?? 'Brasa Burger'}</div>
          <div className="meta">
            {store?.address ?? ''} · {items.length ? `${items.length} linha(s)` : 'sem linhas'}
          </div>
        </div>

        {!items.length ? (
          <div className="empty">
            <div className="big">Comanda vazia</div>
            <p>o gancho tá livre — pede um smash que a chapa tá quente.</p>
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
        ) : null}

        {items.map((it) => (
          <div className="tline" key={it.id}>
            {/* Kernel stepper owns qty mutations + stock caps. */}
            <QuantityStepper itemId={it.id} qty={it.qty} />
            <span>
              <span className="tname">
                {it.qty}× {it.name}
              </span>
              {it.modifiers.length ? (
                <div className="tmods">
                  {it.modifiers
                    .map((m) =>
                      m.priceDeltaCents ? `${m.name} +${cents(m.priceDeltaCents)}` : m.name,
                    )
                    .join(' · ')}
                </div>
              ) : null}
            </span>
            <span className="tprice">{cents(it.lineTotalCents)}</span>
          </div>
        ))}

        {items.length && totals ? (
          <>
            <div className="totals">
              <div className="trow">
                <span>subtotal</span>
                <span>{cents(totals.subtotalCents)}</span>
              </div>
              {totals.deliveryFeeCents ? (
                <div className="trow">
                  <span>entrega</span>
                  <span>{cents(totals.deliveryFeeCents)}</span>
                </div>
              ) : null}
              <div className="trow grand">
                <span>total</span>
                <span>{cents(totals.totalCents)}</span>
              </div>
            </div>

            {belowMin ? (
              <div className="minbar" role="status">
                faltam {cents(missing)} pro mínimo de {cents(totals.minOrderCents)}
                <div className="track" />
                <div
                  className="fill"
                  style={{
                    width: `${Math.min(100, Math.round((totals.subtotalCents / totals.minOrderCents) * 100))}%`,
                  }}
                />
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {items.length ? (
        <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
          <Link to="/" className="cta ghost" style={{ flex: '0 0 auto', textDecoration: 'none' }}>
            + mais fogo
          </Link>
          <Link
            to="/fechar"
            className="cta"
            style={{ textAlign: 'center', textDecoration: 'none' }}
          >
            Fechar pedido →
          </Link>
        </div>
      ) : null}
    </main>
  );
}
