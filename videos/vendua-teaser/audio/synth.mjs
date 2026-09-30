// Synthesizes the teaser's whole soundtrack — score and sound effects — into audio/score-raw.wav.
// Pure DSP, no samples and no randomness beyond a seeded PRNG, so the file is identical on every run.
// Every hit is placed from audio/cues.json, the same times the compositions animate on.
// Run: node audio/synth.mjs && bash audio/master.sh
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const cues = JSON.parse(fs.readFileSync(path.join(here, 'cues.json'), 'utf8'));
const H = cues.hits;

const SR = 48000;
const DUR = cues.duration;
const N = SR * DUR;
const BEAT = 60 / cues.bpm;
const S16 = BEAT / 4;

// ── buses ────────────────────────────────────────────────────────────────
const bus = () => [new Float32Array(N), new Float32Array(N)];
const fx = bus(); // drums + sound effects (not ducked)
const music = bus(); // pads, bass, arp (ducked by the kick)
const revSend = bus();
const dlySend = bus();
const duck = new Float32Array(N).fill(1);

// ── helpers ──────────────────────────────────────────────────────────────
let seed = 0x5eed;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const noise = () => rand() * 2 - 1;
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerpExp = (a, b, x) => a * (b / a) ** clamp(x, 0, 1);

// TPT state-variable filter
function svf() {
  let ic1 = 0,
    ic2 = 0;
  return (x, fc, q = 0.707) => {
    const g = Math.tan((Math.PI * clamp(fc, 20, SR * 0.45)) / SR);
    const k = 1 / q;
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return { lp: v2, bp: v1, hp: x - k * v1 - v2 };
  };
}

// band-limited saw (polyBLEP)
function saw() {
  let ph = rand();
  return (f) => {
    const dt = f / SR;
    ph += dt;
    if (ph >= 1) ph -= 1;
    let v = 2 * ph - 1;
    if (ph < dt) {
      const t = ph / dt;
      v -= t + t - t * t - 1;
    } else if (ph > 1 - dt) {
      const t = (ph - 1) / dt;
      v -= t * t + t + t + 1;
    }
    return v;
  };
}
function sine(p0 = 0) {
  let ph = p0;
  return (f) => {
    ph += f / SR;
    ph -= Math.floor(ph);
    return Math.sin(TAU * ph);
  };
}

/**
 * Renders `fn(dt, i)` for `len` seconds from time `t` onto a bus. `fn` returns a number (mono,
 * panned with `pan` in -1..1) or [l, r]. `rev` / `dly` are send levels.
 */
function place(target, t, len, fn, { gain = 1, pan = 0, rev = 0, dly = 0 } = {}) {
  const i0 = Math.round(t * SR);
  const i1 = Math.min(N, Math.round((t + len) * SR));
  const pl = Math.cos(((pan + 1) * Math.PI) / 4);
  const pr = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = Math.max(0, i0); i < i1; i++) {
    const out = fn((i - i0) / SR, i);
    let l, r;
    if (typeof out === 'number') {
      l = out * pl * Math.SQRT2;
      r = out * pr * Math.SQRT2;
    } else [l, r] = out;
    l *= gain;
    r *= gain;
    target[0][i] += l;
    target[1][i] += r;
    if (rev) {
      revSend[0][i] += l * rev;
      revSend[1][i] += r * rev;
    }
    if (dly) {
      dlySend[0][i] += l * dly;
      dlySend[1][i] += r * dly;
    }
  }
}
// a short linear fade at both ends so no voice clicks
const edge = (dt, len, a = 0.003, r = 0.01) => Math.min(1, dt / a, (len - dt) / r);

