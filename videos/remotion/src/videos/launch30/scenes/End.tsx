import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { Shader } from '../../../lib/gl';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { MARK3D } from '../../../lib/shaders';
import { LAUNCH, T } from '../timeline';
import { reveal } from '../ui';

const E = T.end;

// The signature: the mark, the name, the date, where to find it. Held to the last frame.
export const End: React.FC<{ t: number }> = ({ t }) => {
  const settle = prog(t, E.mark, 2.4, ease.outCubic);
  const line = prog(t, E.date + 0.2, 1.2, ease.inOutCubic);
  return (
    <AbsoluteFill style={{ transform: `scale(${tw(t, E.mark, E.mark + 5, 1.03, 1, ease.outCubic)})` }}>
      <div style={reveal(t, E.mark, 1.4, 30)}>
        <Shader
          frag={MARK3D}
          width={400}
          height={400}
          style={{ left: 340, top: 420 }}
          uniforms={{
            uRot: [0.05 * Math.sin(t * 0.7), (1 - settle) * -1.4 + 0.1 * Math.sin(t * 0.5), -0.03],
            uSize: tw(t, E.mark, E.mark + 1.4, 0.75, 1, ease.outCubic),
            uLight: 0.35 * kick(t, E.mark + 0.2, 1.4),
          }}
        />
      </div>
      <div style={{ position: 'absolute', top: 840, width: '100%', textAlign: 'center', fontFamily: FONT.display, fontWeight: 700, fontSize: 190, letterSpacing: '-0.06em', color: C.cream, lineHeight: 1, ...reveal(t, E.mark + 0.25, 1.3, 30) }}>
        venduá<span style={{ color: C.lime }}>.</span>
      </div>
      <div style={{ position: 'absolute', top: 1090, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28, fontFamily: FONT.display, fontWeight: 600, ...reveal(t, E.date, 1.1, 20) }}>
        <div style={{ height: 3, width: 90 * line, background: C.lime }} />
        <div style={{ fontSize: 30, letterSpacing: '0.3em', color: C.muted }}>LANÇAMENTO</div>
        <div style={{ fontSize: 52, letterSpacing: '0.02em', color: C.lime }}>
          {LAUNCH.day}.{LAUNCH.month}.{LAUNCH.year}
        </div>
        <div style={{ height: 3, width: 90 * line, background: C.lime }} />
      </div>
      <div style={{ position: 'absolute', top: 1220, width: '100%', textAlign: 'center', fontFamily: FONT.body }}>
        <div style={{ fontWeight: 700, fontSize: 60, color: C.cream, ...reveal(t, E.url, 1.0, 20) }}>vendua.com.br</div>
        <div style={{ fontWeight: 600, fontSize: 42, color: C.muted, marginTop: 14, ...reveal(t, E.handle, 1.0, 20) }}>@vendua.digital</div>
      </div>
    </AbsoluteFill>
  );
};
