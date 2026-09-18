import {
  cloneElement,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useCart, useStore } from './hooks.ts';
import type { CatalogProduct } from './api.ts';

/**
 * Headless primitives (02-kernel.md#primitives): Kernel owns behavior, the
 * storefront owns visuals via `asChild` / render props. Each stamps its
 * `data-vendua` hook + ARIA semantics regardless of the delegated child.
 */

/** Minimal asChild: merge props onto the single child element. */
type PrimitiveProps = Record<string, unknown> & { 'data-vendua': string };

function withChild(asChild: boolean | undefined, props: PrimitiveProps, children: ReactNode) {
  if (asChild && isValidElement(children)) {
    return cloneElement(children as ReactElement<Record<string, unknown>>, props);
  }
  return <button type="button" {...props}>{children}</button>;
}

export interface AddToCartProps {
  product: Pick<CatalogProduct, 'id' | 'status'>;
  qty?: number;
  modifierIds?: string[];
  asChild?: boolean;
  children?: ReactNode;
  /** Called after a successful add; Core's cart is the arg. */
  onAdded?: () => void;
  onError?: (err: { code: string; message: string }) => void;
}

export function AddToCart({
  product,
  qty = 1,
  modifierIds = [],
  asChild,
  children,
  onAdded,
  onError,
}: AddToCartProps) {
  const { status } = useStore();
  const { mutations } = useCart();
  const [pending, setPending] = useState(false);
  const soldOut = product.status !== 'active';
  const disabled = pending || soldOut || status === 'paused';

  const onClick = async () => {
    setPending(true);
    try {
      await mutations.add(product.id, qty, modifierIds);
      onAdded?.();
    } catch (err) {
      onError?.(err as { code: string; message: string });
    } finally {
      setPending(false);
    }
  };

  return withChild(
    asChild,
    {
      'data-vendua': 'add-to-cart',
      'data-state': soldOut ? 'sold-out' : pending ? 'pending' : 'idle',
      disabled,
      'aria-disabled': disabled,
      onClick,
    },
    children ?? 'Adicionar',
  );
}

export interface QuantityStepperProps {
  itemId: string;
  qty: number;
  min?: number;
  max?: number;
}

export function QuantityStepper({ itemId, qty, min = 0, max = 99 }: QuantityStepperProps) {
  const { mutations } = useCart();
  const [pending, setPending] = useState(false);
  const step = async (next: number) => {
    if (next < min || next > max || pending) return;
    setPending(true);
    try {
      if (next === 0) await mutations.remove(itemId);
      else await mutations.updateQty(itemId, next);
    } finally {
      setPending(false);
    }
  };
  return (
    <span data-vendua="qty-stepper" role="group" aria-label="quantidade" data-pending={pending}>
      <button type="button" aria-label="diminuir" disabled={pending || qty <= min} onClick={() => step(qty - 1)}>
        −
      </button>
      <output aria-live="polite">{qty}</output>
      <button type="button" aria-label="aumentar" disabled={pending || qty >= max} onClick={() => step(qty + 1)}>
        +
      </button>
    </span>
  );
}

export interface CartTriggerProps {
  asChild?: boolean;
  children?: ReactNode;
  onOpen?: () => void;
}

export function CartTrigger({ asChild, children, onOpen }: CartTriggerProps) {
  const { cart } = useCart();
  const count = cart?.totals.itemCount ?? 0;
  return withChild(
    asChild,
    {
      'data-vendua': 'cart-trigger',
      'data-count': count,
      'aria-label': `sacola, ${count} itens`,
      onClick: () => onOpen?.(),
    },
    children ?? <>Sacola ({count})</>,
  );
}

export function StoreStatusBadge() {
  const { status, resumesAt, store } = useStore();
  const label =
    status === 'open'
      ? 'Aberto'
      : status === 'paused'
        ? 'Pausado'
        : 'Fechado';
  return (
    <span
      data-vendua="store-status"
      data-status={status ?? 'loading'}
      role="status"
      aria-live="polite"
      title={resumesAt ? `retorna ${resumesAt}` : store?.name}
    >
      {status ? label : '…'}
    </span>
  );
}
