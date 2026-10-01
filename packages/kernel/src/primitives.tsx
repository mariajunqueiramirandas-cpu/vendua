import {
  cloneElement,
  isValidElement,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
  type MouseEvent,
  type ImgHTMLAttributes,
} from 'react';
import { UNSAFE_LocationContext, UNSAFE_NavigationContext } from 'react-router-dom';
import { mediaSrcSet, PriceParts, priceLabel } from '@vendua/ui-defaults';
import { lineDraw, productDraw, unitsLeft, useCart, useStore } from './hooks.ts';
import { useKernel, prefetchQuery } from './provider.tsx';
import { productHref, KERNEL_PATHS } from './config.ts';
import { showError } from './errors.ts';
import { emit } from './telemetry.ts';
import type { CatalogProduct, ComboSelection, ProductDetail } from './api.ts';
import { haptic } from './haptics.ts';
import { backgroundOf } from './transitions.tsx';

/** Headless primitives (02-kernel.md): Kernel owns behavior, the storefront owns visuals via asChild — each stamps its data-vendua hook + ARIA regardless of the delegated child. */

/** Minimal asChild: compose props onto the child — onClick chains (primitive first), className concatenates, disabled ORs, child props win except the managed data-vendua/ARIA markers. */
type PrimitiveProps = Record<string, unknown> & { 'data-vendua'?: string };

function withChild(
  asChild: boolean | undefined,
  props: PrimitiveProps,
  children: ReactNode,
  as: 'button' | 'a' = 'button',
) {
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const childProps = child.props;
    const merged: Record<string, unknown> = { ...props, ...childProps };
    // data-vendua stays the primitive's marker; other aria-*/data-* are defaults the child may override
    if (props['data-vendua']) merged['data-vendua'] = props['data-vendua'];
    if (typeof props.onClick === 'function' || typeof childProps.onClick === 'function') {
      merged.onClick = (e: unknown) => {
        (props.onClick as ((e: unknown) => void) | undefined)?.(e);
        (childProps.onClick as ((e: unknown) => void) | undefined)?.(e);
      };
    }
    if (props.className || childProps.className) {
      merged.className = [props.className, childProps.className].filter(Boolean).join(' ');
    }
    if (props.disabled || childProps.disabled) merged.disabled = true;
    return cloneElement(child, merged);
  }
  if (as === 'a') return <a {...props}>{children}</a>;
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}

/** Router-agnostic navigation: SPA push inside a router, full load outside one. */
export function useNavigateTo(): (to: string, state?: unknown) => void {
  const nav = useContext(UNSAFE_NavigationContext) as {
    navigator?: { push: (to: string, state?: unknown) => void };
  } | null;
  return (to: string, state?: unknown) => {
    if (nav?.navigator) nav.navigator.push(to, state);
    else globalThis.location?.assign(to);
  };
}

/** Opens the sacola as a sheet over the current page (a page of its own from checkout). */
export function useOpenBag(): () => void {
  const go = useNavigateTo();
  const here = useContext(UNSAFE_LocationContext)?.location;
  return () => {
    if (here && backgroundOf(here)) return;
    const over =
      here && here.pathname !== KERNEL_PATHS.cart && here.pathname !== KERNEL_PATHS.checkout;
    go(KERNEL_PATHS.cart, over ? { vBackground: here } : undefined);
  };
}

const plainClick = (e: MouseEvent) =>
  e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;

export interface ProductLinkProps {
  product: Pick<CatalogProduct, 'slug'> & Partial<Pick<CatalogProduct, 'id' | 'name'>>;
  asChild?: boolean;
  children?: ReactNode;
  className?: string;
  prefetch?: boolean;
}

