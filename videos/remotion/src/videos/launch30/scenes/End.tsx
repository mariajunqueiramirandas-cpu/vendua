import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { Shader } from '../../../lib/gl';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { MARK3D } from '../../../lib/shaders';
import { Rise } from '../../../lib/text';
import { LAUNCH, T } from '../timeline';

const E = T.end;

// Out of hyperspace: the mark spins down and locks, the wordmark, the date, where to find it.
export const End: React.FC<{ t: number }> = ({ t }) => {
  const iris = tw(t, E.mark - 0.05, E.mark + 0.25, 0, 1, ease.outCubic);
  const land = prog(t, E.mark, 1.0, ease.outExpo);
  const ring = prog(t, E.mark, 0.8, ease.outCubic);
  const word = prog(t, E.mark + 0.08, 0.4, ease.outExpo);
  const date = prog(t, E.date, 0.3, ease.outBack);
  const breathe = 1 + 0.01 * Math.sin((t - E.mark) * 2.2);

  return (
    <AbsoluteFill style={{ background: `radial-gradient(900px 900px at 50% 38%, ${C.forest} 0%, ${C.night} 72%)`, clipPath: `circle(${iris * 1200}px at 540px 820px)` }}>
      <div style={{ position: 'absolute', left: 540 - 150, top: 560 - 150, width: 300, height: 300, borderRadius: 150, border: `6px solid ${C.lime}`, transform: `scale(${0.6 + ring * 2})`, opacity: (1 - ring) * 0.9 }} />
      <div style={{ position: 'absolute', inset: 0, transform: `scale(${breathe})`, transformOrigin: '540px 860px' }}>
        <Shader
          frag={MARK3D}
          width={500}
          height={500}
          style={{ left: 290, top: 310 }}
          uniforms={{
            uRot: [0.1 * Math.sin(t * 1.2), (1 - land) * -Math.PI * 4 + 0.2 * Math.sin(t * 0.9), -0.04],
            uSize: tw(t, E.mark, E.mark + 0.45, 0.3, 1, ease.outBack) * (1 + kick(t, E.mark, 0.35) * 0.06),
            uLight: kick(t, E.mark, 0.6),
          }}
        />
        <div style={{ position: 'absolute', top: 770, width: '100%', textAlign: 'center', fontFamily: FONT.display, fontWeight: 700, fontSize: 210, letterSpacing: '-0.06em', color: C.cream, lineHeight: 1, transform: `scale(${1.3 - 0.3 * word})`, opacity: word, filter: `blur(${(1 - word) * 12}px)` }}>
          venduá<span style={{ color: C.lime }}>.</span>
        </div>
        <div style={{ position: 'absolute', top: 1030, width: '100%', textAlign: 'center' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 22,
              padding: '16px 36px',
              borderRadius: 99,
              background: C.lime,
              color: C.forest,
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: 52,
              letterSpacing: '0.02em',
              transform: `scale(${date})`,
              opacity: Math.min(1, date * 2),
            }}
          >
            <span style={{ fontSize: 30, letterSpacing: '0.16em' }}>LANÇAMENTO</span>
            {LAUNCH.day}.{LAUNCH.month}.{LAUNCH.year}
          </span>
        </div>
        <div style={{ position: 'absolute', top: 1180, width: '100%', textAlign: 'center', fontFamily: FONT.body }}>
          <Rise p={prog(t, E.url, 0.35, ease.outExpo)} style={{ fontWeight: 800, fontSize: 72, color: C.cream }}>
            vendua.com.br
          </Rise>
          <br />
          <Rise p={prog(t, E.handle, 0.35, ease.outExpo)} style={{ fontWeight: 700, fontSize: 48, color: C.muted, marginTop: 12 }}>
            @vendua.digital
          </Rise>
        </div>
      </div>
    </AbsoluteFill>
  );
};
