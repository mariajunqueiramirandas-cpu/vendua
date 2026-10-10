import * as Tone from 'tone';
import { DURATION, G, HITS, SCENES, SFX, T, type Sfx } from './timeline';

// Music and sound effects for Hype30, rendered offline by scripts/render-audio.mjs.
// Everything is placed in absolute seconds from timeline.ts.

export const duration = DURATION;

const CHORDS = [
  ['A3', 'C4', 'E4', 'B4'],
  ['F3', 'A3', 'C4', 'G4'],
  ['C3', 'G3', 'C4', 'E4'],
  ['G3', 'B3', 'D4', 'A4'],
] as const;
const ROOTS = ['A', 'F', 'C', 'G'] as const;
// The drop's hook: [sixteenth in the 2-bar phrase, note, length in sixteenths]
const HOOK: [number, string, number][] = [
  [0, 'E5', 2], [3, 'E5', 1], [4, 'D5', 2], [6, 'C5', 2], [8, 'A4', 3], [11, 'C5', 1], [12, 'D5', 2], [14, 'E5', 2],
  [16, 'G5', 2], [19, 'E5', 1], [20, 'D5', 2], [22, 'C5', 2], [24, 'D5', 3], [27, 'C5', 1], [28, 'A4', 4],
];
// Pentatonic ladder for repeated SFX (pops, ticks) so repeats climb instead of repeating.
const LADDER = ['A5', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7'];
// Chat bubbles: the shopper's messages pan right, Duá's left (T.dua.msgs order).
const SHOPPER = new Set([0, 3, 5, 7]);

export async function score({ only }: { only?: 'music' | 'sfx' } = {}) {
  const { beat, bars } = G;
  const s16 = beat / 4;
  const barOf = (t: number) => Math.floor(t / G.bar + 1e-6);

  // ── buses ──
  const out = new Tone.Gain(0.9).toDestination();
  const glue = new Tone.Compressor({ threshold: -16, ratio: 2.5, attack: 0.02, release: 0.2 }).connect(out);
  // `only` renders one stem (scripts/render-audio.mjs --stems) to balance effects against music
  const music = new Tone.Gain(1).connect(new Tone.Gain(only === 'sfx' ? 0 : 1).connect(glue));
  const sfx = new Tone.Gain(1).connect(new Tone.Gain(only === 'music' ? 0 : 1).connect(glue));
  const verbM = new Tone.Reverb({ decay: 2.8, preDelay: 0.025, wet: 1 }).connect(music);
  const verbS = new Tone.Reverb({ decay: 2.4, preDelay: 0.015, wet: 1 }).connect(sfx);
  await Promise.all([verbM.ready, verbS.ready]);
  const send = (node: Tone.ToneAudioNode, amt: number, verb = verbM) => node.connect(new Tone.Gain(amt).connect(verb));
  const pingpong = new Tone.PingPongDelay({ delayTime: beat * 0.75, feedback: 0.28, wet: 1 }).connect(music);
  send(pingpong, 0.3);

  // sidechain: the chords and bass breathe with every kick
  const pump = new Tone.Gain(1).connect(music);
  const kicks: number[] = [];

  // ── drums ──
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.03,
    octaves: 6.5,
    envelope: { attack: 0.001, decay: 0.34, sustain: 0, release: 0.05 },
    volume: -4,
  }).connect(music);
  const clickHp = new Tone.Filter(3000, 'highpass').connect(music);
  const click = new Tone.NoiseSynth({ envelope: { attack: 0.0005, decay: 0.01, sustain: 0 }, volume: -22 }).connect(clickHp);
  const clapBp = new Tone.Filter({ frequency: 1400, type: 'bandpass', Q: 0.9 }).connect(music);
  send(clapBp, 0.35);
  const clap = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -7 }).connect(clapBp);
  const hatHp = new Tone.Filter(8000, 'highpass').connect(music);
  const hat = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -12 }).connect(hatHp);
  const ohat = new Tone.NoiseSynth({ envelope: { attack: 0.002, decay: 0.16, sustain: 0 }, volume: -18 }).connect(hatHp);
  const shakerHp = new Tone.Filter(9500, 'highpass').connect(music);
  const shaker = new Tone.NoiseSynth({ envelope: { attack: 0.002, decay: 0.022, sustain: 0 }, volume: -20 }).connect(shakerHp);
  const snareBp = new Tone.Filter({ frequency: 2000, type: 'bandpass', Q: 0.7 }).connect(music);
  const snare = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.09, sustain: 0 }, volume: -14 }).connect(snareBp);
  send(snareBp, 0.25);

  const kickAt = (t: number) => {
    kick.triggerAttackRelease('A1', 0.3, t);
    click.triggerAttackRelease(0.01, t);
    kicks.push(t);
  };

  // ── tonal ──
  const bassF = new Tone.Filter(900, 'lowpass').connect(pump);
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { Q: 1.5, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.004, decay: 0.18, sustain: 0.35, release: 0.06 },
    filterEnvelope: { attack: 0.002, decay: 0.16, sustain: 0.2, baseFrequency: 110, octaves: 3 },
    volume: -9,
  }).connect(bassF);
  const sub = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.004, decay: 0.2, sustain: 0.85, release: 0.1 },
    filterEnvelope: { baseFrequency: 300, octaves: 0 },
    volume: -17,
  }).connect(pump);
  const padF = new Tone.Filter(1300, 'lowpass').connect(pump);
  send(padF, 0.35);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
    envelope: { attack: 0.25, decay: 0.4, sustain: 0.7, release: 1.0 },
    volume: -18,
  }).connect(padF);
  const sawF = new Tone.Filter(5200, 'lowpass').connect(pump);
  send(sawF, 0.3);
  const saws = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 6, spread: 36 },
    envelope: { attack: 0.006, decay: 0.3, sustain: 0.6, release: 0.45 },
    volume: -19,
  }).connect(sawF);
  const arpF = new Tone.Filter(1400, 'lowpass').connect(pump);
  arpF.connect(pingpong);
  const arp = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.002, decay: 0.11, sustain: 0, release: 0.08 },
    volume: -15,
  }).connect(arpF);
  const lead = new Tone.Synth({
    oscillator: { type: 'fatsquare', count: 2, spread: 14 },
    envelope: { attack: 0.004, decay: 0.16, sustain: 0.35, release: 0.12 },
    volume: -21,
  });
  const leadF = new Tone.Filter(3600, 'lowpass').connect(music);
  lead.connect(leadF);
  leadF.connect(pingpong);
  send(leadF, 0.25);

  const DROP = SCENES.dua[0];
  const BUILD = T.orders.build;
  const FINAL = T.cta.end;

  // ── arrangement, bar by bar ──
  for (let bar = 0; bar < 15; bar++) {
    const t0 = bars(bar);
    const ch = CHORDS[bar % 4];
    const root = ROOTS[bar % 4];
    const drop = t0 >= DROP;
    const build = t0 === BUILD;

    if (build) {
      // kick on the first two beats, then a snare roll that doubles up into a silent eighth
      kickAt(t0);
      kickAt(t0 + beat);
      const roll = [
        ...[0, 1, 2, 3].map((i) => t0 + i * beat * 0.5),
        ...[0, 1, 2, 3].map((i) => t0 + 2 * beat + i * s16),
        ...[0, 1, 2, 3, 4, 5].map((i) => t0 + 3 * beat + (i * s16) / 2),
      ];
      roll.forEach((t, i) => snare.triggerAttackRelease(0.05, t, 0.35 + (0.65 * i) / roll.length));
      pad.triggerAttackRelease([...ch], G.bar - beat * 0.5, t0, 0.8);
      padF.frequency.setValueAtTime(1300, t0);
      padF.frequency.exponentialRampToValueAtTime(7000, t0 + G.bar - beat * 0.5);
      for (let i = 0; i < 8; i++) bass.triggerAttackRelease(`${root}2`, s16 * 1.5, t0 + i * beat * 0.5);
      continue;
    }

    for (let q = 0; q < 4; q++) {
      const t = t0 + q * beat;
      kickAt(t);
      if (q % 2 === 1) clap.triggerAttackRelease(0.1, t);
      hat.triggerAttackRelease(0.03, t + beat / 2, 0.9);
      if (drop || bar >= 4) ohat.triggerAttackRelease(0.1, t + beat / 2, 0.7);
      for (let s = 0; s < 4; s++) shaker.triggerAttackRelease(0.02, t + s * s16, s % 2 ? 0.45 : 0.8);
      bass.triggerAttackRelease(`${root}2`, beat * 0.4, t + beat / 2, 0.9);
      if (drop) bass.triggerAttackRelease(`${root}3`, s16 * 0.8, t + beat * 0.75, 0.6);
    }

    if (drop) {
      saws.triggerAttackRelease([...ch, `${root}5`], G.bar * 0.95, t0, 0.9);
      sub.triggerAttackRelease(`${root}1`, G.bar * 0.95, t0);
      const phrase = (bar - barOf(DROP)) % 2;
      for (const [s, note, len] of HOOK) {
        const at = s - phrase * 16;
        if (at < 0 || at >= 16) continue;
        lead.triggerAttackRelease(note, len * s16 * 0.9, t0 + at * s16, 0.85);
      }
    } else {
      pad.triggerAttackRelease([...ch], G.bar * 0.98, t0, 0.7);
      // the arp opens up across the intro so energy builds without new parts
      arpF.frequency.setValueAtTime(1400 + bar * 420, t0);
      const notes = [ch[0], ch[1], ch[2], ch[3], ch[2], ch[1]].map((n) => Tone.Frequency(n).transpose(12).toNote());
      for (let s = 0; s < 16; s++) arp.triggerAttackRelease(notes[s % notes.length], s16 * 0.8, t0 + s * s16, s % 4 === 0 ? 1 : 0.6);
    }
  }

  // the final stab: one chord with a sub, ringing out to the end
  saws.triggerAttackRelease(['A3', 'C4', 'E4', 'B4', 'A4', 'E5'], 1.0, FINAL, 1);
  pad.triggerAttackRelease(['A3', 'C4', 'E4', 'B4'], 1.6, FINAL, 0.8);
  sub.triggerAttackRelease('A1', 1.2, FINAL);
  kickAt(FINAL);

  for (const k of kicks) {
    pump.gain.setValueAtTime(0.3, k);
    pump.gain.linearRampToValueAtTime(1, k + beat * 0.42);
  }

  // ── sound effects ──
  const place = (node: Tone.ToneAudioNode, pan = 0, wet = 0.2) => {
    const p = new Tone.Panner(pan).connect(sfx);
    node.connect(p);
    if (wet) send(p, wet, verbS);
    return node;
  };
  const env = (g: Tone.Gain, t: number, a: number, peak: number, d: number) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const noise = (type: 'white' | 'pink', t: number, len: number, into: Tone.ToneAudioNode) =>
    new Tone.Noise(type).connect(into).start(t).stop(t + len);
  const tone = (wave: 'sine' | 'triangle', f0: number, f1: number, t: number, glide: number, a: number, d: number, peak: number, pan = 0, wet = 0.2) => {
    const g = place(new Tone.Gain(0), pan, wet) as Tone.Gain;
    const o = new Tone.Oscillator(f0, wave).connect(g);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    o.start(t).stop(t + a + d + 0.05);
    env(g, t, a, peak, d);
  };
  const bell = (note: string, t: number, peak: number, pan = 0) => {
    const fm = new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 1.4,
      envelope: { attack: 0.002, decay: 1.1, sustain: 0, release: 0.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
    });
    fm.volume.value = Tone.gainToDb(peak);
    place(fm, pan, 0.45);
    fm.triggerAttackRelease(note, 0.5, t);
  };
  const hz = (n: string) => Tone.Frequency(n).toFrequency();

  const play: Record<Sfx, (t: number, n: number, dur: number) => void> = {
    impact: (t) => {
      tone('sine', 110, 38, t, 0.45, 0.003, 0.7, 0.8, 0, 0);
      const lp = place(new Tone.Filter(1600, 'lowpass'), 0, 0.6);
      const g = new Tone.Gain(0).connect(lp);
      noise('pink', t, 0.8, g);
      env(g, t, 0.004, 0.4, 0.6);
    },
    drop: (t) => {
      tone('sine', 140, 34, t, 0.8, 0.003, 1.3, 0.75, 0, 0);
      const lp = place(new Tone.Filter(2400, 'lowpass'), 0, 0.8);
      const g = new Tone.Gain(0).connect(lp);
      noise('pink', t, 1.6, g);
      env(g, t, 0.004, 0.3, 1.3);
      bell('A6', t + 0.01, 0.12);
    },
    whoosh: (t, _n, dur) => {
      const f = place(new Tone.Filter({ frequency: 300, type: 'bandpass', Q: 1.1 }), 0, 0.3) as Tone.Filter;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(4200, t + dur);
      const g = new Tone.Gain(0).connect(f);
      noise('pink', t, dur + 0.05, g);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1.2, t + dur * 0.85);
      g.gain.linearRampToValueAtTime(0, t + dur);
    },
    swish: (t) => {
      const f = place(new Tone.Filter({ frequency: 5000, type: 'bandpass', Q: 1.4 }), 0.2, 0.25) as Tone.Filter;
      f.frequency.setValueAtTime(5000, t);
      f.frequency.exponentialRampToValueAtTime(900, t + 0.22);
      const g = new Tone.Gain(0).connect(f);
      noise('white', t, 0.3, g);
      env(g, t, 0.03, 0.6, 0.2);
    },
    pop: (t, n) => {
      const f = hz(LADDER[n % LADDER.length]) / 2;
      tone('sine', f, f * 1.5, t, 0.04, 0.002, 0.12, 0.38, n % 2 ? 0.25 : -0.25, 0.25);
    },
    bubble: (t, n) => {
      const me = SHOPPER.has(n);
      const f = me ? 520 : 680;
      tone('sine', f, f * 2.1, t, 0.05, 0.002, 0.09, 0.42, me ? 0.4 : -0.4, 0.2);
    },
    tick: (t, n) => tone('sine', 2600 + n * 180, 2400 + n * 180, t, 0.02, 0.001, 0.025, 0.32, 0, 0.1),
    ping: (t) => bell('E6', t, 0.3),
    chime: (t) => {
      bell('A5', t, 0.25, -0.15);
      bell('E6', t + 0.09, 0.22, 0.15);
    },
    lock: (t, n) => {
      tone('sine', 220 - n * 30, 120, t, 0.06, 0.002, 0.12, 0.7, 0, 0.1);
      tone('triangle', 3200, 3000, t, 0.01, 0.001, 0.03, 0.3, 0, 0);
    },
    shimmer: (t) => ['A6', 'C7', 'E7', 'A7'].forEach((note, i) => bell(note, t + i * 0.06, 0.2, i % 2 ? 0.3 : -0.3)),
    tap: (t) => tone('sine', 1400, 900, t, 0.02, 0.001, 0.04, 0.25, 0, 0),
    riser: (t, _n, dur) => {
      const end = dur - beat / 2; // stops an eighth early: the gap before the drop
      const f = place(new Tone.Filter({ frequency: 400, type: 'highpass' }), 0, 0.4) as Tone.Filter;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(7000, t + end);
      const g = new Tone.Gain(0).connect(f);
      noise('white', t, end, g);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + end * 0.97);
      g.gain.linearRampToValueAtTime(0, t + end);
      const sg = place(new Tone.Gain(0), 0, 0.3) as Tone.Gain;
      const o = new Tone.Oscillator(hz('A3'), 'sawtooth').connect(new Tone.Filter(2500, 'lowpass').connect(sg));
      o.frequency.setValueAtTime(hz('A3'), t);
      o.frequency.exponentialRampToValueAtTime(hz('A5'), t + end);
      o.start(t).stop(t + end);
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(0.07, t + end * 0.97);
      sg.gain.linearRampToValueAtTime(0, t + end);
    },
    scribble: (t) => {
      const f = place(new Tone.Filter({ frequency: 2600, type: 'bandpass', Q: 2 }), 0.1, 0.1);
      const g = new Tone.Gain(0).connect(f);
      noise('white', t, 0.4, g);
      for (let i = 0; i < 6; i++) {
        g.gain.setValueAtTime(0.0001, t + i * 0.055);
        g.gain.linearRampToValueAtTime(0.4, t + i * 0.055 + 0.015);
        g.gain.linearRampToValueAtTime(0.02, t + i * 0.055 + 0.05);
      }
      g.gain.linearRampToValueAtTime(0, t + 0.36);
    },
  };
  for (const c of SFX) play[c.kind](c.t, c.n ?? 0, c.dur ?? 0.4);

  // the music ducks ~2.5 dB under each short effect; long sweeps don't duck
  const hits = SFX.filter((c) => !['whoosh', 'riser'].includes(c.kind)).map((c) => c.t);
  const dip = (t: number) => hits.reduce((m, h) => (t >= h - 0.01 && t < h + 0.25 ? Math.min(m, t < h + 0.03 ? 0.75 : 0.75 + ((t - h - 0.03) / 0.22) * 0.25) : m), 1);
  for (let t = 0; t < DURATION; t += 0.01) music.gain.linearRampToValueAtTime(dip(t), t);

  // impacts also land on the camera hits that have no effect of their own
  for (const h of HITS) if (!SFX.some((c) => Math.abs(c.t - h) < 0.02)) play.impact(h, 0, 0);
}
