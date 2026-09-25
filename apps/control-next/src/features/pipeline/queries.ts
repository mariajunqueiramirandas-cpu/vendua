import { useCallback, useRef } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, type LeadListItem } from '@/lib/api.ts';
import { errorMessage, qk } from '@/lib/query.ts';

export const PAGE_SIZE = 100;

/** Keyset-paged lead list; a refetch re-reads every loaded page, so an expanded list keeps its depth. */
export function useLeadList(params: Record<string, string>, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: qk.leads({ ...params, limit: String(PAGE_SIZE) }),
    queryFn: ({ pageParam }) =>
      api.leads({
        ...params,
        limit: String(PAGE_SIZE),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

// The board IS the pipeline — a partial page would hide leads and misreport column totals.
async function loadAll(params: Record<string, string>): Promise<LeadListItem[]> {
  const all: LeadListItem[] = [];
  let cursor: string | null = null;
  do {
    const r: { leads: LeadListItem[]; nextCursor: string | null } = await api.leads({
      ...params,
      limit: '200',
      ...(cursor ? { cursor } : {}),
    });
    all.push(...r.leads);
    cursor = r.nextCursor;
  } while (cursor);
  return all;
}

export const boardKey = (params: Record<string, string>) => qk.leads({ ...params, view: 'board' });

export function useBoardLeads(params: Record<string, string>, enabled = true) {
  return useQuery({
    enabled,
    queryKey: boardKey(params),
    queryFn: () => loadAll(params),
    placeholderData: keepPreviousData,
  });
}

type Stage = LeadListItem['state'];

/**
 * Stage moves: optimistic column swap, one PATCH in flight per lead with the
 * latest requested target queued behind it, server truth reloaded on failure.
 */
export function useMoveLead(params: Record<string, string>) {
  const client = useQueryClient();
  const key = boardKey(params);
  const keyRef = useRef(key);
  keyRef.current = key;
  // Refs, not state — in-flight checks must be synchronous or a queued write goes undrained.
  const inflightMoves = useRef(new Set<string>());
  const queuedMoves = useRef(new Map<string, Stage>());

  return useCallback(
    async (lead: LeadListItem, state: Stage) => {
      if (lead.state === state) return;
      const k = keyRef.current;
      // a refetch landing mid-move would snap the card back to its old column
      void client.cancelQueries({ queryKey: k });
      client.setQueryData<LeadListItem[]>(k, (ls) =>
        ls?.map((l) => (l.id === lead.id ? { ...l, state } : l)),
      );
      // A PATCH in flight — queue the latest target so a slow earlier write can't overwrite the newer stage.
      if (inflightMoves.current.has(lead.id)) {
        queuedMoves.current.set(lead.id, state);
        return;
      }
      inflightMoves.current.add(lead.id);
      try {
        let target: Stage | undefined = state;
        while (target !== undefined) {
          await api.patchLead(lead.id, { state: target });
          target = queuedMoves.current.get(lead.id);
          queuedMoves.current.delete(lead.id);
        }
        void client.invalidateQueries({ queryKey: qk.stats() });
      } catch (e) {
        // drop the pending target — the reload restores server truth
        queuedMoves.current.delete(lead.id);
        toast.error(`não foi possível mover ${lead.name}: ${errorMessage(e)}`);
        void client.invalidateQueries({ queryKey: k });
      } finally {
        inflightMoves.current.delete(lead.id);
      }
    },
    [client],
  );
}
