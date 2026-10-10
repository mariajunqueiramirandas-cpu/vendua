import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { Shader } from '../../../lib/gl';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { MARK3D } from '../../../lib/shaders';
import { Rise } from '../../../lib/text';
import { T } from '../timeline';

const K = T.cta;

const slam = (t: number, s: number, from = 1.6) => {
  const p = prog(t, s, 0.26, ease.outExpo);
  return { transform: `scale(${from - (from - 1) * p})`, filter: `blur(${(1 - p) * 16}px)`, opacity: t >= s ? 1 : 0 };
};

export const Cta: React.FC<{ t: number }> = ({ t }) => {
  const iris = tw(t, K.iris, K.end, 0, 1, ease.inCubic);
  const marker = prog(t, K.line2 + 0.05, 0.2, ease.outCubic);
  const land = prog(t, K.iris, 0.9, ease.outExpo);
  const ring = prog(t, K.end, 0.7, ease.outCubic);
  const breathe = 1 + 0.01 * Math.sin((t - K.end) * 2.2);

  return (
    <AbsoluteFill>
      {t < K.end && (
        <div style={{ position: 'absolute', top: 420, left: 72, right: 72, color: C.forest }}>
          <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 250, letterSpacing: '-0.055em', lineHeight: 0.88, transformOrigin: '0% 100%', ...slam(t, K.line1) }}>
            14 dias
          </div>
          <div style={{ position: 'relative', display: 'inline-block', marginTop: 14, ...slam(t, K.line2) }}>
            <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 250, letterSpacing: '-0.055em', lineHeight: 0.88, padding: '0 24px 24px' }}>grátis.</div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 30,
                background: C.forest,
                color: C.lime,
                clipPath: `inset(0 ${100 - marker * 100}% 0 0 round 30px)`,
                fontFamily: FONT.display,
                fontWeight: 700,
                fontSize: 250,
                letterSpacing: '-0.055em',
                lineHeight: 0.88,
                padding: '0 24px 24px',
              }}
            >
              grátis.
            </div>
          </div>
          <div style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: 100, marginTop: 40 }}>
            <Rise p={prog(t, K.noCard, 0.3, ease.outExpo)}>Sem cartão.</Rise>
          </div>
          <div
            style={{
              display: 'inline-block',
              marginTop: 30,
              padding: '14px 34px',
              borderRadius: 99,
              background: C.forest,
              color: C.lime,
              fontFamily: FONT.body,
              fontWeight: 700,
              fontSize: 46,
              transform: `scale(${tw(t, K.pill, K.pill + 0.3, 0, 1, ease.outBack)})`,
              transformOrigin: '0% 50%',
            }}
          >
            no Venduá Bandeira
          </div>
        </div>
      )}
      {t >= K.iris && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(900px 900px at 50% 38%, ${C.forest} 0%, ${C.night} 70%)`,
            clipPath: t < K.end ? `circle(${iris * 1150}px at 540px 960px)` : 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 540 - 140,
              top: 590 - 140,
              width: 280,
              height: 280,
              borderRadius: 140,
              border: `6px solid ${C.lime}`,
              transform: `scale(${0.6 + ring * 1.9})`,
              opacity: t >= K.end ? (1 - ring) * 0.9 : 0,
            }}
          />
          <div style={{ transform: `scale(${breathe})`, transformOrigin: '540px 900px', position: 'absolute', inset: 0 }}>
            <Shader
              frag={MARK3D}
              width={520}
              height={520}
              style={{ left: 280, top: 330 }}
              uniforms={{
                uRot: [0.1 * Math.sin(t * 1.2), (1 - land) * -Math.PI * 3 + 0.2 * Math.sin(t * 0.9), -0.04],
                uSize: tw(t, K.iris, K.iris + 0.45, 0.3, 1, ease.outBack) * (1 + kick(t, K.end, 0.35) * 0.06),
                uLight: kick(t, K.end, 0.6),
              }}
            />
            <div style={{ position: 'absolute', top: 800, width: '100%', textAlign: 'center', fontFamily: FONT.display, fontWeight: 700, fontSize: 210, letterSpacing: '-0.06em', color: C.cream, lineHeight: 1 }}>
              venduá<span style={{ color: C.lime }}>.</span>
            </div>
            <div style={{ position: 'absolute', top: 1090, width: '100%', textAlign: 'center', fontFamily: FONT.body }}>
              <Rise p={prog(t, K.url, 0.35, ease.outExpo)} style={{ fontWeight: 700, fontSize: 72, color: C.cream }}>
                vendua.com.br
              </Rise>
              <br />
              <Rise p={prog(t, K.tag, 0.35, ease.outExpo)} style={{ fontWeight: 600, fontSize: 48, color: C.muted, marginTop: 14 }}>
                14 dias grátis no Bandeira · sem cartão
              </Rise>
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
