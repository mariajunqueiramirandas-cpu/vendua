import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { split } from '../../../lib/text';
import { G, T, ZERO } from '../timeline';
import { Check } from './Checks';

const R = T.ready;
// The six systems recapped one per eighth, "prontos", then 3 · 2 · 1 on the beats.
const LIST = ['Loja online', 'Pedidos no celular', 'Pix na hora', 'Cozinha e impressão', 'Cardápio e horários', 'Duá, vendedor com IA'];

const Recap: React.FC<{ t: number }> = ({ t }) => {
  const go = prog(t, R.go, 0.24, ease.outExpo);
  const out = prog(t, R.count[0] - 0.12, 0.12, ease.inCubic);
  return (
    <AbsoluteFill style={{ opacity: 1 - out, transform: `scale(${1 + out * 0.5})`, filter: out > 0 ? `blur(${out * 14}px)` : 'none' }}>
      <div style={{ position: 'absolute', left: 84, right: 84, top: 360, fontFamily: FONT.display, fontWeight: 700, fontSize: 104, letterSpacing: '-0.05em', lineHeight: 1, color: C.cream, transformOrigin: '0% 100%', transform: `scale(${1.4 - 0.4 * prog(t, R.title, 0.25, ease.outExpo)})` }}>
        Todos os sistemas
      </div>
      <div style={{ position: 'absolute', left: 84, right: 84, top: 520 }}>
        {LIST.map((label, k) => {
          const s = R.ticks[k];
          const p = prog(t, s, 0.28, ease.outExpo);
          const c = tw(t, s, s + 0.2, 0, 1, ease.outBack);
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 28, height: 112, opacity: t >= s ? 1 : 0.18, transform: `translateX(${(1 - p) * -80}px)` }}>
              <div style={{ width: 76, height: 76, borderRadius: 38, border: `5px solid ${t >= s ? C.lime : 'rgba(247,244,234,0.3)'}`, background: t >= s ? C.lime : 'transparent', display: 'grid', placeItems: 'center', flex: 'none' }}>
                <div style={{ transform: `scale(${c})` }}>
                  <Check size={52} color={C.forest} stroke={22} />
                </div>
              </div>
              <div style={{ fontFamily: FONT.body, fontWeight: 800, fontSize: 56, color: C.cream }}>{label}</div>
            </div>
          );
        })}
      </div>
      {t >= R.go && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 1230,
            textAlign: 'center',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              padding: '4px 48px 26px',
              borderRadius: 40,
              background: C.lime,
              color: C.forest,
              fontFamily: FONT.display,
              fontWeight: 700,
              fontSize: 190,
              letterSpacing: '-0.05em',
              boxShadow: `0 0 ${80 * kick(t, R.go, 0.6)}px ${C.lime}`,
              transform: `rotate(-4deg) scale(${2 - go})`,
              opacity: Math.min(1, go * 3),
            }}
          >
            prontos.
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};

const Count: React.FC<{ t: number }> = ({ t }) => {
  const k = R.count.reduce<number>((m, s, i) => (t >= s ? i : m), -1);
  if (k < 0) return null;
  const s = R.count[k];
  const next = k < 2 ? R.count[k + 1] : R.ignite;
  const inP = prog(t, s, 0.22, ease.outExpo);
  const grow = tw(t, s, next, 0, 1, ease.linear);
  const fly = prog(t, next - 0.1, 0.1, ease.inCubic);
  // on ignition the "1" blows out towards the camera with the warp
  const blow = k === 2 ? prog(t, R.ignite, ZERO - R.ignite, ease.inExpo) : 0;
  const label = prog(t, R.count[0], 0.3, ease.outExpo);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', top: 380, width: '100%', textAlign: 'center', fontFamily: FONT.display, fontWeight: 700, fontSize: 40, letterSpacing: '0.3em', color: C.lime, opacity: label * (1 - blow), transform: `translateY(${(1 - label) * 30}px)` }}>
        LANÇAMENTO EM
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 420,
          height: 1100,
          display: 'grid',
          placeItems: 'center',
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: 900,
          lineHeight: 1,
          letterSpacing: '-0.06em',
          color: k === 2 ? C.lime : C.cream,
          textShadow: split(kick(t, s, 0.35), 26),
          transform: `scale(${(2.2 - 1.2 * inP) * (1 + grow * 0.12) * (k < 2 ? 1 + fly * 2 : 1 + blow * 6)})`,
          opacity: Math.min(1, inP * 3) * (k < 2 ? 1 - fly : 1 - blow),
          filter: `blur(${(1 - inP) * 20 + (k < 2 ? fly : blow) * 30}px)`,
        }}
      >
        {3 - k}
      </div>
      {/* the first beat of each count rings out from the numeral */}
      <div
        style={{
          position: 'absolute',
          left: 540 - 300,
          top: 970 - 300,
          width: 600,
          height: 600,
          borderRadius: 300,
          border: `8px solid ${C.lime}`,
          transform: `scale(${0.4 + prog(t, s, G.beat, ease.outCubic) * 1.6})`,
          opacity: (1 - prog(t, s, G.beat, ease.outCubic)) * 0.8,
        }}
      />
    </AbsoluteFill>
  );
};

export const Ready: React.FC<{ t: number }> = ({ t }) => (t < R.count[0] ? <Recap t={t} /> : <Count t={t} />);
