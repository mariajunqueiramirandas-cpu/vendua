import { H, W } from '../../lib/brand';
import { Shader } from '../../lib/gl';
import { ease, tw } from '../../lib/motion';
import { LIQUID } from '../../lib/shaders';
import { HITS, SCENES, T } from './timeline';

// One liquid shader under the whole film. Night while the problem is told and the product is
// shown; lime for the launch's reveal and the trial offer.
const LIME: [number, number][] = [
  [T.launch.brand, SCENES.launch[1]],
  [SCENES.cta[0], T.cta.end],
];

export const World: React.FC<{ t: number }> = ({ t }) => {
  const lime = LIME.some(([a, b]) => t >= a && t < b) ? 1 : 0;
  let shock = -1;
  for (const h of HITS) if (t >= h && t - h < 1.2) shock = t - h;
  // the build into the launch pushes the liquid, the drop lets it go
  const build = t >= SCENES.launch[0] && t < T.launch.brand;
  const rush = build ? 1.4 * (t - SCENES.launch[0]) ** 2 : t >= T.launch.brand ? 1.4 * (T.launch.brand - SCENES.launch[0]) ** 2 : 0;
  // calmer while a phone is on screen, so the UI reads
  const calm = t >= SCENES.what[0] && t < SCENES.price[0] ? 1 : 0;
  return (
    <Shader
      frag={LIQUID}
      width={W}
      height={H}
      scale={0.5}
      uniforms={{
        uTime: t + rush,
        uMix: lime,
        uWarp: build ? tw(t, SCENES.launch[0], T.launch.brand, 0.7, 1.3) : calm ? 0.55 : 0.8,
        uZoom: 1 + (build ? tw(t, SCENES.launch[0], T.launch.brand, 0, 0.9, ease.inCubic) : 0),
        uShock: shock,
        uShockC: [0, 0],
        uGlow: calm ? 0.35 : 0.8,
        uSpin: t * 0.03,
        uFreq: 0.85,
      }}
    />
  );
};
