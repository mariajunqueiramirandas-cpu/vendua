import { createContext, useContext, type ReactNode } from 'react';
import { useKernel } from '@vendua/kernel';
import { clearLastOrder } from './last-order.ts';

/** Session reset goes through Kernel calls only — never sessionStorage or a provider remount. */
export const SessionResetContext = createContext<() => void>(() => {});
export const useResetSession = () => useContext(SessionResetContext);

/** Must mount inside <VenduaProvider> — it drives the reset via the Kernel. */
export function SessionResetProvider({ children }: { children: ReactNode }) {
  const { api, invalidate } = useKernel();
  const resetSession = () => {
    api.clearSession();
    clearLastOrder();
    invalidate('cart');
  };
  return (
    <SessionResetContext.Provider value={resetSession}>{children}</SessionResetContext.Provider>
  );
}
