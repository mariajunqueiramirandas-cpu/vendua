import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useKernel, useQuery, invalidateQuery } from './provider.tsx';
import type {
  Cart,
  CatalogCategory,
  CepResult,
  CheckoutInput,
  ComboSelection,
  DeliveryAddress,
  DeliveryZone,
  ImportLine,
  ImportReport,
  LoyaltyCard,
  Notice,
  Order,
  OrderSummary,
  ProductDetail,
  QuoteResult,
  StoreProfile,
} from './api.ts';
import { ApiError } from './api.ts';
import type { ConsentPurpose } from './config.ts';
import {
  currentConsent,
  emit,
  onConsentChange,
  trackCustom,
  writeConsent,
  type ConsentState,
} from './telemetry.ts';

// data hooks — thin typed wrappers over Core reads (02-kernel.md#hooks);
// they never compute prices or eligibility, and every read exposes `refetch`

export interface QueryError {
  status?: number | undefined;
  code: string;
  message: string;
  details?: Record<string, unknown> | undefined;
}

export function useStore(): {
  store: StoreProfile | undefined;
  status: 'open' | 'closed' | 'paused' | undefined;
  resumesAt: string | undefined;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery('store', () => api.store());
  return {
    store: q.data,
    status: q.data?.status,
    resumesAt: q.data?.resumesAt,
    loading: q.loading,
    error: q.error,
    refetch: q.refetch,
  };
}

export function useCatalog(): {
  categories: CatalogCategory[];
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery('catalog', () => api.catalog());
  return {
    categories: q.data?.categories ?? [],
    loading: q.loading,
    error: q.error,
    refetch: q.refetch,
  };
}

export function useProduct(slug: string): {
  product: ProductDetail | undefined;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery(`product:${slug}`, () => api.product(slug));
  const product = q.data?.product;
  // product_view once per resolved product per mount (15 — taxonomy)
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!product || seen.current === product.id) return;
    seen.current = product.id;
    emit('product_view', { product_id: product.id, slug: product.slug });
  }, [product]);
  return { product, loading: q.loading, error: q.error, refetch: q.refetch };
}

export function useNotices(zoneMatched?: boolean): {
  notices: Notice[];
  blocking: Notice[];
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string } | undefined;
  loading: boolean;
  refetch: () => void;
} {
  const { api } = useKernel();
  const key = `surfaces:${zoneMatched ?? 'any'}`;
  const q = useQuery(key, () => api.surfaces(zoneMatched));
  const notices = q.data?.notices ?? [];
  const blocking = notices.filter((n) => n.severity === 'blocking' || n.kind === 'emergency');
  return { notices, blocking, store: q.data?.store, loading: q.loading, refetch: q.refetch };
}

export function useDeliveryZones(): {
  zones: DeliveryZone[];
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery('zones', () => api.zones());
  return { zones: q.data?.zones ?? [], loading: q.loading, error: q.error, refetch: q.refetch };
}

export interface CartMutations {
  add: (
    productId: string,
    qty?: number,
    modifierIds?: string[],
    /** Kernel 1.2 — kit picks for a `kind: 'combo'` product */
    comboSelections?: ComboSelection[],
  ) => Promise<Cart>;
  updateQty: (itemId: string, qty: number) => Promise<Cart>;
  remove: (itemId: string) => Promise<Cart>;
  setDelivery: (d: { mode: 'pickup' | 'delivery' } & DeliveryAddress) => Promise<Cart>;
  /** Kernel 1.2 — Core validates and prices; a coupon short of its minimum stays on, not applying */
  applyCoupon: (code: string) => Promise<Cart>;
  removeCoupon: () => Promise<Cart>;
  /** Kernel 1.2 — merge lines into this cart; `report.skipped` says what couldn't be added */
  importItems: (items: ImportLine[]) => Promise<{ cart: Cart; report: ImportReport }>;
  /** Kernel 1.2 — a `?cart=CODE` link anyone can open to get this sacola */
  share: () => Promise<{ code: string; url: string; expiresAt: string }>;
  /** Kernel 1.2 — "pedir de novo": a past order's lines back in the sacola */
  reorder: (orderId: string) => Promise<{ cart: Cart; report: ImportReport }>;
}

