import { Action, createBrowserHistory, type Location, type To } from '@remix-run/router';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Router as BaseRouter, useNavigate } from 'react-router-dom';
import { reducedMotion } from '../lib/spring.ts';
import { placeOf, rootLabel } from './nav.ts';

// BrowserRouter (react-router-dom 6.30) with one change: its history listener is where every
// screen change starts its View Transition, so links, navigate(), back and forward all animate
// the same way. Types: push (deeper), pop (shallower), tab (sibling root), fade (the rest).

export type VtType = 'push' | 'pop' | 'tab' | 'fade';
type Update = { action: Action; location: Location; delta: number | null };
type VT = { finished: Promise<void>; ready: Promise<void> };
type StartVT = (arg: unknown) => VT;

let uaPop = false;
let down: { el: Element; t: number } | null = null;
if (typeof window !== 'undefined') {
  // Safari's edge swipe and Chrome's back gesture already animated this pop: stand aside.
  // Capture phase, so it runs before the history's own popstate listener.
  addEventListener(
    'popstate',
    (e) =>
      void (uaPop = !!(e as PopStateEvent & { hasUAVisualTransition?: boolean })
        .hasUAVisualTransition),
    { capture: true },
  );
  addEventListener(
    'pointerdown',
    (e) => void (down = { el: e.target as Element, t: performance.now() }),
    { capture: true, passive: true },
  );
}

/** pathname of each history entry this tab has seen, by React Router's `idx` */
const trail = new Map<number, string>();
let base = '';
const strip = (p: string) => (p.startsWith(base) ? p.slice(base.length) || '/' : p);
const idxNow = () => (history.state as { idx?: number } | null)?.idx ?? 0;

function typeOf(from: Location, u: Update, forcedPush: boolean): VtType | null {
  // an override belongs to the navigation that asked for it, not to later visits of its entry
  const want =
    u.action === Action.Pop ? undefined : (u.location.state as { vt?: VtType } | null)?.vt;
  if (u.action === Action.Replace && !forcedPush && !want) return null;
  if (u.location.key === from.key) return null;
  if (u.action === Action.Pop && uaPop) return null;
  if (want) return want;
  if (from.pathname === u.location.pathname) return null;
  if (u.action === Action.Pop && u.delta) return u.delta < 0 ? 'pop' : 'push';
  const a = placeOf(strip(from.pathname));
  const b = placeOf(strip(u.location.pathname));
  if (!a || !b) return 'fade';
  if (b.depth > a.depth) return 'push';
  if (b.depth < a.depth) return 'pop';
  if (b.depth === 1) return u.action === Action.Pop ? 'pop' : 'push';
  return a.root === b.root ? 'fade' : 'tab';
}

const MORPH = 'vt-morph';
const inView = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.width > 0;
};

/** The shared element: the tapped `data-vt-src` on a push, the screen's `data-vt-dst` on a pop. */
function morphFrom(type: VtType): { el: HTMLElement; key: string; dst: string } | null {
  if (type === 'push') {
    const hit = down && performance.now() - down.t < 1000 && down.el.isConnected ? down.el : null;
    // a tap on a tile's name or a row's text lands beside the photo that carries the key
    const el =
      hit?.closest<HTMLElement>('[data-vt-src]') ??
      hit?.closest('a,button,[role=button]')?.querySelector<HTMLElement>('[data-vt-src]');
    return el ? { el, key: el.dataset.vtSrc!, dst: 'data-vt-dst' } : null;
  }
  const el = [...document.querySelectorAll<HTMLElement>('[data-vt-dst]')].find(inView);
  return el ? { el, key: el.dataset.vtDst!, dst: 'data-vt-src' } : null;
}

let running = 0;

