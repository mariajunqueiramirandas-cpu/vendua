import * as Tone from 'tone';
import { CLOCK, DURATION, E, G, HITS, IDS, SCENES, SFX, T, VO, type Sfx } from './timeline';

// Music and sound effects for Launch60, rendered offline by scripts/render-audio.mjs, which then
// lays the narration (`voice`) over them. Everything is placed in absolute seconds from
// timeline.ts. The music ducks under every spoken word, so the voice always reads.

export const duration = DURATION;

/** The narration: each picked take at its place on the timeline (paths under public/). */
export const voice = IDS.map((id) => ({ src: `launch60/vo/${id}.mp3`, at: VO[id].at }));

// A minor. The intro walks Am F Dm to E (the dominant) so the drop on "Venduá!" resolves home;
// from there the loop is Am F C G, counted in bars from the drop.
const INTRO: [number, string[], string][] = [
  [0, ['A3', 'C4', 'E4', 'B4'], 'A'],
  [G.bars(1), ['F3', 'A3', 'C4', 'G4'], 'F'],
  [G.bars(2), ['D3', 'F3', 'A3', 'C4'], 'D'],
  [SCENES.pain[1] - G.bar / 2, ['E3', 'G#3', 'B3', 'D4'], 'E'],
];
const LOOP: [string[], string][] = [
  [['A3', 'C4', 'E4', 'B4'], 'A'],
  [['F3', 'A3', 'C4', 'G4'], 'F'],
  [['C3', 'G3', 'C4', 'E4'], 'C'],
  [['G3', 'B3', 'D4', 'A4'], 'G'],
];
// The drop's hook, one bar: [sixteenth, note, length in sixteenths]
const HOOK: [number, string, number][] = [
  [0, 'E5', 2], [3, 'E5', 1], [4, 'D5', 2], [6, 'C5', 2], [8, 'A4', 3], [11, 'C5', 1], [12, 'D5', 2], [14, 'E5', 2],
];
const LADDER = ['A5', 'C6', 'D6', 'E6', 'G6', 'A6', 'C7', 'D7', 'E7'];

type Section = 'hook' | 'pain' | 'build' | 'drop' | 'who' | 'demo' | 'dua' | 'day' | 'setup' | 'clock' | 'rise' | 'full' | 'end';
const DROP = T.launch.brand;
const FULL = SCENES.price[0];
const SECTIONS: [number, Section][] = [
  [0, 'hook'],
  [SCENES.pain[0], 'pain'],
  [SCENES.launch[0], 'build'],
  [DROP, 'drop'],
  [SCENES.who[0], 'who'],
  [SCENES.what[0], 'demo'],
  [SCENES.dua[0], 'dua'],
  [SCENES.day[0], 'day'],
  [SCENES.setup[0], 'setup'],
  [CLOCK[0], 'clock'],
  [T.setup.loja, 'rise'],
  [FULL, 'full'],
  [T.cta.end, 'end'],
];
const sectionAt = (t: number) => SECTIONS.reduce<Section>((s, [at, k]) => (t >= at - 1e-6 ? k : s), 'hook');

