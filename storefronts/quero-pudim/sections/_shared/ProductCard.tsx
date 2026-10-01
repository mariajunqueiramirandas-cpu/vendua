import { Check, Plus } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import {
  AddToCart,
  ProductImage,
  ProductLink,
  priceDisplay,
  priceWords,
  productAnchor,
  useCardState,
  useMoney,
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
  /** larger, horizontal on wide screens */
  feature?: boolean | undefined;
}

/** Product card: tinted media (photo or flavour art), one-tap add where nothing needs choosing.
 *  What it shows is the Kernel's call (`useCardState`, `priceDisplay`); the words are ours. */
export function ProductCard({
  product: p,
  eyebrow,
  number,
  cta,
  soldOutLabel = 'Esgotado hoje',
  feature,
}: ProductCardProps) {
  const card = useCardState(p);
  const price = priceDisplay(p);
  const money = useMoney();
  const { store } = useStore();
  const flavor = p.kind === 'combo' ? KIT_FLAVOR : flavorOf(p.name);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(false), 1600);
    return () => clearTimeout(t);
  }, [added]);
  // a product off its schedule says when it's back (Core's words) instead of "esgotado hoje"
  const soldOutText = card.scheduleLabel ?? soldOutLabel;
  const flag =
    card.badge === 'sold-out'
      ? { text: soldOutText, tone: undefined }
      : card.badge === 'low-stock'
        ? { text: `Restam ${card.stockLeft}`, tone: 'low' }
        : card.badge === 'all-in-bag'
          ? { text: 'Tudo na sacola', tone: 'soft' }
          : card.badge === 'preorder'
            ? { text: 'Sob encomenda', tone: 'soft' }
            : null;

  return (
    <li
      id={productAnchor(p.slug)}
      className="pcard"
      data-soldout={card.soldOut || undefined}
      data-feature={feature || undefined}
      style={{ '--tint': flavor.tint } as CSSProperties}
    >
      <ProductLink product={p} asChild>
        <a
          className="pcard-link"
          aria-label={`${p.name}, ${priceWords(price, store?.currency)}${card.soldOut ? `, ${soldOutText}` : ''}`}
        >
          <div className="pcard-media">
            <ProductImage
              product={p}
              alt=""
              sizes="(max-width: 639px) 50vw, (max-width: 1023px) 33vw, 300px"
              fallback={
                <ProductFigure
                  variant={p.figureVariant}
                  kind={p.kind}
                  title={p.name}
                  flavor={flavor}
                  className="pcard-art"
                />
              }
            />
            {flag ? (
              <span
                className={`pcard-flag${flag.tone ? ` pcard-flag--${flag.tone}` : ''}`}
                data-badge={card.badge}
              >
                {flag.text}
              </span>
            ) : null}
            {number ? <span className="pcard-num">{number}</span> : null}
          </div>
          <div className="pcard-body">
            {eyebrow ? <p className="pcard-eyebrow">{eyebrow}</p> : null}
            <h3 className="pcard-name">{p.name}</h3>
            {p.description ? <p className="pcard-desc">{p.description}</p> : null}
            {price.promoLabel ? <p className="pcard-promo">Promoção · {price.promoLabel}</p> : null}
            <p className="pcard-foot">
              <span className="pcard-price" data-form={price.form}>
                {price.struckCents !== null ? (
                  <s className="pcard-was">{money(price.struckCents)}</s>
                ) : null}
                {price.form === 'from' ? <small className="pcard-from">a partir de </small> : null}
                {money(price.cents)}
              </span>
              {!card.canQuickAdd && !card.soldOut && cta ? (
                <span className="pcard-cta">{cta}</span>
              ) : null}
            </p>
          </div>
        </a>
      </ProductLink>
      {card.canQuickAdd ? (
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
