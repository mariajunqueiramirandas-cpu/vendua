import { useEffect, useState } from 'react';

// Screen Wake Lock: a phone or tablet on the counter keeps the board lit during
// service. The OS drops the lock when the app is hidden; it comes back on return.

const KEY = 'vendua-admin-awake';
type Sentinel = {
  release: () => Promise<void>;
  addEventListener: (t: 'release', f: () => void) => void;
};
type WakeLock = { request: (t: 'screen') => Promise<Sentinel> };
const wl = () => (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;

export const wakeLockSupported = () => typeof navigator !== 'undefined' && !!wl();

export function useWakeLock() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  const [held, setHeld] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* private mode */
    }
    const api = wl();
    if (!on || !api) return;
    let s: Sentinel | null = null;
    let live = true;
    const take = async () => {
      if (document.visibilityState !== 'visible' || s) return;
      try {
        s = await api.request('screen');
        if (!live) return void s.release();
        setHeld(true);
        s.addEventListener('release', () => {
          s = null;
          setHeld(false);
        });
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
      void s?.release().catch(() => undefined);
      setHeld(false);
    };
  }, [on]);
  return { on, held, toggle: () => setOn((v) => !v) };
}
