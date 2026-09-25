import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn.ts';

export const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-medium tracking-normal [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-muted-foreground',
        outline: 'border bg-card text-muted-foreground',
        agent: 'bg-agent text-agent-foreground',
        'agent-soft': 'bg-agent-soft text-agent-ink',
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

export const Badge = forwardRef<
  HTMLSpanElement,
  HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>
>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = 'Badge';

/** Tiny count bubble for nav items and tabs. */
export function CountDot({ n, className }: { n: number; className?: string | undefined }) {
  if (!n) return null;
  return (
    <span
      className={cn(
        'inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10.5px] leading-none font-semibold text-primary-foreground tnum',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}
