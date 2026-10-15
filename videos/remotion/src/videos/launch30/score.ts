import * as Tone from 'tone';
import { DURATION, G, SFX, T, type Sfx } from './timeline';

// Music and sound effects for Launch30, rendered offline by scripts/render-audio.mjs.
// D minor, 96 BPM, cinematic: a felt-piano arpeggio over pads, a soft pulse from the product
// shots, one deep hit on the date, a resolve on the end card. Placed from timeline.ts.

export const duration = DURATION;

const CH = {
  Dm9: ['D3', 'F3', 'A3', 'C4', 'E4'],
  Bb: ['Bb2', 'D3', 'F3', 'A3', 'C4'],
  F: ['F2', 'C3', 'A3', 'E4', 'G4'],
  C: ['C3', 'G3', 'D4', 'E4', 'G4'],
} as const;
type Chord = keyof typeof CH;
const PLAN: Chord[] = ['Dm9', 'Bb', 'F', 'C', 'Dm9', 'Bb', 'F', 'C', 'Bb', 'C', 'Dm9', 'Dm9'];
const ROOT: Record<Chord, string> = { Dm9: 'D', Bb: 'Bb', F: 'F', C: 'C' };
// the date's melody, [bar, beat, note, beats]
const THEME: [number, number, string, number][] = [
  [8, 0, 'D5', 1.5], [8, 1.5, 'F5', 0.5], [8, 2, 'A5', 2],
  [9, 0, 'G5', 1.5], [9, 1.5, 'F5', 0.5], [9, 2, 'E5', 2],
  [10, 0, 'D5', 4],
];
const LADDER = ['D6', 'F6', 'A6', 'C7', 'D7', 'E7'];