export async function score({ only }: { only?: 'music' | 'sfx' } = {}) {
  const { beat } = G;
  const s16 = beat / 4;
  const chordAt = (t: number) => {
    if (t < DROP - 1e-6) {
      const c = INTRO.reduce((p, x) => (t >= x[0] - 1e-6 ? x : p), INTRO[0]);
      return { notes: c[1], root: c[2] };
    }
    const [notes, root] = LOOP[Math.floor((t - DROP) / G.bar + 1e-6) % 4];
    return { notes, root };
  };

  // ── buses ──
  const out = new Tone.Gain(0.9).toDestination();
  const glue = new Tone.Compressor({ threshold: -16, ratio: 2.5, attack: 0.02, release: 0.2 }).connect(out);
  // `only` renders one stem (scripts/render-audio.mjs --stems) to balance effects against music
  const sfx = new Tone.Gain(1).connect(new Tone.Gain(only === 'music' ? 0 : 1).connect(glue));
  // the hook and the pain are heard through a wall; the build opens it up
  const wall = new Tone.Filter(1600, 'lowpass').connect(glue);
  // under the voice the music also loses some presence, where the words' consonants live
  const carve = new Tone.Filter({ type: 'peaking', frequency: 2500, Q: 0.8, gain: 0 }).connect(wall);
  const music = new Tone.Gain(1).connect(new Tone.Gain(only === 'sfx' ? 0 : 1).connect(carve));
  wall.frequency.setValueAtTime(1600, 0);
  wall.frequency.setValueAtTime(1600, SCENES.launch[0]);
  wall.frequency.exponentialRampToValueAtTime(18000, DROP - E);
  // the day's breakdown is softer and warmer
  wall.frequency.setValueAtTime(18000, SCENES.day[0] - 0.01);
  wall.frequency.exponentialRampToValueAtTime(3200, SCENES.day[0] + 0.2);
  wall.frequency.setValueAtTime(3200, SCENES.setup[0]);
  wall.frequency.exponentialRampToValueAtTime(18000, SCENES.setup[0] + G.bar);

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
  const clap = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.16, sustain: 0 }, volume: -8 }).connect(clapBp);
  const hatHp = new Tone.Filter(8000, 'highpass').connect(music);
  const hat = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.035, sustain: 0 }, volume: -13 }).connect(hatHp);
  const ohat = new Tone.NoiseSynth({ envelope: { attack: 0.002, decay: 0.16, sustain: 0 }, volume: -19 }).connect(hatHp);
  const shakerHp = new Tone.Filter(9500, 'highpass').connect(music);
  const shaker = new Tone.NoiseSynth({ envelope: { attack: 0.002, decay: 0.022, sustain: 0 }, volume: -21 }).connect(shakerHp);
  const snareBp = new Tone.Filter({ frequency: 2000, type: 'bandpass', Q: 0.7 }).connect(music);
  const snare = new Tone.NoiseSynth({ envelope: { attack: 0.001, decay: 0.09, sustain: 0 }, volume: -14 }).connect(snareBp);
  send(snareBp, 0.25);

  // collected, then played in order: a mono synth can't schedule back in time
  const kickVel = new Map<number, number>();
  const kickAt = (t: number, v = 1) => void kickVel.set(t, v);
  /** a snare roll from t0 that doubles up towards t1 and stops an eighth early (the gap before a drop) */
  const roll = (t0: number, t1: number) => {
    const end = t1 - E;
    let t = t0;
    let step = E;
    const hits: number[] = [];
    while (t < end - 1e-3) {
      hits.push(t);
      if (t - t0 > (end - t0) * 0.5) step = s16;
      if (t - t0 > (end - t0) * 0.8) step = s16 / 2;
      t += step;
    }
    hits.forEach((h, i) => snare.triggerAttackRelease(0.05, h, 0.3 + (0.7 * i) / hits.length));
  };

  // ── tonal ──
  const bassF = new Tone.Filter(900, 'lowpass').connect(pump);
  const bass = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    filter: { Q: 1.5, type: 'lowpass', rolloff: -24 },
    envelope: { attack: 0.004, decay: 0.18, sustain: 0.35, release: 0.06 },
    filterEnvelope: { attack: 0.002, decay: 0.16, sustain: 0.2, baseFrequency: 110, octaves: 3 },
    volume: -10,
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
    volume: -19,
  }).connect(padF);
  const sawF = new Tone.Filter(5200, 'lowpass').connect(pump);
  send(sawF, 0.3);
  const saws = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 6, spread: 36 },
    envelope: { attack: 0.006, decay: 0.3, sustain: 0.6, release: 0.45 },
    volume: -20,
  }).connect(sawF);
  const arpF = new Tone.Filter(1800, 'lowpass').connect(pump);
  arpF.connect(pingpong);
  const arp = new Tone.Synth({
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.002, decay: 0.11, sustain: 0, release: 0.08 },
    volume: -16,
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

  // ── arrangement: drums and bass beat by beat ──
  const nBeats = Math.round(T.cta.end / beat);
  for (let b = 0; b < nBeats; b++) {
    const t = b * beat;
    const sec = sectionAt(t);
    const { root } = chordAt(t);
    const inBar = b % 4;
    const quiet = sec === 'build' || sec === 'rise';

    // kick: four on the floor everywhere but the pain (half time), the day (none) and the builds
    if (sec === 'pain' ? inBar % 2 === 0 : !['day', 'build', 'rise'].includes(sec)) kickAt(t, sec === 'hook' || sec === 'pain' ? 0.85 : 1);
    if (['drop', 'who', 'demo', 'dua', 'setup', 'full'].includes(sec) && inBar % 2 === 1) clap.triggerAttackRelease(0.1, t);
    if (!quiet) hat.triggerAttackRelease(0.03, t + beat / 2, sec === 'day' ? 0.5 : 0.9);
    if (['drop', 'full'].includes(sec) || (sec === 'dua' && t >= T.dua.dua)) ohat.triggerAttackRelease(0.1, t + beat / 2, 0.7);
    if (['hook', 'pain', 'demo', 'dua', 'day', 'clock', 'full'].includes(sec))
      for (let s = 0; s < 4; s++) shaker.triggerAttackRelease(0.02, t + s * s16, s % 2 ? 0.45 : 0.8);

    // bass: anxious straight eighths in the intro, off-beat pumping after the drop
    if (sec === 'hook' || sec === 'pain' || sec === 'build') {
      bass.triggerAttackRelease(`${root}2`, E * 0.7, t, 0.8);
      bass.triggerAttackRelease(`${root}2`, E * 0.7, t + E, 0.6);
    } else if (sec !== 'day' && sec !== 'rise') {
      bass.triggerAttackRelease(`${root}2`, beat * 0.4, t + beat / 2, 0.9);
      if (sec === 'drop' || sec === 'full') bass.triggerAttackRelease(`${root}3`, s16 * 0.8, t + beat * 0.75, 0.6);
    }
  }

  // ── chords and arps, in segments cut at every bar line and every section start ──
  const points = [...INTRO.map((x) => x[0]), ...SECTIONS.map((x) => x[0])];
  for (let t = DROP; t < T.cta.end; t += G.bar) points.push(t);
  const cuts = [...new Set(points.map((p) => Math.round(p * 1e4) / 1e4))].filter((p) => p < T.cta.end).sort((a, b) => a - b);
  cuts.forEach((t0, i) => {
    const len = (cuts[i + 1] ?? T.cta.end) - t0;
    const sec = sectionAt(t0);
    const { notes, root } = chordAt(t0);
    if (sec === 'drop' || sec === 'full') {
      saws.triggerAttackRelease([...notes, `${root}5`], len * 0.95, t0, 0.9);
      sub.triggerAttackRelease(`${root}1`, len * 0.95, t0);
    } else if (sec === 'who' || sec === 'dua') {
      saws.triggerAttackRelease([...notes], len * 0.9, t0, sec === 'dua' ? 0.55 : 0.7);
      sub.triggerAttackRelease(`${root}1`, len * 0.95, t0, 0.8);
    } else {
      pad.triggerAttackRelease([...notes], len * 0.98, t0, sec === 'build' ? 0.9 : 0.7);
    }
    // a pluck arp under the demos and the day, an octave up, so the voice keeps the middle
    if (['demo', 'dua', 'day', 'setup', 'clock'].includes(sec)) {
      const ns = [notes[0], notes[1], notes[2], notes[3], notes[2], notes[1]].map((n) => Tone.Frequency(n).transpose(12).toNote());
      const first = Math.round(t0 / s16);
      for (let k = first; k * s16 < t0 + len - 1e-3; k++) arp.triggerAttackRelease(ns[k % ns.length], s16 * 0.8, k * s16, k % 4 === 0 ? 0.9 : 0.5);
    }
  });

  // the build into the drop: the pad opens up, a roll doubles up into a silent eighth
  padF.frequency.setValueAtTime(1300, SCENES.launch[0]);
  padF.frequency.exponentialRampToValueAtTime(7000, DROP - E);
  roll(SCENES.launch[0] + G.bar / 2, DROP);
  // and the one into the price
  roll(T.setup.ar, FULL);
  // pushes on the drops that land off the grid
  kickAt(FULL);

  // the hook's melody, only in the instrumental beat after "Venduá!"
  for (const [s, note, len] of HOOK) lead.triggerAttackRelease(note, len * s16 * 0.9, DROP + s * s16, 0.85);
  // and a short answer in the gap after "por pedido"
  const gap = VO.price.words.find((w) => w.w.startsWith('pedido'))!.t1 + 0.05;
  ['C5', 'D5', 'E5', 'G5'].forEach((n, k) => lead.triggerAttackRelease(n, s16 * 0.9, gap + k * s16, 0.7));

  // the final stab: one chord with a sub, ringing out to the end
  const FINAL = T.cta.end;
  saws.triggerAttackRelease(['A3', 'C4', 'E4', 'B4', 'A4', 'E5'], 1.0, FINAL, 1);
  pad.triggerAttackRelease(['A3', 'C4', 'E4', 'B4'], DURATION - FINAL, FINAL, 0.8);
  sub.triggerAttackRelease('A1', 1.6, FINAL);
  kickAt(FINAL);
  arp.triggerAttackRelease('A5', 0.2, FINAL + beat, 0.6);
  arp.triggerAttackRelease('E6', 0.2, FINAL + beat * 1.5, 0.5);
  arp.triggerAttackRelease('A6', 0.4, FINAL + beat * 2, 0.4);

  for (const [t, v] of [...kickVel].sort((a, b) => a[0] - b[0])) {
    kick.triggerAttackRelease('A1', 0.3, t, v);
    click.triggerAttackRelease(0.01, t, v);
    kicks.push(t);
  }
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
  const tone = (wave: 'sine' | 'triangle' | 'square', f0: number, f1: number, t: number, glide: number, a: number, d: number, peak: number, pan = 0, wet = 0.2) => {
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
  // the admin's marimba (apps/admin/src/lib/sound.ts): a sine and two fast-dying partials
  const marimba = (freq: number, t: number, gain: number, length: number) => {
    const g = place(new Tone.Gain(0), 0, 0.3) as Tone.Gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    for (const [mult, pg] of [[1, 1], [4, 0.28], [10, 0.06]]) {
      const pgain = new Tone.Gain(pg).connect(g);
      pgain.gain.setValueAtTime(pg, t);
      pgain.gain.exponentialRampToValueAtTime(0.0001, t + length / mult ** 0.6);
      new Tone.Oscillator(freq * mult, 'sine').connect(pgain).start(t).stop(t + length + 0.05);
    }
  };
  const hz = (n: string) => Tone.Frequency(n).toFrequency();

  const play: Record<Sfx, (t: number, n: number, dur: number) => void> = {
    impact: (t) => {
      tone('sine', 110, 38, t, 0.45, 0.003, 0.7, 0.65, 0, 0);
      const lp = place(new Tone.Filter(1600, 'lowpass'), 0, 0.6);
      const g = new Tone.Gain(0).connect(lp);
      noise('pink', t, 0.8, g);
      env(g, t, 0.004, 0.4, 0.6);
    },
    drop: (t) => {
      tone('sine', 140, 34, t, 0.8, 0.003, 1.3, 0.6, 0, 0);
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
      if (n >= 10) {
        // a notification: up the ladder, left and right
        const f = hz(LADDER[(n - 10) % LADDER.length]);
        tone('sine', f, f * 1.25, t, 0.03, 0.002, 0.1, 0.26, (n % 2 ? 1 : -1) * 0.45, 0.2);
        return;
      }
      const me = n === 1;
      const f = me ? 520 : 680;
      tone('sine', f, f * 2.1, t, 0.05, 0.002, 0.09, 0.42, me ? 0.4 : -0.4, 0.2);
    },
    tick: (t, n) => tone('sine', 2600 + (n % 12) * 120, 2400 + (n % 12) * 120, t, 0.02, 0.001, 0.025, 0.3, 0, 0.1),
    ping: (t) => bell('E6', t, 0.4),
    chime: (t) => {
      bell('A5', t, 0.36, -0.15);
      bell('E6', t + 0.09, 0.32, 0.15);
    },
    lock: (t, n) => {
      tone('sine', 220 - n * 30, 120, t, 0.06, 0.002, 0.12, 0.7, 0, 0.1);
      tone('triangle', 3200, 3000, t, 0.01, 0.001, 0.03, 0.3, 0, 0);
    },
    shimmer: (t) => ['A6', 'C7', 'E7', 'A7'].forEach((note, i) => bell(note, t + i * 0.06, 0.2, i % 2 ? 0.3 : -0.3)),
    tap: (t) => tone('sine', 1100, 650, t, 0.025, 0.004, 0.06, 0.2, 0, 0.12),
    riser: (t, _n, dur) => {
      const end = dur - E; // stops an eighth early: the gap before the drop
      const f = place(new Tone.Filter({ frequency: 400, type: 'highpass' }), 0, 0.4) as Tone.Filter;
      f.frequency.setValueAtTime(400, t);
      f.frequency.exponentialRampToValueAtTime(5000, t + end);
      const g = new Tone.Gain(0).connect(f);
      noise('white', t, end, g);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.17, t + end * 0.97);
      g.gain.linearRampToValueAtTime(0, t + end);
      const sg = place(new Tone.Gain(0), 0, 0.3) as Tone.Gain;
      const o = new Tone.Oscillator(hz('E3'), 'sawtooth').connect(new Tone.Filter(2500, 'lowpass').connect(sg));
      o.frequency.setValueAtTime(hz('E3'), t);
      o.frequency.exponentialRampToValueAtTime(hz('E5'), t + end);
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
    buzz: (t) => {
      // a phone on the table: two short bursts of a low motor
      const lp = place(new Tone.Filter(420, 'lowpass'), 0, 0.05);
      const g = new Tone.Gain(0).connect(lp);
      new Tone.Oscillator(150, 'square').connect(g).start(t).stop(t + 0.5);
      new Tone.Oscillator(75, 'sawtooth').connect(g).start(t).stop(t + 0.5);
      for (const [a, b] of [[0, 0.17], [0.25, 0.42]]) {
        g.gain.setValueAtTime(0, t + a);
        g.gain.linearRampToValueAtTime(0.32, t + a + 0.015);
        g.gain.setValueAtTime(0.32, t + b - 0.02);
        g.gain.linearRampToValueAtTime(0, t + b);
      }
    },
    order: (t) => {
      // "pedido novo": E5 → A5 and a soft octave echo
      for (const [freq, at, gain, length] of [[659.25, 0, 0.55, 1.1], [880, 0.16, 0.6, 1.4], [1760, 0.32, 0.12, 0.9]])
        marimba(freq, t + at, gain * 0.7, length);
    },
    paid: (t) => marimba(1046.5, t, 0.35 * 0.8, 1.2),
  };
  for (const c of SFX) play[c.kind](c.t, c.n ?? 0, c.dur ?? 0.4);

  // impacts also land on the camera hits that have no effect of their own
  for (const h of HITS) if (!SFX.some((c) => Math.abs(c.t - h) < 0.02)) play.impact(h, 0, 0);

  // ── the music ducks: ~5 dB under every spoken word, ~2.5 dB under each short effect ──
  const spans: [number, number][] = [];
  for (const id of IDS)
    for (const w of VO[id].words) {
      const a = w.t0 - 0.06;
      const b = w.t1 + 0.12;
      const last = spans[spans.length - 1];
      if (last && a - last[1] < 0.3) last[1] = Math.max(last[1], b);
      else spans.push([a, b]);
    }
  const hits = SFX.filter((c) => !['whoosh', 'riser'].includes(c.kind)).map((c) => c.t);
  const VOICE_DUCK = 0.45;
  const duck = (t: number) => {
    let g = 1;
    for (const [a, b] of spans) {
      if (t < a - 0.08 || t > b + 0.25) continue;
      const k = t < a ? (a - t) / 0.08 : t > b ? (t - b) / 0.25 : 0;
      g = Math.min(g, VOICE_DUCK + (1 - VOICE_DUCK) * k);
    }
    for (const h of hits)
      if (t >= h - 0.01 && t < h + 0.25) g = Math.min(g, t < h + 0.03 ? 0.75 : 0.75 + ((t - h - 0.03) / 0.22) * 0.25);
    return g;
  };
  for (let t = 0; t < DURATION; t += 0.01) {
    const g = duck(t);
    music.gain.linearRampToValueAtTime(g, t);
    carve.gain.linearRampToValueAtTime(g < 0.7 ? -4 : 0, t);
  }
  // the end card's chord rings out and fades by the last frame
  out.gain.setValueAtTime(0.9, DURATION - 0.35);
  out.gain.linearRampToValueAtTime(0, DURATION);
}
