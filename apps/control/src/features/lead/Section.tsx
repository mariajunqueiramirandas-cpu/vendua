import type { ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

/**
 * Flat, divider-separated block for the lead's side columns — keeps the
 * facts and agent rails dense instead of stacking padded cards.
 */
export function Section({
  title,
  aside,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className={cn('border-b px-3 py-2.5 last:border-b-0', className)}>
      <div className="mb-1.5 flex min-h-6 items-center gap-2">
        <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
        {aside && <span className="truncate text-xs text-muted-foreground">{aside}</span>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/** Muted one-liner for empty/placeholder states inside a Section. */
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-muted-foreground', className)}>{children}</p>;
}

/** Dense list row used across the lead rails (conversations, calls, runs…). */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('flex min-h-8 items-center gap-2 py-0.5 pointer-coarse:min-h-10', className)}
    >
      {children}
    </div>
  );
}
