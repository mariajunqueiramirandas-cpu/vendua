import { api } from '../../lib/api.ts';
import { platform } from '../../platform/index.ts';

// The kitchen reads tickets out loud (and the pickup display calls numbers) in the store's voice,
// spoken by Core (ADR 0048, POST /admin/v1/speech), one line after another. The device's own
// pt-BR voice takes over offline, when Core can't speak, or when the browser won't play: the
// line is still said, a moment later.

type Line = { text: string; rate: number; audio: Promise<Blob | null> };

const queue: Line[] = [];
/** the line playing now, and how to stop it */
let current: { audio: HTMLAudioElement; stop: () => void } | null = null;
let pumping = false;
/** after a failure, the device's voice for a while instead of a request that will fail again */
let serverAfter = 0;
const BACKOFF_MS = 60_000;

const serverUsable = () =>
  Date.now() >= serverAfter && (typeof navigator === 'undefined' || navigator.onLine !== false);

const device = (text: string, rate: number) => platform.speech.speak(text, rate);

function fetchLine(text: string): Promise<Blob | null> {
  return api.speech(text).then(
    (b) => (b.size > 0 ? b : null),
    () => null,
  );
}

function play(blob: Blob): Promise<'ok' | 'failed' | 'stopped'> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio(url);
    let settled = false;
    const done = (r: 'ok' | 'failed' | 'stopped') => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      if (current?.audio === a) current = null;
      resolve(r);
    };
    current = {
      audio: a,
      stop: () => {
        a.pause();
        done('stopped');
      },
    };
    a.onended = () => done('ok');
    a.onerror = () => done('failed');
    a.play().catch(() => done('failed')); // autoplay refused: the device says it
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const line = queue[0]!;
      const blob = await line.audio;
      if (queue[0] !== line) continue; // hushed meanwhile
      queue.shift();
      const r = blob ? await play(blob) : 'failed';
      if (r !== 'failed') continue;
      serverAfter = Date.now() + BACKOFF_MS;
      device(line.text, line.rate);
    }
  } finally {
    pumping = false;
  }
}

export const voiceSupported = () => platform.speech.supported() || serverUsable();

export function speak(text: string, opts: { rate?: number } = {}) {
  const rate = opts.rate ?? 1.05;
  if (!serverUsable()) return device(text, rate);
  // fetched now, so the next line is ready while this one plays
  queue.push({ text, rate, audio: fetchLine(text) });
  void pump();
}

export function hush() {
  queue.length = 0;
  current?.stop();
  platform.speech.hush();
}
