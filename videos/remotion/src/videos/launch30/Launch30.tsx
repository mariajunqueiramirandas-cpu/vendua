import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion';
import '../../lib/fonts';
import { C } from '../../lib/brand';
import { Grain } from '../../lib/grain';
import { Brand } from './scenes/Brand';
import { DateReveal } from './scenes/DateReveal';
import { End } from './scenes/End';
import { Features } from './scenes/Features';
import { Open } from './scenes/Open';
import { DURATION, G, SCENES, XF } from './timeline';
import { World } from './World';

// 30 s, 9:16, for Instagram Reels and Stories: the launch film for 16.10.2026.
// Calm and cinematic; picture and score share timeline.ts. Each shot stays mounted XF past its
// end so it can fade under the next one.
const SEQ = [
  ['open', Open],
  ['brand', Brand],
  ['features', Features],
  ['date', DateReveal],
  ['end', End],
] as const;

export const Launch30: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / G.fps;
  return (
    <AbsoluteFill style={{ background: C.night, overflow: 'hidden' }}>
      <World t={t} />
      {SEQ.map(([id, Scene]) => {
        const [a, b] = SCENES[id];
        const to = Math.min(DURATION, b + XF);
        return (
          <Sequence key={id} name={id} from={G.f(a)} durationInFrames={G.f(to) - G.f(a)}>
            <Scene t={t} />
          </Sequence>
        );
      })}
      <Grain frame={frame} opacity={0.05} />
      <Audio src={staticFile('launch30/score.wav')} />
    </AbsoluteFill>
  );
};
