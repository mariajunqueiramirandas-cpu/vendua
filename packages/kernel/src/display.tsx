import { useMemo, useState, type ReactNode } from 'react';
import type { CatalogProduct } from './api.ts';
import { useStore } from './hooks.ts';
import { Img } from './primitives.tsx';
import { formatCents } from './rules/format.ts';
import { priceDisplay } from './rules/price.ts';
import { qrMatrix, qrSvgPath } from './rules/qr.ts';

// Kernel 1.14 — display components over the rules: the decision is the Kernel's, the look is
// the store's (`data-part` hooks, tokens, its own className).

export interface ProductPriceProps {
  product: Pick<CatalogProduct, 'basePriceCents'> &
    Partial<Pick<CatalogProduct, 'compareAtPriceCents' | 'fromPriceCents' | 'promoLabel'>>;
  className?: string;
}

/** Core's price as the shopper should read it: `a partir de`, `de … por …` or plain, in the
 *  store's currency. Parts: `price` (root, `data-form`), `struck`, `amount`, `from`, `promo`. */
export function ProductPrice({ product, className }: ProductPriceProps) {
  const { store } = useStore();
  const currency = store?.currency ?? 'BRL';
  const d = priceDisplay(product);
  const money = (c: number) => formatCents(c, currency);
  return (
    <span className={className} data-vendua="product-price" data-part="price" data-form={d.form}>
      {d.struckCents !== null ? (
        <>
          <s data-part="struck">
            <span className="v-sr">de </span>
            {money(d.struckCents)}
          </s>{' '}
          <span className="v-sr">por </span>
        </>
      ) : null}
      <span data-part="amount">
        {d.form === 'from' ? <span data-part="from">a partir de </span> : null}
        {money(d.cents)}
      </span>
      {d.promoLabel ? (
        <>
          {' '}
          <span data-part="promo">Promoção: {d.promoLabel}</span>
        </>
      ) : null}
    </span>
  );
}

export interface ProductImageProps {
  product: Pick<CatalogProduct, 'slug' | 'name'> & Partial<Pick<CatalogProduct, 'imageUrl'>>;
  /** `sizes` for the srcset (default: full width up to `width`) */
  sizes?: string;
  /** above the fold: eager, high fetch priority */
  priority?: boolean;
  /** shown with no photo, or when it fails to load */
  fallback?: ReactNode;
  /** intrinsic size (the ratio the box keeps while loading); default 640 × 640 */
  width?: number;
  height?: number;
  /** default: the product's name; pass '' when the name is printed beside it */
  alt?: string;
  className?: string;
}

/** The product's photo through `Img` (Core's resized copies or the CDN), the shared-photo
 *  morph source (`data-vt-src="product:<slug>"`), and `fallback` when there is none. */
export function ProductImage({
  product,
  sizes,
  priority,
  fallback = null,
  width = 640,
  height = 640,
  alt,
  className,
}: ProductImageProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = product.imageUrl;
  if (!src || failed === src) return <>{fallback}</>;
  return (
    <Img
      src={src}
      alt={alt ?? product.name}
      width={width}
      height={height}
      {...(sizes ? { sizes } : {})}
      {...(priority ? { priority } : {})}
      {...(className ? { className } : {})}
      data-vt-src={`product:${product.slug}`}
      onError={() => setFailed(src)}
    />
  );
}

export interface QrCodeProps {
  value: string;
  /** rendered px (default: fills its box) */
  size?: number;
  dark?: string;
  light?: string;
  /** what it encodes, read aloud (e.g. "QR code do cardápio") */
  title?: string;
}

/** An inline SVG QR code (the Kernel's encoder, no dependency); nothing past ~400 bytes. */
export function QrCode({ value, size, dark = '#000', light = '#fff', title }: QrCodeProps) {
  const path = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(value));
    } catch {
      return null;
    }
  }, [value]);
  if (!path) return null;
  return (
    <svg
      data-vendua="qr-code"
      viewBox={`0 0 ${path.size} ${path.size}`}
      {...(size ? { width: size, height: size } : {})}
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
      shapeRendering="crispEdges"
    >
      {title ? <title>{title}</title> : null}
      {light === 'none' ? null : <rect width={path.size} height={path.size} fill={light} />}
      <path d={path.d} fill={dark} />
    </svg>
  );
}
