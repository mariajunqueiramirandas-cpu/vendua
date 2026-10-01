import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { placeOf } from './nav.ts';
import { prevIs } from './Router.tsx';

// What makes the installed app feel like one: back returns to where you were, tapping the
// current tab goes to the top, the keyboard pushes the tab bar away. Screen transitions
// themselves start in Router.tsx.

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

/**
 * Tab/sidebar links: the Router animates the change (a `tab` transition). A tap on the tab
 * you're on scrolls it to the top; a tap while deeper in that tab returns to its root.
 */
export function useTabNav() {
  const nav = useNavigate();
  const loc = useLocation();
  return useCallback(
    (to: string) => (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      if (loc.pathname === to) {
        e.preventDefault();
        return scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
      }
      if (placeOf(loc.pathname)?.root !== to) return;
      e.preventDefault();
      if (prevIs(to)) nav(-1);
      else nav(to, { state: { vt: 'pop' } });
    },
    [loc.pathname, nav],
  );
}

const TYPING =
  'input:not([type=checkbox],[type=radio],[type=range],[type=color],[type=file],[type=button],[type=submit]),textarea,[contenteditable]:not([contenteditable=false])';

/**
 * `html[data-kb]` while the on-screen keyboard is up (phones): a text field has focus and the
 * visual viewport lost more than 150 px. The tab bar steps aside and `--tabbar-h` drops to 0,
 * so action bars sit on the keyboard's edge.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const phone = matchMedia('(max-width: 767px)');
    const root = document.documentElement;
    const typing = () => !!document.activeElement?.matches(TYPING);
    let full = vv.height;
    let t = 0;
    const check = () => {
      if (!typing()) full = Math.max(vv.height, innerHeight);
      const on = phone.matches && typing() && full - vv.height > 150;
      if (on !== root.hasAttribute('data-kb')) root.toggleAttribute('data-kb', on);
    };
    // focus moves through <body> between two fields: look once it has landed
    const later = () => {
      clearTimeout(t);
      t = window.setTimeout(check, 60);
    };
    vv.addEventListener('resize', check);
    addEventListener('focusin', later);
    addEventListener('focusout', later);
    return () => {
      clearTimeout(t);
      vv.removeEventListener('resize', check);
      removeEventListener('focusin', later);
      removeEventListener('focusout', later);
      root.removeAttribute('data-kb');
    };
  }, []);
}
