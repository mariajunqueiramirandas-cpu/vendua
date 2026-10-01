import { ArrowUpRight, Clock, Instagram, MapPin, MessageCircle, QrCode } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BlockArea,
  defineSection,
  image,
  list,
  text,
  url,
  useLinks,
  useStore,
  useStoreHours,
  type SectionProps,
} from '@vendua/kernel';

export const schema = defineSection({
  type: 'store:footer',
  settings: {
    eyebrow: text({ max: 60 }),
    logo: image({ default: '/brand/logo-principal.png' }),
    blurb: text({ max: 160 }),
    contactsTitle: text({ max: 40, default: 'Contato' }),
    links: list({ label: text({ max: 40, default: '' }), href: url({ default: '/' }) }, { max: 6 }),
    qrLabel: text({ max: 40 }),
    qrHref: url(),
  },
  areas: { extra: { accepts: ['info', 'social-proof', 'promo'], max: 2 } },
});

export default function Footer({ settings }: SectionProps<typeof schema>) {
  const { store } = useStore();
  const { contacts } = useLinks();
  const { rows, today } = useStoreHours();
  const anyOpen = rows.some((r) => !r.closed);
  const address = [store?.address, store?.city].filter(Boolean).join(', ');
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <img
              src={settings.logo}
              alt={store ? `${store.name} — ${store.tagline ?? ''}` : ''}
              className="brand-img footer-logo"
            />
            {settings.blurb ? <p className="footer-blurb">{settings.blurb}</p> : null}
            <div className="footer-social">
              {contacts.instagram ? (
                <a
                  href={contacts.instagram.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Instagram @${contacts.instagram.handle}`}
                >
                  <Instagram size={18} aria-hidden="true" />
                </a>
              ) : null}
              {contacts.whatsapp ? (
                <a
                  href={contacts.whatsapp.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="WhatsApp"
                >
                  <MessageCircle size={18} aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <BlockArea name="extra" />
          </div>
          <nav className="footer-col" aria-label="Links da loja">
            <p className="footer-title">{settings.eyebrow || 'Explore'}</p>
            {(settings.links ?? []).map((l) => (
              <Link key={l.href} to={l.href}>
                {l.label}
              </Link>
            ))}
            {settings.qrLabel && settings.qrHref ? (
              <Link to={settings.qrHref}>
                <QrCode size={16} aria-hidden="true" /> {settings.qrLabel}
              </Link>
            ) : null}
          </nav>
          <div className="footer-col">
            <p className="footer-title">{settings.contactsTitle}</p>
            {address ? (
              <p className="footer-line">
                <MapPin size={16} aria-hidden="true" /> {address}
              </p>
            ) : null}
            {anyOpen ? (
              <p className="footer-line tnum">
                <Clock size={16} aria-hidden="true" />
                <span className="footer-hours">
                  {today?.special ? (
                    <span data-today>
                      Hoje{today.special.label ? ` (${today.special.label})` : ''},{' '}
                      {today.closed ? 'fechado' : windowsText(today.windows)}
                    </span>
                  ) : null}
                  {rows.map((r) => (
                    <span key={r.label} data-today={(r.today && !today?.special) || undefined}>
                      {r.label}, {r.closed ? 'fechado' : windowsText(r.windows)}
                    </span>
                  ))}
                </span>
              </p>
            ) : null}
            {contacts.whatsapp ? (
              <a href={contacts.whatsapp.href} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} aria-hidden="true" /> Falar no WhatsApp{' '}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            ) : null}
            {contacts.instagram ? (
              <a href={contacts.instagram.href} target="_blank" rel="noopener noreferrer">
                <Instagram size={16} aria-hidden="true" /> @{contacts.instagram.handle}{' '}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
        <div className="footer-legal">
          <p>
            © {new Date().getFullYear()} {store?.name ?? ''}
          </p>
          {store?.tagline ? <p>{store.tagline}</p> : null}
        </div>
      </div>
    </footer>
  );
}

const windowsText = (ws: { open: string; close: string }[]) =>
  ws.map((w) => `${w.open}–${w.close}`).join(', ');
