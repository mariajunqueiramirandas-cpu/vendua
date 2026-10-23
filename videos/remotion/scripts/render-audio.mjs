// Renders a video's Tone.js score offline in headless Chromium and masters it for Remotion.
//   node scripts/render-audio.mjs <video> [--stems]   e.g. hype30 → public/hype30/score.wav
// --stems also writes out/<video>-music.wav and out/<video>-sfx.wav (unmastered) to balance the mix,
// and out/<video>-voice.wav when there is narration.
// The score module (src/videos/<video>/score.ts) exports `score()` and `duration`, and `voice` when
// the video is narrated: [{ src (under public/), at (seconds) }], laid over the score here. Math.random
// is seeded before Tone loads, so the noise in reverbs and effects is the same on every run.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { browserPath } from './browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
const stems = process.argv.includes('--stems');
if (!id || !existsSync(join(root, 'src/videos', id, 'score.ts'))) {
  console.error('usage: node scripts/render-audio.mjs <video>  (needs src/videos/<video>/score.ts)');
  process.exit(1);
}
const RATE = 48000;
const LUFS = -14;
// narration sits at −16 LUFS and the score this far under it (the score also ducks under each word)
const VOICE_LUFS = -16;
const SCORE_UNDER = 6;

const bundle = await build({
  stdin: {
    contents: `
      import * as Tone from 'tone';
      import * as S from './src/videos/${id}/score.ts';
      const { score, duration } = S;
      window.scoreVoice = S.voice ?? null;
      window.renderScore = async (only) => {
        const buf = await Tone.Offline(() => score({ only }), duration, 2, ${RATE});
        return buf.toArray().map((ch) => {
          const bytes = new Uint8Array(ch.buffer);
          let s = '';
          for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          return btoa(s);
        });
      };`,
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  write: false,
  logLevel: 'warning',
});

let voice;
const executablePath = browserPath();
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });
const renderPass = async (only) => {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.addInitScript(() => {
    let a = 0x5eed;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.setContent('<!doctype html><meta charset="utf-8">');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const b64 = await page.evaluate((o) => window.renderScore(o), only);
  voice ??= await page.evaluate(() => window.scoreVoice);
  return b64.map((s) => {
    const buf = Buffer.from(s, 'base64');
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  });
};
const t0 = Date.now();
const [chans, ...stemChans] = await Promise.all([undefined, ...(stems ? ['music', 'sfx'] : [])].map(renderPass));
await browser.close();
console.log(`rendered ${(chans[0].length / RATE).toFixed(2)} s in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const writeWav = (file, [l, r]) => {
  const data = Buffer.alloc(l.length * 8);
  for (let i = 0; i < l.length; i++) {
    data.writeFloatLE(l[i], i * 8);
    data.writeFloatLE(r[i], i * 8 + 4);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(3, 20); // IEEE float
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 8, 28);
  head.writeUInt16LE(8, 32);
  head.writeUInt16LE(32, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([head, data]));
};
mkdirSync(join(root, 'out'), { recursive: true });
const raw = join(root, 'out', `${id}-score-raw.wav`);
writeWav(raw, chans);
if (stems) ['music', 'sfx'].forEach((k, i) => writeWav(join(root, 'out', `${id}-${k}.wav`), stemChans[i]));

// master: gain to the target loudness, then a limiter with headroom for the AAC encode
const ffmpeg = (args) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stderr;
};
const stats = (file) => {
  const log = ffmpeg(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const sum = log.slice(log.lastIndexOf('Summary'));
  return { I: Number(/I:\s+(-?[\d.]+) LUFS/.exec(sum)[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(sum)[1]) };
};
let mixed = raw;
if (voice?.length) {
  // the takes at their times, one stem: rumble cut, a gentle compressor, then to its loudness
  const vStem = join(root, 'out', `${id}-voice.wav`);
  const dur = (chans[0].length / RATE).toFixed(3);
  const lay = voice.map((v, i) => `[${i}:a]aresample=${RATE},adelay=${Math.round(v.at * 1000)}:all=1[v${i}]`).join(';');
  ffmpeg([
    '-y', '-loglevel', 'error', ...voice.flatMap((v) => ['-i', join(root, 'public', v.src)]),
    '-filter_complex',
    `${lay};${voice.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voice.length}:normalize=0:dropout_transition=0,` +
      `apad=whole_dur=${dur},atrim=0:${dur},highpass=f=75,deesser=i=0.5:m=0.5:f=0.5,equalizer=f=3800:t=q:w=2:g=-2,` +
      `acompressor=threshold=0.125:ratio=2.5:attack=4:release=90,aformat=channel_layouts=stereo[v]`,
    '-map', '[v]', '-c:a', 'pcm_f32le', vStem,
  ]);
  const v = stats(vStem).I;
  const m = stats(raw).I;
  mixed = join(root, 'out', `${id}-mix-raw.wav`);
  ffmpeg([
    '-y', '-loglevel', 'error', '-i', raw, '-i', vStem,
    '-filter_complex',
    `[0:a]volume=${(VOICE_LUFS - SCORE_UNDER - m).toFixed(2)}dB[m];[1:a]volume=${(VOICE_LUFS - v).toFixed(2)}dB[v];[m][v]amix=inputs=2:normalize=0[o]`,
    '-map', '[o]', '-c:a', 'pcm_f32le', mixed,
  ]);
  console.log(`voice: ${voice.length} takes, ${v} LUFS → ${VOICE_LUFS}; score ${m} LUFS → ${VOICE_LUFS - SCORE_UNDER}`);
}

const before = stats(mixed);
const outDir = join(root, 'public', id);
mkdirSync(outDir, { recursive: true });
const dest = join(outDir, 'score.wav');
let gain = LUFS - before.I;
let after;
for (let pass = 0; pass < 3; pass++) {
  const af = `volume=${gain.toFixed(2)}dB,alimiter=limit=0.8:level=false:attack=3:release=60`;
  ffmpeg(['-y', '-loglevel', 'error', '-i', mixed, '-af', af, '-ar', String(RATE), '-c:a', 'pcm_s16le', dest]);
  after = stats(dest);
  if (Math.abs(after.I - LUFS) < 0.3) break;
  gain += LUFS - after.I;
}
console.log(`raw ${before.I} LUFS, ${before.peak} dBFS peak → public/${id}/score.wav: ${after.I} LUFS, ${after.peak} dBFS peak`);
