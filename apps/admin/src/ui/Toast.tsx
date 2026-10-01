import { CheckCircle, WarningCircle, X } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { reducedMotion, SPRING, springEasing } from '../lib/spring.ts';
import { cn } from './cn.ts';

// Undo beats confirm (§2.2.1): reversible actions happen at once and offer
// "desfazer" for 6 s. Bottom on phones (above the nav), bottom-right on desktop; max 2.
// Swipe sideways or down to dismiss.

export interface ToastItem {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
  undo?: () => void;
  action?: { label: string; run: () => void };
  ms: number;
  /** playing its exit; removed from the list when that ends */
  leaving?: boolean;
}

let items: ToastItem[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(
  text: string,
  opts: {
    tone?: ToastItem['tone'];
    undo?: () => void;
    action?: ToastItem['action'];
    ms?: number;
  } = {},
) {
  const t: ToastItem = {
    id: ++seq,
    text,
    tone: opts.tone ?? 'ok',
    ms: opts.ms ?? (opts.undo ? 6000 : 3500),
    ...(opts.undo ? { undo: opts.undo } : {}),
    ...(opts.action ? { action: opts.action } : {}),
  };
  items = [...items, t];
  const live = items.filter((x) => !x.leaving);
  if (live.length > 2) items = items.map((x) => (x === live[0] ? { ...x, leaving: true } : x));
  emit();
  return t.id;
}
toast.error = (text: string) => toast(text, { tone: 'error', ms: 6000 });
export function dismiss(id: number) {
  items = items.map((t) => (t.id === id && !t.leaving ? { ...t, leaving: true } : t));
  emit();
}
function remove(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function useToasts() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => items,
  );
}

interface Drag {
  x0: number;
  y0: number;
  x: number;
  y: number;
  axis: 'x' | 'y' | null;
  id: number;
  trail: { t: number; x: number; y: number }[];
}

