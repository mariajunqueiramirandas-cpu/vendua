import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Drawer as Vaul } from 'vaul';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import { useIsMobile } from '@/lib/hooks.ts';

const overlayClass = 'fixed inset-0 z-50 bg-black/40';

/** Centered modal (desktop) — becomes a bottom sheet on phones via ResponsiveSheet. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  children?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          className={cn(
            'fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-[calc(100%-24px)] max-w-md -translate-x-1/2 flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl outline-none',
            className,
          )}
        >
          <SheetHeader title={title} description={description} />
          {children && <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">{children}</div>}
          {footer && <div className="flex justify-end gap-2 border-t px-4 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function SheetHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-4 pt-3.5 pb-2">
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
      </div>
      <DialogPrimitive.Close className="-mr-1.5 rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground">
        <X className="size-4" />
        <span className="sr-only">fechar</span>
      </DialogPrimitive.Close>
    </div>
  );
}

/**
 * Side panel on ≥768px, drag-to-dismiss bottom sheet on phones. Use for
 * forms, filters, and secondary detail — anything that shouldn't be a route.
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'max-w-md',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode | undefined;
  children: ReactNode;
  footer?: ReactNode | undefined;
  /** tailwind max-w-* for the desktop side panel */
  width?: string | undefined;
}) {
  const mobile = useIsMobile();
  if (mobile) {
    return (
      <Vaul.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <Vaul.Portal>
          <Vaul.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Vaul.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(var(--vvh,100dvh)-24px)] flex-col rounded-t-2xl border-t bg-popover text-popover-foreground outline-none">
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border-strong" />
            <div className="flex items-start gap-2 px-4 pt-2 pb-2">
              <div className="min-w-0 flex-1">
                <Vaul.Title className="text-base font-semibold">{title}</Vaul.Title>
                <Vaul.Description
                  className={description ? 'mt-0.5 text-xs text-muted-foreground' : 'sr-only'}
                >
                  {description ?? title}
                </Vaul.Description>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">{children}</div>
            {footer && (
              <div className="flex gap-2 border-t px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom,0px))] [&>*]:flex-1">
                {footer}
              </div>
            )}
            {!footer && <div className="pb-safe" />}
          </Vaul.Content>
        </Vaul.Portal>
      </Vaul.Root>
    );
  }
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-popover text-popover-foreground shadow-2xl outline-none',
            width,
          )}
        >
          <SheetHeader title={title} description={description} />
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t px-4 py-3">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuGroup = MenuPrimitive.Group;

export const DropdownMenuContent = forwardRef<
  ElementRef<typeof MenuPrimitive.Content>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Content>
>(({ className, sideOffset = 6, align = 'end', ...props }, ref) => (
  <MenuPrimitive.Portal>
    <MenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      className={cn(
        'z-50 min-w-44 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg',
        className,
      )}
      {...props}
    />
  </MenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof MenuPrimitive.Item>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Item> & { destructive?: boolean }
>(({ className, destructive, ...props }, ref) => (
  <MenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-hover pointer-coarse:h-10 [&_svg]:size-4 [&_svg]:text-muted-foreground',
      destructive && 'text-destructive-foreground [&_svg]:text-destructive-foreground',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export function DropdownMenuSeparator() {
  return <MenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return (
    <MenuPrimitive.Label className="px-2 py-1 text-xs text-muted-foreground">
      {children}
    </MenuPrimitive.Label>
  );
}

export { DialogPrimitive };
