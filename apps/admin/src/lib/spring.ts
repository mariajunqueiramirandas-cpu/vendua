// Springs as plain CSS/WAAPI easings (§5.1): a damped spring sampled into `linear()`, so a
// released drag settles like a native one without a physics library. Where `linear()` isn't
// supported the curve falls back to `smooth`.

export interface Spring {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** sheets, drags, swipes, arrivals */
export const SPRING: Spring = { stiffness: 380, damping: 30 };
/** celebrations only */
export const BOUNCY: Spring = { stiffness: 500, damping: 22 };

const FALLBACK = 'cubic-bezier(.2,.8,.2,1)';
let linearOk: boolean | undefined;
const supportsLinear = () =>
  (linearOk ??=
    typeof CSS !== 'undefined' && CSS.supports('animation-timing-function', 'linear(0, 1)'));

/** Distance still to travel (1 → 0) at time t, starting at `v0` distances per second toward 0. */
function remaining({ stiffness: k, damping: c, mass: m = 1 }: Spring, v0: number) {
  const w0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const b = (zeta * w0 - v0) / wd;
    return (t: number) => Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + b * Math.sin(wd * t));
  }
  const b = w0 - v0;
  return (t: number) => Math.exp(-w0 * t) * (1 + b * t);
}

const cache = new Map<string, { easing: string; duration: number }>();

/**
 * The spring as `{ easing, duration }` for `el.animate()` or a CSS transition. `velocity` is
 * how fast the thing is already moving toward its target, in whole distances per second
 * (a fling released at 1200 px/s with 300 px to go is 4).
 */
export function springEasing(s: Spring = SPRING, velocity = 0) {
  const v = Math.round(Math.max(-40, Math.min(40, velocity)) * 4) / 4;
  const key = `${s.stiffness}/${s.damping}/${s.mass ?? 1}/${v}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const y = remaining(s, v);
  // settled once it stays within 0.2% of the target
  let end = 0.05;
  for (let t = 3; t > 0.05; t -= 0.01) {
    if (Math.abs(y(t)) > 0.002) {
      end = t + 0.01;
      break;
    }
  }
  const n = 48;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) pts.push(String(Math.round((1 - y((end * i) / n)) * 1e4) / 1e4));
  pts[n] = '1';
  const out = {
    easing: supportsLinear() ? `linear(${pts.join(',')})` : FALLBACK,
    duration: Math.round(end * 1000),
  };
  cache.set(key, out);
  return out;
}

export const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
