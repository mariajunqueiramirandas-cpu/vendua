import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn.ts';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[11px] leading-[18px] font-medium [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-muted-foreground',
        outline: 'border border-border-strong text-muted-foreground',
        agent: 'bg-agent text-agent-foreground',
        'agent-soft': 'bg-agent-soft text-foreground',
        warn: 'bg-warning-soft text-warning-foreground',
        bad: 'bg-destructive-soft text-destructive-foreground',
        solid: 'bg-primary text-primary-foreground',
        lead: 'bg-stage-lead text-stage-lead-fg',
        contacted: 'bg-stage-contacted text-stage-contacted-fg',
        invited: 'bg-stage-invited text-stage-invited-fg',
        live: 'bg-stage-live text-stage-live-fg',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Tiny count bubble for nav items and tabs. */
export function CountDot({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-warning px-1 font-mono text-[10px] leading-none font-semibold text-[#2a1f05]',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}
