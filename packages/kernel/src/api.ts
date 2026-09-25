// The only supported path from a storefront to Core (no fetch/axios in storefront
// code). Mutations send a fresh Idempotency-Key; the session token rides as Bearer.

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface StoreProfile {
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  whatsapp: string | null;
  instagram: string | null;
  city: string | null;
  address: string | null;
  status: 'open' | 'closed' | 'paused';
  resumesAt?: string;
  hours: { timezone: string; windows: { days: number[]; open: string; close: string }[] };
  prepTimeMinutes: number;
  minOrderCents: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  /** ISO 4217 — pt-BR storefronts today get 'BRL'. */
  currency: string;
  /** Per-tenant copy deck — e.g. { itemSingular: 'doce', bag: 'sacola' }. */
  vocabulary: Record<string, string>;
}

export interface CatalogProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  basePriceCents: number;
  status: 'active' | 'sold_out' | 'archived';
  /** Decorative figure slot — storefronts map variants to artwork. */
  figureVariant: 'default' | 'alt';
  tags: string[];
}

export interface CatalogCategory {
  id: string;
  slug: string;
  name: string;
  sort: number;
  products: CatalogProduct[];
}

export interface ProductDetail extends CatalogProduct {
  modifierGroups: {
    id: string;
    name: string;
    required: boolean;
    minSelect: number;
    maxSelect: number;
    modifiers: { id: string; name: string; priceDeltaCents: number; status: string }[];
  }[];
}

export type NoticeSeverity = 'info' | 'warning' | 'blocking';

export type NoticeAction =
  | { type: 'link'; label: string; href: string }
  | { type: 'notify'; label: string; channel: 'whatsapp' | 'push' }
  | { type: 'dismiss'; label: string }
  | ({ type: string; label: string } & Record<string, unknown>);

export interface Notice {
  id: string;
  kind: string;
  severity: NoticeSeverity | string;
  title: string;
  body?: string;
  actions?: NoticeAction[];
  payload?: Record<string, unknown>;
  dismissible: boolean;
  priority: number;
  startsAt?: string;
  endsAt?: string;
}

export interface SurfacesEnvelope {
  version: 1;
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string };
  notices: Notice[];
}

export interface CartItem {
  id: string;
  productId: string;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  /** Live product availability — 'active' | 'sold_out' | 'archived'. */
  productStatus: string;
  modifiers: { id: string; name: string; priceDeltaCents: number; status: string }[];
  lineTotalCents: number;
}

export interface CartTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  itemCount: number;
  minOrderCents: number;
  /** Cents short of the minimum order — Core-computed so storefronts never
   *  subtract money themselves. 0 once the minimum is met. */
  remainingMinOrderCents: number;
  belowMinOrder: boolean;
}

export interface Cart {
  id: string;
  status: 'open' | 'completed' | 'abandoned';
  items: CartItem[];
  totals: CartTotals;
  delivery: { mode: 'pickup' | 'delivery'; neighborhood?: string; zoneId?: string | null } | null;
}

export interface CheckoutInput {
  customer: { name: string; phone: string };
  delivery: { mode: 'pickup' | 'delivery'; neighborhood?: string; address?: string };
  payment: { method: 'pix' | 'card_on_delivery' | 'cash' };
}

export interface DeliveryZone {
  id: string;
  name: string;
  neighborhoods: string[];
  feeCents: number;
  minOrderCents: number;
  etaMin: number;
  etaMax: number;
}

export interface QuoteResult {
  eligible: boolean;
  reason?: 'OUT_OF_ZONE';
  zoneId?: string;
  feeCents?: number;
  etaMin?: number;
  etaMax?: number;
}

export interface Order {
  id: string;
  number: number;
  state: string;
  customer: { name: string; phone: string };
  delivery: {
    mode: 'pickup' | 'delivery';
    etaMin: number | null;
    etaMax: number | null;
    address: unknown;
    feeCents: number;
    neighborhood: string | null;
  };
  payment: { method: string; status: string; provider: string; instructions: string | null };
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  placedAt: string;
  timeline: { at: string; from: string | null; to: string; actor: string; meta: unknown }[];
}

const SESSION_KEY = 'vendua.session';
const ORDER_TOKENS_KEY = 'vendua.orderTokens';

