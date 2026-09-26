import { useState } from 'react';
import { useCart, useStore } from '../hooks.ts';
import { CheckoutButton, useNavigateTo } from '../primitives.tsx';
import { Slot } from '../slot.tsx';
import { showError } from '../errors.ts';
import { useKernel } from '../provider.tsx';
import { resolvePaths } from '../config.ts';
import type { CartItem } from '../api.ts';

// /sacola — Kernel page (17 — Kernel pages), rendered inside the store's layout.
// Totals are Core's; the page only wires slots to the cart mutations.

function Line({ item, currency }: { item: CartItem; currency: string }) {
  const { mutations } = useCart();
  const [pending, setPending] = useState(false);
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
      onQty={(qty) =>
        void run(() =>
          qty <= 0 ? mutations.remove(item.id) : mutations.updateQty(item.id, Math.min(qty, 99)),
        )
      }
      onRemove={() => void run(() => mutations.remove(item.id))}
    />
  );
}

export function CartPage() {
  const { cart, loading } = useCart();
  const { store } = useStore();
  const { config } = useKernel();
  const go = useNavigateTo();
  const currency = store?.currency ?? 'BRL';
  const browse = () => go(resolvePaths(config).catalog);
  const open = cart?.status === 'open' && cart.items.length > 0;

  return (
    <main id="main" className="v-page" data-vendua-page="cart">
      {loading && !cart ? (
        <div aria-busy="true" aria-label="Carregando sacola" className="v-panel" />
      ) : !open ? (
        <Slot name="checkout.EmptyCart" onBrowse={browse} />
      ) : (
        <Slot
          name="cart.Drawer"
          cart={cart}
          currency={currency}
          presentation="page"
          onClose={browse}
          lines={cart.items.map((i) => (
            <Line key={i.id} item={i} currency={currency} />
          ))}
          summary={<Slot name="checkout.Summary" cart={cart} currency={currency} />}
          checkout={
            <CheckoutButton asChild>
              <button type="button" className="v-btn v-btn-accent v-btn-block">
                Ir para o pagamento
              </button>
            </CheckoutButton>
          }
        />
      )}
    </main>
  );
}
