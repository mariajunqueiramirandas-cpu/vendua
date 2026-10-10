import { Easing, interpolate } from 'remotion';

export const ease = {
  outExpo: Easing.bezier(0.16, 1, 0.3, 1),
  outCubic: Easing.bezier(0.33, 1, 0.68, 1),
  outQuart: Easing.bezier(0.25, 1, 0.5, 1),
  inCubic: Easing.bezier(0.32, 0, 0.67, 0),
  inExpo: Easing.bezier(0.7, 0, 0.84, 0),
  inOutCubic: Easing.bezier(0.65, 0, 0.35, 1),
  inOutExpo: Easing.bezier(0.87, 0, 0.13, 1),
  outBack: Easing.out(Easing.back(1.7)),
  linear: (x: number) => x,
};

/** Clamped tween of `t` (seconds) across [t0, t1], from a to b. */
export const tw = (t: number, t0: number, t1: number, a: number, b: number, e = ease.outCubic) =>
  interpolate(t, [t0, t1], [a, b], {
    easing: e,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

/** 0 → 1 progress of `t` across [t0, t0 + dur]. */
export const prog = (t: number, t0: number, dur: number, e = ease.outCubic) =>
  tw(t, t0, t0 + dur, 0, 1, e);

/** A decaying kick: 1 at t0, falling to 0 over `dur`. */
export const kick = (t: number, t0: number, dur: number) =>
  t < t0 ? 0 : Math.max(0, 1 - (t - t0) / dur) ** 2;

/** Camera shake from a list of hits: a sum of fixed sines, so every tab renders the same offset. */
export const shake = (t: number, hits: readonly number[], amp: number, dur = 0.35) => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const h of hits) {
    const k = kick(t, h, dur);
    if (!k) continue;
    const s = (t - h) * 60;
    x += Math.sin(s * 1.9 + h) * amp * k;
    y += Math.cos(s * 2.3 + h * 3) * amp * k;
    r += Math.sin(s * 1.3 + h * 7) * amp * 0.02 * k;
  }
  return { x, y, r };
};

/** The last value in `steps` whose time is ≤ t (0 ms swaps on the grid). */
export const at = <T>(t: number, steps: readonly (readonly [number, T])[], before: T): T => {
  let v = before;
  for (const [s, x] of steps) if (t >= s) v = x;
  return v;
};
