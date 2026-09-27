import { useEffect } from 'react';
import { BlockArea, defineSection, image, text, type SectionProps } from '@vendua/kernel';

export const schema = defineSection({
  type: 'store:story',
  settings: {
    anchor: text({ max: 40, default: 'nossa-historia' }),
    eyebrow: text({ max: 60 }),
    title: text({ max: 60, default: '' }),
    titleEmphasis: text({ max: 60 }),
    text: text({ max: 600 }),
    image: image(),
    imageAlt: text({ max: 160, default: '' }),
  },
  areas: { aside: { accepts: ['social-proof', 'badge', 'info'], max: 2 } },
});

export default function Story({ settings: s }: SectionProps<typeof schema>) {
  // /#<anchor> deep link — BrowserRouter doesn't scroll to hashes on its own
  useEffect(() => {
    if (window.location.hash !== `#${s.anchor}`) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(s.anchor)?.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth' });
  }, [s.anchor]);

  return (
    <section id={s.anchor} className="ficha-rule" style={{ scrollMarginTop: 120 }}>
      <div className="container" style={{ paddingBlock: 64 }}>
        {s.eyebrow ? (
          <p className="eyebrow" style={{ marginBottom: 24 }}>
            {s.eyebrow}
          </p>
        ) : null}
        <div className="hero-grid">
          {s.image ? (
            <figure className="hero-fig" style={{ order: 2 }}>
              <div className="print-frame">
                <div className="card-frame" style={{ aspectRatio: '4/3' }}>
                  <img src={s.image} alt={s.imageAlt} loading="lazy" decoding="async" />
                </div>
              </div>
            </figure>
          ) : null}
          <div style={{ order: 1 }}>
            <h2 className="display display-lg">
              {s.title}
              {s.titleEmphasis ? (
                <>
                  <br />
                  <em>{s.titleEmphasis}</em>
                </>
              ) : null}
            </h2>
            {s.text ? <p className="hero-sub">{s.text}</p> : null}
            <BlockArea name="aside" />
          </div>
        </div>
      </div>
    </section>
  );
}
