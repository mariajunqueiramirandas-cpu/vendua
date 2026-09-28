import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  BlockArea,
  boolean,
  category,
  defineSection,
  number,
  text,
  url,
  useCatalog,
  type SectionProps,
} from '@vendua/kernel';
import { ProductCard } from './_shared/ProductCard.tsx';
import { Reveal } from './_shared/Reveal.tsx';
import { Skeleton } from './_shared/Skeleton.tsx';
import { twoDigits } from './_shared/format.ts';

// Product showcase: a heading row, then cards — numbered "ficha" cards or captioned feature cards.
export const schema = defineSection({
  type: 'store:showcase',
  settings: {
    eyebrow: text({ max: 60 }),
    title: text({ max: 80 }),
    lede: text({ max: 240 }),
    category: category(),
    limit: number({ min: 1, max: 8, default: 4 }),
    numbered: boolean({ default: true }),
    cardCaption: text({ max: 30 }),
    cardCta: text({ max: 30 }),
    ctaLabel: text({ max: 40 }),
    ctaHref: url(),
    /** larger, horizontal cards — for kits and combos */
    feature: boolean({ default: false }),
  },
  areas: { 'before-grid': { accepts: ['promo', 'info'], max: 1 } },
});

export default function Showcase({ settings: s }: SectionProps<typeof schema>) {
  const { categories, loading } = useCatalog();
  const pool = s.category
    ? (categories.find((c) => c.slug === s.category)?.products ?? [])
    : categories.flatMap((c) => c.products);
  const products = pool.filter((p) => p.status === 'active').slice(0, s.limit);
  if (!loading && products.length === 0) return null;

  return (
    <section className="container showcase">
      <Reveal className="section-head section-head--row">
        <div>
          {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
          {s.title ? <h2 className="display display-lg">{s.title}</h2> : null}
          {s.lede ? <p className="lede">{s.lede}</p> : null}
        </div>
        {s.ctaLabel && s.ctaHref ? (
          <Link to={s.ctaHref} className="link-arrow">
            {s.ctaLabel} <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : null}
      </Reveal>
      <BlockArea name="before-grid" />
      {loading && products.length === 0 ? (
        <div className="card-grid" aria-busy="true" aria-label="Carregando destaques">
          {Array.from({ length: s.limit }, (_, i) => (
            <div key={i}>
              <Skeleton style={{ aspectRatio: '1', width: '100%', borderRadius: 24 }} />
              <div style={{ paddingTop: 14, display: 'grid', gap: 8 }}>
                <Skeleton style={{ height: 22, width: '75%' }} />
                <Skeleton style={{ height: 14, width: '40%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Reveal as="ol" className={`card-grid${s.feature ? ' card-grid--feature' : ''}`}>
          {products.map((p, i) => (
            <ProductCard
              key={p.id}
              product={p}
              feature={s.feature}
              number={s.numbered ? twoDigits(i + 1) : undefined}
              eyebrow={s.cardCaption}
              cta={s.cardCta}
            />
          ))}
        </Reveal>
      )}
    </section>
  );
}
