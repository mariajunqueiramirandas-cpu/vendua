import type { TemplateSet } from '@vendua/templates';

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
  /** Kernel 1.2 — the store's Pix: key + an amount-less copia e cola (null = none). */
  pix?: PixInfo | null;
  /** Kernel 1.2 — the stamp card, when the store runs one. */
  loyalty?: { stampsRequired: number; minOrderCents: number; rewardLabel: string } | null;
  /** Kernel 1.2 — encomenda rules. */
  preorder?: { paymentMethods: string[]; maxDays: number };
}

export interface PixInfo {
  key: string;
  keyType: 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';
  beneficiary: string;
  /** BR Code "copia e cola" — render as a QR or a copy button */
  copyPaste: string;
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
  /** Additive Core fields (03 — semantics pinned in v1): absent until Core serves them. */
  imageUrl?: string | null;
  stockQuantity?: number | null;
  /** Kernel 1.2 fields (Core Phase 2). */
  kind?: 'simple' | 'combo';
  lowStockThreshold?: number | null;
  /** Core's call: tracked stock at/below the threshold */
  lowStock?: boolean;
  requiresPreorder?: boolean;
  preorderLeadDays?: number;
}

export interface ComboSlot {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  /** how many of the same item the slot takes */
  qtyPerItem: number;
  items: {
    productId: string;
    slug: string;
    name: string;
    priceDeltaCents: number;
    status: string;
    stockQuantity: number | null;
    imageUrl: string | null;
  }[];
}

export interface ComboSelection {
  slotId: string;
  productId: string;
  qty: number;
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
  /** Kernel 1.2 */
  gallery?: { url: string; alt: string | null; width: number | null; height: number | null }[];
  comboSlots?: ComboSlot[];
  /** people waiting on a restock (sold-out products) */
  waitlistCount?: number;
  /** first bookable date for an encomenda (YYYY-MM-DD), Core-computed */
  preorderEarliestDate?: string | null;
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

/** `/storefront/v1/state` — the loader's snapshot; `templates` when asked for. */
export interface StateEnvelope {
  version: 1;
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string };
  notices: Notice[];
  loader: { state: 'normal' | 'maintenance'; title?: string; message?: string; href?: string };
  templates?: TemplateSet;
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
  /** Kernel 1.2 */
  combo?: {
    slotId: string;
    slotName: string;
    productId: string;
    name: string;
    qty: number;
    priceDeltaCents: number;
    status: string;
  }[];
  comboSelections?: ComboSelection[];
  imageUrl?: string | null;
  stockQuantity?: number | null;
  requiresPreorder?: boolean;
  preorderLeadDays?: number;
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
  /** Kernel 1.2 — coupon discount (Core-computed); total already has it off */
  discountCents?: number;
  freeDeliveryThresholdCents?: number | null;
  /** cents short of free delivery; 0 once reached */
  freeDeliveryRemainingCents?: number | null;
}

