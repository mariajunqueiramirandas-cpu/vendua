import { ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  CartTrigger,
  StoreStatusBadge,
  boolean,
  defineSection,
  image,
  list,
  text,
  url,
  useCart,
  useStore,
  type SectionProps,
} from '@vendua/kernel';

export const schema = defineSection({
  type: 'store:header',
  settings: {
    logo: image({ default: '/brand/icone-liso.png' }),
    links: list({ label: text({ max: 40, default: '' }), href: url({ default: '/' }) }, { max: 6 }),
    /** anchor the "story" link watches to show it active while in view */
    storyAnchor: text({ max: 40 }),
    cartLabel: text({ max: 20, default: 'Sacola' }),
    showStatus: boolean({ default: true }),
  },
  areas: { actions: { accepts: ['badge', 'info'], max: 1 } },
});

export default function Header({ settings }: SectionProps<typeof schema>) {
  const { store } = useStore();
  const { cart } = useCart();
  const count = cart?.status === 'open' ? cart.totals.itemCount : 0;
  return (
    <header className="site-header">
      <a href="#main" className="skip-link">
        Pular para o conteúdo
      </a>
      <div className="container site-header-inner">
        <Link to="/" className="brand-link" aria-label={`${store?.name ?? 'Loja'} — início`}>
          <img src={settings.logo} alt="" aria-hidden="true" className="brand-img" />
          <span className="brand-lockup">
            <span className="brand-name">{store?.name ?? ''}</span>
            {store?.tagline ? <span className="brand-tag">{store.tagline}</span> : null}
          </span>
        </Link>

        <nav className="site-nav" aria-label="Navegação principal">
          {(settings.links ?? []).map((l) =>
            settings.storyAnchor && l.href.endsWith(`#${settings.storyAnchor}`) ? (
              <AnchorLink
                key={l.href}
                href={l.href}
                anchor={settings.storyAnchor}
                label={l.label}
              />
            ) : (
              <NavLink key={l.href} to={l.href} end={l.href === '/'}>
                {l.label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="header-actions">
          {settings.showStatus ? (
            <span className="header-status">
              <StoreStatusBadge />
            </span>
          ) : null}
          <CartTrigger asChild>
            <button type="button" className="sacola-btn">
              <ShoppingBag size={16} aria-hidden="true" />
              <span className="sacola-word">{settings.cartLabel}</span>
              <span className="sacola-count">{count}</span>
            </button>
          </CartTrigger>
        </div>
      </div>
    </header>
  );
}

/** In-page anchor link — marked current while its section is in view. */
function AnchorLink({ href, anchor, label }: { href: string; anchor: string; label: string }) {
  const { pathname } = useLocation();
  const [active, setActive] = useState(false);
  const onPage = pathname === (href.split('#')[0] || '/');

  useEffect(() => {
    if (!onPage) {
      setActive(false);
      return;
    }
    let ticking = false;
    const update = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        const el = document.getElementById(anchor);
        if (!el) return setActive(false);
        const r = el.getBoundingClientRect();
        setActive(r.top < window.innerHeight * 0.45 && r.bottom > 120);
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [onPage, anchor]);

  return (
    <Link to={href} aria-current={active ? 'true' : undefined}>
      {label}
    </Link>
  );
}
