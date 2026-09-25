import { useEffect, useState, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** < 768px — tab bar, bottom sheets, list rows instead of tables. */
export const useIsMobile = () => useMediaQuery('(max-width: 767.98px)');
/** ≥ 1024px — full sidebar, multi-pane layouts. */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
/** ≥ 1280px — third pane (inbox context, lead agent column). */
export const useIsWide = () => useMediaQuery('(min-width: 1280px)');

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** localStorage-backed state; storage can throw (private mode) — falls back to memory. */
export function useStoredState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      /* memory only */
    }
  }, [key, v]);
  return [v, setV] as const;
}