/** Product route resolution + prefetch; product_view fires when the target resolves (useProduct). */
export function ProductLink({
  product,
  asChild,
  children,
  className,
  prefetch = true,
}: ProductLinkProps) {
  const { config, api } = useKernel();
  const go = useNavigateTo();
  const href = productHref(config, product.slug);
  const warm = () => {
    if (prefetch) prefetchQuery(api, `product:${product.slug}`, () => api.product(product.slug));
  };
  return withChild(
    asChild,
    {
      'data-vendua': 'product-link',
      href,
      ...(className ? { className } : {}),
      onMouseEnter: warm,
      onFocus: warm,
      onTouchStart: warm,
      onClick: (e: MouseEvent<HTMLAnchorElement>) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        go(href);
      },
    },
    children ?? product.name ?? product.slug,
    'a',
  );
}

export interface AddToCartProps {
  product: Pick<CatalogProduct, 'id' | 'status'> &
    Partial<Pick<CatalogProduct, 'basePriceCents' | 'stockQuantity'>> &
    Partial<Pick<ProductDetail, 'comboSlots'>>;
  qty?: number;
  modifierIds?: string[];
  /** Kernel 1.2 — kit picks for a `kind: 'combo'` product */
  comboSelections?: ComboSelection[];
  /** Kernel 1.12 — units per option id in `modifierIds` (options with `maxQty` > 1) */
  modifierQty?: Record<string, number>;
  asChild?: boolean;
  children?: ReactNode;
  onAdded?: () => void;
  /** unhandled errors (no onError) surface through the Kernel's default notice */
  onError?: (err: { code: string; message: string }) => void;
}

export function AddToCart({
  product,
  qty = 1,
  modifierIds = [],
  comboSelections,
  modifierQty,
  asChild,
  children,
  onAdded,
  onError,
}: AddToCartProps) {
  const { status } = useStore();
  const { cart, mutations } = useCart();
  const [pending, setPending] = useState(false);
  const soldOut = product.status !== 'active';
  // the cart already holds what's left (of the product or a kit pick): Core would answer OUT_OF_STOCK
  const atLimit = !soldOut && qty > unitsLeft(cart, productDraw(product, comboSelections));
  const disabled = pending || soldOut || atLimit || status === 'paused';

  const onClick = async () => {
    if (disabled) return;
    setPending(true);
    try {
      await mutations.add(product.id, qty, modifierIds, comboSelections, modifierQty);
      haptic.tick();
      emit('add_to_cart', {
        product_id: product.id,
        qty,
        modifiers: modifierIds.length,
        ...(product.basePriceCents !== undefined ? { value: product.basePriceCents * qty } : {}),
      });
      onAdded?.();
    } catch (err) {
      if (onError) onError(err as { code: string; message: string });
      else showError(err);
    } finally {
      setPending(false);
    }
  };

  return withChild(
    asChild,
    {
      'data-vendua': 'add-to-cart',
      'data-state': soldOut ? 'sold-out' : atLimit ? 'limit' : pending ? 'pending' : 'idle',
      disabled,
      'aria-disabled': disabled,
      'aria-busy': pending || undefined,
      onClick,
    },
    children ?? (soldOut ? 'Esgotado' : 'Adicionar'),
  );
}

export interface QuantityStepperProps {
  itemId: string;
  qty: number;
  min?: number;
  max?: number;
}

