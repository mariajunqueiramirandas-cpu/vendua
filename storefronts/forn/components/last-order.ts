import type { Order } from '@vendua/kernel';

let lastOrder: Order | null = null;

const key = (id: string) => `vendua.forn.order.${id}`;

/** Core order reads need the session token — persist the comanda in sessionStorage for reload/back-button. */
export function setLastOrder(order: Order) {
  lastOrder = order;
  try {
    sessionStorage.setItem(key(order.id), JSON.stringify(order));
  } catch {
    /* private mode */
  }
}

/** Called on session reset so a fresh sacola doesn't inherit the old comanda. */
export function clearLastOrder() {
  lastOrder = null;
}

export function getLastOrder(id?: string): Order | undefined {
  if (id) {
    try {
      const raw = sessionStorage.getItem(key(id));
      if (raw) return JSON.parse(raw) as Order;
    } catch {
      /* ignore */
    }
  }
  return lastOrder ?? undefined;
}