export interface CartCoupon {
  code: string;
  label: string;
  kind: 'percent' | 'fixed' | 'free_delivery';
  /** false = kept on the cart but not discounting now; `reason` is an error code */
  applies: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface CartSchedule {
  /** a line is an encomenda — checkout needs `scheduledFor` */
  required: boolean;
  leadDays: number;
  /** bookable YYYY-MM-DD dates, earliest first */
  dates: string[];
  paymentMethods: string[];
}

export interface DeliveryAddress {
  neighborhood?: string;
  address?: string;
  street?: string;
  number?: string;
  complement?: string;
  reference?: string;
  cep?: string;
  lat?: number;
  lng?: number;
}

export interface Cart {
  id: string;
  status: 'open' | 'completed' | 'abandoned';
  items: CartItem[];
  totals: CartTotals;
  delivery:
    | ({
        mode: 'pickup' | 'delivery';
        neighborhood?: string;
        zoneId?: string | null;
        zoneName?: string | null;
        distanceKm?: number | null;
        etaMin?: number | null;
        etaMax?: number | null;
      } & Omit<DeliveryAddress, 'neighborhood'>)
    | null;
  /** Kernel 1.2 */
  coupon?: CartCoupon | null;
  schedule?: CartSchedule;
}

export interface CheckoutInput {
  customer: { name: string; phone: string };
  delivery: { mode: 'pickup' | 'delivery' } & DeliveryAddress;
  payment: { method: 'pix' | 'card_on_delivery' | 'cash' };
  /** Kernel 1.2 — "Alguma observação?" (≤500) */
  notes?: string;
  /** Kernel 1.2 — encomenda date, YYYY-MM-DD */
  scheduledFor?: string;
}

export interface DeliveryZone {
  id: string;
  name: string;
  neighborhoods: string[];
  feeCents: number;
  minOrderCents: number;
  etaMin: number;
  etaMax: number;
  kind?: 'neighborhood' | 'radius';
  maxDistanceKm?: number | null;
  feePerKmCents?: number;
  freeDeliveryOverCents?: number | null;
}

export interface QuoteResult {
  eligible: boolean;
  reason?: 'OUT_OF_ZONE';
  zoneId?: string;
  feeCents?: number;
  etaMin?: number;
  etaMax?: number;
  zoneName?: string;
  distanceKm?: number | null;
  minOrderCents?: number;
  freeDeliveryOverCents?: number | null;
}

export interface CepResult {
  address: {
    cep: string;
    street: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
  };
  zone: QuoteResult;
}

export interface CouponCheck {
  valid: boolean;
  code: string;
  label?: string;
  kind?: CartCoupon['kind'];
  discountCents?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ImportReport {
  added: number;
  skipped: { productId: string | null; slug: string | null; code: string; message: string }[];
}

export interface ImportLine {
  productId?: string;
  slug?: string;
  qty: number;
  modifierIds?: string[];
  comboSelections?: ComboSelection[];
}

/** A phone's order, as `useOrders` sees it — no address, no other PII. */
export interface OrderSummary {
  id: string;
  number: number;
  state: string;
  placedAt: string;
  scheduledFor: string | null;
  mode: 'pickup' | 'delivery';
  totalCents: number;
  items: { name: string; qty: number }[];
}

export interface LoyaltyCard {
  enabled: boolean;
  stampsRequired: number;
  stamps: number;
  minOrderCents: number;
  rewardLabel: string;
  /** personal coupon codes ready to use */
  rewards: { code: string; label: string; expiresAt: string | null }[];
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
    /** Kernel 1.2 */
    addressParts?: {
      street: string | null;
      number: string | null;
      complement: string | null;
      neighborhood: string | null;
      reference: string | null;
      cep: string | null;
    };
    zoneName?: string | null;
    distanceKm?: number | null;
    /** when Core promised it (null for scheduled orders) */
    promisedFrom?: string | null;
    promisedTo?: string | null;
  };
  payment: {
    method: string;
    status: string;
    provider: string;
    instructions: string | null;
    /** Kernel 1.2 — copia e cola with this order's amount */
    pix?: (Omit<PixInfo, 'keyType'> & { keyType?: string }) | null;
  };
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  placedAt: string;
  timeline: { at: string; from: string | null; to: string; actor: string; meta: unknown }[];
  /** Kernel 1.2 */
  items?: OrderItem[];
  notes?: string | null;
  scheduledFor?: string | null;
  discountCents?: number;
  coupon?: { code: string } | null;
  updatedAt?: string;
  /** bumps on every state change — the live wait's cursor */
  version?: number;
}

export interface OrderItem {
  productId: string | null;
  slug: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  modifiers: { name: string; priceDeltaCents: number }[];
  combo: { slotName: string; name: string; qty: number }[];
  lineTotalCents: number;
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

const CUSTOMER_TOKENS_KEY = 'vendua.customerTokens';

// customer tokens (phone → token) outlive the tab: "meus pedidos" on this device
// keeps working across visits without asking the order number again
interface CustomerTokens {
  last?: string;
  byPhone: Record<string, { token: string; expiresAt: string }>;
}

function readCustomerTokens(): CustomerTokens {
  try {
    const raw = JSON.parse(
      globalThis.localStorage?.getItem(CUSTOMER_TOKENS_KEY) ?? 'null',
    ) as CustomerTokens | null;
    if (!raw || typeof raw.byPhone !== 'object') return { byPhone: {} };
    const now = Date.now();
    for (const [phone, t] of Object.entries(raw.byPhone))
      if (!t?.token || Date.parse(t.expiresAt) < now) delete raw.byPhone[phone];
    return raw;
  } catch {
    return { byPhone: {} };
  }
}

function writeCustomerTokens(t: CustomerTokens) {
  try {
    globalThis.localStorage?.setItem(CUSTOMER_TOKENS_KEY, JSON.stringify(t));
  } catch {
    /* private mode — verification lasts for this page */
  }
}

/** National digits — the shape Core keys phones by. */
export function phoneKey(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length >= 12 && d.startsWith('55') ? d.slice(2) : d;
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
  let customerTokens: CustomerTokens = readCustomerTokens();
  const rememberCustomer = (phone: string, t: { token: string; expiresAt: string }) => {
    const key = phoneKey(phone);
    customerTokens = {
      last: key,
      byPhone: { ...customerTokens.byPhone, [key]: t },
    };
    writeCustomerTokens(customerTokens);
  };
  const customerHeader = (phone?: string): Record<string, string> => {
    const key = phone ? phoneKey(phone) : customerTokens.last;
    const t = key ? customerTokens.byPhone[key] : undefined;
    return t ? { 'x-vendua-customer': t.token } : {};
  };
  const cartPost = async <T>(path: string, body?: unknown, method = 'POST'): Promise<T> => {
    await ensureSessionNow();
    return apiFetch<T>(co(path), {
      method,
      headers: { ...auth(), ...customerHeader(), 'idempotency-key': idemKey() },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

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
    state: (templates = false) =>
      apiFetch<StateEnvelope>(sf(`/state${templates ? '?templates=1' : ''}`)),
    notifyMe: (body: { subject: 'store' | 'product'; productId?: string; phone: string }) =>
      apiFetch<{ subscribed: true }>(co('/notify-me'), {
        method: 'POST',
        headers: { 'idempotency-key': idemKey() },
        body: JSON.stringify(body),
      }),
    /** order ids this browser placed (their tracking tokens are kept) — newest first */
    orderIds: (): string[] => {
      const ids = new Set<string>([...orderTokenMem.keys(), ...Object.keys(readOrderTokens())]);
      return [...ids].reverse();
    },
    /** a bairro name, or Kernel 1.2: `{ lat, lng }` from the device / `{ neighborhood }` */
    quote: (where: string | { neighborhood?: string; lat?: number; lng?: number }) =>
      apiFetch<QuoteResult>(co('/quote'), {
        method: 'POST',
        headers: { 'idempotency-key': idemKey() },
        body: JSON.stringify(typeof where === 'string' ? { neighborhood: where } : where),
      }),
    /** Kernel 1.2 — address + zone for a CEP (Core calls the CEP service) */
    cep: (cep: string) =>
      apiFetch<CepResult>(sf(`/cep/${encodeURIComponent(cep.replace(/\D/g, '').slice(0, 8))}`)),
    /** Kernel 1.2 — restock waitlist; answers how many are waiting */
    waitlist: (productId: string, phone: string) =>
      apiFetch<{ subscribed: true; waiting: number }>(sf('/waitlist'), {
        method: 'POST',
        headers: { 'idempotency-key': idemKey() },
        body: JSON.stringify({ productId, phone }),
      }),
    validateCoupon: (code: string) =>
      apiFetch<CouponCheck>(co('/coupons/validate'), {
        method: 'POST',
        headers: { ...auth(), ...customerHeader(), 'idempotency-key': idemKey() },
        body: JSON.stringify({ code }),
      }),
    applyCoupon: (code: string) =>
      cartPost<{ cart: Cart }>('/cart/coupon', { code }).then((r) => r.cart),
    removeCoupon: () =>
      cartPost<{ cart: Cart }>('/cart/coupon', undefined, 'DELETE').then((r) => r.cart),
    importCart: (items: ImportLine[]) =>
      cartPost<{ cart: Cart; report: ImportReport }>('/cart/import', { items }),
    importShare: (shareCode: string) =>
      cartPost<{ cart: Cart; report: ImportReport }>('/cart/import', { shareCode }),
    shareCart: () => cartPost<{ code: string; expiresAt: string }>('/cart/share'),
    reorder: (orderId: string) =>
      cartPost<{ cart: Cart; report: ImportReport }>('/cart/reorder', {
        orderId,
        ...((orderTokenMem.get(orderId) ?? readOrderTokens()[orderId])
          ? { orderToken: orderTokenMem.get(orderId) ?? readOrderTokens()[orderId] }
          : {}),
      }),
    /** phones this device can read history for (verified or checked out here) */
    customerPhones: (): string[] => {
      customerTokens = readCustomerTokens();
      const phones = Object.keys(customerTokens.byPhone);
      const last = customerTokens.last;
      return last && phones.includes(last) ? [last, ...phones.filter((p) => p !== last)] : phones;
    },
    verifyCustomer: async (phone: string, orderNumber: number) => {
      const r = await apiFetch<{ customerToken: string; expiresAt: string; phone: string }>(
        co('/customer/session'),
        {
          method: 'POST',
          headers: { 'idempotency-key': idemKey() },
          body: JSON.stringify({ phone, orderNumber }),
        },
      );
      rememberCustomer(r.phone, { token: r.customerToken, expiresAt: r.expiresAt });
      return r.phone;
    },
    forgetCustomer: (phone?: string) => {
      const next = { ...customerTokens.byPhone };
      if (phone) delete next[phoneKey(phone)];
      customerTokens = phone ? { byPhone: next } : { byPhone: {} };
      writeCustomerTokens(customerTokens);
    },
    customerOrders: (phone?: string) =>
      apiFetch<{ phone: string; orders: OrderSummary[] }>(
        co(`/customer/orders${phone ? `?phone=${phoneKey(phone)}` : ''}`),
        { headers: customerHeader(phone) },
      ),
    loyalty: (phone?: string) =>
      apiFetch<{ phone: string; loyalty: LoyaltyCard }>(
        co(`/customer/loyalty${phone ? `?phone=${phoneKey(phone)}` : ''}`),
        { headers: customerHeader(phone) },
      ),

    clearSession: clearSessionNow,
    ensureSession: ensureSessionNow,
    cart: cartGet,
    async addItem(
      productId: string,
      qty = 1,
      modifierIds: string[] = [],
      comboSelections?: ComboSelection[],
    ): Promise<Cart> {
      await ensureSessionNow();
      const res = await apiFetch<{ cart: Cart }>(co('/cart/items'), {
        method: 'POST',
        headers: { ...auth(), 'idempotency-key': idemKey() },
        body: JSON.stringify({
          productId,
          qty,
          modifierIds,
          ...(comboSelections?.length ? { comboSelections } : {}),
        }),
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
    setDelivery: (delivery: { mode: 'pickup' | 'delivery' } & DeliveryAddress) => {
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
      const r = await apiFetch<{
        order: Order;
        customerToken?: string;
        customerTokenExpiresAt?: string;
      }>(co('/checkout'), {
        method: 'POST',
        headers: { ...auth(), 'idempotency-key': idemKey() },
        body: JSON.stringify(input),
      });
      // this device placed an order for the phone — it may read the phone's history
      if (r.customerToken && r.customerTokenExpiresAt)
        rememberCustomer(input.customer.phone, {
          token: r.customerToken,
          expiresAt: r.customerTokenExpiresAt,
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
    /** Kernel 1.2 — long poll: resolves when the order moves past `since` or after `waitS` */
    orderWait: (id: string, since: number, waitS = 25, signal?: AbortSignal) => {
      const bearer = orderTokenMem.get(id) ?? readOrderTokens()[id] ?? token;
      return apiFetch<{ order: Order; changed: boolean }>(
        co(`/orders/${id}?since=${since}&wait=${waitS}`),
        {
          headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
          ...(signal ? { signal } : {}),
        },
      );
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
  'NETWORK_ERROR',
  // storefront platform (Phase 1b)
  'INVALID_NOTIFY',
  'INVALID_PAGE',
  'INVALID_TEMPLATE',
  'TEMPLATE_NOT_FOUND',
  'TEMPLATE_VERSION_CONFLICT',
  'INVALID_TOKENS',
  'INVALID_MANIFEST',
  'MIGRATION_NOT_FOUND',
  // commerce completeness (Phase 2 — Kernel 1.2)
  'OUT_OF_STOCK',
  'INVALID_COMBO',
  'COMBO_SLOT_COUNT',
  'COMBO_ITEM_LIMIT',
  'COMBO_ITEM_SOLD_OUT',
  'SCHEDULE_REQUIRED',
  'INVALID_SCHEDULE',
  'PAYMENT_NOT_ALLOWED',
  'INVALID_NOTES',
  'INVALID_COUPON',
  'COUPON_NOT_FOUND',
  'COUPON_EXPIRED',
  'COUPON_NOT_STARTED',
  'COUPON_EXHAUSTED',
  'COUPON_MIN_SUBTOTAL',
  'COUPON_NOT_YOURS',
  'COUPON_ALREADY_USED',
  'COUPON_FIRST_ORDER_ONLY',
  'COUPON_EXISTS',
  'INVALID_IMPORT',
  'SHARE_NOT_FOUND',
  'CUSTOMER_REQUIRED',
  'CUSTOMER_MISMATCH',
  'CUSTOMER_NOT_VERIFIED',
  'INVALID_CEP',
  'CEP_NOT_FOUND',
  'CEP_UNAVAILABLE',
  'INVALID_PIX',
  'ZONE_NOT_FOUND',
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
