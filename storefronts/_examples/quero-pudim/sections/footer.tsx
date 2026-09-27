import { ArrowUpRight, Instagram, MessageCircle, QrCode } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BlockArea,
  defineSection,
  image,
  list,
  text,
  url,
  useStore,
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

const DAY_LABEL = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function hoursSummary(
  hours: { windows: { days: number[]; open: string; close: string }[] } | undefined,
) {
  const w = hours?.windows ?? [];
  if (w.length === 0) return null;
  return w
    .map((x) => {
      const days =
        x.days.length === 7
          ? 'todos os dias'
          : [...x.days]
              .sort()
              .map((d) => DAY_LABEL[d])
              .join(' · ');
      return `${days}, ${x.open}–${x.close}`;
    })
    .join('  ·  ');
}

export default function Footer({ settings }: SectionProps<typeof schema>) {
  const { store } = useStore();
  const instagram = store?.instagram?.replace(/^@/, '');
  const whatsapp = store?.whatsapp?.replace(/\D/g, '');
  const hours = hoursSummary(store?.hours);
  return (
    <footer className="site-footer">
      <div className="container">
        {settings.eyebrow ? <p className="eyebrow">{settings.eyebrow}</p> : null}
        <div className="footer-grid">
          <div>
            <img
              src={settings.logo}
              alt={store ? `${store.name} — ${store.tagline ?? ''}` : ''}
              className="brand-img footer-logo"
            />
            {settings.blurb ? (
              <p className="small muted" style={{ marginTop: 12, maxWidth: '20rem' }}>
                {settings.blurb}
              </p>
            ) : null}
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
            <BlockArea name="extra" />
          </div>
          <nav className="footer-nav" aria-label="Contatos da loja">
            <p className="eyebrow" style={{ fontSize: '0.875rem' }}>
              {settings.contactsTitle}
            </p>
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
                <MessageCircle size={16} aria-hidden="true" /> WhatsApp{' '}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            ) : null}
          </nav>
        </div>
        <div className="footer-legal">
          <p style={{ margin: 0 }}>
            © {new Date().getFullYear()} {store?.name ?? ''}
          </p>
          {store?.tagline ? <p style={{ margin: 0 }}>{store.tagline}</p> : null}
        </div>
      </div>
    </footer>
  );
}
