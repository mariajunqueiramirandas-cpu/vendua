import { useCallback, useMemo } from 'react';
import { useKernel, useQuery, invalidateQuery } from './provider.tsx';
import type {
  Cart,
  CatalogCategory,
  CheckoutInput,
  Notice,
  ProductDetail,
  StoreProfile,
} from './api.ts';

/**
 * Data hooks — thin typed wrappers over Core reads (02-kernel.md#hooks).
 * They never compute prices or eligibility; they surface Core's answer.
 */

export function useStore(): {
  store: StoreProfile | undefined;
  status: 'open' | 'closed' | 'paused' | undefined;
  resumesAt: string | undefined;
  loading: boolean;
  error: { code: string; message: string } | undefined;
} {
  const { api } = useKernel();
  const q = useQuery('store', () => api.store());
  return {
    store: q.data,
    status: q.data?.status,
    resumesAt: q.data?.resumesAt,
    loading: q.loading,
    error: q.error,
  };
}

export function useCatalog(): {
  categories: CatalogCategory[];
  loading: boolean;
  error: { code: string; message: string } | undefined;
} {
  const { api } = useKernel();
  const q = useQuery('catalog', () => api.catalog());
  return { categories: q.data?.categories ?? [], loading: q.loading, error: q.error };
}

export function useProduct(slug: string): {
  product: ProductDetail | undefined;
  loading: boolean;
  error: { code: string; message: string } | undefined;
} {
  const { api } = useKernel();
  const q = useQuery(`product:${slug}`, () => api.product(slug));
  return { product: q.data?.product, loading: q.loading, error: q.error };
}

export function useNotices(zoneMatched?: boolean): {
  notices: Notice[];
  blocking: Notice[];
  store: { status: 'open' | 'closed' | 'paused'; resumesAt?: string } | undefined;
  loading: boolean;
} {
  const { api } = useKernel();
  const key = `surfaces:${zoneMatched ?? 'any'}`;
  const q = useQuery(key, () => api.surfaces(zoneMatched));
  const notices = q.data?.notices ?? [];
  const blocking = notices.filter((n) => n.severity === 'blocking' || n.kind === 'emergency');
  return { notices, blocking, store: q.data?.store, loading: q.loading };
}

export interface CartMutations {
  add: (productId: string, qty?: number, modifierIds?: string[]) => Promise<Cart>;
  updateQty: (itemId: string, qty: number) => Promise<Cart>;
  remove: (itemId: string) => Promise<Cart>;
  setDelivery: (d: { mode: 'pickup' | 'delivery'; neighborhood?: string }) => Promise<Cart>;
}

export function useCart(): {
  cart: Cart | undefined;
  loading: boolean;
  error: { code: string; message: string } | undefined;
  mutations: CartMutations;
} {
  const { api, invalidate } = useKernel();
  const q = useQuery('cart', () =>
    api.sessionToken ? api.cart().then((r) => r.cart) : Promise.resolve(undefined),
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

  return { cart: q.data, loading: q.loading, error: q.error, mutations };
}

export function useCheckout(): {
  submit: (input: CheckoutInput) => Promise<import('./api.ts').Order>;
} {
  const { api } = useKernel();
  return {
    submit: useCallback((input: CheckoutInput) => api.checkout(input), [api]),
  };
}