export function Router({ basename, children }: { basename: string; children: ReactNode }) {
  base = basename;
  const historyRef = useRef<ReturnType<typeof createBrowserHistory>>();
  historyRef.current ??= createBrowserHistory({ v5Compat: true });
  const h = historyRef.current;
  const [state, setState] = useState({ action: h.action, location: h.location });
  const current = useRef(state.location);
  current.current = state.location;
  const forced = useRef(false);

  useLayoutEffect(() => {
    trail.set(idxNow(), strip(state.location.pathname));
  }, [state.location]);

  useLayoutEffect(
    () =>
      h.listen((u: Update) => {
        const forcedPush = forced.current;
        forced.current = false;
        let type = typeOf(current.current, u, forcedPush);
        uaPop = false;
        const next = { action: forcedPush ? Action.Push : u.action, location: u.location };
        const start = (document as { startViewTransition?: StartVT }).startViewTransition;
        if (!type || !start || document.hidden) return setState(next);
        const morph = reducedMotion() || type === 'tab' || type === 'fade' ? null : morphFrom(type);
        if (reducedMotion() || (matchMedia('(min-width: 768px)').matches && type !== 'tab'))
          type = 'fade';
        const root = document.documentElement;
        const token = ++running;
        root.dataset.vt = type;
        if (morph) {
          morph.el.style.viewTransitionName = MORPH;
          // order:…, product:…, customer:… — text morphs and photo morphs blend differently
          root.dataset.vtMorph = morph.key.split(':')[0];
        }
        let dst: HTMLElement | null = null;
        const update = () => {
          flushSync(() => setState(next));
          if (!morph) return;
          morph.el.style.viewTransitionName = '';
          dst = document.querySelector<HTMLElement>(`[${morph.dst}="${CSS.escape(morph.key)}"]`);
          if (dst && inView(dst)) dst.style.viewTransitionName = MORPH;
        };
        const types = typeof ViewTransition !== 'undefined' && 'types' in ViewTransition.prototype;
        let vt: VT;
        try {
          vt = types
            ? start.call(document, { update, types: [type] })
            : start.call(document, update);
        } catch {
          delete root.dataset.vt;
          delete root.dataset.vtMorph;
          return update();
        }
        // a skipped transition (a second tap, a hidden tab) still navigates
        vt.ready.catch(() => undefined);
        void vt.finished
          .catch(() => undefined)
          .then(() => {
            if (dst) dst.style.viewTransitionName = '';
            if (token === running) {
              delete root.dataset.vt;
              delete root.dataset.vtMorph;
            }
          });
      }),
    [h],
  );

  const navigator = useMemo(
    () => ({
      createHref: h.createHref,
      encodeLocation: h.encodeLocation,
      go: h.go,
      replace: h.replace,
      push(to: To, s?: unknown) {
        // inside an open sheet the current entry is the sheet's (Sheet.tsx): the new screen takes
        // its place, one step deeper, so back doesn't land on a sheet that's no longer there
        const cur = history.state as { vSheet?: string; idx?: number } | null;
        if (!cur?.vSheet) return h.push(to, s);
        history.replaceState({ ...cur, idx: (cur.idx ?? 0) + 1 }, '');
        forced.current = true;
        h.replace(to, s);
      },
    }),
    [h],
  );

  return (
    <BaseRouter
      basename={basename}
      location={state.location}
      navigationType={state.action}
      navigator={navigator}
    >
      {children}
    </BaseRouter>
  );
}

/**
 * The phone back button: one history step when there is one (it shows the screen it returns
 * to), else the screen's parent — a drill-down opened straight from a notification.
 */
export function useBack(pathname: string) {
  const nav = useNavigate();
  const place = placeOf(pathname);
  const idx = idxNow();
  const prev = idx > 0 ? trail.get(idx - 1) : undefined;
  const parent = place?.depth ? place.root : null;
  const label = prev ? (placeOf(prev)?.title ?? 'Voltar') : parent ? rootLabel(parent) : 'Voltar';
  return {
    label,
    back: () =>
      idx > 0
        ? nav(-1)
        : nav(parent ?? '/', { replace: true, state: { vt: 'pop' satisfies VtType } }),
  };
}

/** Whether the history entry just before this one shows `pathname`. */
export function prevIs(pathname: string) {
  const idx = idxNow();
  return idx > 0 && trail.get(idx - 1) === pathname;
}
