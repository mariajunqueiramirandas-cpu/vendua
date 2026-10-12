import { Composition } from 'remotion';
import { FPS, H, W } from './lib/brand';
import { Hype30 } from './videos/hype30/Hype30';
import { DURATION } from './videos/hype30/timeline';
import { Launch30 } from './videos/launch30/Launch30';
import { DURATION as LAUNCH30 } from './videos/launch30/timeline';

// One composition per video; each lives in src/videos/<id>/ with its own timeline and score.
export const Root: React.FC = () => (
  <>
    <Composition id="Hype30" component={Hype30} durationInFrames={Math.round(DURATION * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Launch30" component={Launch30} durationInFrames={Math.round(LAUNCH30 * FPS)} fps={FPS} width={W} height={H} />
  </>
);
