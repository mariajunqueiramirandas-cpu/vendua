import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { GlobalActions } from '@/app/GlobalActions.tsx';
import { CountDot } from './ui/badge.tsx';

export interface PageTab {
  to: string;
  label: string;
  end?: boolean | undefined;
  count?: number | undefined;
}

// Scroll positions survive navigation (list → detail → back) for the session.
const scrollMemo = new Map<string, number>();

/**
 * Page chrome: one 48px sticky header line (back · title · count · actions ·
 * global search/add), optional route tabs under it, then the scroll area.
 * `bleed` hands the whole area to the child (multi-pane layouts manage
 * their own scrolling).
 */
export function Page({
  title,
  count,
  back,
  actions,
  tabs,
  toolbar,
  bleed,
  className,
  children,
}: {
  title: ReactNode;
  count?: ReactNode | undefined;
  /** route for the back chevron (phones show it instead of the title's hub context) */
  back?: string | undefined;
  actions?: ReactNode | undefined;
  tabs?: PageTab[] | undefined;
  /** sticky row under the header — filters, search, segmented views */
  toolbar?: ReactNode | undefined;
  bleed?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const loc = useLocation();
  const navigate = useNavigate();
  const key = loc.pathname + loc.search;
  const scroller = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = scrollMemo.get(key) ?? 0;
    const onScroll = () => scrollMemo.set(key, el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [key]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b bg-background">
        <div className="flex h-12 items-center gap-2 px-3 md:h-[52px] md:px-5">
          {back && (
            <Link
              to={back}
              onClick={(e) => {
                // came from inside the app: go back so the list keeps its filters and scroll
                if ((window.history.state as { idx?: number } | null)?.idx) {
                  e.preventDefault();
                  navigate(-1);
                }
              }}
              className="-ml-1.5 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
              aria-label="voltar"
            >
              <ChevronLeft className="size-5" />
            </Link>
          )}
          <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.015em]">
            {title}
          </h1>
          {count != null && (
            <span className="shrink-0 rounded-md bg-secondary px-1.5 text-xs leading-5 font-medium text-muted-foreground tnum">
              {count}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {actions}
            <GlobalActions />
          </div>
        </div>
        {tabs && (
          <nav className="no-scrollbar -mb-px flex gap-0.5 overflow-x-auto px-1.5 md:px-3">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end ?? false}
                className={({ isActive }) =>
                  cn(
                    'relative inline-flex h-9 shrink-0 items-center gap-1.5 px-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                    isActive &&
                      'text-foreground after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground',
                  )
                }
              >
                {t.label}
                {t.count ? <CountDot n={t.count} /> : null}
              </NavLink>
            ))}
          </nav>
        )}
        {toolbar && <div className="border-t px-3 py-2 md:px-5">{toolbar}</div>}
      </header>
      {bleed ? (
        <div ref={scroller} className={cn('flex min-h-0 flex-1 flex-col', className)}>
          {children}
        </div>
      ) : (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
          <div className={cn('p-3 md:p-5', className)}>{children}</div>
        </div>
      )}
    </div>
  );
}