// ── drums ────────────────────────────────────────────────────────────────
function kick(t, g = 1, depth = 0.7) {
  const osc = sine(0.25);
  place(
    fx,
    t,
    0.45,
    (dt) => {
      const f = 44 + 120 * Math.exp(-dt * 32);
      const body = osc(f) * Math.exp(-dt * 7.5) * Math.min(1, dt / 0.0015);
      const click = noise() * Math.exp(-dt * 500) * 0.25;
      return Math.tanh((body + click) * 1.6) * 0.9;
    },
    { gain: g },
  );
  // sidechain: the music bus ducks under each kick (the house pump)
  const i0 = Math.round(t * SR);
  for (let i = i0; i < Math.min(N, i0 + SR * 0.4); i++) {
    const dt = (i - i0) / SR;
    const d = dt < 0.008 ? dt / 0.008 : Math.exp(-(dt - 0.008) * 9);
    duck[i] = Math.min(duck[i], 1 - depth * d);
  }
}
function clap(t, g = 1) {
  const f = svf();
  const tone = sine();
  place(
    fx,
    t,
    0.35,
    (dt) => {
      let env = Math.exp(-dt * 20) * 0.6;
      for (let k = 0; k < 3; k++) if (dt >= k * 0.011) env += Math.exp(-(dt - k * 0.011) * 220);
      const n = f(noise(), 1400, 0.9).bp * 2.2;
      return (n * env + tone(185) * Math.exp(-dt * 30) * 0.25) * edge(dt, 0.35);
    },
    { gain: g * 0.55, rev: 0.25 },
  );
}
function hat(t, g = 1, open = false, pan = 0.25) {
  const f = svf();
  const len = open ? 0.28 : 0.06;
  place(
    fx,
    t,
    len,
    (dt) => f(noise(), 8000, 0.8).hp * Math.exp(-dt * (open ? 13 : 70)) * edge(dt, len, 0.001),
    { gain: g * 0.22, pan },
  );
}
function snare(t, g = 1) {
  const f = svf();
  const tone = sine();
  place(
    fx,
    t,
    0.18,
    (dt) =>
      (f(noise(), 2200, 0.7).bp * 1.8 * Math.exp(-dt * 28) +
        tone(210 - dt * 200) * Math.exp(-dt * 35) * 0.4) *
      edge(dt, 0.18, 0.001),
    { gain: g * 0.45, rev: 0.15 },
  );
}
function crash(t, g = 1, len = 2.4) {
  const fl = svf(),
    fr = svf();
  place(
    fx,
    t,
    len,
    (dt) => {
      const env = Math.exp(-dt * 2.1) * edge(dt, len, 0.001, 0.3);
      return [fl(noise(), 5200, 0.6).hp * env, fr(noise(), 5200, 0.6).hp * env];
    },
    { gain: g * 0.32, rev: 0.35 },
  );
}

