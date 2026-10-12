import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { Shader } from '../../../lib/gl';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { MARK3D } from '../../../lib/shaders';
import { SCENES, T } from '../timeline';
import { Words, fadeOut, reveal } from '../ui';

const B = T.brand;

// The mark turns slowly out of the dark and settles; the name, then what it is.
export const Brand: React.FC<{ t: number }> = ({ t }) => {
  const settle = prog(t, B.mark, 2.6, ease.outCubic);
  const word = prog(t, B.word, 1.4, ease.outQuart);
  return (
    <AbsoluteFill style={{ opacity: fadeOut(t, SCENES.brand[1]), transform: `scale(${tw(t, B.mark, SCENES.brand[1] + 0.5, 1, 1.04, ease.linear)})` }}>
      <div style={{ opacity: prog(t, B.mark, 0.9, ease.outCubic) }}>
        <Shader
          frag={MARK3D}
          width={460}
          height={460}
          style={{ left: 310, top: 400 }}
          uniforms={{
            uRot: [0.06 * Math.sin(t * 0.7), (1 - settle) * 1.6 + 0.12 * Math.sin(t * 0.5), -0.03],
            uSize: tw(t, B.mark, B.mark + 1.6, 0.7, 1, ease.outCubic),
            uLight: 0.4 * kick(t, B.mark + 0.3, 1.4),
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 880,
          width: '100%',
          textAlign: 'center',
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: 200,
          letterSpacing: `${-0.06 + (1 - word) * 0.12}em`,
          color: C.cream,
          lineHeight: 1,
          opacity: word,
          filter: word < 0.999 ? `blur(${(1 - word) * 14}px)` : 'none',
        }}
      >
        venduá<span style={{ color: C.lime }}>.</span>
      </div>
      <div style={{ position: 'absolute', top: 1150, left: 96, right: 96, textAlign: 'center', fontFamily: FONT.body, fontWeight: 600, fontSize: 52, lineHeight: 1.3 }}>
        <div style={{ color: C.cream }}>
          <Words t={t} start={B.tag1} text="Uma loja online com a sua cara" />
        </div>
        <div style={{ color: C.muted, ...reveal(t, B.tag2) }}>e um app para tocar o dia.</div>
      </div>
    </AbsoluteFill>
  );
};
