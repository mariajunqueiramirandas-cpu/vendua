import { X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { dimStatusBar } from '../lib/theme.ts';
import { cn } from './cn.ts';
import { IconButton } from './Button.tsx';
import { TEXT_FIELD } from './keyboard.ts';

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
 * The back button (Android, the browser, a swipe from the edge) closes the sheet
 * instead of leaving the screen: an open sheet is one history entry.
 */
function useBackToClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    let pushed = false;
    // deferred: StrictMode's mount-unmount-mount must not leave entries behind
    const t = setTimeout(() => {
      history.pushState({ ...history.state, vSheet: id }, '');
      pushed = true;
    });
    const onPop = () => {
      if ((history.state as { vSheet?: string } | null)?.vSheet !== id) closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      // closed from the UI: drop our entry (unless a navigation already moved past it)
      if (pushed && (history.state as { vSheet?: string } | null)?.vSheet === id) history.back();
    };
  }, [open]);
}

/**
 * A field that takes focus while its sheet is still sliding up (autoFocus) sits below the screen
 * at that moment: iOS raises the keyboard and scrolls the page to where the field was, leaving
 * the screen blank once the sheet lands. Hold the focus until the slide is over. A document
 * listener, because autoFocus runs before any effect of the sheet's.
 */
function holdFocusWhileSliding(e: FocusEvent) {
  const el = e.target;
  if (!(el instanceof HTMLElement) || !el.matches(TEXT_FIELD)) return;
  const sheet = el.closest<HTMLElement>('[data-vaul-drawer-direction="bottom"]');
  const slide = sheet?.getAnimations().find((a) => a.playState !== 'finished');
  if (!sheet || !slide) return;
  const x = scrollX;
  const y = scrollY;
  el.blur();
  requestAnimationFrame(() => scrollTo(x, y));
  slide.finished.then(
    () => {
      if (el.isConnected && sheet.dataset.state === 'open') el.focus({ preventScroll: true });
    },
    () => undefined,
  );
}
if (typeof document !== 'undefined')
  document.addEventListener('focusin', holdFocusWhileSliding, true);

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
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** where the focus goes on close (by default back to what opened the sheet); preventDefault
   *  to place it yourself, e.g. on a screen the sheet navigated to */
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const desktop = useDesktop();
  useBackToClose(open, () => onOpenChange(false));
  useEffect(() => (open && !desktop ? dimStatusBar() : undefined), [open, desktop]);
  return (
    // repositionInputs off: vaul's iOS keyboard handling fights ui/keyboard.ts; the sheet rides
    // above the keyboard on --kb instead and fits in what it leaves visible (--vvh).
    // noBodyStyles: in a Safari tab vaul pins <body> (position: fixed), so the page can't scroll
    // and iOS pans the visual viewport to reach a field instead, which iOS 26 can leave panned
    // once the keyboard is gone; the installed app never had it (vaul skips it standalone)
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      direction={desktop ? 'right' : 'bottom'}
      repositionInputs={false}
      noBodyStyles
    >
      <Drawer.Portal>
        {/* keep in step with SCRIM in lib/theme.ts (the dimmed status bar) */}
        <Drawer.Overlay className="fixed inset-0 z-[60] bg-[rgb(10_16_13/0.42)]" />
        <Drawer.Content
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            'fixed z-[61] flex flex-col bg-surface text-ink outline-none depth-3',
            desktop
              ? cn(
                  'inset-y-3 right-3 rounded-lg',
                  wide ? 'w-[min(680px,calc(100vw-24px))]' : 'w-[min(480px,calc(100vw-24px))]',
                )
              : 'inset-x-0 bottom-[var(--kb,0px)] max-h-[92dvh] rounded-t-lg kb:max-h-[calc(var(--vvh,100dvh)-env(safe-area-inset-top)-8px)]',
          )}
        >
          {!desktop ? (
            <div
              className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-line-strong kb:hidden"
              aria-hidden
            />
          ) : null}
          <div className="glass sticky top-0 z-10 flex items-start gap-3 rounded-t-lg px-5 pb-3 pt-4 [--glass:color-mix(in_srgb,var(--surface)_92%,transparent)]">
            <div className="min-w-0 flex-1">
              <Drawer.Title className="t-title-2">{title}</Drawer.Title>
              {description ? (
                <Drawer.Description className="t-body mt-1 text-muted kb:sr-only">
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
          <div className="scroll-fade-b min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
            {children}
          </div>
          {footer ? (
            <div className="border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] kb:pb-3">
              {footer}
            </div>
          ) : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
