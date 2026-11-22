import { useId } from 'react';
import { BlockArea, defineSection, richText, text, type SectionProps } from '@vendua/kernel';

// História da marca: every word is a setting, so staff can swap in the owner's own story later.
export const schema = defineSection({
  type: 'store:story',
  title: 'História da marca',
  addable: true,
  settings: {
    kicker: text({ max: 40 }),
    title: text({ max: 90, default: '' }),
    body: richText({ max: 1200, default: '' }),
    quote: text({ max: 160 }),
  },
  areas: { aside: { accepts: ['social-proof', 'info', 'promo'], max: 2 } },
});

export default function Story({ settings: s }: SectionProps<typeof schema>) {
  const titleId = useId();
  const paragraphs = s.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!s.title && paragraphs.length === 0 && !s.quote) return null;

  return (
    <section id="historia" className="story" aria-labelledby={s.title ? titleId : undefined}>
      <div className="story-inner">
        {s.kicker || s.title ? (
          <header className="story-head">
            {s.kicker ? <p className="kicker">{s.kicker}</p> : null}
            {s.title ? (
              <h2 id={titleId} className="story-title">
                {s.title}
              </h2>
            ) : null}
            <span className="rule" aria-hidden="true" />
          </header>
        ) : null}
        <div className="story-body">
          {paragraphs.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {s.quote ? (
            <blockquote className="story-quote">
              <p>{s.quote}</p>
            </blockquote>
          ) : null}
          <BlockArea name="aside" className="story-aside" />
        </div>
      </div>
    </section>
  );
}
