// Renders "pedido novo" (src/lib/sound.ts NEW_ORDER, the same synthesis offline) into the app's
// notification sounds (ADR 0044 §5): ios/App/App/pedido-novo.caf (APNs `sound`) and
// android/app/src/main/res/raw/pedido_novo.ogg (the "Pedidos novos" channel). Needs ffmpeg.
// Rerun after changing the chime: `bun scripts/render-chime.ts`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NEW_ORDER, PARTIALS } from '../src/lib/sound.ts';

const RATE = 44_100;
const root = fileURLToPath(new URL('..', import.meta.url));
const end = Math.max(...NEW_ORDER.map(([, at, , len]) => at + len)) + 0.1;
const pcm = new Float64Array(Math.ceil(end * RATE));

// Web Audio's exponentialRampToValueAtTime, from `a` at t0 to `b` at t1
const ramp = (a: number, b: number, t0: number, t1: number, t: number) =>
  a * (b / a) ** ((t - t0) / (t1 - t0));

for (const [freq, at, gain, length] of NEW_ORDER) {
  for (let i = Math.floor(at * RATE); i < pcm.length; i++) {
    const t = i / RATE;
    if (t > at + length + 0.05) break;
    const env =
      t < at + 0.008
        ? ramp(0.0001, gain, at, at + 0.008, t)
        : t < at + length
          ? ramp(gain, 0.0001, at + 0.008, at + length, t)
          : 0.0001;
    let v = 0;
    for (const [mult, g] of PARTIALS) {
      const until = at + length / mult ** 0.6;
      const pg = t < until ? ramp(g, 0.0001, at, until, t) : 0.0001;
      v += Math.sin(2 * Math.PI * freq * mult * (t - at)) * pg;
    }
    pcm[i]! += v * env;
  }
}

const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const data = Buffer.alloc(pcm.length * 2);
pcm.forEach((v, i) => data.writeInt16LE(Math.round((v / peak) * 0.89 * 32767), i * 2));
const head = Buffer.alloc(44);
head.write('RIFF', 0);
head.writeUInt32LE(36 + data.length, 4);
head.write('WAVEfmt ', 8);
head.writeUInt32LE(16, 16);
head.writeUInt16LE(1, 20);
head.writeUInt16LE(1, 22);
head.writeUInt32LE(RATE, 24);
head.writeUInt32LE(RATE * 2, 28);
head.writeUInt16LE(2, 32);
head.writeUInt16LE(16, 34);
head.write('data', 36);
head.writeUInt32LE(data.length, 40);

const tmp = join(tmpdir(), `vendua-chime-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const wav = join(tmp, 'chime.wav');
writeFileSync(wav, Buffer.concat([head, data]));
const ff = (...args: string[]) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...args]);
const caf = join(root, 'ios/App/App/pedido-novo.caf');
const ogg = join(root, 'android/app/src/main/res/raw/pedido_novo.ogg');
mkdirSync(join(root, 'android/app/src/main/res/raw'), { recursive: true });
// linear PCM in a CAF: what iOS plays for a notification, under its 30 s limit
ff('-c:a', 'pcm_s16le', '-f', 'caf', caf);
ff('-c:a', 'libvorbis', '-q:a', '6', '-map_metadata', '-1', '-fflags', '+bitexact', ogg);
rmSync(tmp, { recursive: true, force: true });
console.log(`chime: ${end.toFixed(2)} s → ${caf}, ${ogg}`);
