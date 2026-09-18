import { createContext, useContext, useEffect, useRef } from 'react';
import { useCart, useKernel } from '@vendua/kernel';

/**
 * Session reset — Phase 0 keeps the checkout token in a createApi() closure
 * plus sessionStorage('vendua.session'); once a cart completes there is no
 * hook to mint a new session, so a *second* order in the same tab would hit
 * CART_NOT_FOUND forever (see OBSERVATIONS.md). The storefront-side fix is to
 * drop the stored token and remount <VenduaProvider> (a new api client) via a
 * key bump — `useResetSession()` is how the confirmation page asks for that.
 */
export const SessionResetContext = createContext<() => void>(() => {});
export const useResetSession = () => useContext(SessionResetContext);

/**
 * After a remount, force the stale 'cart' query entry to refetch.
 * `invalidate` only notifies *existing* subscribers, so this component first
 * subscribes via useCart, then invalidates — without a session token the
 * refetch fails SESSION_REQUIRED and the badge/comanda read empty, which is
 * exactly the reset state we want.
 */
export function EpochSync({ epoch }: { epoch: number }) {
  useCart();
  const { invalidate } = useKernel();
  const ran = useRef(false);
  useEffect(() => {
    if (!ran.current) {
      ran.current = true;
      if (epoch > 0) invalidate('cart');
    }
  }, [epoch, invalidate]);
  return null;
}
