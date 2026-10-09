import { useEffect, useRef, useState } from 'react';

/**
 * A local copy of a server value. A refetch replaces it only while it's unedited, so the
 * 60 s poll never eats someone's changes; `dirty` compares the serialized forms.
 */
export function useSyncedDraft<S, D>(
  src: S | undefined,
  toDraft: (s: S) => D,
  out: (d: D) => unknown,
) {
  const [draft, setDraft] = useState<D | null>(null);
  const base = useRef<string | null>(null);
  const [, bump] = useState(0);
  const canon = (d: D) => JSON.stringify(out(d));
  useEffect(() => {
    if (src === undefined) return;
    const next = toDraft(src);
    const prev = base.current;
    setDraft((d) => (d === null || canon(d) === prev ? next : d));
    base.current = canon(next);
    bump((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);
  return {
    draft,
    setDraft: (d: D) => setDraft(d),
    dirty: draft !== null && base.current !== null && canon(draft) !== base.current,
    discard: () => src !== undefined && setDraft(toDraft(src)),
    markSaved: (d: D) => {
      base.current = canon(d);
      bump((n) => n + 1);
    },
  };
}
