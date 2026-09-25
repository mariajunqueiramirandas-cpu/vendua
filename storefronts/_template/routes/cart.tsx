import { Link, useNavigate } from 'react-router-dom';
import { formatCents, QuantityStepper, useCart, useStore } from '@vendua/kernel';

// Totals come straight from `cart.totals` — no client-side money math.
export function CartPage() {
  const { cart, loading, mutations } = useCart();
  const { store } = useStore();
  const navigate = useNavigate();

  const items = cart?.items ?? [];
  const totals = cart?.totals;

  return (
    <main id="main" className="container page">
      <Link to="/" className="back-link">
        ← Continuar escolhendo
      </Link>
      <header className="page-head">
        <h1>Sacola</h1>
        {items.length > 0 ? (
          <p className="muted">
            {totals?.itemCount ?? 0} {totals?.itemCount === 1 ? 'item' : 'itens'}
          </p>
        ) : null}
      </header>

      {loading && !cart ? (
        <div aria-busy="true" aria-label="Carregando sacola">
          <p className="sk-line" />
          <p className="sk-line" />
          <p className="sk-line sk-line--short" />
        </div>
      ) : items.length === 0 ? (
        <div className="empty">
          <p>Sua sacola está vazia.</p>
          <Link to="/" className="btn">
            Ver cardápio
          </Link>
        </div>
      ) : (
        <div className="cart-grid">
          <ol className="cart-lines">
            {items.map((item) => (
              <li key={item.id} className="cart-line">
                <div className="cart-line-main">
                  <p className="cart-line-name">{item.name}</p>
                  {item.modifiers.length > 0 ? (
                    <p className="muted">
                      {item.modifiers
                        .map((m) =>
                          m.priceDeltaCents > 0
                            ? `${m.name} (+${formatCents(m.priceDeltaCents, store?.currency)})`
                            : m.name,
                        )
                        .join(', ')}
                    </p>
                  ) : null}
                  <p className="muted">
                    {formatCents(item.unitPriceCents, store?.currency)} / unidade
                  </p>
                  <div className="cart-line-actions">
                    <QuantityStepper itemId={item.id} qty={item.qty} />
                    <button
                      type="button"
                      className="btn-ghost"
                      aria-label={`Remover ${item.name}`}
                      onClick={() => void mutations.remove(item.id)}
                    >
                      Remover
                    </button>
                  </div>
                </div>
                <p className="cart-line-total">
                  {formatCents(item.lineTotalCents, store?.currency)}
                </p>
              </li>
            ))}
          </ol>

          <section aria-label="Resumo" className="summary">
            <h2>Resumo</h2>
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{formatCents(totals?.subtotalCents ?? 0, store?.currency)}</span>
            </div>
            {cart?.delivery?.mode === 'delivery' ? (
              <div className="summary-row">
                <span>
                  Entrega{cart.delivery.neighborhood ? ` · ${cart.delivery.neighborhood}` : ''}
                </span>
                <span>
                  {(totals?.deliveryFeeCents ?? 0) > 0
                    ? formatCents(totals?.deliveryFeeCents ?? 0, store?.currency)
                    : 'a confirmar'}
                </span>
              </div>
            ) : null}
            <div className="summary-row summary-total">
              <span>Total</span>
              <span>{formatCents(totals?.totalCents ?? 0, store?.currency)}</span>
            </div>

            {totals?.belowMinOrder ? (
              <p className="alert" role="status">
                Faltam {formatCents(totals.remainingMinOrderCents, store?.currency)} para o pedido
                mínimo de {formatCents(totals.minOrderCents, store?.currency)}.
              </p>
            ) : null}

            <button
              type="button"
              className="btn btn-block"
              disabled={totals?.belowMinOrder}
              onClick={() => navigate('/checkout')}
            >
              Ir para o pagamento
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