export function useCart(): {
  /** null = no session/cart yet (or a resolved empty read). */
  cart: Cart | null;
  loading: boolean;
  error: QueryError | undefined;
  mutations: CartMutations;
  refetch: () => void;
} {
  const { api, invalidate } = useKernel();
  const q = useQuery('cart', () =>
    api.sessionToken ? api.cart().then((r) => r.cart) : Promise.resolve(null),
  );

  const bump = useCallback(
    (cart: Cart) => {
      // seed, don't evict: an evict→refetch gap drops cart to null mid-render,
      // re-firing checkout effects into a POST loop
      invalidateQuery('cart', cart);
      invalidate('cart');
      return cart;
    },
    [invalidate],
  );

  const mutations = useMemo<CartMutations>(
    () => ({
      add: (productId, qty = 1, modifierIds = [], comboSelections) =>
        api.addItem(productId, qty, modifierIds, comboSelections).then(bump),
      updateQty: (itemId, qty) => api.updateItem(itemId, qty).then(bump),
      remove: (itemId) => api.removeItem(itemId).then(bump),
      setDelivery: (d) => api.setDelivery(d).then(bump),
      applyCoupon: (code) => api.applyCoupon(code).then(bump),
      removeCoupon: () => api.removeCoupon().then(bump),
      importItems: (items) =>
        api.importCart(items).then((r) => {
          bump(r.cart);
          return r;
        }),
      share: async () => {
        const r = await api.shareCart();
        const origin = globalThis.location?.origin ?? '';
        return { ...r, url: `${origin}/?cart=${encodeURIComponent(r.code)}` };
      },
      reorder: (orderId) =>
        api.reorder(orderId).then((r) => {
          bump(r.cart);
          return r;
        }),
    }),
    [api, bump],
  );

  return {
    cart: q.data ?? null,
    loading: q.loading,
    error: q.error,
    mutations,
    refetch: q.refetch,
  };
}

const TERMINAL_ORDER = new Set(['delivered', 'cancelled', 'refunded']);

/** Kernel 1.2: live by default — a Kernel-owned long poll (no storefront polling,
 *  no EventSource). Pauses while the tab is hidden, stops at a terminal state,
 *  backs off on errors. `{ live: false }` restores the plain read. */
export function useOrder(
  id: string,
  opts: { live?: boolean } = {},
): {
  order: Order | undefined;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
  /** a live wait is open right now */
  live: boolean;
} {
  const { api } = useKernel();
  const q = useQuery(`order:${id}`, () => api.order(id));
  const [fresh, setFresh] = useState<Order>();
  const [live, setLive] = useState(false);
  const want = opts.live !== false;
  // whichever read is newer wins: the live wait's answer or a refetch
  const own = fresh?.id === id ? fresh : undefined;
  const current = own && (own.version ?? 0) >= (q.data?.version ?? 0) ? own : (q.data ?? own);
  const version = current?.version;
  const state = current?.state;

  useEffect(() => {
    setFresh(undefined);
  }, [id]);

  useEffect(() => {
    // Core without Kernel-1.2 orders (no version) keeps the plain read
    if (!want || version === undefined || !state || TERMINAL_ORDER.has(state)) return;
    const ctl = new AbortController();
    let stopped = false;
    let failures = 0;
    const doc = globalThis.document;
    const visible = () => !doc || doc.visibilityState !== 'hidden';
    const loop = async (since: number) => {
      while (!stopped) {
        if (!visible()) {
          setLive(false);
          await new Promise<void>((r) => {
            const on = () => {
              if (visible() || stopped) {
                doc?.removeEventListener('visibilitychange', on);
                r();
              }
            };
            doc?.addEventListener('visibilitychange', on);
            ctl.signal.addEventListener('abort', on, { once: true });
          });
          continue;
        }
        setLive(true);
        try {
          const r = await api.orderWait(id, since, 25, ctl.signal);
          failures = 0;
          if (r.changed && r.order.version !== undefined) {
            setFresh(r.order);
            // the effect re-arms on the new version (or stops at a terminal state)
            return;
          }
        } catch {
          if (stopped) return;
          failures++;
          setLive(false);
          await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** failures)));
        }
      }
    };
    void loop(version);
    return () => {
      stopped = true;
      ctl.abort();
      setLive(false);
    };
  }, [api, id, want, version, state]);

  return {
    order: current,
    loading: q.loading && !current,
    error: current ? undefined : q.error,
    refetch: q.refetch,
    live,
  };
}

