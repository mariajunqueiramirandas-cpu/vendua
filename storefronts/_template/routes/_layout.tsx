import { Link, Outlet } from 'react-router-dom';
import { CartTrigger, StoreStatusBadge, useStore } from '@vendua/kernel';

/**
 * Shell — the bare commerce chrome every storefront needs: brand link,
 * store status, cart entry (Kernel primitives stamp their data-vendua
 * hooks). Everything visual lives in styles/global.css.
 */
export function Layout() {
  const { store } = useStore();
  return (
    <>
      <a href="#main" className="skip-link">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <div className="container site-header-inner">
          <Link to="/" className="brand">
            {store?.name ?? 'Loja'}
          </Link>
          <div className="header-actions">
            <StoreStatusBadge />
            <CartTrigger asChild>
              <Link to="/cart" className="btn-ghost">
                Sacola
              </Link>
            </CartTrigger>
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="site-footer">
        <div className="container">
          <p>
            {store?.name ?? 'Loja'}
            {store?.city ? ` · ${store.city}` : ''}
          </p>
          {store?.address ? <p className="muted">{store.address}</p> : null}
        </div>
      </footer>
    </>
  );
}