export function QuantityStepper({ itemId, qty, min = 0, max: maxProp = 99 }: QuantityStepperProps) {
  const { cart, mutations } = useCart();
  const [pending, setPending] = useState(false);
  const line = cart?.items.find((i) => i.id === itemId);
  // the stock the cart's other lines leave for this one
  const max = line
    ? Math.min(maxProp, Math.max(qty, unitsLeft(cart, lineDraw(line), itemId)))
    : maxProp;
  const step = async (next: number) => {
    if (next < min || next > max || pending) return;
    haptic.tick();
    setPending(true);
    try {
      if (next === 0) await mutations.remove(itemId);
      else await mutations.updateQty(itemId, next);
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <span data-vendua="qty-stepper" role="group" aria-label="quantidade" data-pending={pending}>
      <button
        type="button"
        aria-label="diminuir"
        disabled={pending || qty <= min}
        onClick={() => step(qty - 1)}
      >
        −
      </button>
      <output aria-live="polite">{qty}</output>
      <button
        type="button"
        aria-label="aumentar"
        disabled={pending || qty >= max}
        onClick={() => step(qty + 1)}
      >
        +
      </button>
    </span>
  );
}

export interface CartTriggerProps {
  asChild?: boolean;
  children?: ReactNode;
  /** default: navigate to the Kernel cart page */
  onOpen?: () => void;
}

export function CartTrigger({ asChild, children, onOpen }: CartTriggerProps) {
  const { cart } = useCart();
  const openBag = useOpenBag();
  // a completed cart is history, not a bag — count only open carts
  const count = cart?.status === 'open' ? cart.totals.itemCount : 0;
  return withChild(
    asChild,
    {
      'data-vendua': 'cart-trigger',
      'data-count': count,
      'aria-label': `sacola, ${count} ${count === 1 ? 'item' : 'itens'}`,
      onClick: (e: MouseEvent) => {
        emit('cart_open', { item_count: count, cart_value: cart?.totals.totalCents ?? 0 });
        if (onOpen) return onOpen();
        if (e && 'preventDefault' in e) e.preventDefault();
        openBag();
      },
    },
    children ?? <>Sacola ({count})</>,
  );
}

export interface CheckoutButtonProps {
  asChild?: boolean;
  children?: ReactNode;
  /** default: navigate to the Kernel checkout page */
  onStart?: () => void;
  className?: string;
}

/** Starts the checkout session; disabled while paused, empty or below the minimum. */
export function CheckoutButton({ asChild, children, onStart, className }: CheckoutButtonProps) {
  const { api } = useKernel();
  const { status } = useStore();
  const { cart } = useCart();
  const go = useNavigateTo();
  const [pending, setPending] = useState(false);
  const empty = !cart || cart.status !== 'open' || cart.items.length === 0;
  const blocked = empty || status === 'paused' || cart.totals.belowMinOrder;
  const disabled = pending || blocked;
  return withChild(
    asChild,
    {
      'data-vendua': 'checkout-button',
      'data-state': pending ? 'pending' : blocked ? 'blocked' : 'idle',
      disabled,
      'aria-disabled': disabled,
      ...(className ? { className } : {}),
      onClick: async () => {
        if (disabled) return;
        setPending(true);
        try {
          await api.ensureSession();
          emit('checkout_start', { cart_value: cart?.totals.totalCents ?? 0 });
          if (onStart) onStart();
          else go(KERNEL_PATHS.checkout);
        } catch (err) {
          showError(err);
        } finally {
          setPending(false);
        }
      },
    },
    children ?? 'Ir para o pagamento',
  );
}

export interface NotifyMeButtonProps {
  subject: 'store' | 'product';
  productId?: string;
  /** customer's WhatsApp number — the primitive validates and submits it */
  phone: string;
  asChild?: boolean;
  children?: ReactNode;
  onSubscribed?: () => void;
  onError?: (err: { code: string; message: string }) => void;
}

/** "Avise-me" for a paused store or a sold-out product. */
export function NotifyMeButton({
  subject,
  productId,
  phone,
  asChild,
  children,
  onSubscribed,
  onError,
}: NotifyMeButtonProps) {
  const { api } = useKernel();
  const [state, setState] = useState<'idle' | 'pending' | 'done'>('idle');
  const digits = phone.replace(/\D/g, '');
  const valid =
    digits.length >= 10 && digits.length <= 13 && (subject === 'store' || Boolean(productId));
  const disabled = state !== 'idle' || !valid;
  return withChild(
    asChild,
    {
      'data-vendua': 'notify-me',
      'data-state': state,
      disabled,
      'aria-disabled': disabled,
      onClick: async () => {
        if (disabled) return;
        setState('pending');
        try {
          await api.notifyMe({ subject, phone: digits, ...(productId ? { productId } : {}) });
          emit('notify_me', { subject, ...(productId ? { product_id: productId } : {}) });
          setState('done');
          onSubscribed?.();
        } catch (err) {
          setState('idle');
          if (onError) onError(err as { code: string; message: string });
          else showError(err);
        }
      },
    },
    children ?? (state === 'done' ? 'Pronto, vamos avisar' : 'Avise-me'),
  );
}

export function StoreStatusBadge() {
  const { status, resumesAt, store } = useStore();
  const label = status === 'open' ? 'Aberto' : status === 'paused' ? 'Pausado' : 'Fechado';
  const resumeLabel = resumesAt
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: store?.hours.timezone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(resumesAt))
    : undefined;
  return (
    <span
      data-vendua="store-status"
      data-status={status ?? 'loading'}
      role="status"
      aria-live="polite"
      title={resumeLabel ? `retorna ${resumeLabel}` : store?.name}
    >
      {status ? label : '…'}
    </span>
  );
}

