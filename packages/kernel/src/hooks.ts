import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useKernel, useQuery, invalidateQuery } from './provider.tsx';
import type {
  Cart,
  CatalogCategory,
  CheckoutInput,
  DeliveryZone,
  Notice,
  Order,
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
  add: (productId: string, qty?: number, modifierIds?: string[]) => Promise<Cart>;
  updateQty: (itemId: string, qty: number) => Promise<Cart>;
  remove: (itemId: string) => Promise<Cart>;
  setDelivery: (d: { mode: 'pickup' | 'delivery'; neighborhood?: string }) => Promise<Cart>;
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
      add: (productId, qty = 1, modifierIds = []) =>
        api.addItem(productId, qty, modifierIds).then(bump),
      updateQty: (itemId, qty) => api.updateItem(itemId, qty).then(bump),
      remove: (itemId) => api.removeItem(itemId).then(bump),
      setDelivery: (d) => api.setDelivery(d).then(bump),
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

export function useOrder(id: string): {
  order: Order | undefined;
  loading: boolean;
  error: QueryError | undefined;
  refetch: () => void;
} {
  const { api } = useKernel();
  const q = useQuery(`order:${id}`, () => api.order(id));
  return { order: q.data, loading: q.loading, error: q.error, refetch: q.refetch };
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
  quote: (neighborhood: string) => Promise<QuoteResult>;
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
    async (neighborhood: string) => {
      const n = ++seq.current;
      setPending(true);
      setError(undefined);
      try {
        const r = await api.quote(neighborhood.trim().slice(0, 80));
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
  address: { street: string; number: string; neighborhood: string; complement: string };
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
