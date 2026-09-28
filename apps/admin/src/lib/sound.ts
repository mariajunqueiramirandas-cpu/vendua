// The two sounds (design spec §5.2), synthesized so there's nothing to download:
// "pedido novo" is a rising two-note marimba chime, "pago" a single soft note.
// Marimba = a sine fundamental plus a fast-decaying 4× partial; no system beeps.

let ctx: AudioContext | null = null;
let volume = 0.8;

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const C =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  ctx ??= new C();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  return ctx;
}

function note(ac: AudioContext, freq: number, at: number, gain: number, length = 1.1) {
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  out.gain.exponentialRampToValueAtTime(0.0001, at + length);
  out.connect(ac.destination);
  const partials: [number, number][] = [
    [1, 1],
    [4, 0.28],
    [10, 0.06],
  ];
  for (const [mult, g] of partials) {
    const osc = ac.createOscillator();
    const pg = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    pg.gain.setValueAtTime(g, at);
    // upper partials die first — that's the wooden "tok"
    pg.gain.exponentialRampToValueAtTime(0.0001, at + length / mult ** 0.6);
    osc.connect(pg).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }
}

/** Rising E5 → A5, then a soft octave echo. Loud enough for a kitchen at volume 1. */
export function chimeNewOrder() {
  const ac = audio();
  if (!ac || volume === 0) return;
  const t = ac.currentTime + 0.02;
  note(ac, 659.25, t, 0.55 * volume);
  note(ac, 880, t + 0.16, 0.6 * volume, 1.4);
  note(ac, 1760, t + 0.32, 0.12 * volume, 0.9);
}

export function chimePaid() {
  const ac = audio();
  if (!ac || volume === 0) return;
  note(ac, 1046.5, ac.currentTime + 0.02, 0.35 * volume, 1.2);
}

/** Browsers only allow audio after a gesture — call from any tap to arm it. */
export function unlockAudio() {
  audio();
}
