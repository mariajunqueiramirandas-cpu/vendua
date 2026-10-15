import type { CSSProperties } from 'react';
import { ease, prog, tw } from '../../lib/motion';

// The film's one way in and one way out: a slow rise out of a soft blur, and a fade back into it.
export const reveal = (t: number, start: number, dur = 1.0, rise = 34): CSSProperties => {
  const p = prog(t, start, dur, ease.outQuart);
  return { opacity: t < start ? 0 : Math.min(1, p * 1.4), transform: `translateY(${(1 - p) * rise}px)`, filter: p < 0.999 ? `blur(${(1 - p) * 12}px)` : 'none' };
};

/** 1 → 0 across a shot's tail: [end − 0.35, end + 0.15]. */
export const fadeOut = (t: number, end: number) => tw(t, end - 0.35, end + 0.15, 1, 0, ease.inOutCubic);

/** Words revealed one after another, 70 ms apart. */
export const Words: React.FC<{ t: number; start: number; text: string; style?: CSSProperties; gap?: number }> = ({ t, start, text, style, gap = 0.07 }) => (
  <span style={style}>
    {text.split(' ').map((w, i, all) => (
      <span key={i} style={{ display: 'inline-block', whiteSpace: 'pre', ...reveal(t, start + i * gap) }}>
        {w}
        {i < all.length - 1 ? ' ' : ''}
      </span>
    ))}
  </span>
);

