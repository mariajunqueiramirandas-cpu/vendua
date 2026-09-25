import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type InboxFilter = 'todas' | 'nao-respondidas' | 'rascunhos';

const ALIASES: Record<string, InboxFilter> = {
  todas: 'todas',
  'nao-respondidas': 'nao-respondidas',
  'não respondidas': 'nao-respondidas',
  'não-respondidas': 'nao-respondidas',
  responder: 'nao-respondidas',
  rascunhos: 'rascunhos',
  aprovacoes: 'rascunhos',
};

/** `f` (view), `ch` (channel) and `q` (search) live in the URL so back/forward and links work. */
export function useInboxFilters() {
  const [sp, setSp] = useSearchParams();
  const f = ALIASES[sp.get('f') ?? ''] ?? 'todas';
  const ch = sp.get('ch') ?? '';
  const q = sp.get('q') ?? '';

  const set = useCallback(
    (patch: Partial<{ f: InboxFilter; ch: string; q: string }>) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (!v || (k === 'f' && v === 'todas')) next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        // typing in the search box shouldn't stack history entries
        { replace: 'q' in patch },
      ),
    [setSp],
  );

  const search = sp.toString();
  return { f, ch, q, set, qs: search ? `?${search}` : '' };
}