// ── cinematic effects ────────────────────────────────────────────────────
function boom(t, g = 1, len = 1.6) {
  const osc = sine();
  place(
    fx,
    t,
    len,
    (dt) => {
      const f = 58 * Math.exp(-dt * 0.9) + 20;
      return Math.tanh(osc(f) * 2.2) * Math.exp(-dt * 2.6) * edge(dt, len, 0.002, 0.2) * 0.8;
    },
    { gain: g, rev: 0.1 },
  );
}
function riser(t0, t1, g = 1, f0 = 350, f1 = 9000) {
  const len = t1 - t0;
  const bl = svf(),
    br = svf();
  const tone = sine();
  place(
    fx,
    t0,
    len,
    (dt) => {
      const x = dt / len;
      const fc = lerpExp(f0, f1, x);
      const env = x ** 2.2 * edge(dt, len, 0.01, 0.004);
      const tn = tone(lerpExp(180, 1100, x)) * 0.18 * x ** 3;
      return [
        (bl(noise(), fc, 2.4).bp * 1.6 + tn) * env,
        (br(noise(), fc * 1.03, 2.4).bp * 1.6 + tn) * env,
      ];
    },
    { gain: g * 0.5, rev: 0.2 },
  );
}
function reverseSwell(t0, t1, g = 1) {
  const len = t1 - t0;
  const fl = svf(),
    fr = svf();
  place(
    fx,
    t0,
    len,
    (dt) => {
      const env = (dt / len) ** 3 * edge(dt, len, 0.01, 0.003);
      return [fl(noise(), 4200, 0.7).hp * env, fr(noise(), 4200, 0.7).hp * env];
    },
    { gain: g * 0.4, rev: 0.1 },
  );
}
function whoosh(t, len, g = 1, f0 = 300, f1 = 5000, pan0 = -0.7, pan1 = 0.7) {
  const bl = svf(),
    br = svf();
  place(
    fx,
    t,
    len,
    (dt) => {
      const x = dt / len;
      const fc = lerpExp(f0, f1, x);
      const env = Math.sin(Math.PI * x ** 0.8) ** 2;
      const p = pan0 + (pan1 - pan0) * x;
      const l = bl(noise(), fc, 1.6).bp * env * Math.cos(((p + 1) * Math.PI) / 4) * 2.2;
      const r = br(noise(), fc, 1.6).bp * env * Math.sin(((p + 1) * Math.PI) / 4) * 2.2;
      return [l, r];
    },
    { gain: g, rev: 0.25 },
  );
}
function thump(t, g = 1) {
  const osc = sine(0.25);
  place(
    fx,
    t,
    0.3,
    (dt) => osc(48 + 80 * Math.exp(-dt * 30)) * Math.exp(-dt * 14) * edge(dt, 0.3, 0.001),
    {
      gain: g,
    },
  );
}
function bell(
  t,
  midi,
  g = 1,
  len = 0.9,
  { ratio = 3.5, index = 2.2, pan = 0, rev = 0.3, dly = 0 } = {},
) {
  const f = mtof(midi);
  const car = sine(),
    mod = sine();
  place(
    fx,
    t,
    len,
    (dt) => {
      const m = mod(f * ratio) * index * Math.exp(-dt * 7) * f;
      return car(f + m) * Math.exp(-dt * (5 / len)) * edge(dt, len, 0.001, 0.05);
    },
    { gain: g * 0.35, pan, rev, dly },
  );
}
function glass(t, g = 1) {
  for (const [f, d] of [
    [2380, 22],
    [3620, 30],
    [5150, 40],
  ]) {
    const o = sine();
    place(fx, t, 0.35, (dt) => o(f) * Math.exp(-dt * d) * edge(dt, 0.35, 0.0008), {
      gain: g * 0.12,
      rev: 0.3,
    });
  }
}
function pop(t, midi, g = 1, pan = 0) {
  // a bubbly pluck: fast downward chirp into a round sine, plus a soft bell on top
  const f = mtof(midi);
  const o = sine();
  place(
    fx,
    t,
    0.4,
    (dt) => o(f * (1 + 1.2 * Math.exp(-dt * 90))) * Math.exp(-dt * 11) * edge(dt, 0.4, 0.001),
    { gain: g * 0.42, pan, rev: 0.22 },
  );
  bell(t, midi + 12, g * 0.4, 0.5, { ratio: 2, index: 1.2, pan, rev: 0.3 });
}
function tick(t, midi, g = 1, pan = 0) {
  const o = sine();
  place(
    fx,
    t,
    0.12,
    (dt) =>
      (o(mtof(midi)) * Math.exp(-dt * 55) + noise() * Math.exp(-dt * 900) * 0.3) *
      edge(dt, 0.12, 0.0005),
    { gain: g * 0.4, pan, rev: 0.15 },
  );
}
function slide(t, len, f0, f1, g = 1) {
  // Duá's climb: a slide-whistle glide with a little vibrato once it arrives
  const o = sine(),
    o2 = sine();
  place(
    fx,
    t,
    len,
    (dt) => {
      const x = dt / len;
      const s = x * x * (3 - 2 * x);
      const vib = 1 + 0.018 * Math.sin(TAU * 7 * dt) * clamp((x - 0.55) * 3, 0, 1);
      const f = lerpExp(f0, f1, s) * vib;
      const env = Math.sin(Math.PI * clamp(x * 1.15, 0, 1)) ** 0.6 * edge(dt, len, 0.01, 0.02);
      return (o(f) + o2(f * 2) * 0.18) * env;
    },
    { gain: g * 0.22, rev: 0.3, dly: 0.1 },
  );
}
function boop(t, midi, g = 1, pan = 0) {
  const f = mtof(midi);
  const o = sine();
  place(
    fx,
    t,
    0.22,
    (dt) =>
      o(f * (0.75 + 0.25 * Math.min(1, dt / 0.05))) * Math.exp(-dt * 16) * edge(dt, 0.22, 0.002),
    { gain: g * 0.38, pan, rev: 0.25, dly: 0.15 },
  );
}
function sparkle(t0, len, g = 1) {
  // an upward shimmer of bells on the F major pentatonic
  const scale = [77, 79, 81, 84, 86, 89, 91, 93, 96, 98, 101];
  const n = 18;
  for (let k = 0; k < n; k++) {
    const x = k / (n - 1);
    const t = t0 + len * x ** 1.3;
    const midi = scale[Math.min(scale.length - 1, Math.floor(x * scale.length))];
    bell(t, midi, g * (0.55 - 0.3 * x), 0.7, {
      ratio: 2.76,
      index: 1.5,
      pan: (rand() - 0.5) * 1.4,
      rev: 0.45,
    });
  }
}

