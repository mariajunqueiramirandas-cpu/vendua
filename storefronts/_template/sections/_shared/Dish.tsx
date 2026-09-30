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
import { useInBag } from './useInBag.ts';

export interface DishLabels {
  add: string;
  soldOut: string;
  lowStock: string;
  preorder: string;
  inBag: string;
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
  const [added, setAdded] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1400);
    return () => clearTimeout(t);
  }, [added]);
  const allInBag = !soldOut && stock === 0;
  // one tap only where there is nothing to choose; the rest open the product
  const quick =
    !soldOut && !allInBag && p.needsChoices === false && p.kind !== 'combo' && !p.requiresPreorder;
  const low =
    !soldOut &&
    !allInBag &&
    (p.lowStock === true ||
      (stock !== null && typeof p.lowStockThreshold === 'number' && stock <= p.lowStockThreshold));
  return { soldOut, stock, inBag, added, setAdded, imgFailed, setImgFailed, quick, low };
}

function Media({
  p,
  category,
  imgFailed,
  onFail,
  inBag,
  labels,
  soldOut,
}: {
  p: CatalogProduct;
  category: string | undefined;
  imgFailed: boolean;
  onFail: () => void;
  inBag: number;
  labels: DishLabels;
  soldOut: boolean;
}) {
  return (
    <span className="dish-media">
      {p.imageUrl && !imgFailed ? (
        <img src={p.imageUrl} alt="" loading="lazy" decoding="async" onError={onFail} />
      ) : (
        <DishArt dish={p.kind === 'combo' ? 'box' : dishOf(p.name, category)} />
      )}
      {soldOut ? <span className="dish-stamp">{labels.soldOut}</span> : null}
      {inBag > 0 ? (
        <span key={inBag} className="dish-inbag" aria-label={`${inBag} ${labels.inBag}`}>
          {inBag}
        </span>
      ) : null}
    </span>
  );
}

function Tags({
  p,
  low,
  stock,
  labels,
  soldOut,
}: {
  p: CatalogProduct;
  low: boolean;
  stock: number | null;
  labels: DishLabels;
  soldOut: boolean;
}) {
  if (soldOut)
    return p.availabilityLabel ? <span className="dish-tag">{p.availabilityLabel}</span> : null;
  if (low)
    return (
      <span className="dish-tag" data-tone="spark">
        {labels.lowStock}
        {typeof stock === 'number' && stock > 0 ? ` ${stock}` : ''}
      </span>
    );
  if (p.requiresPreorder) return <span className="dish-tag">{labels.preorder}</span>;
  return null;
}

function AddButton({
  p,
  quick,
  soldOut,
  added,
  onAdded,
  labels,
}: {
  p: CatalogProduct;
  quick: boolean;
  soldOut: boolean;
  added: boolean;
  onAdded: () => void;
  labels: DishLabels;
}) {
  if (soldOut) return null;
  if (!quick)
    return (
      <span className="dish-add" data-kind="choose" aria-hidden="true">
        <ChevronRight size={20} strokeWidth={2.4} />
      </span>
    );
  return (
    <AddToCart product={p} asChild onAdded={onAdded}>
      <button
        type="button"
        className="dish-add"
        data-added={added || undefined}
        aria-label={`${labels.add}: ${p.name}`}
      >
        {added ? (
          <Check size={20} strokeWidth={2.6} aria-hidden="true" />
        ) : (
          <Plus size={20} strokeWidth={2.6} aria-hidden="true" />
        )}
      </button>
    </AddToCart>
  );
}

/** A menu line: words on the left, the dish on the right, one-tap add on the photo's corner. */
export function DishRow({ product: p, category, currency, labels, highlighted }: DishProps) {
  const d = useDish(p);
  const price = formatCents(p.basePriceCents, currency);
  return (
    <li
      id={`produto-${p.slug}`}
      className="dish"
      data-soldout={d.soldOut || undefined}
      data-hit={highlighted || undefined}
    >
      <ProductLink product={p} asChild>
        <a
          className="dish-link"
          aria-label={`${p.name}, ${price}${d.soldOut ? `, ${labels.soldOut}` : ''}`}
        >
          <span className="dish-text">
            <span className="dish-name">{p.name}</span>
            {p.description ? <span className="dish-desc">{p.description}</span> : null}
            <span className="dish-foot">
              <span className="dish-price">{price}</span>
              <Tags p={p} low={d.low} stock={d.stock} labels={labels} soldOut={d.soldOut} />
            </span>
          </span>
          <Media
            p={p}
            category={category}
            imgFailed={d.imgFailed}
            onFail={() => d.setImgFailed(true)}
            inBag={d.inBag}
            labels={labels}
            soldOut={d.soldOut}
          />
        </a>
      </ProductLink>
      <AddButton
        p={p}
        quick={d.quick}
        soldOut={d.soldOut}
        added={d.added}
        onAdded={() => d.setAdded(true)}
        labels={labels}
      />
    </li>
  );
}

/** The same dish as a small upright card, for rails of highlights. */
export function DishCard({ product: p, category, currency, labels }: DishProps) {
  const d = useDish(p);
  const price = formatCents(p.basePriceCents, currency);
  return (
    <li className="dish-card" data-soldout={d.soldOut || undefined}>
      <ProductLink product={p} asChild>
        <a
          className="dish-card-link"
          aria-label={`${p.name}, ${price}${d.soldOut ? `, ${labels.soldOut}` : ''}`}
        >
          <Media
            p={p}
            category={category}
            imgFailed={d.imgFailed}
            onFail={() => d.setImgFailed(true)}
            inBag={d.inBag}
            labels={labels}
            soldOut={d.soldOut}
          />
          <span className="dish-name">{p.name}</span>
          <span className="dish-foot">
            <span className="dish-price">{price}</span>
            <Tags p={p} low={d.low} stock={d.stock} labels={labels} soldOut={d.soldOut} />
          </span>
        </a>
      </ProductLink>
      <AddButton
        p={p}
        quick={d.quick}
        soldOut={d.soldOut}
        added={d.added}
        onAdded={() => d.setAdded(true)}
        labels={labels}
      />
    </li>
  );
}
