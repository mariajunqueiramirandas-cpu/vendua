import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { cn } from './cn.ts';

export interface SectionLink {
  /** the id of the section element on the page */
  id: string;
  label: string;
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A long page's index: chips for its sections that stay under the header while the page scrolls,
 * the one in view lit. It says up front what's further down, and where you are in it.
 */
export function SectionNav({ items, className }: { items: SectionLink[]; className?: string }) {
  const nav = useRef<HTMLElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(items[0]?.id);
  // a tapped chip stays lit while its section is in view: side-by-side sections share a top, and
  // the line alone would light the first of the row
  const pin = useRef<{ id: string; at: number } | null>(null);
  const ids = items.map((i) => i.id).join(' ');

  useEffect(() => {
    const list = ids.split(' ');
    let frame = 0;
    const pick = () => {
      frame = 0;
      const top = nav.current?.getBoundingClientRect().bottom ?? 0;
      const line = top + innerHeight * 0.2;
      const p = pin.current;
      const pinned = p ? document.getElementById(p.id)?.getBoundingClientRect().top : undefined;
      if (p && pinned !== undefined) {
        // the first second covers the smooth scroll there
        if (performance.now() - p.at < 1000 || (pinned > top - 8 && pinned <= line))
          return setActive(p.id);
        pin.current = null;
      }
      let cur = list[0];
      let curTop = -Infinity;
      for (const id of list) {
        const t = document.getElementById(id)?.getBoundingClientRect().top;
        // past the line, and lower than the last one: the first of a row of sections wins
        if (t !== undefined && t <= line && t > curTop + 1) {
          cur = id;
          curTop = t;
        }
      }
      // a short last section never reaches the line: at the end of the page it's the one
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = list.at(-1);
      setActive(cur);
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(pick);
    };
    addEventListener('scroll', on, { passive: true });
    addEventListener('resize', on);
    pick();
    return () => {
      removeEventListener('scroll', on);
      removeEventListener('resize', on);
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  useEffect(() => {
    // keep the lit chip in the middle of the row
    const r = row.current;
    const chip = r?.querySelector<HTMLElement>('[aria-current]');
    if (!r || !chip) return;
    const rr = r.getBoundingClientRect();
    const cr = chip.getBoundingClientRect();
    r.scrollBy({
      left: cr.left - rr.left - (rr.width - cr.width) / 2,
      behavior: reduced() ? 'auto' : 'smooth',
    });
  }, [active]);

  const go = (e: MouseEvent, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    pin.current = { id, at: performance.now() };
    setActive(id);
    const below = (nav.current?.getBoundingClientRect().bottom ?? 0) + 12;
    scrollTo({
      top: el.getBoundingClientRect().top + scrollY - below,
      behavior: reduced() ? 'auto' : 'smooth',
    });
  };

  return (
    <nav
      ref={nav}
      aria-label="nesta página"
      data-section-nav
      className={cn(
        'sticky top-(--topbar-h) z-20 -mx-4 mb-6 bg-bg/95 px-4 py-2 backdrop-blur-sm md:top-0 md:-mx-8 md:px-8 kb:static',
        className,
      )}
    >
      <div ref={row} className="scroll-row">
        <ul className="flex w-max gap-2">
          {items.map((s) => {
            const on = s.id === active;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => go(e, s.id)}
                  aria-current={on ? 'location' : undefined}
                  className={cn(
                    'press t-label inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 ring-1 transition-[color,background-color,box-shadow,scale] duration-(--duration-quick)',
                    on
                      ? 'bg-primary text-on-primary ring-primary'
                      : 'bg-surface text-ink ring-line-strong hover:bg-hover',
                  )}
                >
                  {s.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
