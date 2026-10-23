import type { CSSProperties, ReactNode } from 'react';
import { Freeze, OffthreadVideo, staticFile } from 'remotion';
import { C, FONT } from '../../lib/brand';
import { ease, prog } from '../../lib/motion';
import { frameAt, tapsOf, UI, type Shot } from './timeline';

/** the phones' screen width in the frame (before the camera's zoom) */
export const PHONE = 660;

export const display = (size: number, color: string): CSSProperties => ({
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: size,
  lineHeight: 0.92,
  letterSpacing: '-0.05em',
  color,
});

/** Lands from big and blurred onto the grid time `s`. */
export const slam = (t: number, s: number, from = 1.6, d = 0.26): CSSProperties => {
  const p = prog(t, s, d, ease.outExpo);
  return { transform: `scale(${from - (from - 1) * p})`, filter: p < 1 ? `blur(${(1 - p) * 16}px)` : 'none', opacity: t >= s ? 1 : 0 };
};

/** A camera on a phone: screen point (x, y), in the capture's CSS px, sits on the device's anchor,
 *  zoomed by z and turned by rx/ry/rz degrees around it. */
export type Cam = { x: number; y: number; z: number; rx?: number; ry?: number; rz?: number };
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** the camera between keys, eased (each key holds until the next one starts moving at its time) */
export const camAt = (t: number, keys: readonly (readonly [number, Cam, number?])[]): Cam => {
  let c = keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, to, d = 0.45] = keys[i];
    if (t < t1) break;
    const k = prog(t, t1, d, ease.inOutCubic);
    const from = c;
    c = {
      x: lerp(from.x, to.x, k),
      y: lerp(from.y, to.y, k),
      z: lerp(from.z, to.z, k),
      rx: lerp(from.rx ?? 0, to.rx ?? 0, k),
      ry: lerp(from.ry ?? 0, to.ry ?? 0, k),
      rz: lerp(from.rz ?? 0, to.rz ?? 0, k),
    };
  }
  return c;
};

/** A finger on the glass: a dot that presses in, then a ring that spreads (CSS px of the capture). */
const Tap: React.FC<{ t: number; at: number; x: number; y: number; s: number }> = ({ t, at, x, y, s }) => {
  if (t < at - 0.08 || t > at + 0.5) return null;
  const press = prog(t, at - 0.08, 0.08, ease.outCubic);
  const ring = prog(t, at, 0.45, ease.outCubic);
  const lift = prog(t, at + 0.12, 0.25, ease.linear);
  const r = 20 * s;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: x * s - r,
          top: y * s - r,
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          background: 'rgba(255,255,255,0.55)',
          boxShadow: '0 0 0 2px rgba(10,16,13,0.25), 0 6px 18px rgba(0,0,0,0.3)',
          transform: `scale(${0.6 + 0.4 * press - 0.15 * (t >= at ? 1 - lift : 0)})`,
          opacity: (1 - lift) * press,
        }}
      />
      {t >= at && (
        <div
          style={{
            position: 'absolute',
            left: x * s - r * 2.6,
            top: y * s - r * 2.6,
            width: r * 5.2,
            height: r * 5.2,
            borderRadius: r * 2.6,
            border: `${3 * s}px solid ${C.lime}`,
            transform: `scale(${0.3 + 0.7 * ring})`,
            opacity: 1 - ring,
          }}
        />
      )}
    </>
  );
};

/**
 * A phone playing a real capture (public/launch60/ui), its time remapped by the shot, with the
 * capture's own taps drawn on the glass. `cx, cy` is where the camera's focus point lands in the
 * frame; `children` draw over the screen in the capture's CSS px (multiply by `s`).
 */
