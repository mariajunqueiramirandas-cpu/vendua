import { QueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from './api.ts';

// One key registry — screens share keys, SSE invalidation (live.ts) targets them.
export const qk = {
  session: ['session'] as const,
  home: ['home'] as const,
  board: ['orders', 'board'] as const,
  orders: (p: object) => ['orders', 'list', p] as const,
  scheduled: (from: string, to: string) => ['orders', 'scheduled', from, to] as const,
  order: (id: string) => ['orders', 'one', id] as const,
  catalog: ['catalog'] as const,
  product: (id: string) => ['catalog', 'product', id] as const,
  store: ['store'] as const,
  payments: ['payments'] as const,
  customers: (p: object) => ['customers', p] as const,
  customer: (phone: string) => ['customers', 'one', phone] as const,
  marketing: ['marketing'] as const,
  share: ['share'] as const,
  reports: (from: string, to: string) => ['reports', from, to] as const,
  team: ['team'] as const,
  activity: ['activity'] as const,
  account: ['account'] as const,
  appearance: ['appearance'] as const,
  sessions: ['me', 'sessions'] as const,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 24 * 60 * 60_000,
      // offline is a state, not an error (§2.2.10): keep showing the last data
      networkMode: 'offlineFirst',
      retry: (n, err) =>
        !(err instanceof ApiError && err.status >= 400 && err.status < 500) && n < 3,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // queued while offline, replayed on reconnect with the same Idempotency-Key
      networkMode: 'online',
      retry: (n, err) => err instanceof ApiError && err.status === 0 && n < 3,
    },
  },
});

/**
 * Optimistic write: show `patch(old)` now, hand back the way to undo it. Call `restore()` in
 * onError; the settling refetch/response replaces the guess on success.
 */
export async function optimistic<T>(qc: QueryClient, key: QueryKey, patch: (old: T) => T) {
  await qc.cancelQueries({ queryKey: key });
  const prev = qc.getQueryData<T>(key);
  if (prev !== undefined) qc.setQueryData<T>(key, patch(prev));
  return {
    restore: () => {
      if (prev !== undefined) qc.setQueryData(key, prev);
    },
  };
}
