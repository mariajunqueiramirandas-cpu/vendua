import { useState } from 'react';
import { lineDraw, unitsLeft, useCart, useStore } from '../hooks.ts';
import { CheckoutButton, useNavigateTo } from '../primitives.tsx';
import { Slot } from '../slot.tsx';
import { errorCode, errorCopy, showError, showInfo } from '../errors.ts';
import { useKernel } from '../provider.tsx';
import { resolvePaths } from '../config.ts';
import type { Cart, CartItem } from '../api.ts';
import { haptic } from '../haptics.ts';

// /sacola — Kernel page (17 — Kernel pages), rendered inside the store's layout.
// Totals are Core's; the page only wires slots to the cart mutations.

function Line({ item, currency }: { item: CartItem; currency: string }) {
  const { cart, mutations } = useCart();
  const [pending, setPending] = useState(false);
  // other lines (another modifier set, a kit with the same pick) draw on the same stock
  const max = Math.min(99, Math.max(item.qty, unitsLeft(cart, lineDraw(item), item.id)));
  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    try {
      await fn();
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <Slot
      name="cart.LineItem"
      item={item}
      currency={currency}
      pending={pending}
      max={max}
      onQty={(qty) => {
        const next = Math.min(qty, max);
        if (qty > 0 && next === item.qty) return;
        haptic.tick();
        void run(() => (qty <= 0 ? mutations.remove(item.id) : mutations.updateQty(item.id, next)));
      }}
      onRemove={() => void run(() => mutations.remove(item.id))}
    />
  );
}

/** "Mandar sacola": a Core share code as a link — native share sheet, else clipboard. */
function ShareCart() {
  const { mutations } = useCart();
  const [pending, setPending] = useState(false);
  const share = async () => {
    setPending(true);
    try {
      const { url } = await mutations.share();
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) {
        await nav.share({ title: 'Minha sacola', url }).catch(() => {});
      } else {
        await nav?.clipboard?.writeText(url);
        showInfo('share', 'Link da sacola copiado', 'Abra em outro aparelho ou mande para alguém.');
      }
    } catch (err) {
      showError(err);
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      type="button"
      className="v-link-btn"
      data-vendua="share-cart"
      disabled={pending}
      onClick={() => void share()}
    >
      {pending ? 'Gerando link…' : 'Mandar sacola por link'}
    </button>
  );
}

function Coupon({ cart, currency }: { cart: Cart; currency: string }) {
  const { mutations } = useCart();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(errorCopy(errorCode(err)).title);
    } finally {
      setPending(false);
    }
  };
  return (
    <Slot
      name="checkout.CouponField"
      coupon={cart.coupon ?? null}
      discountCents={cart.totals.discountCents ?? 0}
      currency={currency}
      pending={pending}
      {...(error ? { error } : {})}
      onApply={(code) => void run(() => mutations.applyCoupon(code))}
      onRemove={() => void run(() => mutations.removeCoupon())}
    />
  );
}

/** The bag itself — the `/sacola` page, or the sheet drawn over the page it was opened from. */
export function CartContents({
  presentation,
  onClose,
}: {
  presentation: 'page' | 'drawer';
  /** drawer: close the sheet; page: back to browsing */
  onClose?: () => void;
}) {
  const { cart, loading } = useCart();
  const { store } = useStore();
  const { config } = useKernel();
  const go = useNavigateTo();
  const currency = store?.currency ?? 'BRL';
  const browse = onClose ?? (() => go(resolvePaths(config).catalog));
  const open = cart?.status === 'open' && cart.items.length > 0;

  if (loading && !cart)
    return <div aria-busy="true" aria-label="Carregando sacola" className="v-panel" />;
  if (!open) return <Slot name="checkout.EmptyCart" onBrowse={browse} />;
  return (
    <Slot
      name="cart.Drawer"
      cart={cart}
      currency={currency}
      presentation={presentation}
      onClose={browse}
      lines={cart.items.map((i) => (
        <Line key={i.id} item={i} currency={currency} />
      ))}
      summary={
        <>
          <Slot name="checkout.Summary" cart={cart} currency={currency} />
          <Coupon cart={cart} currency={currency} />
          <ShareCart />
        </>
      }
      checkout={
        <CheckoutButton asChild>
          <button type="button" className="v-btn v-btn-accent v-btn-block">
            Ir para o pagamento
          </button>
        </CheckoutButton>
      }
    />
  );
}

export function CartPage() {
  return (
    <main id="main" className="v-page" data-vendua-page="cart">
      <CartContents presentation="page" />
    </main>
  );
}