export async function score({ only }: { only?: 'music' | 'sfx' } = {}) {
  const { beat, bar, bars } = G;
  const HIT = T.date.hit;
  const END = T.end.mark;

  // ── buses ──
  const out = new Tone.Gain(0.9).toDestination();
  const glue = new Tone.Compressor({ threshold: -18, ratio: 2, attack: 0.03, release: 0.3 }).connect(out);
  const music = new Tone.Gain(1).connect(new Tone.Gain(only === 'sfx' ? 0 : 1).connect(glue));
  const sfx = new Tone.Gain(1).connect(new Tone.Gain(only === 'music' ? 0 : 1).connect(glue));
  const hall = new Tone.Reverb({ decay: 5.5, preDelay: 0.04, wet: 1 }).connect(music);
  const verbS = new Tone.Reverb({ decay: 4, preDelay: 0.02, wet: 1 }).connect(sfx);
  await Promise.all([hall.ready, verbS.ready]);
  const send = (node: Tone.ToneAudioNode, amt: number, verb = hall) => node.connect(new Tone.Gain(amt).connect(verb));
  const echo = new Tone.PingPongDelay({ delayTime: beat * 0.75, feedback: 0.32, wet: 1 }).connect(music);
  send(echo, 0.5);

  // ── instruments ──
  const padF = new Tone.Filter(800, 'lowpass').connect(music);
  send(padF, 0.6);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
    envelope: { attack: 1.4, decay: 0.5, sustain: 0.8, release: 2.6 },
    volume: -20,
  }).connect(padF);
  const strF = new Tone.Filter(600, 'lowpass').connect(music);
  send(strF, 0.7);
  const strings = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 5, spread: 30 },
    envelope: { attack: 1.2, decay: 0.3, sustain: 0.9, release: 2.2 },
    volume: -24,
  }).connect(strF);
  // felt piano: a soft triangle pluck, dark and wet
  const pianoF = new Tone.Filter(2200, 'lowpass').connect(music);
  send(pianoF, 0.55);
  pianoF.connect(new Tone.Gain(0.25).connect(echo));
  const piano = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.006, decay: 1.6, sustain: 0, release: 1.4 },
    volume: -13,
  }).connect(pianoF);
  const bellM = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 3.01,
    modulationIndex: 1.1,
    envelope: { attack: 0.004, decay: 2.2, sustain: 0, release: 1.5 },
    modulationEnvelope: { attack: 0.004, decay: 0.4, sustain: 0, release: 0.3 },
    volume: -17,
  });
  bellM.connect(music);
  send(bellM, 0.6);
  bellM.connect(new Tone.Gain(0.3).connect(echo));
  const sub = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.3, decay: 0.4, sustain: 0.9, release: 1.2 },
    filterEnvelope: { baseFrequency: 300, octaves: 0 },
    volume: -14,
  }).connect(music);
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.05,
    octaves: 5,
    envelope: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.1 },
    volume: -9,
  }).connect(music);
  const shakerHp = new Tone.Filter(8000, 'highpass').connect(music);
  const shaker = new Tone.NoiseSynth({ envelope: { attack: 0.004, decay: 0.03, sustain: 0 }, volume: -28 }).connect(shakerHp);
  const snareBp = new Tone.Filter({ frequency: 1800, type: 'bandpass', Q: 0.6 }).connect(music);
  send(snareBp, 0.9);
  const snare = new Tone.NoiseSynth({ envelope: { attack: 0.002, decay: 0.16, sustain: 0 }, volume: -17 }).connect(snareBp);

  // ── arrangement ──
  for (let i = 0; i < PLAN.length - 1; i++) {
    const t0 = bars(i);
    const c = PLAN[i];
    const notes = CH[c];
    // bar 10's chord rings through the end card
    const len = i === 10 ? bar * 2 : bar;
    pad.triggerAttackRelease([...notes], len * 0.98, t0, i >= 8 ? 0.9 : 0.6 + i * 0.03);
    if (i >= 2) sub.triggerAttackRelease(`${ROOT[c]}1`, len * 0.95, t0, i >= 8 ? 1 : 0.7);
    if (i >= 4 && i < 10) strings.triggerAttackRelease(notes.slice(1).map((n) => Tone.Frequency(n).transpose(12).toNote()), bar * 0.97, t0, 0.5 + (i - 4) * 0.1);

    // the arpeggio: quarters to begin with, eighths under the product shots, chords on the date
    const up = notes.map((n) => Tone.Frequency(n).transpose(12).toNote());
    const arp = [up[0], up[2], up[4], up[3], up[1], up[2], up[4], up[3]];
    if (i < 4) {
      for (let q = 0; q < 4; q++) piano.triggerAttackRelease(arp[q * 2 + (i % 2)], beat * 1.5, t0 + q * beat, q === 0 ? 0.85 : 0.6);
    } else if (i < 8) {
      for (let e = 0; e < 8; e++) {
        if (i === 7 && e === 7) break; // a held breath before the date
        piano.triggerAttackRelease(arp[e], beat, t0 + (e * beat) / 2, e % 2 ? 0.45 : 0.7);
      }
    } else if (i < 10) {
      piano.triggerAttackRelease(up.slice(0, 4), bar, t0, 0.8);
      piano.triggerAttackRelease(up.slice(1, 4), bar * 0.6, t0 + beat * 2, 0.55);
    } else {
      // the end card: the arpeggio slows and stops on the ninth
      const tail = [up[0], up[2], up[4], up[3], up[2], 'E6'];
      [0, 1, 2, 3, 4, 6].forEach((q, k) => piano.triggerAttackRelease(tail[k], beat * 2, t0 + q * beat, 0.7 - k * 0.07));
    }

    // a quiet pulse under the product shots and the date; out on bar 7's last eighth
    if (i >= 4 && i < 10) {
      for (let q = 0; q < 4; q++) {
        const t = t0 + q * beat;
        if (q % 2 === 0) kick.triggerAttackRelease('D1', 0.4, t, i >= 8 ? 1 : 0.7);
        if (i >= 8 && q === 2) snare.triggerAttackRelease(0.15, t, 0.8);
        for (let s = 0; s < 2; s++) if (!(i === 7 && q === 3 && s === 1)) shaker.triggerAttackRelease(0.03, t + (s * beat) / 2, s ? 0.5 : 0.8);
      }
    }
  }
  strF.frequency.setValueAtTime(600, bars(4));
  strF.frequency.exponentialRampToValueAtTime(3200, HIT - 0.1);
  strF.frequency.setValueAtTime(2400, HIT);
  padF.frequency.setValueAtTime(800, 0);
  padF.frequency.linearRampToValueAtTime(1600, HIT - 0.1);
  padF.frequency.setValueAtTime(2200, HIT);
  padF.frequency.exponentialRampToValueAtTime(900, DURATION);
  // bar 7 holds its breath for an eighth before the hit
  music.gain.setValueAtTime(1, HIT - beat / 2 - 0.05);
  music.gain.linearRampToValueAtTime(0.35, HIT - beat / 2);
  music.gain.setValueAtTime(0.35, HIT - 0.02);
  music.gain.linearRampToValueAtTime(1, HIT);

  for (const [b, q, note, dur] of THEME) bellM.triggerAttackRelease(note, dur * beat, bars(b) + q * beat, 0.8);
  sub.triggerAttackRelease('D1', 3.2, END, 0.9);

  // ── sound effects ──
  const place = (node: Tone.ToneAudioNode, pan = 0, wet = 0.3) => {
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
  const noise = (type: 'white' | 'pink' | 'brown', t: number, len: number, into: Tone.ToneAudioNode) =>
    new Tone.Noise(type).connect(into).start(t).stop(t + len);
  const tone = (f0: number, f1: number, t: number, glide: number, a: number, d: number, peak: number, pan = 0, wet = 0.3) => {
    const g = place(new Tone.Gain(0), pan, wet) as Tone.Gain;
    const o = new Tone.Oscillator(f0, 'sine').connect(g);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    o.start(t).stop(t + a + d + 0.05);
    env(g, t, a, peak, d);
  };
  const bell = (note: string, t: number, peak: number, pan = 0, decay = 1.6) => {
    const fm = new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 1.2,
      envelope: { attack: 0.003, decay, sustain: 0, release: 0.6 },
      modulationEnvelope: { attack: 0.003, decay: 0.3, sustain: 0, release: 0.2 },
    });
    fm.volume.value = Tone.gainToDb(peak);
    place(fm, pan, 0.55);
    fm.triggerAttackRelease(note, 0.5, t);
  };

  const play: Record<Sfx, (t: number, n: number, dur: number) => void> = {
    // a warm low bloom with glass on top: the mark appearing
    bloom: (t) => {
      tone(85, 42, t, 1.2, 0.05, 2.2, 0.35, 0, 0.2);
      bell('D6', t + 0.02, 0.22, -0.2, 2.4);
      bell('A6', t + 0.1, 0.18, 0.2, 2.4);
    },
    // the date: a deep hit that rolls off over two seconds
    boom: (t) => {
      tone(110, 30, t, 1.4, 0.004, 3, 0.95, 0, 0.1);
      const lp = place(new Tone.Filter(1800, 'lowpass'), 0, 0.8) as Tone.Filter;
      lp.frequency.setValueAtTime(1800, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + 2.5);
      const g = new Tone.Gain(0).connect(lp);
      noise('brown', t, 3, g);
      env(g, t, 0.005, 0.9, 2.8);
      bell('D5', t + 0.01, 0.25, 0, 3);
    },
    // a soft breath of air between shots
    air: (t, _n, dur) => {
      const f = place(new Tone.Filter({ frequency: 500, type: 'bandpass', Q: 0.8 }), 0, 0.5) as Tone.Filter;
      f.frequency.setValueAtTime(500, t);
      f.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.55);
      f.frequency.exponentialRampToValueAtTime(900, t + dur);
      const g = new Tone.Gain(0).connect(f);
      noise('pink', t, dur + 0.05, g);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1.7, t + dur * 0.55);
      g.gain.linearRampToValueAtTime(0, t + dur);
    },
    glass: (t, n) => bell(LADDER[n % LADDER.length], t, 0.8, n % 2 ? 0.25 : -0.25),
    chime: (t) => {
      bell('A5', t, 0.65, -0.15, 1.2);
      bell('D6', t + 0.11, 0.6, 0.15, 1.4);
    },
    paid: (t) => {
      ['D6', 'F6', 'A6'].forEach((note, i) => bell(note, t + i * 0.08, 0.4, -0.25 + i * 0.25, 1.4));
      tone(120, 70, t, 0.12, 0.004, 0.3, 0.4, 0, 0);
    },
    toggle: (t, n) => {
      tone(900 + n * 200, 700 + n * 200, t, 0.03, 0.002, 0.06, 0.8, 0, 0.15);
      tone(240, 150, t, 0.04, 0.002, 0.08, 0.7, 0, 0);
    },
    bubble: (t, n) => tone(n ? 700 : 560, n ? 1300 : 1050, t, 0.05, 0.003, 0.12, 0.95, n ? -0.3 : 0.3, 0.3),
    // the breath in before the date, stopping just short of the hit
    swell: (t, _n, dur) => {
      const end = dur - 0.08;
      const f = place(new Tone.Filter({ frequency: 300, type: 'lowpass' }), 0, 0.4) as Tone.Filter;
      f.frequency.setValueAtTime(300, t);
      f.frequency.exponentialRampToValueAtTime(5000, t + end);
      const g = new Tone.Gain(0).connect(f);
      noise('pink', t, end, g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.85, t + end);
      g.gain.linearRampToValueAtTime(0, t + end + 0.02);
    },
    shimmer: (t) => ['D7', 'F7', 'A7'].forEach((note, i) => bell(note, t + i * 0.09, 0.5, i % 2 ? 0.3 : -0.3, 2)),
  };
  for (const c of SFX) play[c.kind](c.t, c.n ?? 0, c.dur ?? 0.5);
}
