import type { CartItem, Order } from '@vendua/kernel';

// session-scoped order log: Core has no "my orders" endpoint, so order +
// cart snapshot persist in sessionStorage — same lifetime as `vendua.session`
// (LGPD-neutral: dies with the tab). Recorded in OBSERVATIONS.md.
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
