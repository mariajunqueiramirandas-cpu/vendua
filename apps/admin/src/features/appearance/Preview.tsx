import { useEffect, useRef, useState } from 'react';
import { cn } from '../../ui/cn.ts';

/** The width a store is laid out at: a phone's, or a laptop's. A smaller frame scales it.
 *  `bare` is the phone in hand, edge to edge: it shows the store at its own width. */
const LAYOUT_WIDTH = { phone: 375, bare: 320, desktop: 1280 } as const;

/**
 * The real storefront in a frame. `phone` and `desktop` draw a device around it (tablet and
 * desktop screens), sized to the space the parent gives it; `bare` is for phones, which are
 * the device already: the frame fills the parent's height.
 */
export function Preview({
  src,
  device,
  frameRef,
  ready,
  url,
  className,
}: {
  src: string;
  device: 'phone' | 'desktop' | 'bare';
  frameRef: React.RefObject<HTMLIFrameElement>;
  ready: boolean;
  url: string;
  className?: string | undefined;
}) {
  const [loaded, setLoaded] = useState(false);
  const [late, setLate] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      // a frame that isn't laid out yet (or is hidden) has nothing to scale to
      if (e && e.contentRect.width > 0)
        setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // never narrower than the store was made for: a small frame shows it zoomed out
  const layoutW = Math.max(size?.w ?? 0, LAYOUT_WIDTH[device]);
  const scale = size ? size.w / layoutW : 1;
  useEffect(() => {
    setLoaded(false);
    setLate(false);
    // the store never said hello: its build predates the editor, or it's offline
    const t = setTimeout(() => setLate(true), 8000);
    return () => clearTimeout(t);
  }, [src]);
  const screen = (
    <div
      ref={box}
      className={cn(
        'relative overflow-hidden bg-surface',
        device === 'phone' && 'aspect-[9/19] rounded-[28px]',
        device === 'desktop' && 'aspect-[16/10] rounded-lg',
        device === 'bare' && 'h-full',
      )}
    >
      {!loaded && !late ? <div className="skeleton absolute inset-0" /> : null}
      {late && !ready ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
          <p className="t-title-2">A prévia não abriu</p>
          <p className="t-body text-muted">
            A sua loja precisa de uma atualização para mostrar as mudanças aqui. Você ainda pode
            editar e publicar; confira o resultado na loja.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="t-label inline-flex min-h-11 items-center rounded-md px-4 ring-1 ring-line-strong"
          >
            abrir a loja
          </a>
        </div>
      ) : null}
      <iframe
        ref={frameRef}
        key={src}
        title="prévia da loja"
        src={src}
        onLoad={() => setLoaded(true)}
        className="border-0"
        style={
          size && scale < 1
            ? {
                width: layoutW,
                height: size.h / scale,
                transform: `scale(${scale})`,
                transformOrigin: '0 0',
              }
            : { width: '100%', height: '100%' }
        }
      />
    </div>
  );
  if (device === 'bare') return <div className={className}>{screen}</div>;
  return (
    // a size container: the device takes the most of it that keeps its shape
    <div className={cn('flex h-full justify-center [container-type:size]', className)}>
      <div
        className={cn(
          'relative h-fit overflow-hidden bg-[#0c1410] depth-3 noite:ring-1 noite:ring-line-strong',
          device === 'phone'
            ? 'w-[min(100cqw,47cqh,420px)] rounded-[44px] px-3 pb-3 pt-10'
            : 'w-[min(100cqw,calc((100cqh-16px)*1.6+16px))] rounded-xl p-2',
        )}
      >
        {device === 'phone' ? (
          <div
            aria-hidden
            className="absolute left-1/2 top-4 z-10 h-1.5 w-16 -translate-x-1/2 rounded-full bg-white/20"
          />
        ) : null}
        {screen}
      </div>
    </div>
  );
}
