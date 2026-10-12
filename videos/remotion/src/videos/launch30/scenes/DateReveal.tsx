import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Rise, split } from '../../../lib/text';
import { LAUNCH, SCENES, T, ZERO } from '../timeline';

const D = T.date;
const END = SCENES.date[1];
const SIZE = 330;

// A slot reel that spins from ignition and locks on `digit` at `lock`, overshooting a touch.
const Reel: React.FC<{ t: number; digit: number; lock: number }> = ({ t, digit, lock }) => {
  const start = T.ready.ignite;
  const p = prog(t, start, lock - start, ease.outCubic);
  const settle = t >= lock ? Math.sin(Math.min(1, (t - lock) / 0.25) * Math.PI) * 0.12 * (1 - Math.min(1, (t - lock) / 0.25)) : 0;
  const idx = digit + 30 - p * 30 - settle;
  const blur = t < lock ? Math.min(14, (1 - p) * 40) : 0;
  return (
    <span style={{ display: 'inline-block', height: SIZE, overflow: 'hidden', lineHeight: 1, verticalAlign: 'top' }}>
      <span style={{ display: 'block', transform: `translateY(${-(idx - Math.floor(idx / 10) * 10 + 10) * SIZE}px)` }}>
        {Array.from({ length: 30 }, (_, k) => (
          <span key={k} style={{ display: 'block', height: SIZE, opacity: blur ? 0.55 + 0.45 * (1 - blur / 14) : 1 }}>
            {k % 10}
          </span>
        ))}
      </span>
    </span>
  );
};

export const DateReveal: React.FC<{ t: number }> = ({ t }) => {
  const pill = prog(t, D.pill, 0.26, ease.outExpo);
  const yearP = prog(t, D.year, 0.26, ease.outExpo);
  const fill = prog(t, D.year + 0.12, 0.45, ease.inOutCubic);
  const exit = prog(t, D.exit, END - D.exit, ease.inExpo);
  const push = tw(t, ZERO, D.exit, 1, 1.06, ease.linear);
  const hit = kick(t, ZERO, 0.5);
  const digits = [LAUNCH.day[0], LAUNCH.day[1], LAUNCH.month[0], LAUNCH.month[1]].map(Number);
  const locked = D.digits.filter((s) => t >= s).length;
  const punch = D.digits.reduce((m, s) => Math.max(m, kick(t, s, 0.22)), 0);

  return (
    <AbsoluteFill style={{ transform: `scale(${push * (1 + exit * 3)})`, filter: exit > 0 ? `blur(${exit * 24}px)` : 'none', opacity: 1 - tw(t, END - 0.08, END, 0, 1), transformOrigin: '540px 900px' }}>
      <AbsoluteFill style={{ background: `radial-gradient(620px 520px at 50% 47%, rgba(10,16,13,${0.55 + 0.2 * (1 - hit)}), transparent 75%)` }} />
      <div style={{ position: 'absolute', top: 430, width: '100%', textAlign: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '16px 40px',
            borderRadius: 99,
            background: C.lime,
            color: C.forest,
            fontFamily: FONT.display,
            fontWeight: 700,
            fontSize: 50,
            letterSpacing: '0.14em',
            transform: `scale(${2.2 - 1.2 * pill})`,
            opacity: Math.min(1, pill * 3),
            boxShadow: `0 0 ${90 * hit}px ${C.lime}`,
          }}
        >
          LANÇAMENTO OFICIAL
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          top: 600,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          fontFamily: FONT.display,
          fontWeight: 700,
          fontSize: SIZE,
          letterSpacing: '-0.04em',
          fontVariantNumeric: 'tabular-nums',
          color: C.lime,
          textShadow: split(punch, 16),
          transform: `scale(${1 + punch * 0.04})`,
        }}
      >
        <Reel t={t} digit={digits[0]} lock={D.digits[0]} />
        <Reel t={t} digit={digits[1]} lock={D.digits[1]} />
        <span style={{ color: C.cream, opacity: locked >= 2 ? 1 : 0.25, lineHeight: 1 }}>.</span>
        <Reel t={t} digit={digits[2]} lock={D.digits[2]} />
        <Reel t={t} digit={digits[3]} lock={D.digits[3]} />
      </div>
      <div style={{ position: 'absolute', top: 960, width: '100%', textAlign: 'center' }}>
        <span style={{ position: 'relative', display: 'inline-block', fontFamily: FONT.display, fontWeight: 700, fontSize: 290, letterSpacing: '-0.05em', lineHeight: 1, transform: `scale(${1.7 - 0.7 * yearP})`, opacity: t >= D.year ? Math.min(1, yearP * 4) : 0, filter: `blur(${(1 - yearP) * 16}px)` }}>
          <span style={{ color: 'transparent', WebkitTextStroke: `5px ${C.cream}` }}>{LAUNCH.year}</span>
          <span style={{ position: 'absolute', left: 0, top: 0, color: C.cream, clipPath: `inset(0 ${100 - fill * 100}% 0 0)` }}>{LAUNCH.year}</span>
        </span>
      </div>
      <div style={{ position: 'absolute', top: 1300, width: '100%', textAlign: 'center', fontFamily: FONT.body, fontWeight: 800, fontSize: 60, color: C.cream, lineHeight: 1.2 }}>
        <Rise p={prog(t, D.weekday, 0.35, ease.outExpo)}>
          {LAUNCH.weekday[0].toUpperCase() + LAUNCH.weekday.slice(1)}.
        </Rise>
        <br />
        <Rise p={prog(t, D.weekday + 0.1, 0.35, ease.outExpo)} style={{ color: C.lime }}>
          Marque na agenda.
        </Rise>
      </div>
    </AbsoluteFill>
  );
};
