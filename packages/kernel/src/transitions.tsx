import { useContext, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { UNSAFE_NavigationContext, useLocation, type Location, type To } from 'react-router-dom';

// Native-feeling navigation without owning the router (stores mount <BrowserRouter>, K02):
// pushes run through a wrapped navigator, back/forward through a capture-phase popstate
// listener that holds the event and replays it inside document.startViewTransition. Type
// vocabulary shared with the admin: push (deeper), pop (shallower), tab (sibling), fade.
// The browser's own swipe-back animation (hasUAVisualTransition) always wins.

export type VtType = 'push' | 'pop' | 'tab' | 'fade';
type Dir = 'push' | 'pop' | 'none';
export type Loc = Pick<Location, 'pathname' | 'search' | 'hash' | 'state' | 'key'>;

/** what the Kernel keeps in history entries (react-router's `state`) */
export interface NavState {
  /** the page a modal route (the bag sheet) is drawn over */
  vBackground?: Loc;
  /** checkout step entries */
  vStep?: string;
  vStepN?: number;
  vFrom?: string;
  /** explicit transition for a push/replace */
  vt?: VtType;
}

const stateOf = (l: { state?: unknown } | null | undefined) =>
  (l?.state && typeof l.state === 'object' ? l.state : null) as NavState | null;
export const backgroundOf = (l: { state?: unknown } | null | undefined): Loc | null =>
  stateOf(l)?.vBackground ?? null;

const MORPH = 'vt-morph';
let depthOf: (pathname: string) => number = () => 0;
/** the location the app last rendered (React Router's) */
let seen: Loc | null = null;
let pointer: { el: Element; t: number } | null = null;
let active: ViewTransitionLike | null = null;
let replaying = false;
let sheetCloser: ((done: () => void) => void) | null = null;

interface ViewTransitionLike {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
}
type StartVT = (
  arg: (() => Promise<void>) | { update: () => Promise<void>; types: string[] },
) => ViewTransitionLike;

const startVT = (): StartVT | null => {
  if (typeof document === 'undefined') return null;
  const d = document as Document & { startViewTransition?: StartVT };
  return typeof d.startViewTransition === 'function' ? d.startViewTransition.bind(d) : null;
};
const wide = () => typeof matchMedia !== 'undefined' && matchMedia('(min-width: 768px)').matches;

/** True while a page transition runs (rendering is frozen; the sheet skips its own entrance). */
export const transitionRunning = () => active !== null;

/** The bag sheet hands the popstate listener its animated close while it is open. */
export function registerSheet(close: (done: () => void) => void): () => void {
  sheetCloser = close;
  return () => {
    if (sheetCloser === close) sheetCloser = null;
  };
}

export function transitionFor(from: Loc | null, to: Loc): { type: VtType; dir: Dir } | null {
  if (!from) return null;
  const fb = backgroundOf(from);
  const tb = backgroundOf(to);
  // the sheet opening over this page / closing back onto it animates itself
  if (tb && !fb && tb.key === from.key) return null;
  if (fb && !tb && (to.key === fb.key || to.pathname === fb.pathname)) return null;
  if (fb && tb) return null;
  const a = fb ?? from;
  const b = tb ?? to;
  let dir: Dir;
  let type: VtType;
  if (a.pathname === b.pathname) {
    const sa = stateOf(a)?.vStepN ?? 0;
    const sb = stateOf(b)?.vStepN ?? 0;
    if (sa === sb) return stateOf(to)?.vt ? { type: stateOf(to)!.vt!, dir: 'none' } : null;
    dir = sb > sa ? 'push' : 'pop';
    type = dir;
  } else {
    const da = depthOf(a.pathname);
    const db = depthOf(b.pathname);
    dir = db > da ? 'push' : db < da ? 'pop' : 'none';
    type = dir === 'none' ? 'tab' : dir;
  }
  type = stateOf(to)?.vt ?? type;
  if ((type === 'push' || type === 'pop') && wide()) type = 'fade';
  return { type, dir };
}

const visible = (el: Element) => {
  const r = el.getBoundingClientRect();
  return (
    r.width > 0 &&
    r.height > 0 &&
    r.bottom > 0 &&
    r.right > 0 &&
    r.top < innerHeight &&
    r.left < innerWidth
  );
};

/** the innermost visible match (a store's own media inside the Kernel's wins) */
function innermost(selector: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(selector)].filter(visible);
  return all.find((el) => !all.some((o) => o !== el && el.contains(o))) ?? null;
}

function waitFor(selector: string, ms: number): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      const el = innermost(selector);
      if (el) finish(el);
    });
    const timer = setTimeout(() => finish(null), ms);
    function finish(el: HTMLElement | null) {
      mo.disconnect();
      clearTimeout(timer);
      resolve(el);
    }
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

/** the tapped element's morph source: itself, or the photo inside the link/button it is in */
function morphSource(): HTMLElement | null {
  const recent = pointer && performance.now() - pointer.t < 1000 && pointer.el.isConnected;
  const from = recent ? pointer!.el : document.activeElement;
  if (!from || from === document.body) return null;
  const src =
    from.closest<HTMLElement>('[data-vt-src]') ??
    from.closest('a,button,[role=button]')?.querySelector<HTMLElement>('[data-vt-src]') ??
    null;
  return src && visible(src) ? src : null;
}

