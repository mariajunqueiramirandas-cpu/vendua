import { C, FONT } from '../../lib/brand';
import { ease, prog } from '../../lib/motion';
import { CAPTIONS, SCENES, T, type LineId } from './timeline';

// The narration as captions over the scenes that show the product (the type-driven scenes say
// their line in their own type). One group at a time, the spoken word lit in lime: most Reels
// play muted until someone taps.
const SHOWN: LineId[] = ['what', 'shop', 'order', 'dua', 'day', 'setup'];
// Duá's reveal spells out who he is in its own type
const QUIET: [number, number][] = [[T.dua.dua - 0.05, T.dua.tira - 0.1]];

export const Captions: React.FC<{ t: number }> = ({ t }) => {
  const scene = SHOWN.find((id) => t >= SCENES[id][0] && t < SCENES[id][1]);
  if (!scene || QUIET.some(([a, b]) => t >= a && t < b)) return null;
  const c = CAPTIONS.find((x) => t >= x.t0 && t < x.t1);
  if (!c) return null;
  const k = c.words.reduce((n, w, i) => (t >= w.t0 ? i : n), 0);
  const p = prog(t, c.t0, 0.14, ease.outCubic);
  return (
    <div style={{ position: 'absolute', top: 222, left: 50, right: 50, display: 'flex', justifyContent: 'center' }}>
    <div
      style={{
        padding: '12px 34px 18px',
        borderRadius: 32,
        background: 'rgba(10,16,13,0.8)',
        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        textAlign: 'center',
        fontFamily: FONT.body,
        fontWeight: 800,
        fontSize: 66,
        lineHeight: 1.1,
        letterSpacing: '-0.01em',
        color: C.cream,
        textShadow: '0 4px 28px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.5)',
        transform: `translateY(${(1 - p) * 18}px) scale(${0.94 + 0.06 * p})`,
        opacity: p,
      }}
    >
      {c.words.map((w, i) => (
        <span
          key={i}
          style={{
            display: 'inline-block',
            margin: '0 0.13em',
            color: i === k ? C.lime : C.cream,
            opacity: i <= k ? 1 : 0.5,
            transform: `scale(${i === k ? 1 + 0.06 * (1 - prog(t, w.t0, 0.18, ease.outCubic)) : 1})`,
          }}
        >
          {w.w}
        </span>
      ))}
    </div>
    </div>
  );
};
