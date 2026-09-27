import { Link } from 'react-router-dom';
import {
  BlockArea,
  defineSection,
  image,
  text,
  url,
  useStore,
  type SectionProps,
} from '@vendua/kernel';

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
    figTitle: text({ max: 60 }),
    figSub: text({ max: 80 }),
  },
  areas: { after: { accepts: ['promo', 'badge', 'info'], max: 2 } },
});

export default function Hero({ settings: s }: SectionProps<typeof schema>) {
  const { store } = useStore();
  // "{city}" in copy is filled from the store profile, so one template reads right anywhere
  const fill = (v: string | undefined) => v?.replaceAll('{city}', store?.city ?? '');
  return (
    <section className="container" style={{ paddingBlock: '40px 48px' }}>
      {s.eyebrow ? <p className="eyebrow rise-in rise-in-1">{fill(s.eyebrow)}</p> : null}
      <div className="hero-grid" style={{ marginTop: 16 }}>
        <div>
          <h1 className="display display-xl rise-in rise-in-2">
            {s.title}
            {s.titleEmphasis ? (
              <>
                <br />
                <em>{s.titleEmphasis}</em>
              </>
            ) : null}
          </h1>
          {s.text ? <p className="hero-sub rise-in rise-in-3">{fill(s.text)}</p> : null}
          <div className="hero-cta rise-in rise-in-4">
            {s.ctaLabel && s.ctaHref ? (
              <Link to={s.ctaHref} className="btn">
                {s.ctaLabel}
              </Link>
            ) : null}
            {s.secondaryLabel && s.secondaryHref ? (
              <Link to={s.secondaryHref} className="btn-ghost">
                {s.secondaryLabel}
              </Link>
            ) : null}
          </div>
          <BlockArea name="after" className="hero-after" />
        </div>
        {s.image ? (
          <figure className="hero-fig rise-in rise-in-3">
            <div className="print-frame">
              <div className="card-frame" style={{ aspectRatio: '4/3' }}>
                <img src={s.image} alt={s.imageAlt} fetchPriority="high" decoding="async" />
              </div>
            </div>
            {s.figTitle || s.figSub ? (
              <figcaption>
                {s.figTitle ? <span className="fig-title">{s.figTitle}</span> : null}
                {s.figSub ? <span className="fig-sub">{s.figSub}</span> : null}
              </figcaption>
            ) : null}
          </figure>
        ) : null}
      </div>
    </section>
  );
}