// ── music ────────────────────────────────────────────────────────────────
const CH = {
  F: [53, 57, 60, 64, 67], // Fmaj9
  Dm: [50, 53, 57, 60, 64], // Dm9
  Bb: [46, 50, 53, 57, 60], // Bbmaj9
  C: [48, 52, 55, 62, 67], // C6/9
};
const ROOT = { F: 41, Dm: 38, Bb: 34, C: 36 };

function pad(t, len, notes, cutoff, g = 1) {
  // three detuned saws a voice, spread across the stereo field
  for (const [n, midi] of notes.entries()) {
    const voices = [-0.09, 0, 0.1].map((d) => ({ osc: saw(), f: mtof(midi + d) }));
    const fl = svf(),
      fr = svf();
    const spread = ((n / (notes.length - 1)) * 2 - 1) * 0.6;
    place(
      music,
      t,
      len + 0.25,
      (dt, i) => {
        const env =
          Math.min(1, dt / 0.03) *
          (dt > len ? Math.exp(-(dt - len) * 18) : 1) *
          edge(dt, len + 0.25, 0.003, 0.02);
        const a = voices[0].osc(voices[0].f),
          b = voices[1].osc(voices[1].f),
          c = voices[2].osc(voices[2].f);
        const fc = cutoff(i / SR);
        const l = fl(a * 0.8 + b * 0.6 + c * 0.2, fc, 0.9).lp;
        const r = fr(c * 0.8 + b * 0.6 + a * 0.2, fc, 0.9).lp;
        return [l * env * (1 - spread * 0.5), r * env * (1 + spread * 0.5)];
      },
      { gain: g * 0.07, rev: 0.3 },
    );
  }
}
function bassNote(t, len, midi, g = 1) {
  const o = saw(),
    sub = sine();
  const f = svf();
  const fr = mtof(midi);
  place(
    music,
    t,
    len,
    (dt) => {
      const fc = 160 + 1100 * Math.exp(-dt * 14);
      const v = f(o(fr), fc, 1.1).lp * 0.7 + sub(fr) * 0.6;
      return Math.tanh(v * 1.4) * edge(dt, len, 0.004, 0.02);
    },
    { gain: g * 0.42 },
  );
}
function pluck(t, midi, g = 1, pan = 0) {
  const o = saw(),
    o2 = saw();
  const f = svf();
  const fr = mtof(midi);
  place(
    music,
    t,
    0.32,
    (dt) => {
      const fc = 350 + 5200 * Math.exp(-dt * 22);
      return (
        f(o(fr) + o2(fr * 1.004) * 0.6, fc, 1.4).lp * Math.exp(-dt * 9) * edge(dt, 0.32, 0.001)
      );
    },
    { gain: g * 0.12, pan, dly: 0.35, rev: 0.12 },
  );
}
function stab(t, notes, g = 1, len = 2.5) {
  for (const [n, midi] of notes.entries()) {
    const a = saw(),
      b = saw();
    const f = svf();
    const fr = mtof(midi);
    place(
      fx,
      t,
      len,
      (dt) => {
        const fc = 600 + 7000 * Math.exp(-dt * 3.5);
        return (
          f(a(fr * 0.998) + b(fr * 1.003), fc, 0.8).lp *
          Math.exp(-dt * 1.6) *
          edge(dt, len, 0.002, 0.3)
        );
      },
      { gain: g * 0.06, pan: (n / (notes.length - 1)) * 1.2 - 0.6, rev: 0.5 },
    );
  }
}

