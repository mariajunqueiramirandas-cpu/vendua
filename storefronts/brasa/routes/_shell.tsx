import { Link, Outlet, useNavigate } from 'react-router-dom';
import { CartTrigger, StoreStatusBadge, useCart, useStore } from '@vendua/kernel';
import { cents, closedDays } from './_ui';

/**
 * Shell — the fixed rail that makes this a dispatch board, not a landing page:
 * stenciled wordmark, status plate (Kernel's live badge inside), address,
 * and the comanda button. Collapses to a sticky bar under 960px.
 */
export function Shell() {
  const { store } = useStore();
  const { cart } = useCart();
  const navigate = useNavigate();
  const hours = store?.hours.windows ?? [];
  const closed = closedDays(hours);

  return (
    <>
      <aside className="rail">
        <Link to="/" className="wordmark stencil" aria-label="Brasa Burger — início">
          <span className="wl">Brasa</span>
          <span className="wl">
            <span className="slash">/</span>Burger
          </span>
          <small>Chapa · Zona Portuária · RJ</small>
        </Link>

        <div className="plate" data-plate="status">
          <div className="row">
            <span className="dim">Turno</span>
            <StoreStatusBadge />
          </div>
          {hours.map((w, i) => (
            <div className="row" key={i}>
              <span className="dim">Chapa</span>
              <span>
                {w.open}–{w.close}
              </span>
            </div>
          ))}
          {closed.length > 0 ? (
            <div className="row">
              <span className="dim">Apagada</span>
              <span>{closed.join(' · ')}</span>
            </div>
          ) : null}
        </div>

        <div className="plate meta">
          <div className="row">
            <span className="dim">Balcão</span>
            <span>{store?.address ?? '—'}</span>
          </div>
          <div className="row">
            <span className="dim">Mínimo</span>
            <span>{store ? cents(store.minOrderCents) : '—'}</span>
          </div>
        </div>

        <div className="spacer" />

        {/* CartTrigger owns open behavior + data-vendua; the look is ours via asChild. */}
        <CartTrigger asChild onOpen={() => navigate('/sacola')}>
          <button type="button" className="comanda-btn">
            Comanda{' '}
            <span className="count">{cart?.status === 'open' ? cart.totals.itemCount : 0}</span>
          </button>
        </CartTrigger>

        <nav className="rail-links" aria-label="contato">
          {store?.whatsapp ? (
            <a href={`https://wa.me/${store.whatsapp}`} rel="noreferrer" target="_blank">
              wa.me/{store.whatsapp}
            </a>
          ) : null}
          {store?.instagram ? <span>{store.instagram}</span> : null}
          <span>{store?.city ?? ''}</span>
        </nav>
      </aside>

      <Outlet />
    </>
  );
}
