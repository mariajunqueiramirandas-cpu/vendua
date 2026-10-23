import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { Shader } from '../../../lib/gl';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { MARK3D } from '../../../lib/shaders';
import { Rise } from '../../../lib/text';
import { display, slam } from '../kit';
import { T, VO } from '../timeline';

const K = T.cta;
const GRATIS = VO.cta.words.find((w) => w.w.startsWith('grátis'))!.t0;
const IRIS = K.end - 0.35;

// "Sábado, começa com 14 dias grátis, sem cartão. Link na bio!", then the end card: the name,
// the date and the offer, held to the last frame.
export const Cta: React.FC<{ t: number }> = ({ t }) => {
  const marker = prog(t, GRATIS + 0.05, 0.22, ease.outCubic);
  const iris = tw(t, IRIS, K.end, 0, 1, ease.inCubic);
  const land = prog(t, IRIS, 0.9, ease.outExpo);
  const ring = prog(t, K.end, 0.7, ease.outCubic);
  const bob = Math.sin((t - K.link) * 9) * 14;
  const line = (at: number) => prog(t, at, 0.35, ease.outExpo);
  return (
    <AbsoluteFill>
      {t < K.end && (
        <div style={{ position: 'absolute', top: 290, left: 72, right: 72, color: C.forest }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 30 }}>
            <div style={{ ...display(190, C.forest), transformOrigin: '0% 100%', ...slam(t, K.sabado) }}>Sábado</div>
            <div
              style={{
                marginBottom: 14,
                padding: '10px 30px 16px',
                borderRadius: 99,
                background: C.forest,
                ...display(84, C.lime),
                ...slam(t, K.sabado + 0.25, 1.5),
              }}
            >
              24/10
            </div>
          </div>
          <div style={{ ...display(250, C.forest), marginTop: 40, transformOrigin: '0% 100%', ...slam(t, K.dias) }}>14 dias</div>
          <div style={{ position: 'relative', display: 'inline-block', marginTop: 10, ...slam(t, GRATIS) }}>
            <div style={{ ...display(250, C.forest), padding: '0 24px 26px' }}>grátis</div>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 30,
                background: C.forest,
                clipPath: `inset(0 ${100 - marker * 100}% 0 0 round 30px)`,
                ...display(250, C.lime),
                padding: '0 24px 26px',
              }}
            >
              grátis
            </div>
          </div>
          <div style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: 96, marginTop: 34 }}>
            <Rise p={line(K.sem)}>sem cartão.</Rise>
          </div>
          {t >= K.link && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 22,
                marginTop: 44,
                padding: '20px 44px 26px',
                borderRadius: 99,
                background: C.forest,
                color: C.lime,
                fontFamily: FONT.body,
                fontWeight: 800,
                fontSize: 62,
                transformOrigin: '0% 50%',
                transform: `scale(${tw(t, K.link, K.link + 0.3, 0, 1, ease.outBack)})`,
              }}
            >
              Link na bio
              <svg viewBox="0 0 64 64" width={62} height={62} style={{ transform: `translateY(${bob}px)` }}>
                <path d="M32 10 V50 M14 34 L32 52 L50 34" fill="none" stroke={C.lime} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          )}
        </div>
      )}
      {t >= IRIS && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(900px 900px at 50% 36%, ${C.forest} 0%, ${C.night} 70%)`,
            clipPath: t < K.end ? `circle(${iris * 1250}px at 540px 960px)` : 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 540 - 140,
              top: 560 - 140,
              width: 280,
              height: 280,
              borderRadius: 140,
              border: `6px solid ${C.lime}`,
              transform: `scale(${0.6 + ring * 1.9})`,
              opacity: t >= K.end ? (1 - ring) * 0.9 : 0,
            }}
          />
          <div style={{ position: 'absolute', inset: 0, transform: `scale(${1 + 0.01 * Math.sin((t - K.end) * 2.2)})`, transformOrigin: '540px 900px' }}>
            <Shader
              frag={MARK3D}
              width={440}
              height={440}
              style={{ left: 320, top: 340 }}
              uniforms={{
                uRot: [0.1 * Math.sin(t * 1.2), (1 - land) * -Math.PI * 3 + 0.2 * Math.sin(t * 0.9), -0.04],
                uSize: tw(t, IRIS, IRIS + 0.45, 0.3, 1, ease.outBack) * (1 + kick(t, K.end, 0.35) * 0.06),
                uLight: kick(t, K.end, 0.6),
              }}
            />
            <div style={{ position: 'absolute', top: 770, width: '100%', textAlign: 'center', ...display(200, C.cream), letterSpacing: '-0.06em', lineHeight: 1 }}>
              venduá<span style={{ color: C.lime }}>.</span>
            </div>
            <div style={{ position: 'absolute', top: 1010, width: '100%', textAlign: 'center', fontFamily: FONT.body }}>
              <Rise p={line(K.end + 0.1)} style={{ fontWeight: 800, fontSize: 70, color: C.cream }}>
                Lançamento: sábado, 24/10
              </Rise>
              <br />
              <Rise p={line(K.end + 0.25)} style={{ fontWeight: 700, fontSize: 52, color: C.lime, marginTop: 18 }}>
                14 dias grátis · sem cartão
              </Rise>
              <br />
              <Rise p={line(K.end + 0.4)} style={{ fontWeight: 600, fontSize: 46, color: C.muted, marginTop: 26 }}>
                Link na bio · @vendua.digital
              </Rise>
            </div>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
