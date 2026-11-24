import type { CSSProperties, ReactNode } from 'react';
import { Img, staticFile } from 'remotion';
import { C, FONT } from '../../lib/brand';
import { ease, prog } from '../../lib/motion';
import { Rise } from '../../lib/text';

// Shared pieces for the Black Friday reel: type, word-synced lines, the phone, the tape, the mark.

export const display = (size: number, color: string): CSSProperties => ({
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: size,
  lineHeight: 0.94,
  letterSpacing: '-0.045em',
  color,
});

export const label = (size: number, color: string): CSSProperties => ({
  fontFamily: FONT.body,
  fontWeight: 800,
  fontSize: size,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color,
});

/** A line whose words rise out of their own boxes, each on the time the narrator says it. */
export const Words: React.FC<{ t: number; words: readonly (readonly [string, number])[]; style?: CSSProperties; dur?: number }> = ({
  t,
  words,
  style,
  dur = 0.34,
}) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.24em', ...style }}>
    {words.map(([w, at], i) => (
      <Rise key={i} p={prog(t, at - 0.05, dur, ease.outExpo)}>
        {w}
      </Rise>
    ))}
  </div>
);

/** The brand's check, drawn on as p goes 0 → 1. */
export const Mark: React.FC<{ size: number; p?: number; color?: string; style?: CSSProperties }> = ({ size, p = 1, color = C.lime, style }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} style={{ overflow: 'visible', ...style }}>
    <path
      d="M32 48 L61 88 L98 34"
      fill="none"
      stroke={color}
      strokeWidth={17}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - p}
    />
  </svg>
);

/** A phone in CSS; its screen is whatever the children draw (real captures are 750×1624). */
export const Phone: React.FC<{ width: number; glare?: number; style?: CSSProperties; children: ReactNode }> = ({ width, glare = 0, style, children }) => {
  const h = Math.round((width * 1624) / 750);
  const bezel = Math.round(width * 0.028);
  return (
    <div
      style={{
        position: 'absolute',
        width: width + bezel * 2,
        height: h + bezel * 2,
        borderRadius: width * 0.14,
        background: 'linear-gradient(145deg, #2a332f, #050806 40%, #1a211e)',
        padding: bezel,
        boxShadow: '0 70px 140px rgba(0,0,0,0.6), 0 0 0 2px rgba(255,255,255,0.06) inset',
        ...style,
      }}
    >
      <div style={{ position: 'relative', width, height: h, borderRadius: width * 0.115, overflow: 'hidden', background: '#000' }}>
        {children}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(115deg, transparent ${30 + glare * 30}%, rgba(255,255,255,0.1) ${42 + glare * 30}%, transparent ${55 + glare * 30}%)`,
          }}
        />
      </div>
    </div>
  );
};

export const Screen: React.FC<{ src: string; width: number; style?: CSSProperties }> = ({ src, width, style }) => (
  <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: 0, width, height: Math.round((width * 1624) / 750), ...style }} />
);

/** Retail tape: a band of repeating text that scrolls; `x` is its offset in px. */
export const Tape: React.FC<{ text: string; x: number; top: number; rotate: number; bg: string; fg: string; size?: number; reveal?: number }> = ({
  text,
  x,
  top,
  rotate,
  bg,
  fg,
  size = 56,
  reveal = 1,
}) => {
  const item = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.55, paddingRight: size * 0.55 }}>
      <span>{text}</span>
      <span style={{ width: size * 0.28, height: size * 0.28, background: fg, transform: 'rotate(45deg)', display: 'inline-block' }} />
    </span>
  );
  return (
    <div
      style={{
        position: 'absolute',
        left: -200,
        width: 1480,
        top,
        height: size * 1.9,
        background: bg,
        transform: `rotate(${rotate}deg)`,
        overflow: 'hidden',
        clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`,
        boxShadow: '0 18px 40px rgba(0,0,0,0.25)',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div style={{ ...label(size, fg), letterSpacing: '0.06em', whiteSpace: 'nowrap', transform: `translateX(${x}px)` }}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i}>{item}</span>
        ))}
      </div>
    </div>
  );
};

/** A phone notification as Core sends it (packages/core/src/admin/workers.ts): app, title, body, one action. */
export const Push: React.FC<{ n: number; who: string; total: string; style?: CSSProperties }> = ({ n, who, total, style }) => (
  <div
    style={{
      position: 'absolute',
      width: 780,
      padding: '26px 30px',
      borderRadius: 40,
      background: 'rgba(247,244,234,0.97)',
      boxShadow: '0 30px 70px rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      fontFamily: FONT.body,
      ...style,
    }}
  >
    <div style={{ width: 84, height: 84, borderRadius: 22, background: C.forest, display: 'grid', placeItems: 'center', flex: 'none' }}>
      <Mark size={52} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, fontWeight: 700, color: '#5d6b64' }}>
        <span>Minha loja</span>
        <span>agora</span>
      </div>
      <div style={{ fontSize: 38, fontWeight: 800, color: '#14211b', marginTop: 4 }}>Pedido #{n} chegou</div>
      <div style={{ fontSize: 30, fontWeight: 600, color: '#3f4d46', marginTop: 2 }}>
        {who} · {total} · entrega
      </div>
    </div>
    <div style={{ padding: '14px 24px', borderRadius: 99, background: C.lime, color: C.forest, fontSize: 28, fontWeight: 800, flex: 'none' }}>
      aceitar
    </div>
  </div>
);
