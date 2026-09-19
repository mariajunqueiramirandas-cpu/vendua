import { ArrowLeft, ArrowRight, ShoppingBag, Trash2, Truck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { QuantityStepper, useCart, useStore } from '@vendua/kernel';
import { ProductFigure } from './_components/ProductFigure.tsx';
import { Skeleton } from './_components/Skeleton.tsx';
import { formatBRL } from './_lib/format.ts';
import { getContinueShoppingUrl } from './_lib/lastSeen.ts';

/**
 * Sacola — Core's cart rendered verbatim: items, modifier lines, stepper
 * (Kernel primitive), totals from `cart.totals` (subtotal, fee, min order).
 */
export function CartPage() {
  const { cart, loading, mutations } = useCart();
  const { store } = useStore();
  const navigate = useNavigate();

  const items = cart?.items ?? [];
  const totals = cart?.totals;
  const continueUrl = getContinueShoppingUrl();

  return (
    <main className="container" style={{ paddingBlock: '32px 96px' }}>
      <Link to={continueUrl} className="back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Continuar escolhendo
      </Link>

      <header
        className="ficha-hairline"
        style={{
          marginTop: 32,
          paddingBottom: 32,
          borderBottom: '1px solid var(--zinc-200)',
          borderTop: 0,
        }}
      >
        <p className="eyebrow">Sua seleção</p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 16,
            marginTop: 8,
          }}
        >
          <h1 className="display display-lg">Um doce momento.</h1>
          {items.length > 0 ? (
            <p className="small muted tnum" style={{ margin: 0 }}>
              {totals?.itemCount ?? 0} {(totals?.itemCount ?? 0) === 1 ? 'doce' : 'doces'} na sacola
            </p>
          ) : null}
        </div>
      </header>

      {loading && !cart ? (
        <div
          style={{ display: 'grid', gap: 24, marginTop: 32 }}
          aria-busy="true"
          aria-label="Carregando sacola"
        >
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} style={{ display: 'flex', gap: 16 }}>
              <Skeleton style={{ width: 112, height: 128, borderRadius: 8 }} />
              <div style={{ flex: 1, display: 'grid', gap: 10, alignContent: 'start' }}>
                <Skeleton style={{ height: 22, width: '50%' }} />
                <Skeleton style={{ height: 14, width: '30%' }} />
                <Skeleton style={{ height: 36, width: 120 }} />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ maxWidth: '32rem', marginInline: 'auto' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: 'var(--caramel-100)',
              color: 'var(--caramel-700)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginInline: 'auto',
            }}
          >
            <ShoppingBag size={20} aria-hidden="true" />
          </div>
          <h2>Ainda falta o seu favorito.</h2>
          <p>Escolha um doce no cardápio para começar.</p>
          <Link to={continueUrl} className="btn">
            Ver cardápio <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <div className="two-col" style={{ marginTop: 32 }}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((item) => (
              <li key={item.id} className="cart-line">
                <div className="cart-thumb">
                  <ProductFigure title={item.name} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3>{item.name}</h3>
                  {item.modifiers.length > 0 ? (
                    <ul className="cart-mods">
                      {item.modifiers.map((m) => (
                        <li key={m.id}>
                          {m.name}
                          {m.priceDeltaCents > 0 ? ` (+ ${formatBRL(m.priceDeltaCents)})` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="cart-unit">{formatBRL(item.unitPriceCents)} / unidade</p>
                  <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span className="stepper-slot">
                      <QuantityStepper itemId={item.id} qty={item.qty} />
                    </span>
                    <button
                      type="button"
                      className="cart-remove"
                      aria-label={`Remover ${item.name}`}
                      onClick={() => void mutations.remove(item.id)}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <p className="cart-line-total" style={{ margin: 0, textAlign: 'right' }}>
                  {formatBRL(item.lineTotalCents)}
                </p>
              </li>
            ))}
          </ol>

          <section aria-label="Resumo" className="summary-card">
            <h2>Seu pedido</h2>
            <div className="summary-row">
              <span className="lbl">Subtotal</span>
              <span className="val">{formatBRL(totals?.subtotalCents ?? 0)}</span>
            </div>
            {cart?.delivery?.mode === 'delivery' ? (
              <div className="summary-row">
                <span className="lbl">
                  Entrega{cart.delivery.neighborhood ? ` · ${cart.delivery.neighborhood}` : ''}
                </span>
                <span className="val">
                  {(totals?.deliveryFeeCents ?? 0) > 0
                    ? formatBRL(totals?.deliveryFeeCents ?? 0)
                    : 'a confirmar'}
                </span>
              </div>
            ) : null}
            <div className="summary-row summary-total">
              <span className="lbl" style={{ color: 'var(--zinc-950)', fontWeight: 500 }}>
                Total
              </span>
              <span className="val">{formatBRL(totals?.totalCents ?? 0)}</span>
            </div>

            <p
              className="small muted"
              style={{ marginTop: 20, display: 'flex', gap: 8, lineHeight: 1.5 }}
            >
              <Truck
                size={18}
                style={{ color: 'var(--caramel-700)', flexShrink: 0 }}
                aria-hidden="true"
              />
              <span>
                Entrega{store?.city ? ` em ${store.city}` : ' local'} ou retirada grátis — você
                escolhe no próximo passo.
              </span>
            </p>

            {totals?.belowMinOrder ? (
              <p className="inline-alert warn" role="status" style={{ marginTop: 16 }}>
                Faltam {formatBRL(totals.minOrderCents - totals.subtotalCents)} para o pedido mínimo
                de {formatBRL(totals.minOrderCents)}.
              </p>
            ) : null}

            <button
              type="button"
              className="btn btn-block"
              style={{ marginTop: 24 }}
              disabled={totals?.belowMinOrder}
              onClick={() => navigate('/checkout')}
            >
              Ir para o pagamento <ArrowRight size={16} aria-hidden="true" />
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
