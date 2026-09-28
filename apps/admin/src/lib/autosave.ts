import { useEffect, useRef, useState } from 'react';
import type { SaveState } from '../ui/fields.tsx';

/**
 * Debounced autosave for structured editors (option groups, kits): edits save
 * themselves ~0.9 s after the last change; a server echo only replaces the draft
 * if nothing was typed meanwhile.
 */
export function useAutosave<T>(
  initial: T,
  save: (v: T) => Promise<T>,
  opts: { valid?: (v: T) => boolean; delay?: number } = {},
) {
  const [draft, setDraftState] = useState(initial);
  const [state, setState] = useState<SaveState>('idle');
  const rev = useRef(0);
  const saved = useRef(JSON.stringify(initial));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    // external change (another device, first load) when not mid-edit
    const s = JSON.stringify(initial);
    if (state !== 'saving' && s !== saved.current && JSON.stringify(draft) === saved.current) {
      saved.current = s;
      setDraftState(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  const setDraft = (next: T | ((p: T) => T)) => {
    setDraftState((p) => {
      const v = typeof next === 'function' ? (next as (p: T) => T)(p) : next;
      rev.current++;
      const mine = rev.current;
      clearTimeout(timer.current);
      if (opts.valid && !opts.valid(v)) return v;
      timer.current = setTimeout(async () => {
        if (JSON.stringify(v) === saved.current) return;
        setState('saving');
        try {
          const out = await save(v);
          saved.current = JSON.stringify(out);
          if (rev.current === mine) setDraftState(out);
          setState('saved');
          setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2400);
        } catch {
          setState('error');
        }
      }, opts.delay ?? 900);
      return v;
    });
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return { draft, setDraft, state };
}