export function useCheckout(): {
  submit: (input: CheckoutInput) => Promise<Order>;
  pending: boolean;
  /** structured failure; `code`/`details.field` stable for form display */
  error: QueryError | undefined;
  reset: () => void;
} {
  const { api, invalidate } = useKernel();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError | undefined>();

  const submit = useCallback(
    async (input: CheckoutInput) => {
      setPending(true);
      setError(undefined);
      emit('payment_submit', { method: input.payment.method });
      try {
        const order = await api.checkout(input);
        // drop the now-completed cart so the next read isn't stale
        invalidateQuery('cart');
        invalidate('cart');
        return order;
      } catch (err) {
        const e =
          err instanceof ApiError
            ? { status: err.status, code: err.code, message: err.message, details: err.details }
            : { code: 'INTERNAL', message: err instanceof Error ? err.message : 'checkout failed' };
        setError(e);
        emit('order_failed', { code: e.code });
        throw err;
      } finally {
        setPending(false);
      }
    },
    [api, invalidate],
  );

  return { submit, pending, error, reset: useCallback(() => setError(undefined), []) };
}

/** Zone check for a neighborhood — fee, ETA and eligibility are Core's answer. */
export function useDeliveryQuote(): {
  /** a bairro, or Kernel 1.2 `{ lat, lng }` (e.g. from the device's location) */
  quote: (
    where: string | { neighborhood?: string; lat?: number; lng?: number },
  ) => Promise<QuoteResult>;
  result: QuoteResult | undefined;
  pending: boolean;
  error: QueryError | undefined;
} {
  const { api } = useKernel();
  const [result, setResult] = useState<QuoteResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError>();
  const seq = useRef(0);
  const quote = useCallback(
    async (where: string | { neighborhood?: string; lat?: number; lng?: number }) => {
      const n = ++seq.current;
      setPending(true);
      setError(undefined);
      try {
        const r = await api.quote(typeof where === 'string' ? where.trim().slice(0, 80) : where);
        if (n === seq.current) setResult(r);
        return r;
      } catch (err) {
        const e =
          err instanceof ApiError
            ? { status: err.status, code: err.code, message: err.message, details: err.details }
            : { code: 'INTERNAL', message: 'quote failed' };
        if (n === seq.current) setError(e);
        throw err;
      } finally {
        if (n === seq.current) setPending(false);
      }
    },
    [api],
  );
  return { quote, result, pending, error };
}

export interface CustomerProfile {
  name: string;
  phone: string;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    complement: string;
    /** Kernel 1.2 */
    cep?: string;
  };
}

const CUSTOMER_KEY = 'vendua.customer';
let customerMem: CustomerProfile | null | undefined;
const customerListeners = new Set<() => void>();

function readCustomer(): CustomerProfile | null {
  if (customerMem !== undefined) return customerMem;
  try {
    const raw = globalThis.localStorage?.getItem(CUSTOMER_KEY);
    const p = raw ? (JSON.parse(raw) as CustomerProfile) : null;
    customerMem = p && typeof p.name === 'string' && typeof p.phone === 'string' ? p : null;
  } catch {
    customerMem = null;
  }
  return customerMem;
}

