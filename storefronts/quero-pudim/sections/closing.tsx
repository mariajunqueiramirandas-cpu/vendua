import { Link } from 'react-router-dom';
import { defineSection, text, url, type SectionProps } from '@vendua/kernel';

export const schema = defineSection({
  type: 'store:closing',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 80, default: '' }),
    text: text({ max: 200 }),
    ctaLabel: text({ max: 40 }),
    ctaHref: url(),
  },
});

export default function Closing({ settings: s }: SectionProps<typeof schema>) {
  return (
    <section className="ficha-rule closing">
      <div className="container" style={{ paddingBlock: 64 }}>
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        <h2 className="display display-lg" style={{ marginTop: 16 }}>
          {s.title}
        </h2>
        {s.text ? (
          <p className="hero-sub" style={{ marginTop: 8 }}>
            {s.text}
          </p>
        ) : null}
        {s.ctaLabel && s.ctaHref ? (
          <Link to={s.ctaHref} className="btn" style={{ marginTop: 32 }}>
            {s.ctaLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}
