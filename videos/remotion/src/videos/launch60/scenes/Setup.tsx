import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { rng } from '../../../lib/random';
import { PHONE, camAt, Device } from '../kit';
import { CLOCK, SCENES, SHOTS, T } from '../timeline';

const S = T.setup;
const START = SCENES.setup[0];

// An hour on a dial, run in a second: the lime arc fills while the minutes count up.
const Clock: React.FC<{ t: number }> = ({ t }) => {
  const [a, b] = CLOCK;
  const inP = prog(t, a - 0.1, 0.3, ease.outBack);
  const outP = prog(t, b - 0.12, 0.2, ease.inCubic);
  if (t < a - 0.1 || outP >= 1) return null;
  const k = tw(t, a, b - 0.15, 0, 1, ease.inOutCubic);
  const R = 230;
  const L = 2 * Math.PI * R;
  const min = Math.round(k * 60);
  return (
    <div
      style={{
        position: 'absolute',
        left: 540 - 300,
        top: 860 - 300,
        width: 600,
        height: 600,
        borderRadius: 300,
        background: 'rgba(10,16,13,0.88)',
        boxShadow: '0 40px 120px rgba(0,0,0,0.6)',
        transform: `scale(${(0.5 + 0.5 * inP) * (1 - outP * 0.4)})`,
        opacity: 1 - outP,
      }}
    >
      <svg viewBox="0 0 600 600" width={600} height={600} style={{ position: 'absolute', inset: 0 }}>
        {Array.from({ length: 12 }, (_, i) => {
          const ang = (i / 12) * Math.PI * 2;
          return (
            <line
              key={i}
              x1={300 + Math.sin(ang) * 262}
              y1={300 - Math.cos(ang) * 262}
              x2={300 + Math.sin(ang) * 278}
              y2={300 - Math.cos(ang) * 278}
              stroke={C.muted}
              strokeWidth={6}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx={300} cy={300} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={26} />
        <circle
          cx={300}
          cy={300}
          r={R}
          fill="none"
          stroke={C.lime}
          strokeWidth={26}
          strokeLinecap="round"
          strokeDasharray={`${L * k} ${L}`}
          transform="rotate(-90 300 300)"
        />
        <line
          x1={300}
          y1={300}
          x2={300 + Math.sin(k * Math.PI * 2) * 190}
          y2={300 - Math.cos(k * Math.PI * 2) * 190}
          stroke={C.cream}
          strokeWidth={12}
          strokeLinecap="round"
        />
        <circle cx={300} cy={300} r={16} fill={C.cream} />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 380,
          textAlign: 'center',
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: 92,
          letterSpacing: '-0.04em',
          color: k >= 1 ? C.lime : C.cream,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {k >= 1 ? '1 hora' : `${min} min`}
      </div>
    </div>
  );
};

// The store goes live: a burst of lime and cream from the finale's hero.
const Burst: React.FC<{ t: number; at: number }> = ({ t, at }) => {
  if (t < at || t > at + 1.2) return null;
  const r = rng(46);
  const k = (t - at) / 1.2;
  return (
    <>
      {Array.from({ length: 70 }, (_, i) => {
        const ang = r() * Math.PI * 2;
        const v = 500 + r() * 700;
        const x = 540 + Math.cos(ang) * v * k;
        const y = 640 + Math.sin(ang) * v * k + 900 * k * k;
        const w = 22 + r() * 26;
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: w * (0.4 + r() * 0.6),
              borderRadius: r() > 0.5 ? w : 4,
              background: [C.lime, C.cream, '#5fe0c8'][i % 3],
              transform: `rotate(${(r() - 0.5) * 720 * k}deg)`,
              opacity: 1 - k ** 3,
            }}
          />
        );
      })}
    </>
  );
};

// "Pra começar, é só responder umas perguntas: em cerca de uma hora, a sua loja tá no ar": the
// real onboarding, Duá's questions with the store card filling in, then its finale.
export const Setup: React.FC<{ t: number }> = ({ t }) => {
  const enter = prog(t, START, 0.5, ease.outExpo);
  const live = t >= SHOTS.noar.from;
  const cam = camAt(t, [
    [START, { x: 187, y: 330, z: 1.02, rx: 6, ry: -10 }],
    [S.responder - 0.75, { x: 187, y: 560, z: 0.95, ry: -4 }, 0.5],
    [S.responder + 0.1, { x: 187, y: 330, z: 1.0, ry: 4 }, 0.4],
    [SHOTS.noar.from, { x: 187, y: 220, z: 1.25, ry: -6 }, 0.01],
    [S.ar - 0.3, { x: 187, y: 260, z: 1.05, ry: 2 }, 0.6],
  ]);
  const clockDim = t >= CLOCK[0] - 0.1 && t < CLOCK[1] ? prog(t, CLOCK[0] - 0.1, 0.25) : 0;
  const pop = live ? prog(t, SHOTS.noar.from, 0.35, ease.outExpo) : 1;
  return (
    <AbsoluteFill>
      <Device
        shot={live ? SHOTS.noar : SHOTS.monta}
        t={t}
        width={PHONE}
        cx={540}
        cy={1100 + (1 - enter) * 1200}
        cam={{ ...cam, z: cam.z * (1 - clockDim * 0.12) * (0.85 + 0.15 * pop), rx: (cam.rx ?? 0) + (1 - enter) * 35 }}
        style={{ filter: clockDim ? `brightness(${1 - clockDim * 0.55}) blur(${clockDim * 6}px)` : 'none' }}
      />
      <Clock t={t} />
      <Burst t={t} at={S.ar} />
      {t >= S.ar && (
        <AbsoluteFill style={{ background: `radial-gradient(600px 600px at 540px 700px, rgba(217,248,117,${0.35 * kick(t, S.ar, 0.6)}), transparent 70%)` }} />
      )}
    </AbsoluteFill>
  );
};