/** Guest customer remembered on this device, only when they opt in at checkout
 *  (03 — storage only via Kernel session utilities). Phone-OTP accounts land
 *  with the merchant admin (Phase 3) behind this same hook. */
export function useCustomer(): {
  customer: CustomerProfile | null;
  status: 'guest' | 'remembered';
  remember: (p: CustomerProfile) => void;
  forget: () => void;
} {
  const customer = useSyncExternalStore(
    (fn) => {
      customerListeners.add(fn);
      return () => customerListeners.delete(fn);
    },
    readCustomer,
    () => null,
  );
  const remember = useCallback((p: CustomerProfile) => {
    const clean: CustomerProfile = {
      name: p.name.slice(0, 120),
      phone: p.phone.replace(/\D/g, '').slice(0, 13),
      address: {
        street: p.address.street.slice(0, 120),
        number: p.address.number.slice(0, 10),
        neighborhood: p.address.neighborhood.slice(0, 80),
        complement: p.address.complement.slice(0, 80),
        ...(p.address.cep ? { cep: p.address.cep.replace(/\D/g, '').slice(0, 8) } : {}),
      },
    };
    customerMem = clean;
    try {
      globalThis.localStorage?.setItem(CUSTOMER_KEY, JSON.stringify(clean));
    } catch {
      /* private mode — remembered for this page only */
    }
    customerListeners.forEach((fn) => fn());
  }, []);
  const forget = useCallback(() => {
    customerMem = null;
    try {
      globalThis.localStorage?.removeItem(CUSTOMER_KEY);
    } catch {
      /* nothing stored */
    }
    customerListeners.forEach((fn) => fn());
  }, []);
  return { customer, status: customer ? 'remembered' : 'guest', remember, forget };
}

/** Allow-listed custom events: `track('custom.<name>', props)`; no-ops without analytics consent. */
export function useAnalytics(): {
  track: (name: `custom.${string}`, props?: Record<string, unknown>) => boolean;
} {
  return useMemo(() => ({ track: (name, props) => trackCustom(name, props) }), []);
}

export function useConsent(): {
  consent: ConsentState | null;
  decide: (purposes: ConsentPurpose[]) => void;
} {
  const consent = useSyncExternalStore(onConsentChange, currentConsent, () => null);
  return { consent, decide: writeConsent };
}

/** Orders this browser placed (the Kernel keeps each order's tracking token). */
export function useOrderHistory(): {
  orders: Order[];
  loading: boolean;
  refetch: () => void;
} {
  const { api } = useKernel();
  const ids = api.orderIds().slice(0, 20);
  const q = useQuery(`orders:${ids.join(',')}`, async () => {
    const settled = await Promise.allSettled(ids.map((id) => api.order(id)));
    return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  });
  return { orders: q.data ?? [], loading: q.loading, refetch: q.refetch };
}

function toQueryError(err: unknown, fallback: string): QueryError {
  return err instanceof ApiError
    ? { status: err.status, code: err.code, message: err.message, details: err.details }
    : { code: 'INTERNAL', message: fallback };
}

/** Kernel 1.2 — "sem senha, sem cadastro": a phone's orders across devices. The
 *  device that checked out with the phone is trusted already; any other proves it
 *  with one order number (`verify`). Summaries only — no addresses. */
