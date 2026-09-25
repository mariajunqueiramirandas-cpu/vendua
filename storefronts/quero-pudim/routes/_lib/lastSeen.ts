// "last seen" item + continue-shopping anchor — sessionStorage-scoped
// (same lifetime as the Kernel session token)
const KEY = 'qp.lastSeen';

export interface LastSeen {
  id: string;
  slug?: string;
  category?: string;
}

let memory: LastSeen | null = null;

export function setLastSeenItem(item: { id: string; slug?: string; category?: string }) {
  const data: LastSeen = { ...item, id: item.id.replace(/^#/, '') };
  memory = data;
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode — in-memory fallback covers the session */
  }
}

export function getLastSeenItem(): LastSeen | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed.id === 'string' && parsed.id.length > 0) {
        const out: LastSeen = { id: parsed.id };
        if (typeof parsed.slug === 'string') out.slug = parsed.slug;
        if (typeof parsed.category === 'string') out.category = parsed.category;
        return out;
      }
    }
  } catch {
    /* corrupted JSON — fall through to memory */
  }
  return memory;
}

/** Where "Continuar escolhendo" should land — last seen card or the grid top. */
export function getContinueShoppingUrl(): string {
  const last = getLastSeenItem();
  if (last?.id) return `/catalog#${last.id}`;
  return '/catalog#cardapio';
}
