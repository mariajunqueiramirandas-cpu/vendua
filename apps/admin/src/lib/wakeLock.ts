import { useEffect, useState } from 'react';
import { platform } from '../platform/index.ts';

// Keep the screen lit: a phone or tablet on the counter keeps the board on during service.
// The OS drops it when the app is hidden; it comes back on return.

const KEY = 'vendua-admin-awake';

export const wakeLockSupported = () => platform.keepAwake.supported();

/** `key`/`initial`: a screen with its own preference (the kitchen's starts on). */
export function useWakeLock(key = KEY, initial = false) {
  const [on, setOn] = useState(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? initial : v === '1';
    } catch {
      return initial;
    }
  });
  const [held, setHeld] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(key, on ? '1' : '0');
    } catch {
      /* private mode */
    }
    if (!on || !platform.keepAwake.supported()) return;
    let release: (() => void) | null = null;
    let live = true;
    const take = async () => {
      if (document.visibilityState !== 'visible' || release) return;
      try {
        const r = await platform.keepAwake.hold(() => {
          release = null;
          setHeld(false);
        });
        if (!r) return;
        if (!live) return r();
        release = r;
        setHeld(true);
      } catch {
        /* battery saver or no gesture yet: retried on the next return */
      }
    };
    void take();
    const vis = () => void take();
    document.addEventListener('visibilitychange', vis);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', vis);
      release?.();
      setHeld(false);
    };
  }, [on, key]);
  return { on, held, toggle: () => setOn((v) => !v) };
}
