import { useCallback, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';

// What makes the installed app feel like one: back returns to where you were,
// tapping the current tab goes to the top, screens cross-fade instead of blinking.

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Back/forward restore the scroll position; a new screen starts at the top. */
export function useScrollMemory() {
  const loc = useLocation();
  const type = useNavigationType();
  const saved = useRef(new Map<string, number>());
  // a layout effect: it must stop recording before the next screen resets the scroll
  useLayoutEffect(() => {
    history.scrollRestoration = 'manual';
    const key = loc.key;
    const on = () => saved.current.set(key, scrollY);
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, [loc.key]);
  useLayoutEffect(() => {
    if (type !== 'POP') return void scrollTo(0, 0);
    const y = saved.current.get(loc.key) ?? 0;
    // the screen may still be filling in: retry for a few frames until it's tall enough
    // (and stop the moment the merchant scrolls, or leaves before it's done)
    let n = 0;
    let frame = 0;
    const stop = () => cancelAnimationFrame(frame);
    const go = () => {
      scrollTo(0, y);
      if (Math.abs(scrollY - y) > 2 && ++n < 20) frame = requestAnimationFrame(go);
    };
    go();
    const opts = { passive: true, once: true } as const;
    addEventListener('touchstart', stop, opts);
    addEventListener('wheel', stop, opts);
    return () => {
      stop();
      removeEventListener('touchstart', stop);
      removeEventListener('wheel', stop);
    };
  }, [loc.key, type]);
}

type VT = (cb: () => Promise<void>) => unknown;

/**
 * Tab/sidebar links: a same-document view transition into the next screen, and a
 * tap on the tab you're on scrolls it to the top.
 */
export function useTabNav() {
  const nav = useNavigate();
  const loc = useLocation();
  const pending = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    pending.current?.();
    pending.current = null;
  }, [loc.key]);
  return useCallback(
    (to: string) => (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      const here = to === '/' ? loc.pathname === '/' : loc.pathname === to;
      if (here) return scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      const start = (document as { startViewTransition?: VT }).startViewTransition;
      if (!start || reduced()) return nav(to);
      // resolves once the router committed the new screen (see the layout effect)
      const vt = start.call(
        document,
        () => new Promise<void>((ok) => ((pending.current = ok), nav(to))),
      ) as { ready?: Promise<void>; finished?: Promise<void> };
      // a skipped transition (a slow screen, a second tap) is fine: the navigation still happens
      vt.ready?.catch(() => undefined);
      vt.finished?.catch(() => undefined);
    },
    [loc.pathname, nav],
  );
}
