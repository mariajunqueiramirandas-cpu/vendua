import * as Tone from 'tone';
import { DURATION, G, HITS, SCENES, SFX, ZERO, type Sfx } from './timeline';

// Music and sound effects for Launch30, rendered offline by scripts/render-audio.mjs.
// D minor, 128 BPM. Everything is placed in absolute seconds from timeline.ts.

export const duration = DURATION;

const CHORDS = [
  ['D3', 'F3', 'A3', 'E4'],
  ['Bb2', 'D3', 'F3', 'A3'],
  ['F3', 'A3', 'C4', 'G4'],
  ['C3', 'G3', 'C4', 'E4'],
] as const;
const ROOTS = ['D', 'Bb', 'F', 'C'] as const;
const BASS_OCT = [2, 1, 2, 2];
// The drops' hook: [sixteenth in the 2-bar phrase, note, length in sixteenths]
const HOOK: [number, string, number][] = [
  [0, 'A5', 2], [2, 'G5', 1], [3, 'F5', 1], [4, 'E5', 2], [6, 'D5', 2], [8, 'F5', 3], [11, 'E5', 1], [12, 'D5', 2], [14, 'C5', 2],
  [16, 'D5', 2], [18, 'E5', 1], [19, 'F5', 1], [20, 'G5', 2], [22, 'A5', 2], [24, 'C6', 3], [27, 'A5', 1], [28, 'D6', 4],
];
// D minor pentatonic, so repeated effects climb instead of repeating
const LADDER = ['D6', 'F6', 'G6', 'A6', 'C7', 'D7', 'F7', 'G7', 'A7'];

