import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { dateShort } from '../../lib/format.ts';

// What every chat with Duá shares: its day marks, its clock and how it follows new messages
// (the Vendedor's conversations, the test chat and the Copilot).

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'hoje';
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return 'ontem';
  return dateShort(d);
}

/** "19:42" in the thread, the admin's own clock style */
export const msgTime = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const reduced = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A conversation opens at its newest message, and follows new ones while you're near the end
 * (not when you scrolled up to read). `box` is the pane's own scroller; without it, the page.
 */
export function useFollow(
  box: React.RefObject<HTMLElement | null> | null,
  count: number,
  ready: boolean,
) {
  const first = useRef(true);
  const [near, setNear] = useState(true);
  useEffect(() => {
    const el = box?.current;
    const target: HTMLElement | Window = el ?? window;
    const on = () => {
      const gap = el
        ? el.scrollHeight - el.scrollTop - el.clientHeight
        : document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
      setNear(gap < 240);
    };
    target.addEventListener('scroll', on, { passive: true });
    return () => target.removeEventListener('scroll', on);
  }, [box]);
  useLayoutEffect(() => {
    if (!ready) return;
    if (!first.current && !near) return;
    const smooth = !first.current && !reduced();
    const go = () => {
      const el = box?.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      else
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: smooth ? 'smooth' : 'auto',
        });
    };
    go();
    // the page's own scroll restore runs after the first paint: land at the end after it
    if (first.current) requestAnimationFrame(() => requestAnimationFrame(go));
    first.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, ready]);
}
