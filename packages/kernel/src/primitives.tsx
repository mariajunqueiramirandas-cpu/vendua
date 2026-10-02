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
import {
  lineDraw,
  productDraw,
  unitsLeft,
  useCart,
  useCartCount,
  useCopy,
  useStore,
  useStoreStatus,
} from './hooks.ts';
import { MAX_LINE_QTY } from './rules/card.ts';
import { takesOrders } from './rules/hours.ts';
import { mediaSrcSet, plural } from './rules/format.ts';
import { digitsOf, isValidPhone } from './rules/phone.ts';
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
      const { added } = await mutations.addLine(
        product.id,
        qty,
        modifierIds,
        comboSelections,
        modifierQty,
      );
      haptic.tick();
      // the value is what Core charged for these units (options, kit, promo); an older Core
      // doesn't say, and then there is no value rather than a guessed one
      emit('add_to_cart', {
        product_id: product.id,
        qty,
        modifiers: modifierIds.length,
        ...(added ? { value: added.lineTotalCents } : {}),
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

export function QuantityStepper({
  itemId,
  qty,
  min = 0,
  max: maxProp = MAX_LINE_QTY,
}: QuantityStepperProps) {
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
  const { vocabulary: v } = useCopy();
  // a completed cart is history, not a bag — count only open carts
  const count = useCartCount();
  return withChild(
    asChild,
    {
      'data-vendua': 'cart-trigger',
      'data-count': count,
      'aria-label': `${v.bag}, ${count} ${plural(count, v.itemSingular, v.itemPlural)}`,
      onClick: (e: MouseEvent) => {
        emit('cart_open', { item_count: count, cart_value: cart?.totals.totalCents ?? 0 });
        if (onOpen) return onOpen();
        if (e && 'preventDefault' in e) e.preventDefault();
        openBag();
      },
    },
    children ?? (
      <>
        {capitalize(v.bag)} ({count})
      </>
    ),
  );
}

export interface CheckoutButtonProps {
  asChild?: boolean;
  children?: ReactNode;
  /** default: navigate to the Kernel checkout page */
  onStart?: () => void;
  className?: string;
}

/** Starts the checkout session; disabled while paused, empty or below the minimum, and while
 *  closed unless the store takes this cart then (`takesOrders`). */
export function CheckoutButton({ asChild, children, onStart, className }: CheckoutButtonProps) {
  const { api } = useKernel();
  const { store } = useStore();
  // re-reads the store when it opens, so the button wakes up by itself
  const { status } = useStoreStatus();
  const { cart } = useCart();
  const go = useNavigateTo();
  const [pending, setPending] = useState(false);
  const empty = !cart || cart.status !== 'open' || cart.items.length === 0;
  const blocked =
    empty ||
    (status !== undefined && !takesOrders(status, store, cart.items)) ||
    cart.totals.belowMinOrder;
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
  const digits = digitsOf(phone);
  const valid = isValidPhone(digits) && (subject === 'store' || Boolean(productId));
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

const STATUS_WORD = { open: 'Aberto', closed: 'Fechado', paused: 'Pausado' } as const;

export interface StoreStatusBadgeProps {
  /** Kernel 1.14 — the store's own word per status (default: Aberto, Fechado, Pausado) */
  labels?: Partial<Record<'open' | 'closed' | 'paused', string>>;
}

/** Core's open/closed/paused. The title carries Core's moment ("Aberto até 18:00", "Abre amanhã
 *  às 09:00"); parts: `label`. `data-hint` = `statusHint`'s kind. */
export function StoreStatusBadge({ labels }: StoreStatusBadgeProps = {}) {
  const { status, hint, label } = useStoreStatus();
  return (
    <span
      data-vendua="store-status"
      data-status={status ?? 'loading'}
      {...(hint ? { 'data-hint': hint.kind } : {})}
      role="status"
      aria-live="polite"
      {...(label ? { title: label } : {})}
    >
      <span data-part="label">{status ? (labels?.[status] ?? STATUS_WORD[status]) : '…'}</span>
    </span>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