export async function score({ only }: { only?: 'music' | 'sfx' } = {}) {
  const { beat, bars } = G;
  const s16 = beat / 4;

  // ── buses ──
  const out = new Tone.Gain(0.9).toDestination();
  const glue = new Tone.Compressor({ threshold: -16, ratio: 2.5, attack: 0.02, release: 0.2 }).connect(out);
  const music = new Tone.Gain(1).connect(new Tone.Gain(only === 'sfx' ? 0 : 1).connect(glue));
  const sfx = new Tone.Gain(1).connect(new Tone.Gain(only === 'music' ? 0 : 1).connect(glue));
  const verbM = new Tone.Reverb({ decay: 3.2, preDelay: 0.025, wet: 1 }).connect(music);
  const verbS = new Tone.Reverb({ decay: 2.6, preDelay: 0.015, wet: 1 }).connect(sfx);
  await Promise.all([verbM.ready, verbS.ready]);
  const send = (node: Tone.ToneAudioNode, amt: number, verb = verbM) => node.connect(new Tone.Gain(amt).connect(verb));
  const pingpong = new Tone.PingPongDelay({ delayTime: beat * 0.75, feedback: 0.3, wet: 1 }).connect(music);
  send(pingpong, 0.3);

  // sidechain: the chords and bass breathe with every kick
  const pump = new Tone.Gain(1).connect(music);
  const kicks: number[] = [];

  // ── drums ──
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.032,
    octaves: 6.5,
    envelope: { attack: 0.001, decay: 0.36, sustain: 0, release: 0.05 },
    volume: -4,
  }).connect(music);
  const clickHp = new Tone.Filter(3200, 'highpass').connect(music);
  const click = new Tone.NoiseSynth({ envelope: { attack: 0.0005, decay: 0.01, sustain: 0 }, volume: -22 }).connect(clickHp);
  const clapBp = new Tone.Filter({ frequency: 1500, type: 'bandpass', Q: 0.9 }).connect(music);
  send(clapBp, 0.4);
  const clap = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.17, sustain: 0 }, volume: -7 }).connect(clapBp);
  const hatHp = new Tone.Filter(8200, 'highpass').connect(music);
  const hat = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -12 }).connect(hatHp);
  const ohat = new Tone.NoiseSynth({ envelope: { attack: 0.002, decay: 0.17, sustain: 0 }, volume: -18 }).connect(hatHp);
  const shakerHp = new Tone.Filter(9500, 'highpass').connect(music);
  const shaker = new Tone.NoiseSynth({ envelope: { attack: 0.002, decay: 0.022, sustain: 0 }, volume: -20 }).connect(shakerHp);
  const snareBp = new Tone.Filter({ frequency: 2100, type: 'bandpass', Q: 0.7 }).connect(music);
  const snare = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.09, sustain: 0 }, volume: -14 }).connect(snareBp);
  send(snareBp, 0.25);

  const kickAt = (t: number, v = 1) => {
    kick.triggerAttackRelease('D1', 0.3, t, v);
    click.triggerAttackRelease(0.01, t);
    kicks.push(t);
  };

  // ── tonal ──
  const bassF = new Tone.Filter(950, 'lowpass').connect(pump);
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { Q: 1.5, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.004, decay: 0.18, sustain: 0.35, release: 0.06 },
    filterEnvelope: { attack: 0.002, decay: 0.16, sustain: 0.2, baseFrequency: 110, octaves: 3 },
    volume: -9,
  }).connect(bassF);
  const sub = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.004, decay: 0.2, sustain: 0.85, release: 0.15 },
    filterEnvelope: { baseFrequency: 300, octaves: 0 },
    volume: -16,
  }).connect(pump);
  const padF = new Tone.Filter(1300, 'lowpass').connect(pump);
  send(padF, 0.4);
  const pad = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 26 },
    envelope: { attack: 0.25, decay: 0.4, sustain: 0.7, release: 1.2 },
    volume: -18,
  }).connect(padF);
  const sawF = new Tone.Filter(5400, 'lowpass').connect(pump);
  send(sawF, 0.32);
  const saws = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 6, spread: 40 },
    envelope: { attack: 0.006, decay: 0.3, sustain: 0.6, release: 0.5 },
    volume: -19,
  }).connect(sawF);
  // a glassy layer an octave over the saws on the second drop: the launch should feel bigger
  const glass = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2,
    modulationIndex: 1.2,
    envelope: { attack: 0.01, decay: 0.6, sustain: 0.3, release: 0.8 },
    volume: -25,
  });
  glass.connect(pingpong);
  send(glass, 0.5);
  const arpF = new Tone.Filter(1400, 'lowpass').connect(pump);
  arpF.connect(pingpong);
  const arp = new Tone.Synth({
    oscillator: { type: 'square' },
    envelope: { attack: 0.002, decay: 0.09, sustain: 0, release: 0.06 },
    volume: -19,
  }).connect(arpF);
  const lead = new Tone.Synth({
    oscillator: { type: 'fatsquare', count: 2, spread: 14 },
    envelope: { attack: 0.004, decay: 0.16, sustain: 0.35, release: 0.12 },
    volume: -21,
  });
  const leadF = new Tone.Filter(3800, 'lowpass').connect(music);
  lead.connect(leadF);
  leadF.connect(pingpong);
  send(leadF, 0.25);

  const DROP1 = bars(8);
  const BUILD = bars(7);
  const COUNT = bars(11);
  const END = SCENES.end[0];
  const isDrop = (t0: number) => (t0 >= DROP1 && t0 < bars(10)) || (t0 >= ZERO && t0 < END);

  // ── arrangement, bar by bar ──
  for (let bar = 0; bar < 14; bar++) {
    const t0 = bars(bar);
    const ch = CHORDS[bar % 4];
    const root = ROOTS[bar % 4];
    const bassNote = `${root}${BASS_OCT[bar % 4]}`;
    const drop = isDrop(t0);

    if (t0 === BUILD) {
      // Duá boots: kick on the first two beats, then a snare roll that doubles up into a silent eighth
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
      padF.frequency.setValueAtTime(1300, t0 + G.bar);
      for (let i = 0; i < 8; i++) bass.triggerAttackRelease(bassNote, s16 * 1.5, t0 + i * beat * 0.5);
      continue;
    }

    if (t0 === COUNT) {
      // the countdown: drums out, a D pedal under a clock ticking on the eighths
      pad.triggerAttackRelease(['D3', 'A3', 'D4', 'E4'], G.bar - beat * 0.5, t0, 0.6);
      sub.triggerAttackRelease('D1', G.bar - beat, t0, 0.8);
      for (let i = 0; i < 7; i++) hat.triggerAttackRelease(0.03, t0 + i * beat * 0.5, i % 2 ? 0.5 : 0.9);
      continue;
    }

    for (let q = 0; q < 4; q++) {
      const t = t0 + q * beat;
      kickAt(t);
      if (q % 2 === 1 && (bar >= 1 || q === 3)) clap.triggerAttackRelease(0.1, t);
      hat.triggerAttackRelease(0.03, t + beat / 2, 0.9);
      if (bar >= 2) ohat.triggerAttackRelease(0.1, t + beat / 2, drop ? 0.9 : 0.6);
      for (let s = 0; s < 4; s++) shaker.triggerAttackRelease(0.02, t + s * s16, s % 2 ? 0.45 : 0.8);
      bass.triggerAttackRelease(bassNote, beat * 0.4, t + beat / 2, 0.9);
      if (drop) bass.triggerAttackRelease(`${root}${BASS_OCT[bar % 4] + 1}`, s16 * 0.8, t + beat * 0.75, 0.6);
    }

    if (drop) {
      saws.triggerAttackRelease([...ch, `${root}5`], G.bar * 0.95, t0, 0.9);
      sub.triggerAttackRelease(`${root}1`, G.bar * 0.95, t0);
      const phrase = (bar - (t0 >= ZERO ? 12 : 8)) % 2;
      for (const [s, note, len] of HOOK) {
        const at = s - phrase * 16;
        if (at < 0 || at >= 16) continue;
        lead.triggerAttackRelease(note, len * s16 * 0.9, t0 + at * s16, 0.85);
        if (t0 >= ZERO) glass.triggerAttackRelease(Tone.Frequency(note).transpose(12).toNote(), len * s16 * 0.9, t0 + at * s16, 0.5);
      }
    } else {
      pad.triggerAttackRelease([...ch], G.bar * 0.98, t0, 0.7);
      // the arp opens up through the checks: energy builds without new parts
      arpF.frequency.setValueAtTime(1300 + Math.min(bar, 7) * 450, t0);
      const notes = [ch[0], ch[2], ch[3], ch[1], ch[2], ch[3]].map((n) => Tone.Frequency(n).transpose(12).toNote());
      for (let s = 0; s < 16; s++) arp.triggerAttackRelease(notes[s % notes.length], s16 * 0.7, t0 + s * s16, s % 4 === 0 ? 1 : 0.55);
    }
  }

  // the end card: one wide chord with a sub, then the arp echoing out under the logo
  saws.triggerAttackRelease(['D3', 'F3', 'A3', 'E4', 'D4', 'A4'], 1.2, END, 1);
  glass.triggerAttackRelease(['D5', 'A5', 'E6'], 1.4, END, 0.6);
  pad.triggerAttackRelease(['D3', 'F3', 'A3', 'E4'], 3.2, END, 0.8);
  sub.triggerAttackRelease('D1', 1.6, END);
  kickAt(END);
  arpF.frequency.setValueAtTime(2600, END);
  arpF.frequency.exponentialRampToValueAtTime(500, DURATION - 0.2);
  const tail = ['D5', 'A5', 'E5', 'F5', 'A5', 'C6', 'A5', 'E5'];
  for (let s = 4; s < 32 && END + s * s16 * 2 < DURATION - 0.3; s++)
    arp.triggerAttackRelease(tail[s % tail.length], s16 * 0.7, END + s * s16 * 2, 0.7 * (1 - s / 34));

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
  const noise = (type: 'white' | 'pink' | 'brown', t: number, len: number, into: Tone.ToneAudioNode) =>
    new Tone.Noise(type).connect(into).start(t).stop(t + len);
  const tone = (wave: 'sine' | 'triangle', f0: number, f1: number, t: number, glide: number, a: number, d: number, peak: number, pan = 0, wet = 0.2) => {
    const g = place(new Tone.Gain(0), pan, wet) as Tone.Gain;
    const o = new Tone.Oscillator(f0, wave).connect(g);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + glide);
    o.start(t).stop(t + a + d + 0.05);
    env(g, t, a, peak, d);
  };
  const bell = (note: string, t: number, peak: number, pan = 0, decay = 1.1) => {
    const fm = new Tone.FMSynth({
      harmonicity: 3.01,
      modulationIndex: 1.4,
      envelope: { attack: 0.002, decay, sustain: 0, release: 0.4 },
      modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
    });
    fm.volume.value = Tone.gainToDb(peak);
    place(fm, pan, 0.45);
    fm.triggerAttackRelease(note, 0.5, t);
  };
  const hz = (n: string) => Tone.Frequency(n).toFrequency();
  const swell = (t: number, dur: number, f0: number, f1: number, peak: number, type: 'white' | 'pink' = 'pink') => {
    const f = place(new Tone.Filter({ frequency: f0, type: 'bandpass', Q: 1.1 }), 0, 0.3) as Tone.Filter;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = new Tone.Gain(0).connect(f);
    noise(type, t, dur + 0.05, g);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + dur * 0.85);
    g.gain.linearRampToValueAtTime(0, t + dur);
  };

  const play: Record<Sfx, (t: number, n: number, dur: number) => void> = {
    impact: (t) => {
      tone('sine', 110, 36, t, 0.45, 0.003, 0.7, 0.8, 0, 0);
      const lp = place(new Tone.Filter(1600, 'lowpass'), 0, 0.6);
      const g = new Tone.Gain(0).connect(lp);
      noise('pink', t, 0.8, g);
      env(g, t, 0.004, 0.4, 0.6);
    },
    drop: (t) => {
      tone('sine', 140, 33, t, 0.8, 0.003, 1.3, 0.75, 0, 0);
      const lp = place(new Tone.Filter(2400, 'lowpass'), 0, 0.8);
      const g = new Tone.Gain(0).connect(lp);
      noise('pink', t, 1.6, g);
      env(g, t, 0.004, 0.3, 1.3);
      bell('D7', t + 0.01, 0.12);
    },
    whoosh: (t, _n, dur) => swell(t, dur, 300, 4200, 2.2),
    swish: (t) => {
      const f = place(new Tone.Filter({ frequency: 5000, type: 'bandpass', Q: 1.4 }), 0.2, 0.25) as Tone.Filter;
      f.frequency.setValueAtTime(5000, t);
      f.frequency.exponentialRampToValueAtTime(900, t + 0.22);
      const g = new Tone.Gain(0).connect(f);
      noise('white', t, 0.3, g);
      env(g, t, 0.03, 2.0, 0.2);
    },
    pop: (t, n) => {
      const f = hz(LADDER[n % LADDER.length]) / 2;
      tone('sine', f, f * 1.5, t, 0.04, 0.002, 0.12, 0.9, n % 2 ? 0.25 : -0.25, 0.25);
    },
    bubble: (t, n) => {
      const f = n % 2 ? 520 : 680;
      tone('sine', f, f * 2.1, t, 0.05, 0.002, 0.09, 1.0, n % 2 ? 0.4 : -0.4, 0.2);
    },
    tick: (t, n) => tone('sine', 2600 + n * 180, 2400 + n * 180, t, 0.02, 0.001, 0.025, 0.5, 0, 0.1),
    // the HUD: two quick sine blips, a fifth apart
    blip: (t, n) => {
      const f = hz(LADDER[n % 5]);
      tone('sine', f, f, t, 0.01, 0.002, 0.05, 0.8, -0.2, 0.15);
      tone('sine', f * 1.5, f * 1.5, t + 0.07, 0.01, 0.002, 0.07, 0.75, 0.2, 0.2);
    },
    // a check stamped "pronto": a soft thump and a bell that climbs check by check
    stamp: (t, n) => {
      tone('sine', 210, 105, t, 0.07, 0.002, 0.14, 1.0, 0, 0.1);
      tone('triangle', 3000, 2800, t, 0.01, 0.001, 0.03, 0.25, 0, 0);
      bell(LADDER[n % LADDER.length], t + 0.015, 0.32, n % 2 ? 0.2 : -0.2);
    },
    // the order push: three bright glass notes
    notify: (t, n) => ['D6', 'F6', 'A6'].forEach((note, i) => bell(Tone.Frequency(note).transpose(n * 3).toNote(), t + i * 0.075, 0.6, -0.3 + i * 0.3, 0.7)),
    tap: (t) => {
      tone('sine', 1500, 950, t, 0.02, 0.001, 0.045, 1.0, 0, 0);
      tone('sine', 300, 180, t, 0.03, 0.001, 0.06, 0.9, 0, 0);
    },
    paid: (t) => {
      bell('A5', t, 0.26, -0.15);
      bell('D6', t + 0.1, 0.24, 0.15);
      tone('sine', 120, 70, t, 0.1, 0.003, 0.25, 0.45, 0, 0);
    },
    // a thermal printer, softened: a filtered noise pulse on every 32nd
    print: (t, _n, dur) => {
      const f = place(new Tone.Filter({ frequency: 3200, type: 'bandpass', Q: 2.2 }), 0.15, 0.08);
      const g = new Tone.Gain(0).connect(f);
      noise('white', t, dur + 0.05, g);
      const step = s16 / 2;
      for (let x = 0; x < dur - 0.01; x += step) {
        g.gain.setValueAtTime(0.0001, t + x);
        g.gain.linearRampToValueAtTime(1.3, t + x + 0.006);
        g.gain.linearRampToValueAtTime(0.13, t + x + step * 0.8);
      }
      g.gain.linearRampToValueAtTime(0, t + dur);
    },
    toggle: (t, n) => {
      const f = hz(LADDER[n % LADDER.length]) / 2;
      tone('sine', f, f * 1.25, t, 0.03, 0.002, 0.09, 0.8, n % 2 ? 0.2 : -0.2, 0.2);
      tone('triangle', 2400, 2200, t, 0.01, 0.001, 0.02, 0.35, 0, 0);
    },
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
      const o = new Tone.Oscillator(hz('D3'), 'sawtooth').connect(new Tone.Filter(2500, 'lowpass').connect(sg));
      o.frequency.setValueAtTime(hz('D3'), t);
      o.frequency.exponentialRampToValueAtTime(hz('D5'), t + end);
      o.start(t).stop(t + end);
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(0.07, t + end * 0.97);
      sg.gain.linearRampToValueAtTime(0, t + end);
    },
    // 3 · 2 · 1: a sub hit and a bell that climbs A → C → D
    count: (t, n) => {
      tone('sine', 95, 42, t, 0.4, 0.003, 0.55, 0.5, 0, 0);
      bell(['A5', 'C6', 'D6'][n], t, 0.18, 0, 1.3);
      bell(['A4', 'C5', 'D5'][n], t, 0.12, 0, 1.3);
      const lp = place(new Tone.Filter(1200, 'lowpass'), 0, 0.7);
      const g = new Tone.Gain(0).connect(lp);
      noise('pink', t, 0.5, g);
      env(g, t, 0.004, 0.15, 0.4);
    },
    // ignition: a swell that sucks up into T−0 and stops a sixteenth short
    ignite: (t, _n, dur) => {
      const end = dur - s16;
      swell(t, end, 200, 6000, 0.7, 'white');
      const sg = place(new Tone.Gain(0), 0, 0.3) as Tone.Gain;
      const o = new Tone.Oscillator(hz('D2'), 'sawtooth').connect(new Tone.Filter(1800, 'lowpass').connect(sg));
      o.frequency.setValueAtTime(hz('D2'), t);
      o.frequency.exponentialRampToValueAtTime(hz('D4'), t + end);
      o.start(t).stop(t + end);
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(0.12, t + end * 0.95);
      sg.gain.linearRampToValueAtTime(0, t + end);
    },
    // T−0: a long sub bloom, a rumble that rolls off, and a bright chord on top
    launch: (t) => {
      tone('sine', 150, 30, t, 1.4, 0.003, 2.2, 0.6, 0, 0);
      const lp = place(new Tone.Filter(900, 'lowpass'), 0, 0.5) as Tone.Filter;
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(200, t + 2.4);
      const g = new Tone.Gain(0).connect(lp);
      noise('brown', t, 2.8, g);
      env(g, t, 0.006, 0.9, 2.6);
      ['D6', 'A6', 'D7', 'E7'].forEach((note, i) => bell(note, t + 0.02 + i * 0.05, 0.16, i % 2 ? 0.35 : -0.35, 1.6));
    },
    // a slot reel locking: a short click and a low knock, the click climbing per digit
    reel: (t, n) => {
      const f = hz(LADDER[n + 1]);
      tone('sine', f, f * 0.98, t, 0.02, 0.001, 0.06, 0.65, n % 2 ? 0.2 : -0.2, 0.15);
      tone('sine', 180, 95, t, 0.05, 0.002, 0.1, 0.85, 0, 0);
    },
    shimmer: (t) => ['D7', 'F7', 'A7', 'D8'].forEach((note, i) => bell(note, t + i * 0.06, 0.55, i % 2 ? 0.3 : -0.3)),
    ping: (t) => bell('A6', t, 0.9),
  };
  for (const c of SFX) play[c.kind](c.t, c.n ?? 0, c.dur ?? 0.4);

  // the music ducks ~2.5 dB under each short effect; long sweeps don't duck
  const hits = SFX.filter((c) => !['whoosh', 'riser', 'ignite', 'print'].includes(c.kind)).map((c) => c.t);
  const dip = (t: number) => hits.reduce((m, h) => (t >= h - 0.01 && t < h + 0.25 ? Math.min(m, t < h + 0.03 ? 0.75 : 0.75 + ((t - h - 0.03) / 0.22) * 0.25) : m), 1);
  for (let t = 0; t < DURATION; t += 0.01) music.gain.linearRampToValueAtTime(dip(t), t);

  // impacts also land on the camera hits that have no effect of their own
  for (const h of HITS) if (!SFX.some((c) => Math.abs(c.t - h) < 0.02)) play.impact(h, 0, 0);
}