export const Device: React.FC<{
  shot: Shot;
  t: number;
  width: number;
  cx: number;
  cy: number;
  cam: Cam;
  style?: CSSProperties;
  children?: (s: number) => ReactNode;
}> = ({ shot, t, width, cx, cy, cam, style, children }) => {
  const meta = UI[shot.clip];
  const s = width / meta.viewport.width;
  const h = Math.round((width * 2436) / 1124);
  const bezel = Math.round(width * 0.03);
  const f = Math.max(0, Math.min(meta.frames - 1, Math.round(frameAt(shot, t))));
  const glare = ((cam.ry ?? 0) / 30) * 0.8;
  return (
    <div
      style={{
        position: 'absolute',
        left: cx,
        top: cy,
        width: 0,
        height: 0,
        transformOrigin: '0 0',
        transform: `perspective(2600px) rotateX(${cam.rx ?? 0}deg) rotateY(${cam.ry ?? 0}deg) rotateZ(${cam.rz ?? 0}deg) scale(${cam.z})`,
        ...style,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -(cam.x * s + bezel),
          top: -(cam.y * s + bezel),
          width: width + bezel * 2,
          height: h + bezel * 2,
          borderRadius: width * 0.14,
          padding: bezel,
          background: 'linear-gradient(145deg, #2a332f, #050806 40%, #1a211e)',
          boxShadow: '0 60px 140px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(255,255,255,0.09)',
        }}
      >
        <div style={{ position: 'relative', width, height: h, borderRadius: width * 0.115, overflow: 'hidden', background: '#000' }}>
          <Freeze frame={f}>
            <OffthreadVideo src={staticFile(`launch60/ui/${shot.clip}.mp4`)} muted style={{ width, height: h, display: 'block' }} />
          </Freeze>
          {tapsOf(shot).map((p) => (
            <Tap key={p.f} t={t} at={p.t} x={p.x} y={p.y} s={s} />
          ))}
          {children?.(s)}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(115deg, transparent ${30 + glare * 30}%, rgba(255,255,255,0.08) ${42 + glare * 30}%, transparent ${55 + glare * 30}%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

/** A lime outline that draws itself around a region of the screen (CSS px of the capture). */
export const Ring: React.FC<{ t: number; at: number; s: number; x: number; y: number; w: number; h: number; until?: number }> = ({
  t,
  at,
  s,
  x,
  y,
  w,
  h,
  until = Infinity,
}) => {
  if (t < at || t > until) return null;
  const p = prog(t, at, 0.3, ease.outExpo);
  const out = until === Infinity ? 0 : prog(t, until - 0.15, 0.15, ease.linear);
  return (
    <div
      style={{
        position: 'absolute',
        left: (x - 6) * s,
        top: (y - 6) * s,
        width: (w + 12) * s,
        height: (h + 12) * s,
        borderRadius: 16 * s,
        border: `${3 * s}px solid ${C.lime}`,
        boxShadow: `0 0 ${24 * s}px rgba(217,248,117,0.45)`,
        transform: `scale(${1.15 - 0.15 * p})`,
        opacity: p * (1 - out),
      }}
    />
  );
};

/** A pill callout beside a phone. */
export const Chip: React.FC<{ p: number; children: ReactNode; style?: CSSProperties; tone?: 'lime' | 'cream' | 'night' }> = ({
  p,
  children,
  style,
  tone = 'lime',
}) => (
  <div
    style={{
      position: 'absolute',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      padding: '18px 30px',
      borderRadius: 99,
      background: tone === 'lime' ? C.lime : tone === 'cream' ? C.cream : C.night,
      color: tone === 'night' ? C.cream : C.forest,
      fontFamily: FONT.body,
      fontWeight: 800,
      fontSize: 44,
      whiteSpace: 'nowrap',
      boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
      transform: `scale(${0.4 + 0.6 * ease.outBack(Math.min(1, p))})`,
      opacity: Math.min(1, p * 3),
      ...style,
    }}
  >
    {children}
  </div>
);

export const Check: React.FC<{ size: number; color: string; p?: number }> = ({ size, color, p = 1 }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} style={{ flex: 'none' }}>
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

/** The brand's mark (public/brand/mark-*.svg) flat, its check drawing itself on as p goes 0 → 1;
 *  on the app icon's rounded square when `bg` is set. */
export const Mark: React.FC<{ size: number; p: number; color: string; bg?: string; style?: CSSProperties }> = ({ size, p, color, bg, style }) => (
  <svg viewBox="0 0 128 128" width={size} height={size} style={{ position: 'absolute', overflow: 'visible', ...style }}>
    {bg && <rect width={128} height={128} rx={28} fill={bg} />}
    {p > 0 && (
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
    )}
  </svg>
);
