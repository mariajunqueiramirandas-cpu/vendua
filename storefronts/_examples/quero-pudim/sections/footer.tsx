import { ArrowUpRight, Clock, Instagram, MapPin, MessageCircle, QrCode } from 'lucide-react';
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
              {instagram ? (
                <a
                  href={`https://www.instagram.com/${instagram}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Instagram @${instagram}`}
                >
                  <Instagram size={18} aria-hidden="true" />
                </a>
              ) : null}
              {whatsapp ? (
                <a
                  href={`https://wa.me/${whatsapp}`}
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
            {hours ? (
              <p className="footer-line tnum">
                <Clock size={16} aria-hidden="true" /> {hours}
              </p>
            ) : null}
            {whatsapp ? (
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle size={16} aria-hidden="true" /> Falar no WhatsApp{' '}
                <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            ) : null}
            {instagram ? (
              <a
                href={`https://www.instagram.com/${instagram}/`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Instagram size={16} aria-hidden="true" /> @{instagram}{' '}
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
