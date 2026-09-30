import { useId, useMemo } from 'react';
import {
  category,
  defineSection,
  number,
  text,
  useCatalog,
  usePageContext,
  useStore,
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
  },
});

export default function MenuRail({ settings: s }: SectionProps<typeof schema>) {
  const { categories } = useCatalog();
  const { store } = useStore();
  const { params } = usePageContext();
  const titleId = useId();

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

  if (picks.length < 2) return null;

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
      <h2 id={titleId} className="rail-title">
        {s.title}
      </h2>
      <ol className="rail-list">
        {picks.map(({ product, category: c }) => (
          <DishCard
            key={product.id}
            product={product}
            category={c}
            currency={store?.currency ?? 'BRL'}
            labels={labels}
          />
        ))}
      </ol>
    </section>
  );
}
