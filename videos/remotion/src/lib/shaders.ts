import { HEADER } from './gl';

const NOISE = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p = r * p * 2.03; a *= 0.5; }
  return s * 0.5 + 0.5;
}
`;

const PALETTE = `
const vec3 NIGHT = vec3(0.039, 0.063, 0.051);
const vec3 FOREST = vec3(0.071, 0.235, 0.196);
const vec3 LIME = vec3(0.851, 0.973, 0.459);
const vec3 CREAM = vec3(0.969, 0.957, 0.918);
`;

/**
 * The world every scene sits in: a domain-warped liquid in the brand's greens.
 * uMix 0 = night (forest folds, lime ridges), 1 = lime (soft forest folds, text still reads).
 * uShock = seconds since a hit (<0 for none): a ring that pushes the liquid outwards.
 */
export const LIQUID =
  HEADER +
  NOISE +
  PALETTE +
  `
uniform float uTime, uMix, uWarp, uZoom, uShock, uGlow, uSpin, uFreq;
uniform vec2 uShockC;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float ring = 0.0;
  if (uShock >= 0.0) {
    float d = length(p - uShockC);
    ring = exp(-pow((d - uShock * 1.6) * 9.0, 2.0)) * exp(-uShock * 2.2);
    p -= normalize(p - uShockC + 1e-4) * ring * 0.09;
  }
  float c = cos(uSpin), s = sin(uSpin);
  p = mat2(c, -s, s, c) * p / uZoom;
  float t = uTime * 0.16;
  vec2 q = vec2(fbm(p * uFreq + vec2(0.0, t)), fbm(p * uFreq + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(p * uFreq + 3.6 * uWarp * q + vec2(1.7, 9.2) + 0.7 * t),
                fbm(p * uFreq + 3.6 * uWarp * q + vec2(8.3, 2.8) - 0.5 * t));
  float f = fbm(p * uFreq + 3.6 * uWarp * r);
  float ridge = smoothstep(0.66, 0.92, f + 0.22 * length(r) - 0.1);
  vec3 night = mix(NIGHT, FOREST, smoothstep(0.25, 0.85, f) * 0.9);
  night = mix(night, LIME, ridge * 0.5 * uGlow);
  vec3 lime = mix(LIME, mix(LIME, FOREST, 0.22), smoothstep(0.35, 0.95, f));
  lime = mix(lime, vec3(1.0, 1.0, 0.86), ridge * 0.4);
  vec3 col = mix(night, lime, uMix);
  col += ring * 0.3 * mix(LIME, CREAM, uMix);
  col *= 1.0 - 0.38 * pow(length(uv - 0.5) * 1.25, 2.2) * (1.0 - 0.6 * uMix);
  outColor = vec4(col, 1.0);
}
`;

/**
 * The brand's check mark as a glossy 3D tube, raymarched. Transparent where it misses, so DOM
 * type can sit behind or in front. uRot = euler angles (radians), uSize = tube scale.
 */
export const MARK3D =
  HEADER +
  PALETTE +
  `
uniform vec3 uRot;
uniform float uSize, uLight;
mat3 rot(vec3 a) {
  float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
  return mat3(cy, 0, -sy, 0, 1, 0, sy, 0, cy) * mat3(1, 0, 0, 0, cx, sx, 0, -sx, cx) * mat3(cz, sz, 0, -sz, cz, 0, 0, 0, 1);
}
float capsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}
// mark-lime.svg: M32 48 L61 88 L98 34 in a 128 box, stroke 17
const vec3 A = vec3(-0.50, 0.25, 0.0);
const vec3 B = vec3(-0.047, -0.375, 0.0);
const vec3 D = vec3(0.531, 0.469, 0.0);
float map(vec3 p) {
  p = rot(uRot) * p / uSize;
  return min(capsule(p, A, B, 0.135), capsule(p, B, D, 0.135)) * uSize;
}
vec3 normal(vec3 p) {
  vec2 e = vec2(0.002, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, 3.2), rd = normalize(vec3(p, -2.0));
  float t = 0.0, hit = 0.0;
  // the mark fits a sphere of ~0.8 * uSize: skip rays that miss it
  float bb = dot(ro, rd); float disc = bb * bb - dot(ro, ro) + pow(0.85 * uSize, 2.0);
  if (disc > 0.0) {
    t = -bb - sqrt(disc);
    for (int i = 0; i < 56; i++) {
      float d = map(ro + rd * t);
      if (d < 0.0015) { hit = 1.0; break; }
      t += d;
      if (t > 6.0) break;
    }
  }
  if (hit < 0.5) { outColor = vec4(0.0); return; }
  vec3 pos = ro + rd * t, n = normal(pos), v = -rd;
  vec3 l = normalize(vec3(0.6, 0.8, 0.9));
  float dif = clamp(dot(n, l) * 0.6 + 0.4, 0.0, 1.0);
  float spe = pow(clamp(dot(reflect(-l, n), v), 0.0, 1.0), 48.0);
  float fre = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
  vec3 env = mix(FOREST * 0.6, CREAM, smoothstep(-0.4, 0.8, reflect(rd, n).y));
  vec3 col = LIME * (0.35 + 0.75 * dif);
  col = mix(col, env, fre * 0.55);
  col += vec3(1.0) * spe * (0.8 + uLight);
  col += LIME * uLight * 0.35;
  outColor = vec4(col, 1.0);
}
`;
