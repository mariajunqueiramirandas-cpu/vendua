import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useKernel } from './provider.tsx';
import { resolvePaths } from './config.ts';
import { useCopy } from './hooks.ts';
import { CartContents } from './pages/cart.tsx';
import {
  registerSheet,
  sheetBlocked,
  transitionRunning,
  uaTraversal,
  type Loc,
} from './transitions.tsx';
import { reducedMotion, SPRING, springEasing } from './spring.ts';
import { setToastHost, toastHost } from './toast-layer.ts';
import { dimThemeColor } from './theme-color.ts';
import { haptic } from './haptics.ts';

// The bag as a modal route: /sacola pushed with `state.vBackground` draws over the page it
// was opened from, in a <dialog> (top layer, inert page behind). Phones: a bottom sheet the
// finger drags 1:1 and that settles on a spring; ≥ 768 px: a right-side panel. Every way
// out (drag, ×, Esc, scrim, the back button) animates the sheet away before the route pops.

const wide = () => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 768px)').matches;
const GRAB = '.v-sheet-grip, [data-part="head"]';

export function CartSheet({ background }: { background: Loc }) {
  const navigate = useNavigate();
  const { key } = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const closing = useRef(false);
  const mounted = useRef(false);
  const unregister = useRef<(() => void) | null>(null);

  const leave = useCallback(() => {
    if (!mounted.current) return;
    const idx = (globalThis.history?.state as { idx?: unknown } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else
      navigate(
        { pathname: background.pathname, search: background.search, hash: background.hash },
        { replace: true, state: background.state },
      );
  }, [navigate, background]);

  /**
   * animate out from wherever the finger left it, then `then` (default: pop the route);
   * returns `reopen`, which calls the close off while it animates
   */
  const close = useCallback(
    (velocity = 0, then?: () => void): (() => void) | undefined => {
      if (closing.current) return;
      closing.current = true;
      unregister.current?.();
      dimThemeColor(false);
      let called = false;
      const finish = () => {
        if (called) return;
        called = true;
        (then ?? leave)();
      };
      const panel = panelRef.current;
      const scrim = scrimRef.current;
      if (!panel || typeof panel.animate !== 'function') {
        finish();
        return;
      }
      const reduce = reducedMotion();
      const axis = wide() ? 'X' : 'Y';
      const from = offset.current;
      let anim: Animation;
      if (reduce) {
        anim = panel.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
      } else {
        const size = axis === 'Y' ? panel.offsetHeight : panel.offsetWidth;
        const { easing, duration } = springEasing(
          SPRING,
          (Math.max(0, velocity) * 1000) / Math.max(1, size - from),
        );
        anim = panel.animate(
          [{ transform: `translate${axis}(${from}px)` }, { transform: `translate${axis}(100%)` }],
          { duration: Math.min(duration, 380), easing, fill: 'forwards' },
        );
      }
      panel.style.transform = '';
      scrim?.animate([{ opacity: scrim.style.opacity || '1' }, { opacity: 0 }], {
        duration: reduce ? 120 : 220,
        easing: 'ease-out',
        fill: 'forwards',
      });
      anim.finished.then(finish, finish);
      return function reopen() {
        if (called || !mounted.current) return;
        called = true;
        const t = reduce ? 120 : 240;
        for (const el of [panel, scrim]) {
          if (!el) continue;
          const cs = getComputedStyle(el);
          const now = { transform: cs.transform, opacity: cs.opacity };
          for (const a of el.getAnimations()) a.cancel();
          el.animate([now, { transform: 'none', opacity: 1 }], {
            duration: t,
            easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
          });
        }
        if (scrim) scrim.style.opacity = '';
        offset.current = 0;
        closing.current = false;
        dimThemeColor(true);
        unregister.current = registerSheet((done) => close(0, done));
      };
    },
    [leave],
  );

  useLayoutEffect(() => {
    const d = dialogRef.current!;
    const panel = panelRef.current!;
    const scrim = scrimRef.current!;
    mounted.current = true;
    closing.current = false;
    try {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } catch {
      d.setAttribute('open', '');
    }
    setToastHost(d);
    dimThemeColor(true);
    unregister.current = registerSheet((done) => close(0, done));
    // inside a page transition (back from checkout), or after the browser's own swipe
    // animation, the sheet is simply there
    if (sheetBlocked()) close();
    else if (!transitionRunning() && !uaTraversal(key) && typeof panel.animate === 'function') {
      const reduce = reducedMotion();
      if (reduce) panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      else
        panel.animate(
          [{ transform: `translate${wide() ? 'X' : 'Y'}(100%)` }, { transform: 'none' }],
          springEasing(SPRING),
        );
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: reduce ? 120 : 240,
        easing: 'ease-out',
      });
    }
    return () => {
      mounted.current = false;
      unregister.current?.();
      dimThemeColor(false);
      if (toastHost() === d) setToastHost(null);
      try {
        if (d.open) d.close();
      } catch {
        d.removeAttribute('open');
      }
      // closing the dialog hands focus back to its opener; a blocking notice needs it instead
      if (sheetBlocked())
        document
          .querySelector<HTMLElement>('[data-vendua="blocking-overlay"] [role="alertdialog"]')
          ?.focus({ preventScroll: true });
    };
    // opens once per mount; `close` is stable for the sheet's life
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // finger-driven drag: 1:1 from the grip/header, from the body only while it is scrolled
  // to the top and the finger moves down
  useEffect(() => {
    const panel = panelRef.current!;
    const body = bodyRef.current!;
    const scrim = scrimRef.current!;
    let g: {
      x0: number;
      y0: number;
      grip: boolean;
      on: boolean;
      dead: boolean;
      samples: { t: number; y: number }[];
    } | null = null;

    const set = (y: number) => {
      offset.current = y;
      panel.style.transform = y ? `translateY(${y}px)` : '';
      scrim.style.opacity = String(Math.max(0, 1 - Math.max(0, y) / panel.offsetHeight));
    };
    const begin = (x: number, y: number, target: EventTarget | null) => {
      if (wide() || closing.current || !(target instanceof Element)) return;
      g = {
        x0: x,
        y0: y,
        grip: Boolean(target.closest(GRAB)),
        on: false,
        dead: false,
        samples: [{ t: performance.now(), y }],
      };
    };
    /** true when this move belongs to the sheet (the caller prevents scrolling) */
    const move = (x: number, y: number): boolean => {
      if (!g || g.dead) return false;
      const dy = y - g.y0;
      const dx = x - g.x0;
      if (!g.on) {
        const atTop = body.scrollTop <= 0;
        if (!g.grip && !(atTop && dy > 0)) {
          if (Math.abs(dy) > 2 || Math.abs(dx) > 2) g.dead = true;
          return false;
        }
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return true;
        if (Math.abs(dx) > Math.abs(dy)) {
          g.dead = true;
          return false;
        }
        g.on = true;
        g.y0 = y;
        for (const a of panel.getAnimations()) a.cancel();
      }
      const d = y - g.y0;
      set(d >= 0 ? d : -Math.min(24, Math.sqrt(-d) * 3));
      const now = performance.now();
      g.samples.push({ t: now, y });
      g.samples = g.samples.filter((s) => now - s.t < 100);
      return true;
    };
    const settle = (v: number) => {
      const y = offset.current;
      set(0);
      if (!y || typeof panel.animate !== 'function') return;
      const { easing, duration } = springEasing(SPRING, (-v * 1000 * Math.sign(y)) / Math.abs(y));
      panel.animate([{ transform: `translateY(${y}px)` }, { transform: 'none' }], {
        easing,
        duration,
      });
      scrim.animate(
        [{ opacity: Math.max(0, 1 - Math.max(0, y) / panel.offsetHeight) }, { opacity: 1 }],
        { duration: Math.min(duration, 300), easing: 'ease-out' },
      );
    };
    const end = () => {
      const was = g;
      g = null;
      if (!was?.on) return;
      const s = was.samples;
      const first = s[0];
      const last = s[s.length - 1];
      const v = first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const y = offset.current;
      if (y > panel.offsetHeight * 0.3 || (v > 0.5 && y > 8)) {
        haptic.commit();
        close(v);
      } else settle(v);
    };

    const ts = (e: TouchEvent) => {
      const t = e.touches[0];
      if (e.touches.length === 1 && t) return begin(t.clientX, t.clientY, e.target);
      // a second finger mid-drag: the sheet goes back to rest rather than stay parked
      const was = g;
      g = null;
      if (was?.on) settle(0);
    };
    const tm = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      if (move(t.clientX, t.clientY)) {
        if (e.cancelable) e.preventDefault();
        else if (g && !g.on) g.dead = true;
      }
    };
    const pd = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      const target = e.target as Element;
      if (!target.closest?.(GRAB) || target.closest('button, a, input, select, textarea')) return;
      begin(e.clientX, e.clientY, target);
      panel.setPointerCapture?.(e.pointerId);
    };
    const pm = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') move(e.clientX, e.clientY);
    };
    const pu = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') end();
    };
    panel.addEventListener('touchstart', ts, { passive: true });
    panel.addEventListener('touchmove', tm, { passive: false });
    panel.addEventListener('touchend', end);
    panel.addEventListener('touchcancel', end);
    panel.addEventListener('pointerdown', pd);
    panel.addEventListener('pointermove', pm);
    panel.addEventListener('pointerup', pu);
    panel.addEventListener('pointercancel', pu);
    return () => {
      panel.removeEventListener('touchstart', ts);
      panel.removeEventListener('touchmove', tm);
      panel.removeEventListener('touchend', end);
      panel.removeEventListener('touchcancel', end);
      panel.removeEventListener('pointerdown', pd);
      panel.removeEventListener('pointermove', pm);
      panel.removeEventListener('pointerup', pu);
      panel.removeEventListener('pointercancel', pu);
    };
  }, [close]);

  // the empty bag's "Ver cardápio": the sheet leaves, and its entry becomes the menu
  const { config } = useKernel();
  const { vocabulary } = useCopy();
  const catalog = resolvePaths(config).catalog;
  const browse = () =>
    background.pathname === catalog
      ? close()
      : close(0, () => {
          if (mounted.current) navigate(catalog, { replace: true, state: { vt: 'fade' } });
        });

  const onScrim = (e: MouseEvent) => {
    if (e.target === dialogRef.current || e.target === scrimRef.current) close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="v-sheet"
      data-vendua="cart-sheet"
      aria-label={vocabulary.bag.charAt(0).toUpperCase() + vocabulary.bag.slice(1)}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClose={() => {
        // the browser closed it itself (Android back on a modal): just pop the route. The
        // event is async: a remount (StrictMode) may already have reopened it.
        if (!mounted.current || closing.current || dialogRef.current?.open) return;
        closing.current = true;
        unregister.current?.();
        dimThemeColor(false);
        leave();
      }}
      onClick={onScrim}
    >
      <div className="v-sheet-scrim" ref={scrimRef} data-part="scrim" aria-hidden="true" />
      <div className="v-sheet-panel" ref={panelRef} data-part="panel">
        <div className="v-sheet-grip" data-part="grip" aria-hidden="true" />
        <div className="v-sheet-body" ref={bodyRef} data-part="body" data-vendua-page="cart">
          <CartContents presentation="drawer" onClose={() => close()} onBrowse={browse} />
        </div>
      </div>
    </dialog>
  );
}
