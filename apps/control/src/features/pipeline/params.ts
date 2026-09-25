import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export const SORTS = [
  ['new', 'recentes'],
  ['activity', 'últ. atividade'],
  ['score', 'score'],
  ['value', 'valor'],
  ['name', 'nome'],
] as const;
export type LeadSort = (typeof SORTS)[number][0];

export const ARCHIVED = [
  ['', 'ativos'],
  ['only', 'arquivados'],
  ['all', 'todos'],
] as const;

export interface Filters {
  q: string;
  state: string;
  tag: string;
  sort: LeadSort;
  archived: string;
}

const FILTER_KEYS = ['q', 'state', 'tag', 'sort', 'archived'] as const;

/**
 * Everything the pipeline shows lives in the URL (`v`, filters, `novo`) so a
 * trip to a lead and back — or a shared link — lands on the same view.
 */
export function usePipelineParams() {
  const [sp, setSp] = useSearchParams();

  const filters = useMemo<Filters>(
    () => ({
      q: sp.get('q') ?? '',
      state: sp.get('state') ?? '',
      tag: sp.get('tag') ?? '',
      sort: (SORTS.some(([v]) => v === sp.get('sort')) ? sp.get('sort') : 'new') as LeadSort,
      archived: sp.get('archived') ?? '',
    }),
    [sp],
  );

  const patch = useCallback(
    (next: Record<string, string | null>, push = false) =>
      setSp(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(next)) {
            // defaults stay out of the URL
            if (!v || (k === 'sort' && v === 'new') || (k === 'v' && v === 'list')) p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace: !push },
      ),
    [setSp],
  );

  const setFilter = useCallback(
    (k: (typeof FILTER_KEYS)[number], v: string) => patch({ [k]: v }),
    [patch],
  );

  return {
    view: sp.get('v') === 'board' ? ('board' as const) : ('list' as const),
    novo: sp.get('novo') === '1',
    filters,
    filtered: !!(filters.q || filters.state || filters.tag || filters.archived),
    setFilter,
    // sort survives "limpar" — it's an ordering, not a filter
    clearFilters: () => patch({ q: null, state: null, tag: null, archived: null }),
    setView: (v: 'list' | 'board') => patch({ v }, true),
    openNew: () => patch({ novo: '1' }, true),
    closeNew: () => patch({ novo: null }),
    patch,
  };
}
export type PipelineParams = ReturnType<typeof usePipelineParams>;

/** Server params for the lead list — defaults omitted like the old view did. */
export function leadQuery(f: Filters, withState = true): Record<string, string> {
  return {
    ...(f.q ? { q: f.q } : {}),
    ...(withState && f.state ? { state: f.state } : {}),
    ...(f.tag ? { tag: f.tag } : {}),
    ...(f.archived ? { archived: f.archived } : {}),
    ...(f.sort !== 'new' ? { sort: f.sort } : {}),
  };
}
