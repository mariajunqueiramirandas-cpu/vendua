import { useEffect, useRef } from 'react';
import { cn } from '../cn.ts';

const SIZES = {
  xs: 'size-[18px] text-[10px] font-bold',
  sm: 'size-8 text-[0.875rem]',
  md: 'size-14 text-[1.375rem]',
  lg: 'size-20 text-[2rem]',
} as const;

const still = () =>
  typeof window === 'undefined' ||
  navigator.webdriver ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The Vendedor's face: a spark disc with the initial of the name the merchant chose. The ring
 * breathes (3.2 s) only while it is answering; paused, in Ensaio or with the owner on the floor
 * it is still (sales-agent-ux §6). Decorative unless `label` is given: the name is in the text.
 */
export function PersonaAvatar({
  name,
  size = 'md',
  answering = false,
  label,
  className,
}: {
  name: string;
  size?: keyof typeof SIZES | undefined;
  answering?: boolean | undefined;
  /** an accessible name, when the avatar stands alone */
  label?: string | undefined;
  className?: string | undefined;
}) {
  const ring = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ring.current;
    if (!answering || !el || still() || !el.animate) return;
    // WAAPI rather than a theme keyframe: only transform and opacity, stopped with the state
    const a = el.animate(
      [
        { transform: 'scale(0.94)', opacity: 0.3 },
        { transform: 'scale(1.06)', opacity: 0.85 },
        { transform: 'scale(0.94)', opacity: 0.3 },
      ],
      { duration: 3200, iterations: Infinity, easing: 'ease-in-out' },
    );
    return () => a.cancel();
  }, [answering]);
  const initial = (name.trim().slice(0, 1) || 'A').toUpperCase();
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'relative grid shrink-0 place-items-center rounded-full bg-spark font-display font-semibold leading-none text-on-spark',
        SIZES[size],
        className,
      )}
    >
      {initial}
      {answering ? (
        <span
          ref={ring}
          aria-hidden
          className={cn(
            'pointer-events-none absolute rounded-full border-2 border-spark opacity-60',
            size === 'xs' ? '-inset-0.5' : size === 'sm' ? '-inset-1' : '-inset-1.5',
          )}
        />
      ) : null}
    </span>
  );
}
