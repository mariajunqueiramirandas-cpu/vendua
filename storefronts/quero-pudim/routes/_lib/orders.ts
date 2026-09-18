import type { CartItem, Order } from '@vendua/kernel';

/**
 * Session-scoped order log. There is no "my orders" endpoint in Core, no
 * items list on the order view, and no client-storage utility in the Kernel —
 * so we persist the order payload plus a cart snapshot in sessionStorage,
 * matching the lifetime of the Kernel's own `vendua.session` token (a tab
 * session, LGPD-neutral: it dies with the tab). Recorded in OBSERVATIONS.md.
 */
const KEY = 'qp.orders';

export interface StoredOrder {
  order: Order;
  items: CartItem[];
  notes?: string;
  savedAt: string;
}

interface StoredOrders {
  items: StoredOrder[];
}

function readAll(): StoredOrder[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredOrders;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function writeAll(items: StoredOrder[]) {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify({ items } satisfies StoredOrders));
  } catch {
    /* private mode — order history lives in memory via checkout state only */
  }
}

export function rememberOrder(order: Order, items: CartItem[], notes?: string) {
  const all = readAll().filter((o) => o.order.id !== order.id);
  const entry: StoredOrder = { order, items, savedAt: new Date().toISOString() };
  if (notes !== undefined) entry.notes = notes;
  all.unshift(entry);
  writeAll(all);
}

export function listOrders(): StoredOrder[] {
  return readAll();
}

export function findOrder(id: string): StoredOrder | undefined {
  return readAll().find((o) => o.order.id === id || `pedido-${o.order.number}` === id);
}
