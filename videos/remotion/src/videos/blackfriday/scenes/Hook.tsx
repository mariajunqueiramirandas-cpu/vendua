import { AbsoluteFill } from 'remotion';
import { C } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { F, T } from '../timeline';
import { display, Words } from '../ui';

// "Atenção, quem vende comida!" — the call-out lands at once; the last word is a reel that spins
// through the stores Venduá is for and locks on "comida".
const REEL = ['doce.', 'marmita.', 'hambúrguer.', 'pão.'];
const LINE = 168;

export const Hook: React.FC<{ t: number }> = ({ t }) => {
  const w = F.hook.w;
  const slam = prog(t, 0, 0.32, ease.outExpo);
  const bar = prog(t, 0.12, 0.38, ease.outExpo);
  const spin = T.hook.roll.reduce((k, r, i) => (t >= r ? i : k), -1);
  const locked = t >= T.hook.lock;
  const lockK = kick(t, T.hook.lock, 0.3);
  const word = locked ? 'comida.' : spin >= 0 ? REEL[spin] : '';
  const since = locked ? t - T.hook.lock : spin >= 0 ? t - T.hook.roll[spin] : 0;
  const slide = tw(since, 0, locked ? 0.16 : 0.05, 1, 0, locked ? ease.outBack : ease.outCubic);

  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 72, top: 640 }}>
        <div
          style={{
            ...display(196, C.cream),
            transformOrigin: '0% 100%',
            transform: `scale(${1.16 - 0.16 * slam})`,
            filter: `blur(${(1 - slam) * 10}px)`,
            opacity: Math.min(1, slam * 3),
            display: 'inline-block',
          }}
        >
          Atenção,
          <div style={{ height: 18, marginTop: 18, borderRadius: 9, background: C.lime, width: `${bar * 100}%` }} />
        </div>
        <Words t={t} words={[['quem', w.quem], ['vende', w.vende]]} style={{ ...display(132, C.cream), marginTop: 70 }} />
        <div style={{ position: 'relative', height: LINE * 1.1, overflow: 'hidden', marginTop: 6 }}>
          <div
            style={{
              ...display(LINE, C.lime),
              position: 'absolute',
              left: 0,
              top: 0,
              whiteSpace: 'nowrap',
              transform: `translateY(${slide * 100}%) scale(${1 + lockK * 0.05})`,
              transformOrigin: '0% 60%',
              filter: !locked && spin >= 0 ? 'blur(1.5px)' : 'none',
            }}
          >
            {word}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