// ── the arrangement (seconds, on the 120 BPM grid) ───────────────────────
const up = (m) => m.map((x) => x + 12);

// bar 0 — the spark: a filtered pad opens under the riser, slams on the V
pad(
  0,
  2,
  CH.F,
  (t) => (t < H.vSlam ? lerpExp(250, 2200, t / H.vSlam) : lerpExp(4200, 900, (t - H.vSlam) / 1)),
  0.9,
);
riser(H.riser[0], H.riser[1], 1);
boom(H.vSlam, 1.1);
kick(H.vSlam, 1, 0);
crash(H.vSlam, 1);
stab(H.vSlam, up(CH.F), 0.9, 1.2);
bassNote(H.vSlam, 0.9, 29, 0.8);
reverseSwell(H.reverseSwell[0], H.reverseSwell[1], 1);

// bars 1–3 — the groove, then the build
const groove = [
  [2, 'F'],
  [4, 'Dm'],
  [6, 'Bb'],
  [7, 'C'],
];
for (const [t, c] of groove) {
  const len = t >= 6 ? 1 : 2;
  const end = Math.min(t + len, H.build[1]);
  pad(
    t,
    end - t,
    CH[c],
    (x) => (x < H.build[0] ? 1500 : lerpExp(1500, 6000, (x - H.build[0]) / 0.875)),
    1,
  );
  for (let b = t; b < end - 1e-6; b += BEAT) {
    bassNote(b + BEAT / 2, BEAT / 2 - 0.02, ROOT[c] + 12, 1);
    if (b < 4) bassNote(b, BEAT / 2 - 0.02, ROOT[c], 0.7);
  }
}
for (let b = 2; b < H.build[0] - 1e-6; b += BEAT) {
  kick(b, 1);
  hat(b + BEAT / 2, 1, true);
  hat(b + S16, 0.45, false, -0.2);
  hat(b + 3 * S16, 0.45, false, -0.2);
  if (Math.round((b - 2) / BEAT) % 2 === 1) clap(b, 0.8);
}
// the four words, up the F major scale
H.words.forEach((t, k) => {
  pop(t, [77, 81, 84, 89][k], 1.25, [-0.3, 0.1, -0.1, 0.3][k]);
  tick(t, [89, 93, 96, 101][k], 0.5);
});
stab(H.stackHold, CH.F, 0.5, 0.4);
whoosh(H.whipUp - 0.1, 0.65, 1.1, 250, 6000, -0.6, 0.6);
H.headline.forEach((t, k) => tick(t, [84, 89][k], 0.9, k ? 0.2 : -0.2));
thump(H.phoneLand, 1);
glass(H.phoneLand + 0.02, 1);
crash(H.phoneLand, 0.35, 1.2);
// the phone swings up; the order push arrives with a quick two-note ding
whoosh(H.phoneSwing, 0.6, 0.6, 400, 3500, 0.2, -0.2);
bell(H.orderPush, 91, 0.95, 0.9, { ratio: 2, index: 1.4, pan: 0.15, rev: 0.35 });
bell(H.orderPush + 0.09, 96, 0.95, 1.1, { ratio: 2, index: 1.4, pan: 0.15, rev: 0.35, dly: 0.15 });
// the build: an accelerating snare roll and a riser into a half-beat of silence
for (let t = H.build[0], k = 0; t < H.build[1] - 1e-6; k++) {
  const x = (t - H.build[0]) / (H.build[1] - H.build[0]);
  snare(t, 0.6 + 1.1 * x);
  t += x < 0.5 ? S16 : S16 / 2;
}
riser(H.build[0], H.build[1], 0.9, 500, 11000);

