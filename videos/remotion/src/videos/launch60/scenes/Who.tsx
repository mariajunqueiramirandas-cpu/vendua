import { AbsoluteFill } from 'remotion';
import { C, FONT } from '../../../lib/brand';
import { ease, prog } from '../../../lib/motion';
import { Rise } from '../../../lib/text';
import { display } from '../kit';
import { SCENES, VO } from '../timeline';

const END = SCENES.who[1];
const START = VO.who.words[0].t0;
// the four trades as stickers, each slapped on with its word
const TRADES = [
  ['🎂', 'doceiras', C.lime, C.forest, -4],
  ['🍱', 'marmitarias', C.cream, C.forest, 3],
  ['🍔', 'hamburguerias', C.forest, C.lime, -2],
  ['🥖', 'padarias', C.lime, C.forest, 4],
] as const;
const AT = VO.who.words.filter((w) => !/^(pra|e)$/i.test(w.w)).map((w) => w.t0);

// "Pra doceiras, marmitarias, hamburguerias e padarias:"
export const Who: React.FC<{ t: number }> = ({ t }) => {
  const out = prog(t, END - 0.28, 0.28, ease.inCubic);
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 80, top: 300, ...display(120, C.muted), opacity: 1 - out }}>
        <Rise p={prog(t, START, 0.3, ease.outExpo)}>Pra</Rise>
      </div>
      {TRADES.map(([emoji, word, bg, fg, rot], i) => {
        const at = AT[i];
        if (t < at) return null;
        const p = prog(t, at, 0.3, ease.outBack);
        return (
          <div
            key={word}
            style={{
              position: 'absolute',
              left: i % 2 ? 150 : 80,
              top: 480 + i * 240,
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              padding: '22px 46px 30px 34px',
              borderRadius: 40,
              background: bg,
              boxShadow: '0 30px 70px rgba(0,0,0,0.45)',
              transformOrigin: '30% 50%',
              transform: `translateX(${out * (i % 2 ? 1 : -1) * 1300}px) rotate(${rot + (1 - p) * 14}deg) scale(${1.6 - 0.6 * p})`,
              opacity: Math.min(1, p * 3),
            }}
          >
            <span style={{ fontSize: 110, lineHeight: 1 }}>{emoji}</span>
            <span style={{ ...display(104, fg), fontFamily: FONT.display }}>{word}</span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
