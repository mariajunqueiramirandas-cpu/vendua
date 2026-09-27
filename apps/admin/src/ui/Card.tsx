import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn.ts';

export function Card({
  className,
  as: As = 'div',
  ...rest
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' | 'article' | 'li' }) {
  return <As className={cn('rounded-lg bg-surface depth-1', className)} {...rest} />;
}

/** A titled group on a page: title, optional hint and action, then content. */
export function Section({
  title,
  hint,
  action,
  children,
  className,
  id,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn('scroll-mt-24', className)}
      aria-labelledby={id ? `${id}-t` : undefined}
    >
      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 id={id ? `${id}-t` : undefined} className="t-title-2">
            {title}
          </h2>
          {hint ? <p className="t-body mt-0.5 text-muted">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Tappable list row — the phone's workhorse. */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  onClick,
  href,
  className,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      {leading ? <span className="shrink-0">{leading}</span> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{title}</span>
        {subtitle ? <span className="t-caption block truncate text-muted">{subtitle}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-right">{trailing}</span> : null}
    </>
  );
  const cls = cn(
    'flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition-colors',
    (onClick || href) && 'hover:bg-hover active:bg-press cursor-pointer',
    className,
  );
  if (href)
    return (
      <a href={href} className={cls}>
        {inner}
      </a>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cls}>
        {inner}
      </button>
    );
  return <div className={cls}>{inner}</div>;
}

export function Divided({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('divide-y divide-line', className)}>{children}</div>;
}
