import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import '../../lib/fonts';
import { C } from '../../lib/brand';
import { Grain } from '../../lib/grain';
import { kick, shake } from '../../lib/motion';
import { Captions } from './Captions';
import { Cta } from './scenes/Cta';
import { Day } from './scenes/Day';
import { Dua } from './scenes/Dua';
import { Hook } from './scenes/Hook';
import { Launch } from './scenes/Launch';
import { Order } from './scenes/Order';
import { Pain } from './scenes/Pain';
import { Price } from './scenes/Price';
import { Setup } from './scenes/Setup';
import { Shop } from './scenes/Shop';
import { What } from './scenes/What';
import { Who } from './scenes/Who';
import { BIG_HITS, G, HITS, SCENES, type LineId } from './timeline';
import { World } from './World';

// 60 s, 9:16, for Instagram Reels: the launch on Saturday 24/10. Narrated (lines.ts), and the
// product is the real admin and storefront, filmed by scripts/capture-ui.mjs. Picture, score and
// voice share timeline.ts.
const SEQ: [LineId, React.FC<{ t: number }>][] = [
  ['hook', Hook],
  ['pain', Pain],
  ['launch', Launch],
  ['who', Who],
  ['what', What],
  ['shop', Shop],
  ['order', Order],
  ['dua', Dua],
  ['day', Day],
  ['setup', Setup],
  ['price', Price],
  ['cta', Cta],
];

export const Launch60: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / G.fps;
  const big = BIG_HITS.reduce((m, h) => Math.max(m, kick(t, h, 0.18)), 0);
  const s = shake(t, HITS, 12 + 18 * big, 0.3);

  return (
    <AbsoluteFill style={{ background: C.night, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg) scale(1.03)` }}>
        <World t={t} />
        {SEQ.map(([id, Scene]) => (
          <Sequence key={id} name={id} from={G.f(SCENES[id][0])} durationInFrames={G.f(SCENES[id][1]) - G.f(SCENES[id][0])}>
            <Scene t={t} />
          </Sequence>
        ))}
        <Captions t={t} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.cream, opacity: big * 0.5, mixBlendMode: 'screen' }} />
      <Grain frame={frame} opacity={0.06} />
      <Audio src={staticFile('launch60/score.wav')} />
    </AbsoluteFill>
  );
};
