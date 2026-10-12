import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import '../../lib/fonts';
import { C } from '../../lib/brand';
import { Grain } from '../../lib/grain';
import { kick, shake } from '../../lib/motion';
import { Hud } from './Hud';
import { Checks } from './scenes/Checks';
import { DateReveal } from './scenes/DateReveal';
import { Dua } from './scenes/Dua';
import { End } from './scenes/End';
import { Hook } from './scenes/Hook';
import { Ready } from './scenes/Ready';
import { BIG_HITS, G, HITS, SCENES } from './timeline';
import { World } from './World';

// 30 s, 9:16, for Instagram Reels and Stories: the launch film for 16.10.2026.
// Picture and score share timeline.ts.
const SEQ = [
  ['hook', Hook],
  ['checks', Checks],
  ['dua', Dua],
  ['ready', Ready],
  ['date', DateReveal],
  ['end', End],
] as const;

export const Launch30: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / G.fps;
  const big = BIG_HITS.reduce((m, h) => Math.max(m, kick(t, h, 0.18)), 0);
  const s = shake(t, HITS, 14 + 22 * big, 0.32);

  return (
    <AbsoluteFill style={{ background: C.night, overflow: 'hidden' }}>
      <AbsoluteFill style={{ transform: `translate(${s.x}px, ${s.y}px) rotate(${s.r}deg) scale(1.03)` }}>
        <World t={t} />
        {SEQ.map(([id, Scene]) => (
          <Sequence key={id} name={id} from={G.f(SCENES[id][0])} durationInFrames={G.f(SCENES[id][1]) - G.f(SCENES[id][0])}>
            <Scene t={t} />
          </Sequence>
        ))}
        <Hud t={t} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.cream, opacity: big * 0.55, mixBlendMode: 'screen' }} />
      <Grain frame={frame} />
      <Audio src={staticFile('launch30/score.wav')} />
    </AbsoluteFill>
  );
};
