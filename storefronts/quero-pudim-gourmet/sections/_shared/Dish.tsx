import { Check, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AddToCart,
  ProductImage,
  ProductLink,
  priceDisplay,
  priceWords,
  productAnchor,
  useCardState,
  useStore,
  type CardState,
  type CatalogProduct,
  type PriceDisplay,
} from '@vendua/kernel';
import { DishArt, dishOf } from './DishArt.tsx';
import { Price } from './Price.tsx';
import { useInBag } from './useInBag.ts';

export interface DishLabels {
  add: string;
  soldOut: string;
  lowStock: string;
  preorder: string;
  inBag: string;
  allInBag: string;
}

interface DishProps {
  product: CatalogProduct;
  category?: string | undefined;
  labels: DishLabels;
}

function useDish(p: CatalogProduct) {
  const card = useCardState(p);
  const inBag = useInBag(p.id);
  // counts adds, so every tap replays the "+1" even while the last one is still showing
  const [adds, setAdds] = useState(0);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1400);
    return () => clearTimeout(t);
  }, [added, adds]);
  // AddToCart already gives the haptic tick
  const onAdded = () => {
    setAdds((n) => n + 1);
    setAdded(true);
  };
  return { card, inBag, adds, added, onAdded };
}

type DishState = ReturnType<typeof useDish>;

function Media({
  p,
  category,
  d,
  labels,
  sizes,
}: {
  p: CatalogProduct;
  category: string | undefined;
  d: DishState;
  labels: DishLabels;
  sizes: string;
}) {
  return (
    // the photo morphs into the product page's picture (data-vt-dst on store:dish-media)
    <span className="dish-media" data-vt-src={`product:${p.slug}`}>
      <ProductImage
        product={p}
        alt=""
        width={176}
        height={176}
        sizes={sizes}
        fallback={<DishArt dish={p.kind === 'combo' ? 'box' : dishOf(p.name, category)} />}
      />
      {d.card.soldOut ? <span className="dish-stamp">{labels.soldOut}</span> : null}
      {d.inBag > 0 ? (
        <span key={d.inBag} className="dish-inbag" aria-label={`${d.inBag} ${labels.inBag}`}>
          {d.inBag}
        </span>
      ) : null}
    </span>
  );
}

// the Kernel picks the one badge; the words are the menu's
function Tags({ card, labels }: { card: CardState; labels: DishLabels }) {
  switch (card.badge) {
    case 'sold-out':
      return card.scheduleLabel ? <span className="dish-tag">{card.scheduleLabel}</span> : null;
    case 'all-in-bag':
      return <span className="dish-tag">{labels.allInBag}</span>;
    case 'low-stock':
      return (
        <span className="dish-tag" data-tone="spark">
          {labels.lowStock}
          {card.stockLeft ? ` ${card.stockLeft}` : ''}
        </span>
      );
    case 'preorder':
      return <span className="dish-tag">{labels.preorder}</span>;
    default:
      return null;
  }
}

function AddButton({ p, d, labels }: { p: CatalogProduct; d: DishState; labels: DishLabels }) {
  if (d.card.soldOut) return null;
  // everything left is already in the sacola: say so rather than offer a dead "+"
  if (d.card.allInBag)
    return (
      <span className="dish-add" data-kind="full" aria-hidden="true">
        <Check size={20} strokeWidth={2.6} />
      </span>
    );
  if (!d.card.canQuickAdd)
    return (
      <span className="dish-add" data-kind="choose" aria-hidden="true">
        <ChevronRight size={20} strokeWidth={2.4} />
      </span>
    );
  return (
    <AddToCart product={p} asChild onAdded={d.onAdded}>
      <button
        type="button"
        className="dish-add"
        data-added={d.added || undefined}
        aria-label={`${labels.add}: ${p.name}`}
      >
        <span className="dish-add-icon" key={d.added ? `ok${d.adds}` : 'plus'}>
          {d.added ? (
            <Check size={20} strokeWidth={2.6} aria-hidden="true" />
          ) : (
            <Plus size={20} strokeWidth={2.6} aria-hidden="true" />
          )}
        </span>
        {d.added ? (
          <span key={d.adds} className="dish-plus1" aria-hidden="true">
            +1
          </span>
        ) : null}
      </button>
    </AddToCart>
  );
}

// Core's price in the form the Kernel decides: "a partir de", "de … por …" or plain
function DishPrice({ shown }: { shown: PriceDisplay }) {
  if (shown.form === 'from')
    return (
      <span className="dish-price">
        <span className="price-cur">a partir de</span> <Price cents={shown.cents} />
      </span>
    );
  if (shown.struckCents !== null)
    return (
      <span className="dish-price">
        <s className="dish-struck" aria-hidden="true">
          <Price cents={shown.struckCents} />
        </s>{' '}
        <Price cents={shown.cents} />
      </span>
    );
  return <Price cents={shown.cents} className="dish-price" />;
}

function useLinkLabel(p: CatalogProduct, shown: PriceDisplay, d: DishState, labels: DishLabels) {
  const { store } = useStore();
  return `${p.name}, ${priceWords(shown, store?.currency)}${d.card.soldOut ? `, ${labels.soldOut}` : ''}${d.inBag ? `, ${d.inBag} ${labels.inBag}` : ''}`;
}

/** A menu line: words on the left, the dish on the right, one-tap add on the photo's corner. */
export function DishRow({ product: p, category, labels }: DishProps) {
  const d = useDish(p);
  const shown = priceDisplay(p);
  const label = useLinkLabel(p, shown, d, labels);
  return (
    // the Kernel scrolls a #produto-<slug> link here and marks it data-target for a moment
    <li id={productAnchor(p.slug)} className="dish" data-soldout={d.card.soldOut || undefined}>
      <ProductLink product={p} asChild>
        <a className="dish-link" aria-label={label}>
          <span className="dish-text">
            <span className="dish-name">{p.name}</span>
            {p.description ? <span className="dish-desc">{p.description}</span> : null}
            <span className="dish-foot">
              <DishPrice shown={shown} />
              <Tags card={d.card} labels={labels} />
            </span>
          </span>
          <Media
            p={p}
            category={category}
            d={d}
            labels={labels}
            sizes="(min-width: 880px) 120px, 104px"
          />
        </a>
      </ProductLink>
      <AddButton p={p} d={d} labels={labels} />
    </li>
  );
}

/** The same dish as a small upright card, for rails of highlights. */
export function DishCard({ product: p, category, labels }: DishProps) {
  const d = useDish(p);
  const shown = priceDisplay(p);
  const label = useLinkLabel(p, shown, d, labels);
  return (
    <li className="dish-card" data-soldout={d.card.soldOut || undefined}>
      <ProductLink product={p} asChild>
        <a className="dish-card-link" aria-label={label}>
          <Media
            p={p}
            category={category}
            d={d}
            labels={labels}
            sizes="(min-width: 768px) 176px, 148px"
          />
          <span className="dish-name">{p.name}</span>
          <span className="dish-foot">
            <DishPrice shown={shown} />
            <Tags card={d.card} labels={labels} />
          </span>
        </a>
      </ProductLink>
      <AddButton p={p} d={d} labels={labels} />
    </li>
  );
}
