import { useRef, useSyncExternalStore } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, ApiError, type AgentRun } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const isActive = (status: string | undefined) => status === 'queued' || status === 'running';

/** ?status= values; 'scheduled' is the delayed queue (scheduled=1), not a status — own cursor/ordering */
export const RUN_VIEWS = [
  ['', 'todos'],
  ['queued', 'na fila'],
  ['running', 'rodando'],
  ['scheduled', 'agendados'],
  ['done', 'feitos'],
  ['failed', 'falhas'],
  ['canceled', 'cancelados'],
] as const;

export function runListParams(kind: string, view: string): Record<string, string> {
  return {
    ...(kind ? { kind } : {}),
    ...(view && view !== 'scheduled' ? { status: view } : {}),
    ...(view === 'scheduled' ? { scheduled: '1', status: 'queued', limit: '200' } : {}),
  };
}

export function useRunList(params: Record<string, string>) {
  return useInfiniteQuery({
    // `list` never reaches the API — it keeps this paged cache entry apart from
    // plain useQuery(qk.runs(sameParams)) readers, whose data has another shape
    queryKey: qk.runs({ ...params, list: 'paged' }),
    queryFn: ({ pageParam }) =>
      api.runs({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor || undefined,
  });
}

// Cancels acknowledged this session: the cancel control hides at once, before
// the run's own refetch lands (the worker may take a beat to flip the status).
const canceled = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export function useCanceledRuns() {
  useSyncExternalStore(subscribe, () => version);
  return canceled;
}

export function useCancelRun() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelRun(id),
    onSuccess: (_r, id) => {
      canceled.add(id);
      version++;
      for (const fn of listeners) fn();
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: (_r, _e, id) => {
      void client.invalidateQueries({ queryKey: ['runs'] });
      void client.invalidateQueries({ queryKey: qk.run(id) });
    },
  });
}

/**
 * One run, kept live by SSE invalidation of 'run'. Two guards from the old
 * stage: 'canceled' lands before the final journal, so it keeps reading on a
 * short bounded grace window while late tool results still arrive; and once
 * terminal it latches, so a delayed 'running' snapshot can't resurrect it.
 */
export function useLiveRun(id: string | null | undefined) {
  const grace = useRef<{ id: string; at: number; len: number } | null>(null);
  const latched = useRef<AgentRun | null>(null);
  if (latched.current && latched.current.id !== id) latched.current = null;

  const q = useQuery({
    queryKey: qk.run(id ?? ''),
    queryFn: () => api.run(id!),
    enabled: !!id,
    select: (r) => r.run,
    refetchInterval: (query) => {
      const run = query.state.data?.run;
      if (!run || run.status !== 'canceled') return isActive(run?.status) ? 60_000 : false;
      const len = Array.isArray(run.steps) ? run.steps.length : 0;
      const g = grace.current;
      if (!g || g.id !== run.id) {
        grace.current = { id: run.id, at: Date.now(), len };
        return 1300;
      }
      const since = Date.now() - g.at;
      if (since < 2000 || (since < 6000 && len > g.len)) {
        g.len = Math.max(g.len, len);
        return 1300;
      }
      return false;
    },
  });

  let run = q.data ?? null;
  if (run) {
    const g = grace.current;
    const settled =
      !isActive(run.status) &&
      (run.status !== 'canceled' || (g?.id === run.id && Date.now() - g.at >= 2000));
    if (settled) latched.current = run;
    else if (isActive(run.status) && latched.current?.id === run.id) run = latched.current;
  }
  const missing = q.error instanceof ApiError && q.error.status === 404;
  return { run, missing, error: q.error, isPending: q.isPending && !!id, refetch: q.refetch };
}
