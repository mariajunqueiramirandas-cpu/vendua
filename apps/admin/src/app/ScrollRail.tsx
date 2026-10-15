import { useEffect, useRef } from 'react';

// A touch screen draws no scrollbar until a finger moves the page, so a long screen looks like it
// ends at the fold. The rail shows from the first paint how much is below and where you are.
// Mouse and trackpad screens keep the themed native bar instead (theme.css).

/** a page this many screens tall, or more, gets the rail */
const LONG = 1.25;

export function ScrollRail() {
  const rail = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = rail.current;
    const t = thumb.current;
    if (!r || !t) return;
    let frame = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const paint = () => {
      frame = 0;
      const view = innerHeight;
      const total = document.documentElement.scrollHeight;
      const on = total > view * LONG;
      r.toggleAttribute('data-on', on);
      if (!on) return;
      const h = r.clientHeight;
      const size = Math.max(40, Math.round((h * view) / total));
      const max = total - view;
      const y = max > 0 ? (Math.min(Math.max(scrollY, 0), max) / max) * (h - size) : 0;
      t.style.height = `${size}px`;
      t.style.transform = `translateY(${Math.round(y)}px)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onScroll = () => {
      schedule();
      r.toggleAttribute('data-active', true);
      clearTimeout(idle);
      idle = setTimeout(() => r.removeAttribute('data-active'), 900);
    };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', schedule);
    // the page grows as its data arrives
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
    schedule();
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', schedule);
      ro.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(idle);
    };
  }, []);
  return (
    <div
      ref={rail}
      aria-hidden
      className="vt-scroll group pointer-events-none fixed bottom-[calc(var(--tabbar-h)+8px)] right-[calc(var(--dock-w)+2px)] top-[calc(var(--topbar-h)+8px)] z-30 w-2 opacity-0 transition-opacity duration-(--duration-quick) data-on:opacity-100 pointer-fine:hidden"
    >
      <div
        ref={thumb}
        className="ml-auto h-10 w-1 rounded-full bg-scrollbar transition-[width,background-color] duration-(--duration-quick) group-data-active:w-1.5 group-data-active:bg-scrollbar-hover"
      />
    </div>
  );
}
