import { X } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { cn } from './cn.ts';
import { IconButton } from './Button.tsx';

function useDesktop() {
  const q = '(min-width: 768px)';
  const [d, set] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => set(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return d;
}

/**
 * Bottom sheet on phones (drag down to dismiss), side panel on desktop. Focus is
 * trapped while open and returns to the trigger on close (§7, §10).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const desktop = useDesktop();
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction={desktop ? 'right' : 'bottom'}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-[rgb(10_16_13/0.42)]" />
        <Drawer.Content
          aria-describedby={undefined}
          className={cn(
            'fixed z-[61] flex flex-col bg-surface text-ink outline-none depth-3',
            desktop
              ? cn(
                  'inset-y-3 right-3 rounded-lg',
                  wide ? 'w-[min(680px,calc(100vw-24px))]' : 'w-[min(480px,calc(100vw-24px))]',
                )
              : 'inset-x-0 bottom-0 max-h-[92dvh] rounded-t-lg',
          )}
        >
          {!desktop ? (
            <div
              className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-line-strong"
              aria-hidden
            />
          ) : null}
          <div className="glass sticky top-0 z-10 flex items-start gap-3 rounded-t-lg px-5 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <Drawer.Title className="t-title-2">{title}</Drawer.Title>
              {description ? (
                <Drawer.Description className="t-body mt-1 text-muted">
                  {description}
                </Drawer.Description>
              ) : null}
            </div>
            <IconButton
              label="fechar"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="-mr-2 -mt-1"
            >
              <X />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
            {children}
          </div>
          {footer ? (
            <div className="border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