export interface ImgProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet'> {
  src: string;
  alt: string;
  /** intrinsic size — required so the page never shifts (CLS budget) */
  width: number;
  height: number;
  /** above-the-fold: eager + high fetch priority */
  priority?: boolean;
}

const WIDTHS = [320, 480, 640, 960, 1280, 1920];

/** CDN-backed responsive image with a token-coloured blur-up placeholder. */
export function Img({
  src,
  alt,
  width,
  height,
  priority,
  sizes,
  className,
  style,
  onLoad,
  onError,
  ...rest
}: ImgProps) {
  const { config } = useKernel();
  const [loaded, setLoaded] = useState(false);
  const cdn = config.images?.cdn;
  const local = src.startsWith('/') && !src.startsWith('//');
  const widths = WIDTHS.filter((w) => w <= width * 2);
  const srcSet =
    cdn && local
      ? widths
          .map(
            (w) =>
              `${cdn.replace('{src}', encodeURIComponent(src)).replace('{w}', String(w))} ${w}w`,
          )
          .join(', ')
      : // Kernel 1.7 — no CDN: Core's own uploads resize themselves (`?w=`)
        !cdn && widths.length
        ? mediaSrcSet(src, widths)
        : undefined;
  return (
    <img
      {...rest}
      src={src}
      alt={alt}
      width={width}
      height={height}
      {...(srcSet ? { srcSet, sizes: sizes ?? `(max-width: ${width}px) 100vw, ${width}px` } : {})}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      {...(priority ? { fetchpriority: 'high' } : {})}
      className={['v-img', className].filter(Boolean).join(' ')}
      data-loaded={loaded}
      style={{ aspectRatio: `${width} / ${height}`, ...style }}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      // a failed image must not stay invisible behind the blur-up
      onError={(e) => {
        setLoaded(true);
        onError?.(e);
      }}
    />
  );
}

/** The price fields ProductPrice reads: a CatalogProduct, a ProductDetail or a summary all fit. */
export interface ProductPriceProps {
  product: { basePriceCents: number; compareAtPriceCents?: number | null | undefined };
  /** "a partir de" before the price (options or kit picks can raise it) */
  from?: boolean;
  className?: string;
  /** wrap each formatted amount (the store's own typesetting); the text is still Core's price */
  renderAmount?: (formatted: string) => ReactNode;
}

/** Kernel 1.13 — a product's price in the store currency, the "de" price struck through only when
 *  it is above what the shopper pays. Display-only: never use it to compute a total. */
export function ProductPrice({ product, from, className, renderAmount }: ProductPriceProps) {
  const currency = useStore().store?.currency ?? 'BRL';
  return (
    <span className={['v-price v-num', className].filter(Boolean).join(' ')} data-part="price">
      <PriceParts product={product} currency={currency} from={from} renderAmount={renderAmount} />
    </span>
  );
}

/** ProductPrice's words for an aria-label: "de R$ 24,00 por R$ 18,00", or just "R$ 18,00". */
export function productPriceLabel(product: ProductPriceProps['product'], currency = 'BRL'): string {
  return priceLabel(product, currency);
}
