import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn.ts';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0 active:translate-y-px',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        agent: 'bg-agent text-agent-foreground hover:bg-agent/85',
        outline: 'border border-border-strong bg-card hover:bg-hover',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'text-muted-foreground hover:bg-hover hover:text-foreground',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        'destructive-outline':
          'border border-destructive/40 text-destructive-foreground hover:bg-destructive-soft',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 text-sm pointer-coarse:h-10 pointer-coarse:px-3.5',
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5 pointer-coarse:h-9',
        lg: 'h-10 px-4 text-sm',
        icon: 'size-8 pointer-coarse:size-10',
        'icon-sm': 'size-7 [&_svg]:size-3.5 pointer-coarse:size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        {...(asChild ? {} : { type })}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
