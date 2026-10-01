import { MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { defineSection, text, url, useLinks, type SectionProps } from '@vendua/kernel';
import { Reveal } from './_shared/Reveal.tsx';

export const schema = defineSection({
  type: 'store:closing',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 80, default: '' }),
    text: text({ max: 200 }),
    ctaLabel: text({ max: 40 }),
    ctaHref: url(),
    /** shown next to the store's WhatsApp link when the store has one */
    whatsappLabel: text({ max: 40, default: 'Chamar no WhatsApp' }),
  },
});

export default function Closing({ settings: s }: SectionProps<typeof schema>) {
  const { whatsapp } = useLinks().contacts;
  return (
    <section className="container closing-wrap">
      <Reveal className="closing">
        <div className="closing-copy">
          {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
          <h2 className="display display-lg">{s.title}</h2>
          {s.text ? <p className="closing-text">{s.text}</p> : null}
        </div>
        <div className="closing-actions">
          {s.ctaLabel && s.ctaHref ? (
            <Link to={s.ctaHref} className="btn btn-lg btn-light">
              {s.ctaLabel}
            </Link>
          ) : null}
          {whatsapp ? (
            <a
              className="btn-ghost btn-lg btn-ghost--light"
              href={whatsapp.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <MessageCircle size={18} aria-hidden="true" /> {s.whatsappLabel}
            </a>
          ) : null}
        </div>
      </Reveal>
    </section>
  );
}
