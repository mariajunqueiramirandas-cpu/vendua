import { Link } from 'react-router-dom';
import {
  BlockArea,
  defineSection,
  image,
  text,
  url,
  useCopy,
  type SectionProps,
} from '@vendua/kernel';
import { ProductFigure } from './_shared/ProductFigure.tsx';
import { StatusPill } from './_shared/StatusPill.tsx';
import { flavorOf } from './_shared/flavor.ts';

export const schema = defineSection({
  type: 'store:hero',
  settings: {
    eyebrow: text({ max: 80 }),
    title: text({ max: 60, default: '' }),
    titleEmphasis: text({ max: 60 }),
    text: text({ max: 300 }),
    ctaLabel: text({ max: 40 }),
    ctaHref: url(),
    secondaryLabel: text({ max: 40 }),
    secondaryHref: url(),
    image: image(),
    imageAlt: text({ max: 160, default: '' }),
    /** the round sticker on the photo */
    figTitle: text({ max: 60 }),
    figSub: text({ max: 80 }),
    /** short promises under the buttons, separated by "|" */
    proof: text({ max: 160 }),
  },
  areas: { after: { accepts: ['promo', 'badge', 'info'], max: 2 } },
});

export default function Hero({ settings: s }: SectionProps<typeof schema>) {
  // "{city}" in copy is filled from the store profile, so one template reads right anywhere
  const { interpolate: fill } = useCopy();
  const proof = (s.proof ?? '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="hero-pill rise-in rise-in-1">
            <StatusPill />
            {s.eyebrow ? <span>{fill(s.eyebrow)}</span> : null}
          </p>
          <h1 className="display display-xl rise-in rise-in-2">
            {s.title}
            {s.titleEmphasis ? (
              <>
                {' '}
                <em>{s.titleEmphasis}</em>
              </>
            ) : null}
          </h1>
          {s.text ? <p className="hero-sub rise-in rise-in-3">{fill(s.text)}</p> : null}
          <div className="hero-cta rise-in rise-in-4">
            {s.ctaLabel && s.ctaHref ? (
              <Link to={s.ctaHref} className="btn btn-lg">
                {s.ctaLabel}
              </Link>
            ) : null}
            {s.secondaryLabel && s.secondaryHref ? (
              <Link to={s.secondaryHref} className="btn-ghost btn-lg">
                {s.secondaryLabel}
              </Link>
            ) : null}
          </div>
          {proof.length > 0 ? (
            <ul className="hero-proof rise-in rise-in-4">
              {proof.map((p) => (
                <li key={p}>{fill(p)}</li>
              ))}
            </ul>
          ) : null}
          <BlockArea name="after" className="hero-after" />
        </div>
        <figure className="hero-visual rise-in rise-in-3">
          <div className="hero-arch">
            {s.image ? (
              <img src={s.image} alt={s.imageAlt} {...{ fetchpriority: 'high' }} decoding="async" />
            ) : (
              <ProductFigure
                title="Pudim artesanal"
                flavor={flavorOf('tradicional')}
                className="hero-art"
              />
            )}
          </div>
          {s.figTitle ? (
            <figcaption className="hero-sticker">
              <span className="hero-sticker-title">{s.figTitle}</span>
              {s.figSub ? <span className="hero-sticker-sub">{s.figSub}</span> : null}
            </figcaption>
          ) : null}
        </figure>
      </div>
    </section>
  );
}