function One({ t }: { t: ToastItem }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const gone = useRef(false);
  // the entrance animation's fill would override the finger's inline transform
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (t.leaving) return;
    let h = 0;
    // never time out from under a finger
    const arm = (ms: number) =>
      (h = window.setTimeout(() => (drag.current ? arm(1500) : dismiss(t.id)), ms));
    arm(t.ms);
    return () => clearTimeout(h);
  }, [t.id, t.ms, t.leaving]);
  useLayoutEffect(() => {
    if (!t.leaving || gone.current) return;
    gone.current = true;
    const el = ref.current;
    if (!el) return remove(t.id);
    const now = getComputedStyle(el).transform;
    const a = el.animate(
      [
        { transform: now === 'none' ? 'none' : now, opacity: getComputedStyle(el).opacity },
        reducedMotion() ? { opacity: 0 } : { transform: 'translateY(12px) scale(.96)', opacity: 0 },
      ],
      {
        duration: reducedMotion() ? 120 : 180,
        easing: 'cubic-bezier(.4,0,1,1)',
        fill: 'forwards',
      },
    );
    a.onfinish = () => remove(t.id);
  }, [t.leaving, t.id]);

  const put = (x: number, y: number) => {
    const el = ref.current!;
    el.style.transform = x || y ? `translate(${x}px, ${y}px)` : '';
    const far = Math.max(Math.abs(x) / el.offsetWidth, y / 120);
    el.style.opacity = far > 0 ? String(1 - Math.min(0.6, far * 0.6)) : '';
  };
  const onDown = (e: React.PointerEvent) => {
    if (t.leaving || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag.current = {
      x0: e.clientX,
      y0: e.clientY,
      x: 0,
      y: 0,
      axis: null,
      id: e.pointerId,
      trail: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const mx = e.clientX - d.x0;
    const my = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      d.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    d.trail.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (d.trail.length > 6) d.trail.shift();
    d.x = d.axis === 'x' ? mx : 0;
    // upward has nowhere to go: resist
    d.y = d.axis === 'y' ? (my > 0 ? my : my * 0.2) : 0;
    put(d.x, d.y);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.axis) return;
    const el = ref.current!;
    const last = d.trail[d.trail.length - 1]!;
    const from = d.trail.find((p) => last.t - p.t <= 80) ?? last;
    const dt = e.timeStamp - last.t > 80 ? 0 : last.t - from.t;
    const vx = dt ? (last.x - from.x) / dt : 0;
    const vy = dt ? (last.y - from.y) / dt : 0;
    const w = el.offsetWidth;
    const out =
      e.type !== 'pointercancel' &&
      (d.axis === 'x'
        ? Math.abs(d.x) > w * 0.35 || (Math.abs(vx) > 0.45 && Math.sign(vx) === Math.sign(d.x))
        : d.y > 48 || (vy > 0.45 && d.y > 8));
    const at = { transform: el.style.transform || 'none', opacity: el.style.opacity || '1' };
    el.style.transform = '';
    el.style.opacity = '';
    if (out) {
      gone.current = true;
      const to =
        d.axis === 'x'
          ? `translate(${Math.sign(d.x) * (w + 32)}px, 0)`
          : `translate(0, ${d.y + 120}px)`;
      const a = reducedMotion()
        ? el.animate([at, { transform: at.transform, opacity: 0 }], {
            duration: 120,
            fill: 'forwards',
          })
        : el.animate([at, { transform: to, opacity: 0 }], {
            duration: 200,
            easing: 'cubic-bezier(.2,.8,.2,1)',
            fill: 'forwards',
          });
      a.onfinish = () => remove(t.id);
      // so a new toast's "max 2" doesn't count this one
      dismiss(t.id);
      return;
    }
    if (reducedMotion()) return;
    const dist = Math.hypot(d.x, d.y) || 1;
    const toward = (-(d.axis === 'x' ? vx * Math.sign(d.x) : vy * Math.sign(d.y)) * 1000) / dist;
    el.animate([at, { transform: 'none', opacity: 1 }], springEasing(SPRING, toward));
  };

  return (
    <div
      ref={ref}
      role={t.tone === 'error' ? 'alert' : 'status'}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onAnimationEnd={(e) => e.target === e.currentTarget && setEntered(true)}
      className={cn(
        !entered && 'animate-fade-up',
        'pointer-events-auto flex min-h-14 w-full touch-none select-none items-center gap-3 rounded-md px-4 py-2 depth-3',
        'bg-ink text-bg noite:bg-raised noite:text-ink',
      )}
    >
      {t.tone === 'error' ? (
        <WarningCircle weight="fill" className="size-5 shrink-0 text-[#ff8a7f]" aria-hidden />
      ) : t.tone === 'ok' ? (
        <CheckCircle weight="fill" className="size-5 shrink-0 text-spark" aria-hidden />
      ) : null}
      <p className="t-body min-w-0 flex-1 font-medium">{t.text}</p>
      {t.undo ? (
        <button
          type="button"
          onClick={() => {
            t.undo!();
            dismiss(t.id);
          }}
          className="press t-label min-h-11 rounded-sm px-3 text-spark hover:bg-white/10"
        >
          desfazer
        </button>
      ) : t.action ? (
        <button
          type="button"
          onClick={() => {
            t.action!.run();
            dismiss(t.id);
          }}
          className="press t-label min-h-11 rounded-sm px-3 text-spark hover:bg-white/10"
        >
          {t.action.label}
        </button>
      ) : (
        <button
          type="button"
          aria-label="fechar"
          onClick={() => dismiss(t.id)}
          className="press grid size-10 place-items-center rounded-full opacity-70 hover:opacity-100"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Toaster() {
  const list = useToasts();
  // an action bar can wrap to two rows (Cardápio's selection bar): sit above its real height
  const [bar, setBar] = useState<number>();
  useLayoutEffect(() => {
    if (list.length) setBar(document.querySelector('[data-action-bar]')?.clientHeight || undefined);
  }, [list.length]);
  return (
    <div
      aria-live="polite"
      data-no-pull
      style={bar ? ({ '--bar-h': `${bar}px` } as React.CSSProperties) : undefined}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--tabbar-h,calc(72px+env(safe-area-inset-bottom)))+16px)] z-[70] flex flex-col items-center gap-2 px-4 max-md:[html:not([data-kb]):has([data-action-bar])_&]:bottom-[calc(var(--tabbar-h,calc(72px+env(safe-area-inset-bottom)))+var(--bar-h,80px)+16px)] md:bottom-6 md:left-auto md:right-6 md:w-[420px] md:items-end"
    >
      {list.map((t) => (
        <One key={t.id} t={t} />
      ))}
    </div>
  );
}
