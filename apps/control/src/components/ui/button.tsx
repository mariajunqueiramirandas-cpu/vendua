import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn.ts';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium tracking-[-0.01em] transition-[background-color,box-shadow,color] duration-100 select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(0_0_0/0.14)] hover:bg-primary/90',
        agent:
          'bg-agent text-agent-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_1px_2px_rgb(0_0_0/0.12)] hover:bg-agent/85',
        outline: 'border bg-card text-foreground shadow-card hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'text-muted-foreground hover:bg-hover hover:text-foreground',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
        'destructive-outline':
          'border border-destructive/40 text-destructive-foreground hover:bg-destructive-soft',
        link: 'text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3 pointer-coarse:h-10 pointer-coarse:px-3.5',
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
  asChild?: boolean | undefined;
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
