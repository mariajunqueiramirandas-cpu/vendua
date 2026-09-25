import { useEffect, useSyncExternalStore } from 'react';
import { useMediaQuery } from './hooks.ts';

export type ThemePref = 'light' | 'dark' | 'system';

const KEY = 'vendua-control-theme';
const listeners = new Set<() => void>();
let pref: ThemePref = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
})();

function setPref(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* memory only */
  }
  listeners.forEach((fn) => fn());
}

export const THEME_LABEL: Record<ThemePref, string> = {
  system: 'automático',
  light: 'claro',
  dark: 'escuro',
};

export function useTheme() {
  const current = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => pref,
  );
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = current === 'dark' || (current === 'system' && systemDark);
  const cycle = () =>
    setPref(current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system');
  return { pref: current, dark, setPref, cycle };
}

/** Mount once (App) — keeps the `dark` class on <html> in sync. */
export function useApplyTheme() {
  const { dark } = useTheme();
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
}
