import { C, H, W } from '../../lib/brand';
import { Shader } from '../../lib/gl';
import { ease, kick, tw } from '../../lib/motion';
import { LIQUID } from '../../lib/shaders';
import { DURATION, T } from './timeline';

// A slow, dark liquid under the whole film; it wakes a little for the date, then settles.
export const World: React.FC<{ t: number }> = ({ t }) => {
  const hit = T.date.hit;
  const lift = t < hit ? 0 : tw(t, hit, hit + 0.6, 0, 1, ease.outCubic) * tw(t, T.end.mark - 0.4, T.end.mark + 0.4, 1, 0.4);
  return (
    <>
      <Shader
        frag={LIQUID}
        width={W}
        height={H}
        scale={0.5}
        uniforms={{
          uTime: t * 0.45 + 3,
          uMix: 0,
          uWarp: 0.62,
          uZoom: 1.25 + t * 0.006,
          uShock: t >= hit && t < hit + 2 ? t - hit : -1,
          uShockC: [0, 0.05],
          uGlow: 0.28 + 0.4 * lift,
          uSpin: t * 0.012,
          uFreq: 0.7,
        }}
      />
      {/* the room darkens towards the edges; on the date a soft light opens up behind the type */}
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(1100px 1500px at 50% 46%, transparent 30%, rgba(5,9,7,0.78) 100%)` }} />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(700px 620px at 50% 48%, rgba(217,248,117,${0.1 * lift + 0.14 * kick(t, hit, 1.6)}), transparent 70%)`,
          opacity: t < DURATION ? 1 : 0,
        }}
      />
      <div style={{ position: 'absolute', inset: 0, background: C.night, opacity: tw(t, 0, 0.6, 1, 0) }} />
    </>
  );
};
