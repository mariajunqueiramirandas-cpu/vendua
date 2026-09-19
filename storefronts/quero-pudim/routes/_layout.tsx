import { ArrowUpRight, Instagram, MessageCircle, QrCode, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { CartTrigger, StoreStatusBadge, useCart, useStore } from '@vendua/kernel';

const DAY_LABEL = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function hoursSummary(
  hours: { windows: { days: number[]; open: string; close: string }[] } | undefined,
) {
  const w = hours?.windows ?? [];
  if (w.length === 0) return null;
  const everyDay = w.some((x) => x.days.length === 7);
  return w
    .map((x) => {
      const days = everyDay
        ? 'todos os dias'
        : [...x.days]
            .sort()
            .map((d) => DAY_LABEL[d])
            .join(' · ');
      return `${days}, ${x.open}–${x.close}`;
    })
    .join('  ·  ');
}

export function Layout() {
  const { store } = useStore();
  const instagram = store?.instagram?.replace(/^@/, '');
  const whatsapp = store?.whatsapp?.replace(/\D/g, '');
  const hours = hoursSummary(store?.hours);

  return (
    <>
      <header className="site-header">
        <div className="container site-header-inner">
          <Link to="/" className="brand-link" aria-label="Quero Pudim — início">
            <img src="/brand/icone-liso.png" alt="" aria-hidden="true" className="brand-img" />
            <span className="brand-lockup">
              <span className="brand-name">{store?.name ?? 'Quero Pudim'}</span>
              {store?.tagline ? <span className="brand-tag">{store.tagline}</span> : null}
            </span>
          </Link>

          <nav className="site-nav" aria-label="Navegação principal">
            <NavLink to="/" end>
              Início
            </NavLink>
            <StoryLink />
            <NavLink to="/catalog">Nosso cardápio</NavLink>
            <NavLink to="/meus-pedidos">Meus pedidos</NavLink>
          </nav>

          <div className="header-actions">
            <StoreStatusBadge />
            <CartTrigger asChild>
              <Link to="/cart" className="sacola-btn">
                <ShoppingBag size={16} aria-hidden="true" />
                <span className="sacola-word">Sacola</span>
                <SacolaCount />
              </Link>
            </CartTrigger>
          </div>
        </div>
      </header>

      <Outlet />

      <footer className="site-footer">
        <div className="container">
          <p className="eyebrow">Feito à mão em {store?.city ?? 'Saquarema'}</p>
          <div className="footer-grid">
            <div>
              <img
                src="/brand/logo-principal.png"
                alt={store ? `${store.name} — ${store.tagline ?? ''}` : 'Quero Pudim'}
                className="brand-img footer-logo"
              />
              <p className="small muted" style={{ marginTop: 12, maxWidth: '20rem' }}>
                Pequenos momentos. Muito sabor.
              </p>
              {store?.address ? (
                <p className="small muted" style={{ marginTop: 16, fontSize: '0.75rem' }}>
                  {store.address}
                  {store.city ? `, ${store.city}` : ''}
                </p>
              ) : null}
              {hours ? (
                <p className="small muted tnum" style={{ marginTop: 4, fontSize: '0.75rem' }}>
                  {hours}
                </p>
              ) : null}
            </div>
            <nav className="footer-nav" aria-label="Contatos da loja">
              <p className="eyebrow" style={{ fontSize: '0.875rem' }}>
                Vamos conversar?
              </p>
              <Link to="/catalog">Nosso cardápio</Link>
              <Link to="/meus-pedidos">Meus pedidos</Link>
              <Link to="/qrcode">
                <QrCode size={16} aria-hidden="true" /> Cardápio QR Code
              </Link>
              {instagram ? (
                <a
                  href={`https://www.instagram.com/${instagram}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Instagram size={16} aria-hidden="true" /> Instagram @{instagram}{' '}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              ) : null}
              {whatsapp ? (
                <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={16} aria-hidden="true" /> WhatsApp da loja{' '}
                  <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              ) : null}
            </nav>
          </div>
          <div className="footer-legal">
            <p style={{ margin: 0 }}>
              © {new Date().getFullYear()} {store?.name ?? 'Quero Pudim Gourmet'}
            </p>
            <p style={{ margin: 0 }}>
              {store?.tagline ?? 'Pudins sem furinhos e sacolés cremosos'}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}

/**
 * "Nossa história" — in-page anchor on the landing page, highlighted while its
 * section is in view (ported scroll-spy, reduced to a viewport check).
 */
function StoryLink() {
  const { pathname } = useLocation();
  const [active, setActive] = useState(false);
  const isLanding = pathname === '/';

  useEffect(() => {
    if (!isLanding) {
      setActive(false);
      return;
    }
    let ticking = false;
    const update = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const el = document.getElementById('nossa-historia');
        if (!el) {
          setActive(false);
          return;
        }
        const r = el.getBoundingClientRect();
        setActive(r.top < window.innerHeight * 0.45 && r.bottom > 120);
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [isLanding]);

  return (
    <Link to="/#nossa-historia" aria-current={active ? 'true' : undefined}>
      Nossa história
    </Link>
  );
}

function SacolaCount() {
  // CartTrigger stamps data-count on the child but does not pass it as a prop —
  // the badge reads the cart itself.
  const { cart } = useCart();
  return <span className="sacola-count">{cart?.totals.itemCount ?? 0}</span>;
}
