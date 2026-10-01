import { useState } from 'react';
import { lineDraw, unitsLeft, useCart, useCopy, useCoupon, useStore } from '../hooks.ts';
import { CheckoutButton, useNavigateTo } from '../primitives.tsx';
import { Slot } from '../slot.tsx';
import { showError, showInfo } from '../errors.ts';
import { useKernel } from '../provider.tsx';
import { resolvePaths } from '../config.ts';
import type { CartItem } from '../api.ts';
import { haptic } from '../haptics.ts';
import { MAX_LINE_QTY } from '../rules/card.ts';
import type { Vocabulary } from '../rules/copy.ts';
import { usePageTitle } from '../head.ts';

// /sacola — Kernel page (17 — Kernel pages), rendered inside the store's layout.
// Totals are Core's; the page only wires slots to the cart mutations.

function Line({
  item,
  currency,
  vocabulary,
}: {
  item: CartItem;
  currency: string;
  vocabulary: Vocabulary;
}) {
  const { cart, mutations } = useCart();
  const [pending, setPending] = useState(false);
  // other lines (another modifier set, a kit with the same pick) draw on the same stock
  const max = Math.min(MAX_LINE_QTY, Math.max(item.qty, unitsLeft(cart, lineDraw(item), item.id)));
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
      vocabulary={vocabulary}
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
  const { vocabulary } = useCopy();
  const [pending, setPending] = useState(false);
  const share = async () => {
    setPending(true);
    try {
      const { url } = await mutations.share();
      const nav = globalThis.navigator as Navigator | undefined;
      if (nav?.share) {
        await nav.share({ title: vocabulary.yourBag, url }).catch(() => {});
      } else {
        await nav?.clipboard?.writeText(url);
        showInfo(
          'share',
          `Link ${vocabulary.ofBag} copiado`,
          'Abra em outro aparelho ou mande para alguém.',
        );
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
      {pending ? 'Gerando link…' : `Mandar ${vocabulary.bag} por link`}
    </button>
  );
}

function Coupon({ currency }: { currency: string }) {
  const coupon = useCoupon();
  return (
    <Slot
      name="checkout.CouponField"
      coupon={coupon.coupon}
      discountCents={coupon.discountCents}
      currency={currency}
      pending={coupon.pending}
      {...(coupon.message ? { error: coupon.message } : {})}
      onApply={(code) => void coupon.apply(code)}
      onRemove={() => void coupon.remove()}
    />
  );
}

/** The bag itself — the `/sacola` page, or the sheet drawn over the page it was opened from. */
export function CartContents({
  presentation,
  onClose,
  onBrowse,
}: {
  presentation: 'page' | 'drawer';
  /** drawer: close the sheet; page: back to browsing */
  onClose?: () => void;
  /** the empty bag's way to the menu (default: go to the catalog) */
  onBrowse?: () => void;
}) {
  const { cart, loading } = useCart();
  const { store } = useStore();
  const { vocabulary } = useCopy();
  const { config } = useKernel();
  const go = useNavigateTo();
  const currency = store?.currency ?? 'BRL';
  const browse = onClose ?? (() => go(resolvePaths(config).catalog));
  const open = cart?.status === 'open' && cart.items.length > 0;

  if (loading && !cart)
    return <div aria-busy="true" aria-label={`Carregando ${vocabulary.bag}`} className="v-panel" />;
  if (!open)
    return (
      <Slot
        name="checkout.EmptyCart"
        vocabulary={vocabulary}
        onBrowse={onBrowse ?? (() => go(resolvePaths(config).catalog))}
      />
    );
  return (
    <Slot
      name="cart.Drawer"
      cart={cart}
      currency={currency}
      vocabulary={vocabulary}
      presentation={presentation}
      onClose={browse}
      lines={cart.items.map((i) => (
        <Line key={i.id} item={i} currency={currency} vocabulary={vocabulary} />
      ))}
      summary={
        <>
          <Slot name="checkout.Summary" cart={cart} currency={currency} vocabulary={vocabulary} />
          <Coupon currency={currency} />
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
  const { vocabulary } = useCopy();
  usePageTitle(capitalize(vocabulary.bag));
  return (
    <main id="main" className="v-page" data-vendua-page="cart">
      <CartContents presentation="page" />
    </main>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