export function useOrders(phone?: string): {
  orders: OrderSummary[];
  /** the phone the list belongs to (normalized), once known */
  phone: string | undefined;
  /** no proof for this phone on this device yet — call verify(orderNumber) */
  needsVerification: boolean;
  verify: (orderNumber: number, phoneOverride?: string) => Promise<void>;
  forget: () => void;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const [, bumpTick] = useState(0);
  const known = api.customerPhones();
  const target = phone ?? known[0];
  const key = `customer-orders:${target ?? ''}`;
  const q = useQuery(key, () =>
    target && known.some((p) => target.replace(/\D/g, '').endsWith(p))
      ? api.customerOrders(target)
      : Promise.resolve(null),
  );
  const needsVerification =
    !q.loading && (q.data === null || q.error?.code === 'CUSTOMER_REQUIRED');
  const verify = useCallback(
    async (orderNumber: number, phoneOverride?: string) => {
      const p = phoneOverride ?? phone;
      if (!p) throw new ApiError(422, 'INVALID_CUSTOMER', 'phone is required');
      const verified = await api.verifyCustomer(p, orderNumber);
      invalidateQuery(`customer-orders:${phoneOverride ?? phone ?? ''}`);
      invalidateQuery(`customer-orders:${verified}`);
      invalidateQuery(`loyalty:${verified}`);
      bumpTick((t) => t + 1);
    },
    [api, phone],
  );
  const forget = useCallback(() => {
    api.forgetCustomer(target);
    invalidateQuery(key);
    bumpTick((t) => t + 1);
  }, [api, key, target]);
  return {
    orders: q.data?.orders ?? [],
    phone: q.data?.phone ?? target,
    needsVerification,
    verify,
    forget,
    loading: q.loading,
    error: q.error?.code === 'CUSTOMER_REQUIRED' ? undefined : q.error,
    refetch: q.refetch,
  };
}

/** Kernel 1.2 — the stamp card for a verified phone (see useOrders for verification). */
export function useLoyalty(phone?: string): {
  card: LoyaltyCard | null;
  needsVerification: boolean;
  loading: boolean;
  refetch: () => void;
} {
  const { api } = useKernel();
  const target = phone ?? api.customerPhones()[0];
  const q = useQuery(`loyalty:${target ?? ''}`, () =>
    target ? api.loyalty(target).catch(() => null) : Promise.resolve(null),
  );
  return {
    card: q.data?.loyalty ?? null,
    needsVerification: !q.loading && !q.data,
    loading: q.loading,
    refetch: q.refetch,
  };
}

/** Kernel 1.2 — CEP → street/bairro/cidade and the delivery zone, via Core. */
export function useCep(): {
  lookup: (cep: string) => Promise<CepResult | null>;
  result: CepResult | undefined;
  pending: boolean;
  error: QueryError | undefined;
} {
  const { api } = useKernel();
  const [result, setResult] = useState<CepResult>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError>();
  const seq = useRef(0);
  const lookup = useCallback(
    async (cep: string) => {
      const digits = cep.replace(/\D/g, '');
      if (digits.length !== 8) return null;
      const n = ++seq.current;
      setPending(true);
      setError(undefined);
      try {
        const r = await api.cep(digits);
        if (n === seq.current) setResult(r);
        return r;
      } catch (err) {
        if (n === seq.current) setError(toQueryError(err, 'cep lookup failed'));
        return null;
      } finally {
        if (n === seq.current) setPending(false);
      }
    },
    [api],
  );
  return { lookup, result, pending, error };
}

/** Kernel 1.2 — join a sold-out product's restock waitlist. */
export function useWaitlist(productId: string | undefined): {
  join: (phone: string) => Promise<number>;
  /** how many wait, after joining */
  waiting: number | undefined;
  joined: boolean;
  pending: boolean;
  error: QueryError | undefined;
} {
  const { api } = useKernel();
  const [waiting, setWaiting] = useState<number>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<QueryError>();
  const join = useCallback(
    async (phone: string) => {
      if (!productId) throw new ApiError(422, 'INVALID_NOTIFY', 'no product');
      setPending(true);
      setError(undefined);
      try {
        const r = await api.waitlist(productId, phone);
        setWaiting(r.waiting);
        emit('notify_me', { subject: 'product', product_id: productId });
        return r.waiting;
      } catch (err) {
        setError(toQueryError(err, 'waitlist failed'));
        throw err;
      } finally {
        setPending(false);
      }
    },
    [api, productId],
  );
  return { join, waiting, joined: waiting !== undefined, pending, error };
}
