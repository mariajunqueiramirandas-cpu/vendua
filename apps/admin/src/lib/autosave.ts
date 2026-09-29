import { useEffect, useRef, useState } from 'react';
import type { SaveState } from '../ui/fields.tsx';

/**
 * Debounced autosave for structured editors (option groups, kits): edits save
 * themselves ~0.9 s after the last change; a server echo only replaces the draft
 * if nothing was typed meanwhile. One save is in flight at a time (the newest draft
 * goes next, so an older response can't land last), and leaving the screen saves
 * what's pending instead of dropping it.
 */
export function useAutosave<T>(
  initial: T,
  save: (v: T) => Promise<T>,
  opts: { valid?: (v: T) => boolean; delay?: number } = {},
) {
  const [draft, setDraftState] = useState(initial);
  const [state, setState] = useState<SaveState>('idle');
  const latest = useRef(initial);
  const saved = useRef(JSON.stringify(initial));
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inFlight = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const cfg = useRef({ save, ...opts });
  cfg.current = { save, ...opts };

  useEffect(() => {
    // external change (another device, first load) when not mid-edit
    const s = JSON.stringify(initial);
    if (
      !inFlight.current &&
      !timer.current &&
      s !== saved.current &&
      JSON.stringify(latest.current) === saved.current
    ) {
      saved.current = s;
      latest.current = initial;
      setDraftState(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const show = (s: SaveState) => {
    if (mounted.current) setState(s);
  };

  const flush = async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    while (inFlight.current) await inFlight.current;
    const v = latest.current;
    const { valid, save } = cfg.current;
    if ((valid && !valid(v)) || JSON.stringify(v) === saved.current) return;
    show('saving');
    const run = (async () => {
      try {
        const out = await save(v);
        saved.current = JSON.stringify(out);
        if (latest.current === v) {
          latest.current = out;
          if (mounted.current) setDraftState(out);
        }
        show('saved');
        setTimeout(() => mounted.current && setState((s) => (s === 'saved' ? 'idle' : s)), 2400);
      } catch {
        show('error');
      }
    })();
    inFlight.current = run.finally(() => {
      inFlight.current = null;
    });
    await inFlight.current;
  };

  const setDraft = (next: T | ((p: T) => T)) => {
    const v = typeof next === 'function' ? (next as (p: T) => T)(latest.current) : next;
    latest.current = v;
    setDraftState(v);
    clearTimeout(timer.current);
    timer.current = undefined;
    if (cfg.current.valid && !cfg.current.valid(v)) return;
    timer.current = setTimeout(() => void flush(), cfg.current.delay ?? 900);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) void flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { draft, setDraft, state };
}
