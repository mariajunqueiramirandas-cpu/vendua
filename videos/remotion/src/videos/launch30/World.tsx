import { H, W } from '../../lib/brand';
import { Shader } from '../../lib/gl';
import { ease, tw } from '../../lib/motion';
import { LIQUID, WARP } from '../../lib/shaders';
import { HITS, SCENES, T, ZERO } from './timeline';

// One liquid shader under the whole film, so the world never cuts even when the scenes do.
// Lime only while Duá is online; night everywhere else. From ignition to the end card, hyperspace
// streaks are screened over it.
const LIME: [number, number][] = [[T.dua.online, SCENES.dua[1]]];

const WARP_ON = T.ready.ignite;
const WARP_OFF = SCENES.end[0] + 0.25;

/** Warp speed: sucks up to full at T−0, settles to a cruise under the date, surges into the end card. */
export const warpSpeed = (t: number) =>
  t < ZERO
    ? tw(t, WARP_ON, ZERO, 0.15, 3, ease.inExpo)
    : t < T.date.exit
      ? tw(t, ZERO, ZERO + 1.1, 3, 0.45, ease.outCubic)
      : tw(t, T.date.exit, SCENES.end[0], 0.45, 3.2, ease.inCubic);

// distance travelled = the integral of speed, so the streaks never jump when the speed changes
const travel = (t: number) => {
  let d = 0;
  const dt = 1 / 120;
  for (let x = WARP_ON; x < t; x += dt) d += warpSpeed(x) * dt * 0.55;
  return d;
};

export const World: React.FC<{ t: number }> = ({ t }) => {
  const lime = LIME.some(([a, b]) => t >= a && t < b) ? 1 : 0;
  let shock = -1;
  for (const h of HITS) if (t >= h && t - h < 1.2) shock = t - h;

  // the boot bar pushes the liquid faster and faster; the drop lets it go
  const { boot, online } = T.dua;
  const building = t >= boot && t < online;
  const rush = t < boot ? 0 : 1.6 * Math.min(t - boot, online - boot) ** 2;
  const zoom = 1 + (building ? tw(t, boot, online, 0, 1.4, ease.inCubic) : 0) + (t >= T.ready.ignite && t < SCENES.end[0] ? tw(t, T.ready.ignite, ZERO, 0, 0.6, ease.inExpo) : 0);
  const warp = t >= WARP_ON && t < WARP_OFF;

  return (
    <>
      <Shader
        frag={LIQUID}
        width={W}
        height={H}
        scale={0.5}
        uniforms={{
          uTime: t + rush,
          uMix: lime,
          uWarp: building ? tw(t, boot, online, 0.7, 1.3) : lime ? 0.85 : 0.7,
          uZoom: zoom,
          uShock: shock,
          uShockC: [0, 0],
          uGlow: lime || t >= ZERO ? 1 : 0.6,
          uSpin: t * 0.03 + (building ? tw(t, boot, online, 0, 1.2, ease.inCubic) : 0),
          uFreq: 0.85,
        }}
      />
      {warp && (
        <Shader
          frag={WARP}
          width={W}
          height={H}
          scale={0.5}
          style={{ mixBlendMode: 'screen' }}
          uniforms={{
            uTravel: travel(t),
            uSpeed: warpSpeed(t),
            uFade: tw(t, WARP_ON, WARP_ON + 0.25, 0, 1) * tw(t, SCENES.end[0], WARP_OFF, 1, 0),
          }}
        />
      )}
    </>
  );
};
