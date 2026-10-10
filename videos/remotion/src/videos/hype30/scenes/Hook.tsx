import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, kick, prog, tw } from '../../../lib/motion';
import { Chars, split } from '../../../lib/text';
import { G, SCENES, T } from '../timeline';

const H = T.hook;
const SUB = 'Doce, marmita, hambúrguer, pão.';

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
  const p = prog(t, start + i * 0.032, 0.5, ease.outExpo);
  return {
    transform: `perspective(1200px) translateZ(${(1 - p) * -900}px) translateY(${(1 - p) * 90}px) rotateX(${(1 - p) * -95}deg)`,
    opacity: Math.min(1, p * 3),
  };
};

export const Hook: React.FC<{ t: number }> = ({ t }) => {
  const answer = t >= H.line2;
  // a small punch on every beat of the answer bar
  const beatK = answer ? kick(t, H.line2 + Math.floor((t - H.line2) / G.beat) * G.beat, 0.25) : 0;
  const exit = prog(t, H.exit, SCENES.hook[1] - H.exit, ease.inCubic);
  const slam = (s: number) => {
    const p = prog(t, s, 0.28, ease.outExpo);
    return { transform: `scale(${1.7 - 0.7 * p})`, filter: `blur(${(1 - p) * 18}px)`, opacity: Math.min(1, p * 4) };
  };
  const scribble = prog(t, H.scribble, 0.32, ease.outCubic);

  return (
    <AbsoluteFill>
      {!answer ? (
        <div style={{ position: 'absolute', left: 72, top: 660 }}>
          <div style={{ ...display(250, C.cream), textShadow: split(kick(t, H.line1 + 0.15, 0.5)) }}>
            <Chars text="Você" char={flyIn(t, H.line1 - 0.12)} />
          </div>
          <div style={{ ...display(250, C.cream), marginTop: 10 }}>
            <Chars text="cozinha." char={flyIn(t, H.line1 + 0.02)} />
          </div>
          <div style={{ fontFamily: FONT.body, fontWeight: 600, fontSize: 54, color: C.muted, marginTop: 56 }}>
            {SUB.slice(0, Math.max(0, Math.floor((t - H.sub) / 0.022)))}
          </div>
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            left: 72,
            top: 620,
            transformOrigin: '40% 50%',
            transform: `scale(${(1 + beatK * 0.035) * (1 + exit * 5)})`,
            filter: `blur(${exit * 24}px)`,
            opacity: 1 - tw(t, SCENES.hook[1] - 0.12, SCENES.hook[1], 0, 1),
          }}
        >
          <div style={{ ...display(240, C.forest), transformOrigin: '0% 100%', ...slam(H.line2) }}>A gente</div>
          <div style={{ position: 'relative', display: 'inline-block', marginTop: 20 }}>
            <div style={{ ...display(300, C.forest), transformOrigin: '0% 100%', ...slam(H.line2 + G.beat / 2) }}>vende.</div>
            <svg
              viewBox="0 0 900 120"
              preserveAspectRatio="none"
              style={{ position: 'absolute', left: -10, top: '96%', width: '104%', height: 110, overflow: 'visible' }}
            >
              <path
                d="M10 70 C 180 30, 360 95, 520 55 S 800 40, 890 62"
                fill="none"
                stroke={C.forest}
                strokeWidth={20}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - scribble}
              />
            </svg>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