// bars 4–5 — the drop, the name
const drop = [
  [8, 2, 'F'],
  [10, 1, 'Dm'],
  [11, 0.5, 'Bb'],
  [11.5, 0.5, 'C'],
];
for (const [t, len, c] of drop) {
  pad(t, len, CH[c], () => 2600, 1.1);
  for (let b = t; b < t + len - 1e-6; b += BEAT) {
    bassNote(b + BEAT / 2, BEAT / 2 - 0.02, ROOT[c] + 12, 1.1);
    bassNote(b + (3 * BEAT) / 4, BEAT / 4 - 0.02, ROOT[c] + 24, 0.45);
  }
  // 16th arpeggio over the chord's top voices
  const arp = [...CH[c].slice(1), CH[c][2] + 12].map((m) => m + 12);
  for (let k = 0; k < len / S16 - 1e-6; k++)
    pluck(t + k * S16, arp[k % arp.length], k % 4 === 0 ? 1 : 0.7, k % 2 ? 0.4 : -0.4);
}
for (let b = H.drop; b < H.finale - 1e-6; b += BEAT) {
  kick(b, 1.05);
  hat(b + BEAT / 2, 1.1, true);
  hat(b + S16, 0.5, false, -0.2);
  hat(b + 3 * S16, 0.5, false, -0.2);
  if (Math.round((b - H.drop) / BEAT) % 2 === 1) clap(b, 0.9);
}
crash(H.drop, 0.9);
boom(H.drop, 0.6, 1);
// the letters, one per eighth, climbing Fmaj9; the accent rings; the dot lands hard
H.letters.forEach((t, k) => pop(t, [77, 81, 84, 88, 91, 93][k], 1.35, -0.5 + k * 0.2));
bell(H.accent, 96, 1.1, 1.4, { ratio: 3.01, index: 2.5, rev: 0.45, dly: 0.2 });
reverseSwell(H.accent + 0.05, H.dot, 0.7);
boom(H.dot, 1.2, 1.4);
crash(H.dot, 1);
clap(H.dot, 0.7);
thump(H.dot, 0.9);
slide(H.duaClimb[0], H.duaClimb[1] - H.duaClimb[0], 520, 1250, 1);
H.duaWave.forEach((t, k) => boop(t, [88, 91][k], 1, k ? 0.35 : -0.35));
reverseSwell(11.25, H.finale, 0.8);
riser(11.5, H.finale, 0.5, 800, 9000);

// the finale — the last hit, drums out, the chord rings to the end
kick(H.finale, 1.1, 0);
boom(H.finale, 1.3, 2.8);
crash(H.finale, 1.1, 3);
stab(H.finale, [...CH.F, 72, 76], 1.2, 3);
pad(
  H.finale,
  DUR - H.finale - 0.3,
  [...CH.F, 72],
  (t) => lerpExp(3800, 700, (t - H.finale) / 3),
  1.2,
);
bassNote(H.finale, 2.6, 29, 0.9);
sparkle(H.finale + 0.02, 0.75, 1);
bell(H.instagram, 84, 0.9, 1.6, { ratio: 3.01, index: 1.8, pan: -0.25, rev: 0.5, dly: 0.25 });
bell(H.website, 89, 0.9, 1.8, { ratio: 3.01, index: 1.8, pan: 0.25, rev: 0.5, dly: 0.25 });
pop(H.instagramNudge, 96, 0.55);

