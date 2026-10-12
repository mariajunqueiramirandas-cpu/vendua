import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Chars, split } from '../../../lib/text';
import { SCENES, T } from '../timeline';

const K = T.hook;
const END = SCENES.hook[1];
const SCAN = 'verificando sistemas…';

const display = (size: number, color: string): React.CSSProperties => ({
  fontFamily: FONT.display,
  fontWeight: 700,
  fontSize: size,
  lineHeight: 0.9,
  letterSpacing: '-0.05em',
  color,
});

// Letters fly in from behind the screen, flipping up: frame 0 is already mid-flight.
const flyIn = (t: number, start: number) => (i: number): React.CSSProperties => {
  const p = prog(t, start + i * 0.03, 0.5, ease.outExpo);
  return {
    transform: `perspective(1200px) translateZ(${(1 - p) * -900}px) translateY(${(1 - p) * 90}px) rotateX(${(1 - p) * -95}deg)`,
    opacity: Math.min(1, p * 3),
  };
};

const slam = (t: number, s: number, from = 1.7) => {
  const p = prog(t, s, 0.28, ease.outExpo);
  return { transform: `scale(${from - (from - 1) * p})`, filter: `blur(${(1 - p) * 18}px)`, opacity: t >= s ? Math.min(1, p * 4) : 0 };
};

export const Hook: React.FC<{ t: number }> = ({ t }) => {
  const second = t >= K.seq;
  const exit = prog(t, K.exit, END - K.exit, ease.inExpo);

  if (!second) {
    return (
      <AbsoluteFill>
        <div style={{ position: 'absolute', left: 72, top: 600 }}>
          <div style={{ ...display(260, C.cream), textShadow: split(kick(t, 0.12, 0.5)) }}>
            <Chars text="Algo" char={flyIn(t, -0.12)} />
          </div>
          <div style={{ ...display(260, C.cream), marginTop: 6 }}>
            <Chars text="grande" char={flyIn(t, 0.02)} />
          </div>
          <div style={{ ...display(260, C.lime), marginTop: 6, transformOrigin: '0% 100%', ...slam(t, K.line2) }}>vem aí.</div>
        </div>
      </AbsoluteFill>
    );
  }

  const bar = prog(t, K.scan, K.exit - K.scan, ease.inOutCubic);
  const typed = SCAN.slice(0, Math.max(0, Math.floor((t - K.scan) / 0.025)));
  return (
    <AbsoluteFill
      style={{
        transformOrigin: '50% 48%',
        transform: `scale(${1 + exit * 4})`,
        filter: `blur(${exit * 22}px)`,
        opacity: 1 - tw(t, END - 0.1, END, 0, 1),
      }}
    >
      <div style={{ position: 'absolute', left: 72, right: 72, top: 640 }}>
        <div style={{ ...display(124, C.cream), transformOrigin: '0% 100%', ...slam(t, K.seq, 1.5) }}>Sequência de</div>
        <div style={{ ...display(176, C.lime), marginTop: 8, transformOrigin: '0% 100%', textShadow: split(kick(t, K.seq + 0.1, 0.45), 14), ...slam(t, K.seq + 0.06, 1.6) }}>lançamento</div>
        <div style={{ marginTop: 70, fontFamily: FONT.display, fontWeight: 500, fontSize: 46, letterSpacing: '0.04em', color: C.muted, height: 60 }}>
          {typed}
          {t >= K.scan && <span style={{ color: C.lime, opacity: Math.floor(t * 8) % 2 ? 1 : 0.2 }}>▍</span>}
        </div>
        <div style={{ marginTop: 26, height: 14, borderRadius: 7, background: 'rgba(247,244,234,0.12)', overflow: 'hidden', opacity: t >= K.scan ? 1 : 0 }}>
          <div style={{ width: `${bar * 100}%`, height: '100%', background: C.lime, boxShadow: `0 0 30px ${C.lime}` }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
