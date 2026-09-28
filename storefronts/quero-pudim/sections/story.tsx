import { useEffect } from 'react';
import { BlockArea, defineSection, image, text, type SectionProps } from '@vendua/kernel';
import { Reveal } from './_shared/Reveal.tsx';

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
    /** a second paragraph */
    text2: text({ max: 600 }),
    /** the handwritten line under the story */
    signature: text({ max: 60 }),
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
    <section id={s.anchor} className="story">
      <div className="container story-grid">
        <Reveal className="story-media">
          <div className="story-frame">
            {s.image ? (
              <img src={s.image} alt={s.imageAlt} loading="lazy" decoding="async" />
            ) : (
              <span className="story-placeholder" aria-hidden="true" />
            )}
          </div>
        </Reveal>
        <Reveal className="story-copy" delay={80}>
          {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
          <h2 className="display display-lg">
            {s.title}
            {s.titleEmphasis ? (
              <>
                {' '}
                <em>{s.titleEmphasis}</em>
              </>
            ) : null}
          </h2>
          {s.text ? <p className="story-text">{s.text}</p> : null}
          {s.text2 ? <p className="story-text">{s.text2}</p> : null}
          {s.signature ? <p className="story-sign">{s.signature}</p> : null}
          <BlockArea name="aside" />
        </Reveal>
      </div>
    </section>
  );
}
