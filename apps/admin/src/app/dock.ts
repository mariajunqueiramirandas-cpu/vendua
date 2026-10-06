import { useEffect, useState } from 'react';

// The Copilot's dock on wide screens (Shell): open or closed is this device's choice, kept in
// localStorage. Its code is the Copilot's lazy chunk; only this switch lives in the shell.

const KEY = 'vendua-copilot-dock';

export const WIDE = '(min-width: 1200px)';

export function useMedia(q: string) {
  const [m, set] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => set(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function useDockOpen() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      if (open) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      /* private mode: it stays as chosen until the tab closes */
    }
  }, [open]);
  return [open, setOpen] as const;
}

/** "⌘J" on Apple keyboards, "Ctrl J" elsewhere */
export const dockKeys = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘J' : 'Ctrl J';
