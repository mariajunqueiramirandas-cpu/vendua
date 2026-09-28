import { ArrowClockwise } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { haptic } from '../lib/haptics.ts';
import { cn } from '../ui/cn.ts';

const TRIGGER = 72;

/**
 * Pull down at the top of a screen to refresh it (phones). The body has
 * overscroll-behavior: none, so the browser's own pull-to-refresh (a full reload,
 * and none at all once installed) never fires; this refetches what's on screen.
 */
export function PullToRefresh() {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const g = useRef<{ y: number; x: number; on: boolean } | null>(null);
  const pullRef = useRef(0);

  useEffect(() => {
    const start = (e: TouchEvent) => {
      const t = e.target as Element;
      if (
        scrollY > 0 ||
        e.touches.length !== 1 ||
        t.closest('[role="dialog"], [data-vaul-drawer], [data-no-pull], input, textarea, select')
      )
        return;
      g.current = { y: e.touches[0]!.clientY, x: e.touches[0]!.clientX, on: false };
    };
    const move = (e: TouchEvent) => {
      const s = g.current;
      if (!s) return;
      const dy = e.touches[0]!.clientY - s.y;
      const dx = e.touches[0]!.clientX - s.x;
      if (!s.on) {
        // a sideways swipe (order cards) or an upward scroll is not a pull
        if (Math.abs(dx) > Math.abs(dy) || dy < 0 || scrollY > 0) {
          if (Math.abs(dx) > 8 || dy < -8) g.current = null;
          return;
        }
        if (dy > 10) s.on = true;
      }
      if (s.on) {
        // resistance: the further you pull, the less it follows
        const p = Math.min(TRIGGER * 1.5, (dy - 10) * 0.5);
        if (pullRef.current < TRIGGER && p >= TRIGGER) haptic.tick();
        pullRef.current = p;
        setPull(p);
      }
    };
    const end = () => {
      const fire = g.current?.on && pullRef.current >= TRIGGER;
      g.current = null;
      pullRef.current = 0;
      setPull(0);
      if (!fire) return;
      haptic.commit();
      setBusy(true);
      void qc
        .refetchQueries({ type: 'active' })
        .finally(() => setTimeout(() => setBusy(false), 300));
    };
    addEventListener('touchstart', start, { passive: true });
    addEventListener('touchmove', move, { passive: true });
    addEventListener('touchend', end);
    addEventListener('touchcancel', end);
    return () => {
      removeEventListener('touchstart', start);
      removeEventListener('touchmove', move);
      removeEventListener('touchend', end);
      removeEventListener('touchcancel', end);
    };
  }, [qc]);

  const shown = busy ? TRIGGER : pull;
  if (!shown) return null;
  return (
    <div
      aria-hidden={!busy}
      role={busy ? 'status' : undefined}
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)-2.5rem)] z-50 flex justify-center md:hidden"
      style={{ transform: `translateY(${shown * 0.9}px)` }}
    >
      <span
        className={cn(
          'grid size-10 place-items-center rounded-full bg-surface text-ink depth-2',
          busy && 'text-primary',
        )}
      >
        <ArrowClockwise
          weight="bold"
          className={cn('size-5', busy && 'animate-spin')}
          style={busy ? undefined : { transform: `rotate(${(pull / TRIGGER) * 300}deg)` }}
        />
        {busy ? <span className="sr-only">atualizando</span> : null}
      </span>
    </div>
  );
}
