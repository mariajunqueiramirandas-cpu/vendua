import { useEffect, useRef, useState } from 'react';
import {
  Img,
  defineBlock,
  usePageContext,
  useProduct,
  useReducedMotion,
  type BlockProps,
} from '@vendua/kernel';
import { DishArt, dishOf } from './_shared/DishArt.tsx';

// The product page's picture, in the SDK purchase panel's `media` area: the photos when there
// are any (swipeable when there are several), the same drawn dish as the menu when there are none.
// Its own strip rather than the Kernel's catalog.Gallery: the menu's dots sit on the photo, with
// no thumbnail row.
export const schema = defineBlock({
  type: 'store:dish-media',
  category: 'media',
  settings: {},
});

export default function DishMedia(_: BlockProps<typeof schema>) {
  const { params } = usePageContext();
  const { product } = useProduct(params.slug ?? '');
  const still = useReducedMotion();
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const photos = (
    product
      ? product.gallery?.length
        ? product.gallery
        : product.imageUrl
          ? [{ url: product.imageUrl, alt: null }]
          : []
      : []
  ).filter((g) => !failed.includes(g.url));
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
  // no photo, or none that loads: the drawn dish
  if (n === 0)
    return (
      <div className="pd-media" data-vt-dst={vt}>
        <DishArt dish={product.kind === 'combo' ? 'box' : dishOf(product.name)} />
      </div>
    );
  const go = (k: number) => {
    const el = strip.current;
    if (!el) return;
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
          <Img
            key={g.url}
            src={g.url}
            alt={g.alt ?? (i === 0 ? product.name : '')}
            width={960}
            height={960}
            sizes="(min-width: 720px) 560px, 100vw"
            priority={i === 0}
            draggable={false}
            onError={() => setFailed((f) => (f.includes(g.url) ? f : [...f, g.url]))}
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
