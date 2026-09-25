import { QueryCache, QueryClient, MutationCache } from '@tanstack/react-query';
import { ApiError } from './api.ts';

/**
 * Query keys: the first element names the resource and is what lib/live.ts
 * invalidates on SSE events — always build keys through `qk` so a feature's
 * cache refreshes when the server says that resource changed.
 */
export const qk = {
  session: () => ['session'] as const,
  stats: () => ['stats'] as const,
  leads: (params?: Record<string, string>) => ['leads', params ?? {}] as const,
  lead: (id: string) => ['lead', id] as const,
  leadThreads: (id: string) => ['lead-threads', id] as const,
  leadFacts: (id: string) => ['lead-facts', id] as const,
  leadAutonomy: (id: string) => ['lead-autonomy', id] as const,
  activities: (leadId: string) => ['activities', leadId] as const,
  tasks: (params?: Record<string, string>) => ['tasks', params ?? {}] as const,
  threads: (params?: Record<string, string>) => ['threads', params ?? {}] as const,
  thread: (id: string) => ['thread', id] as const,
  approvals: () => ['approvals'] as const,
  runs: (params?: Record<string, string>) => ['runs', params ?? {}] as const,
  run: (id: string) => ['run', id] as const,
  agentMetrics: (days: number) => ['agent-metrics', days] as const,
  briefs: () => ['briefs'] as const,
  segments: () => ['segments'] as const,
  channelHealth: () => ['channel-health'] as const,
  meetings: (params?: Record<string, string>) => ['meetings', params ?? {}] as const,
  meetingsStatus: () => ['meetings-status'] as const,
  integrations: () => ['integrations'] as const,
  waQr: () => ['integrations', 'wa'] as const,
  settings: () => ['settings'] as const,
  wakeups: (params?: Record<string, string>) => ['wakeups', params ?? {}] as const,
  agentConfig: () => ['agent-config'] as const,
  memory: (params?: Record<string, string>) => ['memory', params ?? {}] as const,
  duplicates: () => ['duplicates'] as const,
  snapshots: () => ['snapshots'] as const,
};

type AuthListener = () => void;
const authListeners = new Set<AuthListener>();
export const onUnauthorized = (fn: AuthListener) => {
  authListeners.add(fn);
  return () => void authListeners.delete(fn);
};
const checkAuth = (err: unknown) => {
  if (err instanceof ApiError && err.status === 401) for (const fn of authListeners) fn();
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    // the session probe itself 401s when logged out — that's its answer, not an expiry
    onError: (err, query) => query.queryKey[0] !== 'session' && checkAuth(err),
  }),
  mutationCache: new MutationCache({ onError: checkAuth }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // SSE (lib/live.ts) accelerates refreshes; this poll is the floor if the stream is down
      refetchInterval: 60_000,
      retry: (n, err) =>
        !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && n < 2,
    },
  },
});

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return 'não encontrado';
    if (err.status >= 500) return 'o servidor falhou — tente de novo';
    return err.message || err.code;
  }
  if (err instanceof TypeError) return 'sem conexão com o servidor';
  return err instanceof Error ? err.message : String(err);
}
