import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from './cn.ts';
import { Spinner } from './Spinner.tsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'spark' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md t-label ' +
  'transition-[transform,background-color,box-shadow,color] duration-(--duration-instant) ease-out ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-busy:pointer-events-none';

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover depth-1',
  secondary: 'bg-surface text-ink ring-1 ring-line-strong hover:bg-hover depth-1',
  ghost: 'text-ink hover:bg-hover active:bg-press',
  quiet: 'bg-sunken text-ink hover:bg-press',
  danger: 'bg-danger text-surface hover:opacity-90 noite:text-bg',
  spark: 'bg-spark text-on-spark hover:brightness-95 depth-1',
};

// 48px minimum on touch (§10); sm is for dense desktop rows only
const sizes: Record<Size, string> = {
  sm: 'h-10 px-3.5 text-[0.875rem] [&_svg]:size-4.5',
  md: 'h-12 px-5 [&_svg]:size-5',
  lg: 'h-14 px-6 text-[1rem] rounded-lg [&_svg]:size-6',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    icon,
    block,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], block && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner className="absolute" /> : null}
      <span className={cn('inline-flex items-center gap-2', loading && 'opacity-0')}>
        {icon}
        {children}
      </span>
    </button>
  );
});

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  block,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode; block?: boolean }) {
  return (
    <Link
      className={cn(base, variants[variant], sizes[size], block && 'w-full', className)}
      {...rest}
    >
      {icon}
      {children}
    </Link>
  );
}

/** Icon-only: universal symbols only (close, back, search, more) and always named (§2.2.7). */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: Variant; size?: 'sm' | 'md' }
>(function IconButton(
  { label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        base,
        variants[variant],
        size === 'md'
          ? 'size-12 rounded-full [&_svg]:size-6'
          : 'size-10 rounded-full [&_svg]:size-5',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
