import { Menu, ShoppingBag, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  BlockArea,
  CartTrigger,
  DEFAULT_PATHS,
  boolean,
  defineSection,
  image,
  list,
  text,
  url,
  useCartCount,
  useStore,
  type SectionProps,
} from '@vendua/kernel';
import { StatusPill } from './_shared/StatusPill.tsx';

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
  const count = useCartCount();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  // the phone menu closes on navigation and on Escape
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className="site-header" data-scrolled={scrolled || undefined}>
      <a href="#main" className="skip-link">
        Pular para o conteúdo
      </a>
      <div className="container site-header-inner">
        <Link
          to={DEFAULT_PATHS.home}
          className="brand-link"
          aria-label={`${store?.name ?? 'Loja'} — início`}
        >
          <img src={settings.logo} alt="" aria-hidden="true" className="brand-img" />
          <span className="brand-lockup">
            <span className="brand-name">{store?.name ?? ''}</span>
            {store?.tagline ? <span className="brand-tag">{store.tagline}</span> : null}
          </span>
        </Link>

        <nav
          className="site-nav"
          id="site-nav"
          aria-label="Navegação principal"
          data-open={menuOpen || undefined}
        >
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
          <BlockArea name="actions" className="header-area" />
          {settings.showStatus ? (
            <span className="header-status">
              <StatusPill openLabel="Aberto" />
            </span>
          ) : null}
          <CartTrigger asChild>
            <button type="button" className="sacola-btn">
              <ShoppingBag size={20} aria-hidden="true" />
              <span className="sacola-word">{settings.cartLabel}</span>
              <span className="sacola-count" key={count} data-empty={count === 0 || undefined}>
                {count}
              </span>
            </button>
          </CartTrigger>
          <button
            type="button"
            className="menu-btn"
            aria-expanded={menuOpen}
            aria-controls="site-nav"
            aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
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
