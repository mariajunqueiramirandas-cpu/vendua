import { Link } from 'react-router-dom';
import {
  BlockArea,
  ProductLink,
  boolean,
  category,
  defineSection,
  number,
  text,
  url,
  useCatalog,
  type SectionProps,
} from '@vendua/kernel';
import { ProductFigure } from './_shared/ProductFigure.tsx';
import { Skeleton } from './_shared/Skeleton.tsx';
import { formatBRL, twoDigits } from './_shared/format.ts';

// Product showcase in the "ficha" style: numbered or captioned print-frame cards.
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
    <section className="container ficha-rule" style={{ paddingBlock: '32px 64px' }}>
      <div className="section-head">
        {s.eyebrow ? <p className="eyebrow">{s.eyebrow}</p> : null}
        {s.title ? <h2 className="display display-lg">{s.title}</h2> : null}
        {s.lede ? <p className="lede">{s.lede}</p> : null}
      </div>
      <BlockArea name="before-grid" />
      {loading && products.length === 0 ? (
        <div className="card-grid" aria-busy="true" aria-label="Carregando destaques">
          {Array.from({ length: s.limit }, (_, i) => (
            <div key={i}>
              <Skeleton style={{ aspectRatio: '1', width: '100%' }} />
              <div style={{ paddingTop: 12, display: 'grid', gap: 8 }}>
                <Skeleton style={{ height: 12, width: '40%' }} />
                <Skeleton style={{ height: 22, width: '80%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ol className="card-grid">
          {products.map((p, i) => (
            <li key={p.id}>
              <ProductLink product={p} asChild>
                <a className="card-link" aria-label={`${p.name}, ${formatBRL(p.basePriceCents)}`}>
                  <div className="print-frame">
                    <div className="card-frame">
                      <div className="card-figure">
                        <ProductFigure variant={p.figureVariant} title={p.name} />
                      </div>
                    </div>
                  </div>
                  {s.numbered ? (
                    <p className="ficha-num" style={{ marginTop: 12 }}>
                      {twoDigits(i + 1)}
                    </p>
                  ) : s.cardCaption ? (
                    <p className="card-cat">{s.cardCaption}</p>
                  ) : null}
                  <h3 className="card-name">{p.name}</h3>
                  <div className="card-foot">
                    <span className="card-price">{formatBRL(p.basePriceCents)}</span>
                    {s.cardCta ? <span className="card-cta">{s.cardCta}</span> : null}
                  </div>
                </a>
              </ProductLink>
            </li>
          ))}
        </ol>
      )}
      {s.ctaLabel && s.ctaHref ? (
        <Link to={s.ctaHref} className="btn" style={{ marginTop: 40 }}>
          {s.ctaLabel}
        </Link>
      ) : null}
    </section>
  );
}
