import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { backgroundOf } from './transitions.tsx';

// Route changes reset scroll like page loads do: new page → top, #hash → that element (waiting
// for async content), back/forward → where the visitor was. Same-path changes (filters, ?query)
// never move the page. A modal route (the bag sheet) is not a page change: everything here
// follows the page under it.

const STORE = 'vendua:scroll';
const WAIT_MS = 2000;

function read(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function write(key: string, y: number): void {
  try {
    const all = read();
    all[key] = y;
    const keys = Object.keys(all);
    if (keys.length > 50) delete all[keys[0]!];
    sessionStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage blocked — restoration just degrades to top */
  }
}

function jump(y: number): void {
  window.scrollTo({ top: y, left: 0, behavior: 'instant' });
}

// Runs `attempt` until it reports done, on every DOM change, for at most WAIT_MS.
function until(attempt: () => boolean): () => void {
  if (attempt()) return () => {};
  const mo = new MutationObserver(() => {
    if (attempt()) stop();
  });
  const timer = setTimeout(stop, WAIT_MS);
  function stop() {
    mo.disconnect();
    clearTimeout(timer);
  }
  mo.observe(document.body, { childList: true, subtree: true });
  return stop;
}

export function ScrollManager() {
  const location = useLocation();
  const page = backgroundOf(location) ?? location;
  const { pathname, hash } = page;
  // a typed URL / fresh tab has no entry key: don't let every such load share one position
  const key = page.key === 'default' ? `default:${pathname}` : page.key;
  const type = useNavigationType();
  const prev = useRef<string | null>(null);
  // read, not a dependency: the sheet opening or closing changes the type, not the page
  const typeRef = useRef(type);
  typeRef.current = type;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!('scrollRestoration' in history)) return;
    const before = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => {
      history.scrollRestoration = before;
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        write(keyRef.current, window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useLayoutEffect(() => {
    const first = prev.current === null;
    const samePath = prev.current === pathname;
    prev.current = pathname;

    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      return until(() => {
        const el = document.getElementById(id);
        if (!el) return false;
        el.scrollIntoView({ block: 'start', behavior: 'instant' });
        return true;
      });
    }
    if (typeRef.current === 'POP') {
      const y = read()[key];
      if (y === undefined) {
        if (!first) jump(0);
        return;
      }
      // content is async — retry until the page is tall enough to land there
      return until(() => {
        jump(y);
        return Math.abs(window.scrollY - y) < 2;
      });
    }
    if (samePath || first) return;
    jump(0);
  }, [pathname, hash, key]);

  return null;
}
