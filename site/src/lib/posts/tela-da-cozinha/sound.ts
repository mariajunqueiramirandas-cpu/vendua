// The kitchen's three cues, synthesized exactly as apps/admin/src/lib/sound.ts does (a marimba-ish
// sine with fast-dying upper partials), so "ouvir" on this page plays the same notes the screen does.

export interface Cue {
  id: 'ticket' | 'late' | 'call';
  /** [Hz, seconds after the start, gain, length] */
  notes: [number, number, number, number][];
}

export const CUES: Record<Cue['id'], Cue> = {
  ticket: {
    id: 'ticket',
    notes: [
      [784, 0, 0.45, 0.6],
      [784, 0.13, 0.4, 0.8],
    ],
  },
  late: {
    id: 'late',
    notes: [
      [880, 0, 0.5, 0.7],
      [659.25, 0.18, 0.55, 1.1],
    ],
  },
  call: {
    id: 'call',
    notes: [
      [1046.5, 0, 0.55, 1.2],
      [880, 0.42, 0.55, 1.6],
    ],
  },
};

let ctx: AudioContext | null = null;
const VOLUME = 0.8;

function note(ac: AudioContext, freq: number, at: number, gain: number, length: number) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, at + length);
  out.connect(ac.destination);
  for (const [mult, g] of [
    [1, 1],
    [4, 0.28],
    [10, 0.06],
  ] as const) {
    const osc = ac.createOscillator();
    const pg = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    pg.gain.setValueAtTime(g, at);
    pg.gain.exponentialRampToValueAtTime(0.0001, at + length / mult ** 0.6);
    osc.connect(pg).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

export function play(id: Cue['id']) {
  if (typeof window === 'undefined') return;
  const C =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return;
  ctx ??= new C();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const t = ctx.currentTime + 0.02;
  for (const [f, dt, g, len] of CUES[id].notes) note(ctx, f, t + dt, g * VOLUME, len);
}

/** the device's own pt-BR voice, as the pickup display uses it */
export function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'pt-BR';
  const v =
    speechSynthesis.getVoices().find((x) => /^pt[-_]BR$/i.test(x.lang)) ??
    speechSynthesis.getVoices().find((x) => /^pt/i.test(x.lang));
  if (v) u.voice = v;
  u.rate = 0.95;
  speechSynthesis.speak(u);
}
