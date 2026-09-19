import { useRef, useState } from 'react';
import { AddToCart } from '@vendua/kernel';
import type { FornProduct } from './catalog-ext.ts';

/**
 * "pegar" — the case-card take button. AddToCart owns the behavior (disable on
 * paused/sold-out, the mutation, data-vendua); we own the skin and the
 * "na sacola" confirmation flash.
 */
export function TakeButton({
  product,
  qty = 1,
  modifierIds = [],
  label = 'pegar',
}: {
  product: Pick<FornProduct, 'id' | 'status'>;
  qty?: number;
  modifierIds?: string[];
  label?: string;
}) {
  const [added, setAdded] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flash = (ok: boolean) => {
    clearTimeout(timer.current);
    setAdded(ok);
    setFailed(!ok);
    timer.current = setTimeout(() => {
      setAdded(false);
      setFailed(false);
    }, 1800);
  };

  const soldOut = product.status !== 'active';
  const text = added ? 'na sacola' : failed ? 'tenta de novo' : soldOut ? 'acabou' : label;

  return (
    <AddToCart
      product={product}
      qty={qty}
      modifierIds={modifierIds}
      asChild
      onAdded={() => flash(true)}
      onError={() => flash(false)}
    >
      <button type="button" className={`take-btn${added ? ' is-added' : ''}`}>
        {soldOut ? 'acabou' : added ? '✓ na sacola' : failed ? 'tenta de novo' : text}
      </button>
    </AddToCart>
  );
}
