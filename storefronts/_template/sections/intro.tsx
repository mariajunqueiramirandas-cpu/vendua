import { Link } from 'react-router-dom';
import { BlockArea, defineSection, text, url, type SectionProps } from '@vendua/kernel';

// A store section: bespoke markup, copy from settings, one area where SDK blocks can land.
export const schema = defineSection({
  type: 'store:intro',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 90, default: '' }),
    text: text({ max: 280 }),
    ctaLabel: text({ max: 40 }),
    ctaHref: url(),
  },
  areas: { aside: { accepts: ['promo', 'badge', 'info'], max: 2 } },
});

export default function Intro({ settings }: SectionProps<typeof schema>) {
  return (
    <section className="intro">
      <div className="intro-inner">
        {settings.eyebrow ? <p className="intro-eyebrow">{settings.eyebrow}</p> : null}
        <h1 className="intro-title">{settings.title}</h1>
        {settings.text ? <p className="intro-text">{settings.text}</p> : null}
        {settings.ctaLabel && settings.ctaHref ? (
          <Link className="intro-cta" to={settings.ctaHref}>
            {settings.ctaLabel}
          </Link>
        ) : null}
        <BlockArea name="aside" className="intro-aside" />
      </div>
    </section>
  );
}