const attrSel = (attr: string, key: string) =>
  `[${attr}="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : key}"]`;

/** Runs `update` (a synchronous router update) as a view transition of `type`. */
export function runTransition(type: VtType, dir: Dir, update: () => void): void {
  const start = startVT();
  if (!start) return update();
  const html = document.documentElement;
  let old: HTMLElement | null = null;
  let key: string | undefined;
  if (dir === 'push') {
    old = morphSource();
    key = old?.dataset.vtSrc;
  } else if (dir === 'pop') {
    old = innermost('[data-vt-dst]');
    key = old?.dataset.vtDst;
  }
  if (old && key) old.style.setProperty('view-transition-name', MORPH);
  let next: HTMLElement | null = null;
  const run = async () => {
    old?.style.removeProperty('view-transition-name');
    flushSync(update);
    if (!key) return;
    const sel = attrSel(dir === 'push' ? 'data-vt-dst' : 'data-vt-src', key);
    // a product page whose data is still in flight gets a moment to draw its photo
    next = innermost(sel) ?? (dir === 'push' ? await waitFor(sel, 300) : null);
    next?.style.setProperty('view-transition-name', MORPH);
  };
  html.dataset.vt = type;
  let vt: ViewTransitionLike;
  try {
    vt = start({ update: run, types: [type] });
  } catch {
    // engines without typed transitions take only the callback
    vt = start(run);
  }
  active = vt;
  const done = () => {
    next?.style.removeProperty('view-transition-name');
    if (active !== vt) return;
    active = null;
    delete html.dataset.vt;
  };
  vt.finished.then(done, done);
  vt.ready.catch(() => {});
  vt.updateCallbackDone.catch(() => {});
}

function replay(state: unknown) {
  replaying = true;
  try {
    window.dispatchEvent(new PopStateEvent('popstate', { state }));
  } finally {
    replaying = false;
  }
}

function windowLoc(): Loc {
  const s = (history.state ?? null) as { usr?: unknown; key?: string } | null;
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    state: s?.usr ?? null,
    key: s?.key ?? 'default',
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.target instanceof Element) pointer = { el: e.target, t: performance.now() };
    },
    { capture: true, passive: true },
  );
  // capture on window runs before the router's own (bubble) popstate listener
  window.addEventListener(
    'popstate',
    (e) => {
      if (replaying || !seen) return;
      const ua = (e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
      const from = seen;
      const to = windowLoc();
      const fb = backgroundOf(from);
      if (sheetCloser && fb && !backgroundOf(to) && to.pathname === fb.pathname) {
        if (ua) return;
        e.stopImmediatePropagation();
        const state = e.state;
        sheetCloser(() => replay(state));
        return;
      }
      if (ua || !startVT()) return;
      const t = transitionFor(from, to);
      if (!t) return;
      e.stopImmediatePropagation();
      const state = e.state;
      runTransition(t.type, t.dir, () => replay(state));
    },
    true,
  );
}

type Nav = {
  push: (to: To, state?: unknown, opts?: unknown) => void;
  replace: (to: To, state?: unknown, opts?: unknown) => void;
};

function target(to: To, state: unknown, from: Loc): Loc {
  if (typeof to === 'string') {
    const u = new URL(to, `http://x${from.pathname}${from.search}`);
    return { pathname: u.pathname, search: u.search, hash: u.hash, state, key: '' };
  }
  return {
    pathname: to.pathname ?? from.pathname,
    search: to.search ?? '',
    hash: to.hash ?? '',
    state,
    key: '',
  };
}

function wrap<N extends Nav>(real: N): N {
  const nav = Object.create(real) as N;
  const via = (method: 'push' | 'replace') => (to: To, state?: unknown, opts?: unknown) => {
    const call = () => real[method](to, state, opts);
    const from = seen;
    // a replace (filters, redirects) never animates unless it asks to
    if (!from || !startVT() || (method === 'replace' && !stateOf({ state })?.vt)) return call();
    const t = transitionFor(from, target(to, state, from));
    if (!t) return call();
    runTransition(t.type, t.dir, call);
  };
  nav.push = via('push');
  nav.replace = via('replace');
  return nav;
}

/**
 * Re-provides the router's navigator so every Kernel push, store `<Link>` and
 * `useNavigate()` below runs as a view transition; records what was rendered for the
 * popstate listener.
 */
export function NativeNavigation({
  depth,
  children,
}: {
  depth: (pathname: string) => number;
  children: ReactNode;
}) {
  const ctx = useContext(UNSAFE_NavigationContext);
  const loc = useLocation();
  depthOf = depth;
  useLayoutEffect(() => {
    seen = loc;
  }, [loc]);
  useLayoutEffect(
    () => () => {
      seen = null;
    },
    [],
  );
  const value = useMemo(
    () => ({
      ...ctx,
      navigator: wrap(ctx.navigator as unknown as Nav) as unknown as typeof ctx.navigator,
    }),
    [ctx],
  );
  return (
    <UNSAFE_NavigationContext.Provider value={value}>{children}</UNSAFE_NavigationContext.Provider>
  );
}
