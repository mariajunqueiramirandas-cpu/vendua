import { Composition } from 'remotion';
import { FPS, H, W } from './lib/brand';
import { Hype30 } from './videos/hype30/Hype30';
import { DURATION } from './videos/hype30/timeline';

// One composition per video; each lives in src/videos/<id>/ with its own timeline and score.
export const Root: React.FC = () => (
  <Composition id="Hype30" component={Hype30} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={W} height={H} />
);
