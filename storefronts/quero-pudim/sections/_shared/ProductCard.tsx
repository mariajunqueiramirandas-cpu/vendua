import { Check, Plus } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import {
  AddToCart,
  ProductLink,
  ProductPrice,
  productPriceLabel,
  useStockLeft,
  useStore,
  type CatalogProduct,
} from '@vendua/kernel';
import { ProductFigure } from './ProductFigure.tsx';
import { flavorOf, KIT_FLAVOR } from './flavor.ts';

export interface ProductCardProps {
  product: CatalogProduct;
  /** small line above the name (category or a caption) */
  eyebrow?: string | undefined;
  /** 01, 02… on the ficha */
  number?: string | undefined;
  /** label on the go-to-product affordance for items that need choices */
  cta?: string | undefined;
  soldOutLabel?: string | undefined;
  lowStockThreshold?: number | undefined;
  highlighted?: boolean | undefined;
  /** larger, horizontal on wide screens */
  feature?: boolean | undefined;
}

/** Product card: tinted media (photo or flavour art), one-tap add where nothing needs choosing. */
export function ProductCard({
  product: p,
  eyebrow,
  number,
  cta,
  soldOutLabel = 'Esgotado hoje',
  lowStockThreshold = 5,
  highlighted,
  feature,
}: ProductCardProps) {
  const soldOut = p.status === 'sold_out';
  const stock = useStockLeft(p);
  const currency = useStore().store?.currency;
  const low = !soldOut && typeof stock === 'number' && stock > 0 && stock <= lowStockThreshold;
  const flavor = p.kind === 'combo' ? KIT_FLAVOR : flavorOf(p.name);
  const [imgFailed, setImgFailed] = useState(false);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1600);
    return () => clearTimeout(t);
  }, [added]);
  // every unit left is already in the sacola: no quick add
  const allInBag = !soldOut && stock === 0;
  const quick =
    !soldOut && !allInBag && p.needsChoices === false && p.kind !== 'combo' && !p.requiresPreorder;
  const tag = allInBag ? 'Tudo na sacola' : p.requiresPreorder ? 'Sob encomenda' : null;

  return (
    <li
      id={`produto-${p.slug}`}
      className="pcard"
      data-soldout={soldOut || undefined}
      data-feature={feature || undefined}
      data-hit={highlighted || undefined}
      style={{ '--tint': flavor.tint } as CSSProperties}
    >
      <ProductLink product={p} asChild>
        <a
          className="pcard-link"
          aria-label={`${p.name}, ${productPriceLabel(p, currency)}${soldOut ? `, ${soldOutLabel}` : ''}`}
        >
          <div className="pcard-media">
            {p.imageUrl && !imgFailed ? (
              <img
                src={p.imageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <ProductFigure
                variant={p.figureVariant}
                kind={p.kind}
                title={p.name}
                flavor={flavor}
                className="pcard-art"
              />
            )}
            {soldOut ? <span className="pcard-flag">{soldOutLabel}</span> : null}
            {low ? <span className="pcard-flag pcard-flag--low">Restam {stock}</span> : null}
            {!soldOut && !low && tag ? (
              <span className="pcard-flag pcard-flag--soft">{tag}</span>
            ) : null}
            {number ? <span className="pcard-num">{number}</span> : null}
          </div>
          <div className="pcard-body">
            {eyebrow ? <p className="pcard-eyebrow">{eyebrow}</p> : null}
            <h3 className="pcard-name">{p.name}</h3>
            {p.description ? <p className="pcard-desc">{p.description}</p> : null}
            <p className="pcard-foot">
              <ProductPrice product={p} className="pcard-price" />
              {!quick && !soldOut && cta ? <span className="pcard-cta">{cta}</span> : null}
            </p>
          </div>
        </a>
      </ProductLink>
      {quick ? (
        <AddToCart product={p} asChild onAdded={() => setAdded(true)}>
          <button
            type="button"
            className="pcard-add"
            data-added={added || undefined}
            aria-label={added ? `${p.name} adicionado` : `Adicionar ${p.name} à sacola`}
          >
            {added ? <Check size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
          </button>
        </AddToCart>
      ) : null}
    </li>
  );
}
