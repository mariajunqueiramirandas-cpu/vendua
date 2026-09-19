import { useCallback, useMemo, useState } from 'react';
import { useKernel, useQuery, invalidateQuery } from './provider.tsx';
import type {
  Cart,
  CatalogCategory,
  CheckoutInput,
  DeliveryZone,
  Notice,
  Order,
  ProductDetail,
  StoreProfile,
} from './api.ts';
import { ApiError } from './api.ts';

/**
 * Data hooks — thin typed wrappers over Core reads (02-kernel.md#hooks).
 * They never compute prices or eligibility; they surface Core's answer.
 * Every read hook exposes `refetch` — storefronts use it for order
 * tracking polls and retry affordances.
 */

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
  return { product: q.data?.product, loading: q.loading, error: q.error, refetch: q.refetch };
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
      invalidateQuery('cart');
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
  /** Structured failure from the last submit — `code`/`details.field` are
   *  stable for form-level error display. */
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
      try {
        const order = await api.checkout(input);
        // The cart behind this session is now completed — drop it so the next
        // read doesn't show a stale finished cart.
        invalidateQuery('cart');
        invalidate('cart');
        return order;
      } catch (err) {
        const e =
          err instanceof ApiError
            ? { status: err.status, code: err.code, message: err.message, details: err.details }
            : { code: 'INTERNAL', message: err instanceof Error ? err.message : 'checkout failed' };
        setError(e);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [api, invalidate],
  );

  return { submit, pending, error, reset: useCallback(() => setError(undefined), []) };
}
