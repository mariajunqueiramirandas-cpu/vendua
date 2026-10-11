import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  category,
  defineSection,
  number,
  text,
  useCatalog,
  usePageContext,
  useReducedMotion,
  type SectionProps,
} from '@vendua/kernel';
import { DishCard, type DishLabels } from './_shared/Dish.tsx';

// A swipeable row of dishes: the store's highlights on the home page, "peça também" under a product.
export const schema = defineSection({
  type: 'store:menu-rail',
  settings: {
    title: text({ max: 60, default: 'Destaques' }),
    category: category(),
    limit: number({ min: 2, max: 12, default: 8 }),
    addLabel: text({ max: 30, default: 'adicionar' }),
    soldOutLabel: text({ max: 30, default: 'esgotado' }),
    lowStockLabel: text({ max: 30, default: 'restam' }),
    preorderLabel: text({ max: 30, default: 'sob encomenda' }),
    inBagLabel: text({ max: 30, default: 'na sacola' }),
    allInBagLabel: text({ max: 30, default: 'tudo na sacola' }),
    prevLabel: text({ max: 30, default: 'Anteriores' }),
    nextLabel: text({ max: 30, default: 'Próximos' }),
  },
});

// which ends of the strip still have dishes past them
function useEnds(list: RefObject<HTMLOListElement>, count: number) {
  const [ends, setEnds] = useState({ start: true, end: true });
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const read = () =>
      setEnds({
        start: el.scrollLeft <= 4,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
      });
    read();
    el.addEventListener('scroll', read, { passive: true });
    // an old WebView has no ResizeObserver: the window's resize stands in
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    if (ro) ro.observe(el);
    else window.addEventListener('resize', read);
    return () => {
      el.removeEventListener('scroll', read);
      ro?.disconnect();
      window.removeEventListener('resize', read);
    };
  }, [list, count]);
  return ends;
}

export default function MenuRail({ settings: s }: SectionProps<typeof schema>) {
  const { categories } = useCatalog();
  const { params } = usePageContext();
  const titleId = useId();
  const list = useRef<HTMLOListElement>(null);
  const still = useReducedMotion();

  // one of each category first, so the rail shows the range of the menu; photos lead
  const picks = useMemo(() => {
    const pool = categories
      .filter((c) => !s.category || c.slug === s.category)
      .map((c) => ({
        name: c.name,
        products: c.products.filter((p) => p.status === 'active' && p.slug !== params.slug),
      }));
    const rounds: { product: (typeof pool)[number]['products'][number]; category: string }[] = [];
    for (let i = 0; rounds.length < s.limit && pool.some((c) => c.products[i]); i++)
      for (const c of pool)
        if (c.products[i]) rounds.push({ product: c.products[i]!, category: c.name });
    return rounds
      .slice(0, s.limit)
      .sort((a, b) => Number(!a.product.imageUrl) - Number(!b.product.imageUrl));
  }, [categories, s.category, s.limit, params.slug]);

  const ends = useEnds(list, picks.length);

  if (picks.length < 2) return null;

  const page = (dir: 1 | -1) => {
    const el = list.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: still ? 'auto' : 'smooth' });
  };

  const labels: DishLabels = {
    add: s.addLabel,
    soldOut: s.soldOutLabel,
    lowStock: s.lowStockLabel,
    preorder: s.preorderLabel,
    inBag: s.inBagLabel,
    allInBag: s.allInBagLabel,
  };

  return (
    <section className="rail" aria-labelledby={titleId}>
      <div className="rail-head">
        <h2 id={titleId} className="rail-title">
          {s.title}
        </h2>
        {ends.start && ends.end ? null : (
          <div className="rail-nav">
            <button
              type="button"
              aria-label={s.prevLabel}
              disabled={ends.start}
              onClick={() => page(-1)}
            >
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={s.nextLabel}
              disabled={ends.end}
              onClick={() => page(1)}
            >
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <ol
        className="rail-list"
        ref={list}
        data-start={ends.start || undefined}
        data-end={ends.end || undefined}
      >
        {picks.map(({ product, category: c }) => (
          <DishCard key={product.id} product={product} category={c} labels={labels} />
        ))}
      </ol>
    </section>
  );
}
