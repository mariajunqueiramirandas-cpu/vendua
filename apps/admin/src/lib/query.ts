import {
  QueryClient,
  useMutation as useQueryMutation,
  type DefaultError,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { ApiError, withRetryScope } from './api.ts';

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
  statement: (month: string) => ['payments', 'statement', month] as const,
  alerts: ['alerts'] as const,
  helpStatus: ['help', 'status'] as const,
  signupPlans: ['signup', 'plans'] as const,
};

// 408 and 429 pass with time; other 4xx won't change by asking again
const permanent = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 24 * 60 * 60_000,
      // offline is a state, not an error (§2.2.10): keep showing the last data
      networkMode: 'offlineFirst',
      retry: (n, err) => n < 3 && !(err instanceof ApiError && permanent(err.status)),
      refetchOnWindowFocus: true,
    },
    mutations: {
      // queued while offline, replayed on reconnect with the same Idempotency-Key
      networkMode: 'online',
      // only when the outcome is unknown; api.ts resends the same Idempotency-Key, so Core replays
      retry: (n, err) =>
        n < 3 &&
        err instanceof ApiError &&
        (err.status === 0 || err.code === 'IDEMPOTENCY_IN_PROGRESS'),
    },
  },
});

/**
 * useMutation with retry-safe Idempotency-Keys: TanStack hands every attempt of one mutation
 * the same context object, and api.ts keys its requests by it, so a retry after a dropped
 * connection is replayed by Core, never applied twice. Screens import this one.
 */
export function useMutation<
  TData = unknown,
  TError = DefaultError,
  TVariables = void,
  TContext = unknown,
>(options: UseMutationOptions<TData, TError, TVariables, TContext>) {
  const fn = options.mutationFn;
  return useQueryMutation<TData, TError, TVariables, TContext>({
    ...options,
    ...(fn ? { mutationFn: (v, ctx) => withRetryScope(ctx, () => fn(v, ctx)) } : {}),
  });
}

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
