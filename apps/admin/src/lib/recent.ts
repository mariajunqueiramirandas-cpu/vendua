// What Buscar opened lately on this device, for this store: the empty field offers it back.
// Customer names live here, so sign-out and store switches drop it (persist.ts › resetClient).

export interface Recent {
  kind: 'order' | 'product' | 'customer' | 'screen';
  to: string;
  label: string;
  sub?: string;
}

const KEY = 'vendua.search.recent';
const MAX = 5;

export function readRecent(storeId: string): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      store: string;
      items: Recent[];
    } | null;
    return v?.store === storeId && Array.isArray(v.items) ? v.items.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(storeId: string, r: Recent) {
  const items = [r, ...readRecent(storeId).filter((x) => x.to !== r.to)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify({ store: storeId, items }));
  } catch {
    /* private mode: nothing kept */
  }
}

export function forgetRecent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
