import { useEffect, useRef } from 'react';
import { cn } from '../cn.ts';
import { Mascote, type Pose } from '../Mascote.tsx';

export type AvatarPose = Extract<
  Pose,
  'avatar-ola' | 'avatar-pensando' | 'avatar-feliz' | 'avatar-ajuda'
>;

const SIZES = { xs: 18, sm: 32, md: 56, lg: 80 } as const;

// Below 48 px the whole figure is a smudge: the small sizes zoom on the head. Centre of the
// head in each pose's 640×640 art, as fractions.
const HEAD: Record<AvatarPose, [number, number]> = {
  'avatar-ola': [0.6, 0.33],
  'avatar-pensando': [0.66, 0.34],
  'avatar-feliz': [0.67, 0.36],
  'avatar-ajuda': [0.67, 0.36],
};
const ZOOM = { xs: 1.6, sm: 1.5, md: 1, lg: 1 } as const;

const still = () =>
  typeof window === 'undefined' ||
  navigator.webdriver ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Duá's face: the mascot on a lit disc (cream in Noite, where forest green would vanish).
 * `answering` switches to the thinking pose and the ring breathes (3.2 s); paused, in Ensaio or
 * with the owner on the floor it is still (sales-agent-ux §6). Decorative unless `label` is
 * given: the name is in the text.
 */
export function PersonaAvatar({
  size = 'md',
  pose,
  answering = false,
  label,
  className,
}: {
  size?: keyof typeof SIZES | undefined;
  /** defaults to `avatar-ola`, or `avatar-pensando` while answering */
  pose?: AvatarPose | undefined;
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
  const shown: AvatarPose = pose ?? (answering ? 'avatar-pensando' : 'avatar-ola');
  const px = SIZES[size];
  const k = ZOOM[size];
  const [cx, cy] = HEAD[shown];
  // zoomed: the head's centre lands on the disc's centre; whole: the bust sits on the rim
  const place =
    k === 1
      ? { width: '100%', left: 0, top: '4%' }
      : { width: `${k * 100}%`, left: `${50 - cx * k * 100}%`, top: `${50 - cy * k * 100}%` };
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: px, height: px }}
      className={cn('dua-disc relative inline-block shrink-0 bg-spark-soft', className)}
    >
      <span className="absolute inset-0 overflow-hidden rounded-full">
        <span className="absolute block aspect-square" style={place}>
          <Mascote pose={shown} size={Math.round(px * k)} className="w-full" />
        </span>
      </span>
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
