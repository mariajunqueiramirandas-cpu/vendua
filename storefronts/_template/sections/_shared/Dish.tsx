import { Check, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AddToCart,
  ProductLink,
  formatCents,
  useStockLeft,
  type CatalogProduct,
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
  currency: string;
  labels: DishLabels;
  highlighted?: boolean | undefined;
}

function useDish(p: CatalogProduct) {
  const soldOut = p.status !== 'active';
  const stock = useStockLeft(p);
  const inBag = useInBag(p.id);
  // counts adds, so every tap replays the "+1" even while the last one is still showing
  const [adds, setAdds] = useState(0);
  const [added, setAdded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1400);
    return () => clearTimeout(t);
  }, [added, adds]);
  const onAdded = () => {
    setAdds((n) => n + 1);
    setAdded(true);
    navigator.vibrate?.(8);
  };
  const allInBag = !soldOut && stock === 0;
  // one tap only where there is nothing to choose; the rest open the product
  const quick =
    !soldOut && !allInBag && p.needsChoices === false && p.kind !== 'combo' && !p.requiresPreorder;
  const low =
    !soldOut &&
    !allInBag &&
    (p.lowStock === true ||
      (stock !== null && typeof p.lowStockThreshold === 'number' && stock <= p.lowStockThreshold));
  return {
    soldOut,
    stock,
    inBag,
    adds,
    added,
    onAdded,
    imgFailed,
    setImgFailed,
    quick,
    low,
    allInBag,
  };
}

type DishState = ReturnType<typeof useDish>;

function Media({
  p,
  category,
  d,
  labels,
}: {
  p: CatalogProduct;
  category: string | undefined;
  d: DishState;
  labels: DishLabels;
}) {
  return (
    // the photo morphs into the product page's picture (data-vt-dst on store:dish-media)
    <span className="dish-media" data-vt-src={`product:${p.slug}`}>
      {p.imageUrl && !d.imgFailed ? (
        <img
          src={p.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => d.setImgFailed(true)}
        />
      ) : (
        <DishArt dish={p.kind === 'combo' ? 'box' : dishOf(p.name, category)} />
      )}
      {d.soldOut ? <span className="dish-stamp">{labels.soldOut}</span> : null}
      {d.inBag > 0 ? (
        <span key={d.inBag} className="dish-inbag" aria-label={`${d.inBag} ${labels.inBag}`}>
          {d.inBag}
        </span>
      ) : null}
    </span>
  );
}

function Tags({ p, d, labels }: { p: CatalogProduct; d: DishState; labels: DishLabels }) {
  if (d.soldOut)
    return p.availabilityLabel ? <span className="dish-tag">{p.availabilityLabel}</span> : null;
  if (d.allInBag) return <span className="dish-tag">{labels.allInBag}</span>;
  if (d.low)
    return (
      <span className="dish-tag" data-tone="spark">
        {labels.lowStock}
        {typeof d.stock === 'number' && d.stock > 0 ? ` ${d.stock}` : ''}
      </span>
    );
  if (p.requiresPreorder) return <span className="dish-tag">{labels.preorder}</span>;
  return null;
}

function AddButton({ p, d, labels }: { p: CatalogProduct; d: DishState; labels: DishLabels }) {
  if (d.soldOut) return null;
  // everything left is already in the sacola: say so rather than offer a dead "+"
  if (d.allInBag)
    return (
      <span className="dish-add" data-kind="full" aria-hidden="true">
        <Check size={20} strokeWidth={2.6} />
      </span>
    );
  if (!d.quick)
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

// Core's "a partir de": priced by a required list, the cheapest choice
const fromOf = (p: CatalogProduct) =>
  p.fromPriceCents != null && p.fromPriceCents > p.basePriceCents ? p.fromPriceCents : null;

function DishPrice({ p, price }: { p: CatalogProduct; price: string }) {
  if (fromOf(p) === null) return <Price text={price} className="dish-price" />;
  return (
    <span className="dish-price">
      <span className="price-cur">a partir de</span> <Price text={price} />
    </span>
  );
}

const linkLabel = (p: CatalogProduct, price: string, d: DishState, labels: DishLabels) =>
  `${p.name}, ${fromOf(p) !== null ? 'a partir de ' : ''}${price}${d.soldOut ? `, ${labels.soldOut}` : ''}${d.inBag ? `, ${d.inBag} ${labels.inBag}` : ''}`;

/** A menu line: words on the left, the dish on the right, one-tap add on the photo's corner. */
export function DishRow({ product: p, category, currency, labels, highlighted }: DishProps) {
  const d = useDish(p);
  const price = formatCents(fromOf(p) ?? p.basePriceCents, currency);
  return (
    <li
      id={`produto-${p.slug}`}
      className="dish"
      data-soldout={d.soldOut || undefined}
      data-hit={highlighted || undefined}
    >
      <ProductLink product={p} asChild>
        <a className="dish-link" aria-label={linkLabel(p, price, d, labels)}>
          <span className="dish-text">
            <span className="dish-name">{p.name}</span>
            {p.description ? <span className="dish-desc">{p.description}</span> : null}
            <span className="dish-foot">
              <DishPrice p={p} price={price} />
              <Tags p={p} d={d} labels={labels} />
            </span>
          </span>
          <Media p={p} category={category} d={d} labels={labels} />
        </a>
      </ProductLink>
      <AddButton p={p} d={d} labels={labels} />
    </li>
  );
}

/** The same dish as a small upright card, for rails of highlights. */
export function DishCard({ product: p, category, currency, labels }: DishProps) {
  const d = useDish(p);
  const price = formatCents(fromOf(p) ?? p.basePriceCents, currency);
  return (
    <li className="dish-card" data-soldout={d.soldOut || undefined}>
      <ProductLink product={p} asChild>
        <a className="dish-card-link" aria-label={linkLabel(p, price, d, labels)}>
          <Media p={p} category={category} d={d} labels={labels} />
          <span className="dish-name">{p.name}</span>
          <span className="dish-foot">
            <DishPrice p={p} price={price} />
            <Tags p={p} d={d} labels={labels} />
          </span>
        </a>
      </ProductLink>
      <AddButton p={p} d={d} labels={labels} />
    </li>
  );
}