// The checkout-time token stays authorized to read that order even after the
// session rotates onto a fresh cart.
function readOrderTokens(): Record<string, string> {
  try {
    return JSON.parse(globalThis.sessionStorage?.getItem(ORDER_TOKENS_KEY) ?? '{}') as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

function storeOrderToken(orderId: string, t: string) {
  try {
    const m = readOrderTokens();
    m[orderId] = t;
    // Bound the map — keep the newest ~20 entries.
    for (const k of Object.keys(m).slice(0, -20)) delete m[k];
    globalThis.sessionStorage?.setItem(ORDER_TOKENS_KEY, JSON.stringify(m));
  } catch {
    /* private mode — order tracking lives in memory only */
  }
}

function readStoredToken(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

function storeToken(token: string) {
  try {
    globalThis.sessionStorage?.setItem(SESSION_KEY, token);
  } catch {
    /* private mode — session lives in memory only */
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // Wrap transport failures so callers always get a `code`, never a bare TypeError.
    throw new ApiError(0, 'NETWORK_ERROR', 'could not reach the store backend');
  }
  const body = (await res.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL',
      err?.message ?? res.statusText,
      err?.details,
    );
  }
  return body;
}

function idemKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random()}`;
}

export function createApi(baseUrl = '') {
  const sf = (path: string) => `${baseUrl}/storefront/v1${path}`;
  const co = (path: string) => `${baseUrl}/checkout/v1${path}`;
  let token: string | null = readStoredToken();
  let sessionPromise: Promise<{ cart: Cart }> | null = null;
  // Memory first (survives sessionStorage failures); the persisted copy covers refresh.
  const orderTokenMem = new Map<string, string>();
  // Serial delivery writes — a slower earlier write must not overwrite the newer cart.
  let deliveryQueue: Promise<unknown> = Promise.resolve();
  const auth = () => (token ? { authorization: `Bearer ${token}` } : {});

  // Closure-scoped so a destructured `checkout` behaves identically to `api.checkout()`.
  const cartGet = () => apiFetch<{ cart: Cart }>(co('/cart'), { headers: auth() });

  const clearSessionNow = () => {
    token = null;
    try {
      globalThis.sessionStorage?.removeItem(SESSION_KEY);
    } catch {
      /* private mode */
    }
  };

  const ensureSessionNow = async (): Promise<{ cart: Cart }> => {
    // Single-flight: concurrent first mutations share ONE session creation,
    // or each would mint its own cart and only the last token would survive.
    sessionPromise ??= (async () => {
      // An open cart reuses its token; a spent token rotates through POST /session.
      if (token) {
        try {
          const { cart } = await cartGet();
          if (cart.status === 'open') return { cart };
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 401) throw err;
        }
      }
      const res = await apiFetch<{ sessionToken: string; cart: Cart }>(co('/session'), {
        method: 'POST',
        headers: { ...auth(), 'idempotency-key': idemKey() },
      });
      token = res.sessionToken;
      storeToken(token);
      return { cart: res.cart };
    })().finally(() => {
      sessionPromise = null;
    });
    return sessionPromise;
  };

  return {
    get sessionToken() {
      return token;
    },

    store: () => apiFetch<StoreProfile>(sf('/store')),
    catalog: () => apiFetch<{ categories: CatalogCategory[] }>(sf('/catalog')),
    product: (slug: string) => apiFetch<{ product: ProductDetail }>(sf(`/products/${slug}`)),
    surfaces: (zoneMatched?: boolean) =>
      apiFetch<SurfacesEnvelope>(
        sf(`/surfaces${zoneMatched === undefined ? '' : `?zoneMatched=${zoneMatched}`}`),
      ),
    zones: () => apiFetch<{ zones: DeliveryZone[] }>(sf('/zones')),
    quote: (neighborhood: string) =>
      apiFetch<QuoteResult>(co('/quote'), {
        method: 'POST',
        headers: { 'idempotency-key': idemKey() },
        body: JSON.stringify({ neighborhood }),
      }),

    clearSession: clearSessionNow,
    ensureSession: ensureSessionNow,
    cart: cartGet,
    async addItem(productId: string, qty = 1, modifierIds: string[] = []): Promise<Cart> {
      await ensureSessionNow();
      const res = await apiFetch<{ cart: Cart }>(co('/cart/items'), {
        method: 'POST',
        headers: { ...auth(), 'idempotency-key': idemKey() },
        body: JSON.stringify({ productId, qty, modifierIds }),
      });
      return res.cart;
    },
    updateItem: (itemId: string, qty: number) =>
      apiFetch<{ cart: Cart }>(co(`/cart/items/${itemId}`), {
        method: 'PATCH',
        headers: { ...auth(), 'idempotency-key': idemKey() },
        body: JSON.stringify({ qty }),
      }).then((r) => r.cart),
    removeItem: (itemId: string) =>
      apiFetch<{ cart: Cart }>(co(`/cart/items/${itemId}`), {
        method: 'DELETE',
        headers: { ...auth(), 'idempotency-key': idemKey() },
      }).then((r) => r.cart),
    setDelivery: (delivery: { mode: 'pickup' | 'delivery'; neighborhood?: string }) => {
      // Bind the token at call time — a queued write must target the cart it was
      // issued for, not a session rotated by a completed checkout.
      const bound = token;
      const bearer = bound ? { authorization: `Bearer ${bound}` } : {};
      const p = deliveryQueue.then(() =>
        apiFetch<{ cart: Cart }>(co('/cart/delivery'), {
          method: 'POST',
          headers: { ...bearer, 'idempotency-key': idemKey() },
          body: JSON.stringify(delivery),
        }).then((r) => r.cart),
      );
      // A failed write must not wedge the queue — the next call still runs.
      deliveryQueue = p.catch(() => {});
      return p;
    },
    async checkout(input: CheckoutInput): Promise<Order> {
      const r = await apiFetch<{ order: Order }>(co('/checkout'), {
        method: 'POST',
        headers: { ...auth(), 'idempotency-key': idemKey() },
        body: JSON.stringify(input),
      });
      // The order's token is its tracking credential — keep it before rotation swaps `token`.
      if (token) {
        orderTokenMem.set(r.order.id, token);
        storeOrderToken(r.order.id, token);
      }
      // Rotate now so the next `cart()` reads a fresh cart; a rotation failure must not mask a placed order.
      try {
        clearSessionNow();
        await ensureSessionNow();
      } catch {
        /* order placed; session heals lazily */
      }
      return r.order;
    },
    order: (id: string) => {
      const bearer = orderTokenMem.get(id) ?? readOrderTokens()[id] ?? token;
      return apiFetch<{ order: Order }>(co(`/orders/${id}`), {
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      }).then((r) => r.order);
    },
  };
}

/** Error codes emitted by Core — kept in sync with `HttpError` call sites in
 *  packages/core (storefronts may switch on these; never invent others). */
export const ERROR_CODES = [
  'TENANT_NOT_FOUND',
  'TENANT_SUSPENDED',
  'SESSION_REQUIRED',
  'CART_NOT_FOUND',
  'CART_NOT_OPEN',
  'PRODUCT_NOT_FOUND',
  'SOLD_OUT',
  'MODIFIER_SOLD_OUT',
  'INVALID_MODIFIER',
  'MODIFIER_REQUIRED',
  'MODIFIER_LIMIT',
  'INVALID_QTY',
  'EMPTY_CART',
  'STORE_CLOSED',
  'STORE_PAUSED',
  'ORDER_MIN_NOT_MET',
  'DELIVERY_UNAVAILABLE',
  'PICKUP_UNAVAILABLE',
  'OUT_OF_ZONE',
  'INVALID_DELIVERY',
  'INVALID_CUSTOMER',
  'INVALID_PAYMENT',
  'ORDER_NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'INVALID_ORDER_TRANSITION',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_IN_PROGRESS',
  'RATE_LIMITED',
  // control-plane (staff) API codes — leads module
  'INVALID_STATE',
  'INVALID_LEAD',
  'INVALID_SORT',
  'LEAD_NOT_FOUND',
  'THREAD_NOT_FOUND',
  'MESSAGE_NOT_FOUND',
  'TASK_NOT_FOUND',
  'RUN_NOT_FOUND',
  'BRIEF_NOT_FOUND',
  'UNKNOWN_TOOL',
  'INVALID_AGENT_GOAL',
  'LEAD_SUPPRESSED',
  'LEAD_COST_CAP',
  'THREAD_PAUSED',
  'PLAYBOOK_DISABLED',
  'PARAMS_TOO_LARGE',
  'WAKEUP_NOT_FOUND',
  // memory v2 (agent memory items + lead facts)
  'MEMORY_ITEM_NOT_FOUND',
  'MEMORY_CAP_PINNED',
  'FACT_NOT_FOUND',
  'SOURCE_RUN_NOT_FOUND',
  'NOTE_LIMIT',
  // meetings module (booking surface + control meetings API)
  'MEETING_NOT_FOUND',
  'SLOT_TAKEN',
  'CANCEL_WINDOW',
  'LEAD_ARCHIVED',
  'BAD_START',
  'BAD_END',
  'BAD_TRANSITION',
  'BAD_REQUEST',
  'NOT_FOUND',
  'INTERNAL',
  'EMAIL_PROVIDER_UNAVAILABLE',
  'EMAIL_FETCH_FAILED',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export type VenduaApi = ReturnType<typeof createApi>;

// The shared money formatter — pass the tenant currency from `useStore().store.currency`.
export function formatCents(cents: number, currency = 'BRL', locale = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}
