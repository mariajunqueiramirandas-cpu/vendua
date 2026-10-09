import { useId } from 'react';
import { ArrowUpRight, Instagram as InstagramIcon } from 'lucide-react';
import { BlockArea, defineSection, text, url, useLinks, type SectionProps } from '@vendua/kernel';

// The invitation to follow the store: a blush card with one button out to its Instagram.
export const schema = defineSection({
  type: 'store:instagram',
  title: 'Instagram',
  addable: true,
  settings: {
    kicker: text({ max: 40 }),
    title: text({ max: 90, default: '' }),
    text: text({ max: 240 }),
    handle: text({ max: 40 }),
    // the profile set here wins; empty falls back to the Instagram saved in the store's contacts
    href: url(),
    ctaLabel: text({ max: 40, default: 'Siga no Instagram' }),
    newTabLabel: text({ max: 40, default: 'abre em nova aba' }),
  },
  areas: { aside: { accepts: ['promo', 'info'], max: 1 } },
});

export default function Instagram({ settings: s }: SectionProps<typeof schema>) {
  const titleId = useId();
  const { contacts } = useLinks();
  const href = s.href || contacts.instagram?.href;
  const handle = s.handle || (contacts.instagram ? `@${contacts.instagram.handle}` : '');
  if (!href) return null;
  return (
    <section className="insta" aria-labelledby={titleId}>
      <div className="insta-card">
        <span className="insta-mark" aria-hidden="true">
          <InstagramIcon size={26} strokeWidth={1.6} />
        </span>
        <div className="insta-copy">
          {s.kicker ? <p className="kicker">{s.kicker}</p> : null}
          <h2 id={titleId} className="insta-title">
            {s.title}
          </h2>
          {s.text ? <p className="insta-text">{s.text}</p> : null}
        </div>
        <div className="insta-actions">
          <a className="btn-ink" href={href} target="_blank" rel="noopener noreferrer">
            {s.ctaLabel}
            <ArrowUpRight size={18} strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">({s.newTabLabel})</span>
          </a>
          {handle ? <p className="insta-handle">{handle}</p> : null}
        </div>
        <BlockArea name="aside" className="insta-aside" />
      </div>
    </section>
  );
}
