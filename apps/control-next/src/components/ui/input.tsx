import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn.ts';

// 16px on phones: iOS zooms into inputs rendered smaller than that
const field =
  'w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-base md:text-sm text-foreground placeholder:text-muted-foreground/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(field, 'h-10 md:h-8', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, 'min-h-16 py-1.5 leading-snug', className)} {...props} />
));
Textarea.displayName = 'Textarea';

/** Native select — the OS picker is the best mobile UI there is. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <span className={cn('relative inline-flex min-w-0', className)}>
      <select ref={ref} className={cn(field, 'h-10 appearance-none pr-7 md:h-8')} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('text-xs font-medium text-muted-foreground', className)} {...props} />
  );
}

/** Label + control + optional hint, stacked. */
export function Field({
  label,
  hint,
  htmlFor,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode | undefined;
  htmlFor?: string | undefined;
  className?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <Label {...(htmlFor ? { htmlFor } : {})}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
