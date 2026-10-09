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
  segment: string;
  source: string;
  city: string;
  /** '1' = only leads with a draft waiting for approval */
  draft: string;
  /** '1' = only leads with an overdue task */
  overdue: string;
}

export type FilterKey = keyof Filters;
const FILTER_KEYS = [
  'q',
  'state',
  'tag',
  'sort',
  'archived',
  'segment',
  'source',
  'city',
  'draft',
  'overdue',
] as const satisfies readonly FilterKey[];
/** what "limpar" clears — sort is an ordering, not a filter */
const CLEARABLE = FILTER_KEYS.filter((k) => k !== 'sort');
/** what a saved view holds: the filters, the order and list/board */
export const VIEW_KEYS = [...FILTER_KEYS, 'v'] as const;

/**
 * Everything the pipeline shows lives in the URL (`v`, filters, `novo`) so a
 * trip to a lead and back — or a shared link, or a saved view — lands on the same view.
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
      segment: sp.get('segment') ?? '',
      source: sp.get('source') ?? '',
      city: sp.get('city') ?? '',
      draft: sp.get('draft') === '1' ? '1' : '',
      overdue: sp.get('overdue') === '1' ? '1' : '',
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

  const setFilter = useCallback((k: FilterKey, v: string) => patch({ [k]: v }), [patch]);

  /** the URL's view params — what "salvar visão" stores */
  const viewParams = useMemo(() => {
    const out: Record<string, string> = {};
    for (const k of VIEW_KEYS) {
      const v = sp.get(k);
      if (v) out[k] = v;
    }
    return out;
  }, [sp]);

  return {
    view: sp.get('v') === 'board' ? ('board' as const) : ('list' as const),
    novo: sp.get('novo') === '1',
    filters,
    filtered: CLEARABLE.some((k) => !!filters[k]),
    setFilter,
    clearFilters: () => patch(Object.fromEntries(CLEARABLE.map((k) => [k, null]))),
    /** replaces every view param with a saved view's (a history entry, so back undoes it) */
    applyView: (params: Record<string, string>) =>
      patch(Object.fromEntries(VIEW_KEYS.map((k) => [k, params[k] ?? null])), true),
    viewParams,
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
    ...(f.segment ? { segment: f.segment } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.city ? { city: f.city } : {}),
    ...(f.draft ? { draft: '1' } : {}),
    ...(f.overdue ? { overdue: '1' } : {}),
    ...(f.sort !== 'new' ? { sort: f.sort } : {}),
  };
}
