import type { MouseEvent, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePreload } from '../app/routes.ts';
import { cn } from './cn.ts';

export interface PageTab {
  to: string;
  label: string;
  /** a count beside the label (things waiting there) */
  badge?: ReactNode;
  /** the paths that light this tab, when more than its own (its drill-downs) */
  match?: (pathname: string) => boolean;
}

/**
 * The views of one area (Marketing › Ofertas · Divulgar · Lembretes), each its own address.
 * Siblings swap in place: back leaves the area instead of walking its tabs.
 */
export function PageTabs({
  tabs,
  label,
  className,
}: {
  tabs: PageTab[];
  /** the area's name, for the nav landmark */
  label: string;
  className?: string;
}) {
  const { pathname } = useLocation();
  const preload = usePreload();
  const current = tabs.find((t) => (t.match ? t.match(pathname) : t.to === pathname));
  const top = (e: MouseEvent) => {
    e.preventDefault();
    scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <nav
      aria-label={label}
      className={cn('scroll-row -mx-4 mb-6 px-4 md:mx-0 md:mb-7 md:px-0', className)}
    >
      {/* an underlined strip, not a segmented control: it says where you are, and the filters
          inside a view (Novos · Preparo…) stay the only segmented ones */}
      <ul className="flex w-max min-w-full border-b border-line md:min-w-0 md:gap-2">
        {tabs.map((t) => {
          const on = t === current;
          return (
            <li key={t.to} className="flex flex-1 md:flex-none">
              <Link
                to={t.to}
                replace
                state={{ vt: 'fade' }}
                aria-current={on ? 'page' : undefined}
                onClick={on && t.to === pathname ? top : undefined}
                {...preload(t.to)}
                className={cn(
                  't-label relative flex min-h-12 w-full items-center justify-center gap-1.5 whitespace-nowrap px-2.5 transition-colors duration-(--duration-quick) sm:px-4',
                  on ? 'text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {t.label}
                {t.badge ? (
                  <span
                    className={cn(
                      'tnum min-w-6 rounded-full px-1.5 text-center text-[0.75rem] leading-6',
                      on ? 'bg-spark text-on-spark' : 'bg-sunken text-muted',
                    )}
                  >
                    {t.badge}
                  </span>
                ) : null}
                {on ? (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-primary"
                  />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
