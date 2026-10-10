import { Shader } from '../../lib/gl';
import { ease, tw } from '../../lib/motion';
import { LIQUID } from '../../lib/shaders';
import { H, W } from '../../lib/brand';
import { HITS, SCENES, T } from './timeline';

// One liquid shader under the whole film, so the world never cuts even when the scenes do.
// Lime stretches: the hook's answer, Duá's reveal and the trial line; night everywhere else.
const LIME: [number, number][] = [
  [T.hook.line2, SCENES.hook[1]],
  [SCENES.dua[0], T.dua.chat],
  [SCENES.cta[0], T.cta.end],
];

export const World: React.FC<{ t: number }> = ({ t }) => {
  const lime = LIME.some(([a, b]) => t >= a && t < b) ? 1 : 0;
  let shock = -1;
  for (const h of HITS) if (t >= h && t - h < 1.2) shock = t - h;

  // the build pushes the liquid faster and faster; the drop lets it go
  const { build } = T.orders;
  const end = SCENES.orders[1];
  const rush = t < build ? 0 : 1.6 * Math.min(t - build, end - build) ** 2;
  const zoom =
    tw(t, T.hook.exit, SCENES.hook[1], 1, 2.6, ease.inExpo) * (t < SCENES.hook[1] ? 1 : 0) +
    (t >= SCENES.hook[1] ? 1 : 0) +
    (t >= build && t < end ? tw(t, build, end, 0, 1.4, ease.inCubic) : 0);
  const drop = t >= SCENES.dua[0] && t < SCENES.cta[1];

  return (
    <Shader
      frag={LIQUID}
      width={W}
      height={H}
      scale={0.5}
      uniforms={{
        uTime: t + rush,
        uMix: lime,
        uWarp: t >= build && t < end ? tw(t, build, end, 0.7, 1.3) : drop ? 0.85 : 0.7,
        uZoom: zoom,
        uShock: shock,
        uShockC: [0, 0],
        uGlow: drop ? 1 : 0.65,
        uSpin: t * 0.03 + (t >= build && t < end ? tw(t, build, end, 0, 1.2, ease.inCubic) : 0),
        uFreq: 0.85,
      }}
    />
  );
};
