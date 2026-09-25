import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn.ts';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border bg-card text-card-foreground shadow-card', className)}
      {...props}
    />
  );
}

/** Card with a compact title row — the standard container for a page section. */
export function Panel({
  title,
  aside,
  actions,
  className,
  bodyClassName,
  flush,
  children,
}: {
  title?: ReactNode | undefined;
  aside?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  /** no body padding — for lists/tables that run edge to edge */
  flush?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      {(title || actions || aside) && (
        <div className="flex min-h-10 items-center gap-2 border-b px-3 py-1.5">
          {title && <h2 className="truncate text-[13px] font-semibold tracking-tight">{title}</h2>}
          {aside && <span className="truncate text-xs text-muted-foreground">{aside}</span>}
          {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className={cn(!flush && 'p-3', 'min-h-0 flex-1', bodyClassName)}>{children}</div>
    </Card>
  );
}
