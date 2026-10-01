import { useEffect, useRef, useState } from 'react';
import { defineBlock, usePageContext, useProduct, type BlockProps } from '@vendua/kernel';
import { DishArt, dishOf } from './_shared/DishArt.tsx';

// The product page's picture, in the SDK purchase panel's `media` area: the photos when there
// are any (swipeable when there are several), the same drawn dish as the menu when there are none.
export const schema = defineBlock({
  type: 'store:dish-media',
  category: 'media',
  settings: {},
});

export default function DishMedia(_: BlockProps<typeof schema>) {
  const { params } = usePageContext();
  const { product } = useProduct(params.slug ?? '');
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const photos = product
    ? product.gallery?.length
      ? product.gallery
      : product.imageUrl
        ? [{ url: product.imageUrl, alt: null }]
        : []
    : [];
  const n = photos.length;
  // the dots follow the swipe; the strip is the only source of truth
  useEffect(() => {
    const el = strip.current;
    if (!el || n < 2) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (el.clientWidth) setAt(Math.min(n - 1, Math.round(el.scrollLeft / el.clientWidth)));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [n]);
  if (!product) return null;
  const vt = `product:${product.slug}`;
  if (n === 0)
    return (
      <div className="pd-media" data-vt-dst={vt}>
        <DishArt dish={product.kind === 'combo' ? 'box' : dishOf(product.name)} />
      </div>
    );
  const go = (k: number) => {
    const el = strip.current;
    if (!el) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: k * el.clientWidth, behavior: still ? 'auto' : 'smooth' });
  };
  return (
    <div className="pd-media pd-gallery" data-vt-dst={vt}>
      <div
        ref={strip}
        className="pd-photos"
        tabIndex={n > 1 ? 0 : undefined}
        aria-label={n > 1 ? product.name : undefined}
        role={n > 1 ? 'group' : undefined}
      >
        {photos.map((g, i) => (
          <img
            key={g.url}
            src={g.url}
            alt={g.alt ?? (i === 0 ? product.name : '')}
            loading={i === 0 ? 'eager' : 'lazy'}
            draggable={false}
            {...(i === 0 ? { fetchpriority: 'high' } : {})}
          />
        ))}
      </div>
      {n > 1 ? (
        <div className="pd-dots">
          {photos.map((g, i) => (
            <button
              key={g.url}
              type="button"
              className="pd-dot"
              aria-label={`Foto ${i + 1} de ${n}`}
              aria-current={i === at || undefined}
              onClick={() => go(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
