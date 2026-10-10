import { AbsoluteFill } from 'remotion';
import { C, FONT, H, W } from '../../../lib/brand';
import { Shader } from '../../../lib/gl';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { ParticleText } from '../../../lib/particles';
import { MARK3D } from '../../../lib/shaders';
import { Rise } from '../../../lib/text';
import { SCENES, T } from '../timeline';

const B = T.brand;
const END = SCENES.brand[1];

export const Brand: React.FC<{ t: number }> = ({ t }) => {
  const e = prog(t, B.explode, END - B.explode, ease.linear);
  const land = prog(t, B.mark, 0.9, ease.outExpo);
  const size = tw(t, B.mark, B.mark + 0.5, 0, 1, ease.outBack);
  const tag = (s: number) => prog(t, s, 0.4, ease.outExpo);

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(700px 420px at 50% 50%, rgba(217,248,117,${0.16 * prog(t, B.converge + 0.5, 0.6)}), transparent 70%)`,
        }}
      />
      <ParticleText
        text="venduá"
        font="700 250px 'Space Grotesk'"
        width={W}
        height={H}
        center={[540, 960]}
        count={18000}
        colors={[C.lime, C.cream]}
        p={prog(t, B.converge, 1.15, ease.linear)}
        e={e}
        t={t}
        size={3.4}
      />
      <div style={{ opacity: 1 - e, transform: `scale(${1 + e * e * 3})`, filter: `blur(${e * 14}px)`, transformOrigin: '540px 640px' }}>
        <Shader
          frag={MARK3D}
          width={560}
          height={560}
          style={{ left: 260, top: 360 }}
          uniforms={{
            uRot: [0.12 * Math.sin(t * 1.3), (1 - land) * Math.PI * 4 + 0.25 * Math.sin(t * 0.9) + e * 3, -0.05],
            uSize: size,
            uLight: kick(t, B.mark + 0.45, 0.5),
          }}
        />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 1170,
          width: '100%',
          textAlign: 'center',
          fontFamily: FONT.body,
          fontWeight: 700,
          fontSize: 70,
          lineHeight: 1.15,
          color: C.cream,
          opacity: 1 - e,
          transform: `scale(${1 + e * 0.6})`,
          filter: `blur(${e * 12}px)`,
        }}
      >
        <Rise p={tag(B.tag1)}>Sua loja online</Rise>
        <br />
        <Rise p={tag(B.tag2)}>
          com vendedor de <span style={{ color: C.lime }}>IA.</span>
        </Rise>
      </div>
    </AbsoluteFill>
  );
};