// ── effects ──────────────────────────────────────────────────────────────
function reverb([inL, inR]) {
  // Freeverb: 8 parallel combs + 4 series allpasses a channel
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) =>
    Math.round((d * SR) / 44100),
  );
  const aps = [556, 441, 341, 225].map((d) => Math.round((d * SR) / 44100));
  const out = bus();
  for (const [ch, input] of [inL, inR].entries()) {
    const spread = ch ? Math.round((23 * SR) / 44100) : 0;
    const acc = new Float32Array(N);
    for (const d0 of combs) {
      const d = d0 + spread;
      const buf = new Float32Array(d);
      let idx = 0,
        store = 0;
      for (let i = 0; i < N; i++) {
        const y = buf[idx];
        store = y * 0.7 + store * 0.3;
        buf[idx] = input[i] * 0.015 + store * 0.86;
        acc[i] += y;
        if (++idx >= d) idx = 0;
      }
    }
    for (const d0 of aps) {
      const d = d0 + spread;
      const buf = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < N; i++) {
        const b = buf[idx];
        const y = -acc[i] + b;
        buf[idx] = acc[i] + b * 0.5;
        acc[i] = y;
        if (++idx >= d) idx = 0;
      }
    }
    out[ch] = acc;
  }
  return out;
}
function pingPong([inL, inR]) {
  const d = Math.round(0.375 * SR);
  const out = bus();
  const bl = new Float32Array(d),
    br = new Float32Array(d);
  let idx = 0,
    lpL = 0,
    lpR = 0;
  for (let i = 0; i < N; i++) {
    const yl = bl[idx],
      yr = br[idx];
    lpL += 0.35 * (yl - lpL);
    lpR += 0.35 * (yr - lpR);
    bl[idx] = inL[i] + inR[i] * 0.3 + lpR * 0.38;
    br[idx] = lpL * 0.38;
    out[0][i] = yl;
    out[1][i] = yr;
    if (++idx >= d) idx = 0;
  }
  return out;
}

const rv = reverb(revSend);
const dl = pingPong(dlySend);

// master: the half-beat of silence before the drop, and the fade to the end
const gate = (t) => {
  const [s0, s1] = H.silence;
  const [f0, f1] = H.fadeOut;
  let g = 1;
  if (t > s0 - 0.006 && t < s1) g = Math.max(0, Math.min(1, (s0 - t) / 0.006));
  if (t >= f0) g *= Math.max(0, 1 - (t - f0) / (f1 - f0)) ** 1.5;
  return g;
};
const outL = new Float32Array(N),
  outR = new Float32Array(N);
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR;
  const g = gate(t);
  // the reverb tail keeps ringing through the silence at a whisper
  const rg = t > H.silence[0] && t < H.silence[1] ? 0.15 : g;
  const l = (fx[0][i] + music[0][i] * duck[i] + dl[0][i] * 0.55) * g + rv[0][i] * 0.9 * rg;
  const r = (fx[1][i] + music[1][i] * duck[i] + dl[1][i] * 0.55) * g + rv[1][i] * 0.9 * rg;
  // gentle bus saturation
  outL[i] = Math.tanh(l * 0.55);
  outR[i] = Math.tanh(r * 0.55);
  peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
}

// 24-bit stereo WAV, peak-normalized to -1 dBFS (loudness is set in master.sh)
const norm = 10 ** (-1 / 20) / peak;
const bytes = 3;
const data = Buffer.alloc(N * 2 * bytes);
for (let i = 0; i < N; i++) {
  for (const [c, ch] of [outL, outR].entries()) {
    const v = Math.round(clamp(ch[i] * norm, -1, 1) * 8388607);
    data.writeIntLE(v, (i * 2 + c) * bytes, 3);
  }
}
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0);
hdr.writeUInt32LE(36 + data.length, 4);
hdr.write('WAVE', 8);
hdr.write('fmt ', 12);
hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20);
hdr.writeUInt16LE(2, 22);
hdr.writeUInt32LE(SR, 24);
hdr.writeUInt32LE(SR * 2 * bytes, 28);
hdr.writeUInt16LE(2 * bytes, 32);
hdr.writeUInt16LE(bytes * 8, 34);
hdr.write('data', 36);
hdr.writeUInt32LE(data.length, 40);
fs.writeFileSync(path.join(here, 'score-raw.wav'), Buffer.concat([hdr, data]));
console.log(`score-raw.wav: ${DUR}s, peak before normalize ${peak.toFixed(3)}`);
