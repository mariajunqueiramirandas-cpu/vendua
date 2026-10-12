import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../lib/brand';
import { ease, kick, prog, tw } from '../../lib/motion';
import { SCENES, SYSTEMS, T, ZERO, systemsAt } from './timeline';

// Mission control over the first 24 s: corner brackets, the clock counting down to T−0, and the
// systems coming online along the bottom. Forest while the world is lime, lime on night.
const pad2 = (n: number) => String(n).padStart(2, '0');
export const clock = (t: number) => {
  const cs = Math.max(0, Math.round((ZERO - t) * 100));
  return `T−${pad2(Math.floor(cs / 100))},${pad2(cs % 100)}`;
};

const Bracket: React.FC<{ x: number; y: number; sx: number; sy: number; color: string; p: number }> = ({ x, y, sx, sy, color, p }) => (
  <div
    style={{
      position: 'absolute',
      left: x - (sx < 0 ? 56 : 0),
      top: y - (sy < 0 ? 56 : 0),
      width: 56,
      height: 56,
      borderColor: color,
      borderStyle: 'solid',
      borderWidth: 0,
      [sx > 0 ? 'borderLeftWidth' : 'borderRightWidth']: 5,
      [sy > 0 ? 'borderTopWidth' : 'borderBottomWidth']: 5,
      opacity: p,
      transform: `translate(${(1 - p) * -40 * sx}px, ${(1 - p) * -40 * sy}px)`,
    }}
  />
);

export const Hud: React.FC<{ t: number }> = ({ t }) => {
  const onLime = t >= T.dua.online && t < SCENES.dua[1];
  const ink = onLime ? C.forest : C.lime;
  const dim = onLime ? 'rgba(18,60,50,0.7)' : C.muted;
  const p = prog(t, 0, 0.45, ease.outExpo);
  const out = tw(t, ZERO + 0.15, ZERO + 0.5, 1, 0, ease.inCubic);
  if (out <= 0) return null;
  const n = systemsAt(t);
  const atZero = t >= ZERO;

  return (
    <AbsoluteFill style={{ opacity: out, pointerEvents: 'none' }}>
      <Bracket x={48} y={236} sx={1} sy={1} color={ink} p={p} />
      <Bracket x={1032} y={236} sx={-1} sy={1} color={ink} p={p} />
      <Bracket x={48} y={1576} sx={1} sy={-1} color={ink} p={p} />
      <Bracket x={1032} y={1576} sx={-1} sy={-1} color={ink} p={p} />
      <div style={{ position: 'absolute', left: 84, top: 262, fontFamily: FONT.display, fontWeight: 700, fontSize: 26, letterSpacing: '0.2em', color: ink, opacity: p }}>
        VENDUÁ
        <div style={{ fontWeight: 500, color: dim, marginTop: 4 }}>SEQUÊNCIA DE LANÇAMENTO</div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 84,
          top: 256,
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: 50,
          letterSpacing: '0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: atZero ? C.cream : ink,
          opacity: p,
          transform: `scale(${1 + kick(t, ZERO, 0.4) * 0.3})`,
          transformOrigin: '100% 0%',
        }}
      >
        {clock(t)}
      </div>
      <div style={{ position: 'absolute', left: 84, right: 84, top: 1486, display: 'flex', alignItems: 'center', gap: 18, opacity: p }}>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 24, letterSpacing: '0.2em', color: dim }}>SISTEMAS</div>
        <div style={{ flex: 1, display: 'flex', gap: 8 }}>
          {Array.from({ length: SYSTEMS }, (_, i) => (
            <div key={i} style={{ flex: 1, height: 12, borderRadius: 6, background: i < n ? ink : onLime ? 'rgba(18,60,50,0.18)' : 'rgba(247,244,234,0.14)' }} />
          ))}
        </div>
        <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 30, color: ink, fontVariantNumeric: 'tabular-nums' }}>
          {n}/{SYSTEMS}
        </div>
      </div>
    </AbsoluteFill>
  );
};
