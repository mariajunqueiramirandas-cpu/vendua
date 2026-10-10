import type { CSSProperties } from 'react';

/** Text split into inline-block characters, each styled by its index (for per-letter motion). */
export const Chars: React.FC<{
  text: string;
  style?: CSSProperties;
  char: (i: number, n: number) => CSSProperties;
}> = ({ text, style, char }) => {
  const chars = [...text];
  return (
    <span style={{ display: 'inline-block', whiteSpace: 'pre', ...style }}>
      {chars.map((c, i) => (
        <span key={i} style={{ display: 'inline-block', ...char(i, chars.length) }}>
          {c === ' ' ? ' ' : c}
        </span>
      ))}
    </span>
  );
};

/** A line that slides up out of its own box: p = 0 hidden below, 1 in place. */
export const Rise: React.FC<{ p: number; children: React.ReactNode; style?: CSSProperties }> = ({ p, children, style }) => (
  <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.08em', ...style }}>
    <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%)` }}>{children}</span>
  </span>
);

/** RGB-split text shadow; k = 0 none, 1 full. */
export const split = (k: number, px = 10) =>
  k <= 0.001
    ? 'none'
    : `${-px * k}px 0 rgba(217,248,117,${0.9 * k}), ${px * k}px 0 rgba(95,224,200,${0.8 * k})`;
