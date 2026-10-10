// Renders stills at given times (seconds) and tiles them into one contact sheet.
//   node scripts/stills.mjs <Composition> <t1> <t2> ... [--out out/stills]
// One bundle and one browser for all frames: much faster than `remotion still` per frame.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderStill, selectComposition } from '@remotion/renderer';
import { browserPath, glRenderer } from './browser.mjs';

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = resolve(outIdx >= 0 ? args.splice(outIdx, 2)[1] : 'out/stills');
const [id, ...times] = args;
if (!id || !times.length) {
  console.error('usage: node scripts/stills.mjs <Composition> <seconds...> [--out dir]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const browserExecutable = browserPath();
const chromiumOptions = { gl: glRenderer() };
if (!browserExecutable) await ensureBrowser();
const serveUrl = await bundle({ entryPoint: resolve('src/index.ts') });
const composition = await selectComposition({ serveUrl, id, browserExecutable, chromiumOptions });
const files = [];
for (const s of times) {
  const frame = Math.min(composition.durationInFrames - 1, Math.round(Number(s) * composition.fps));
  const output = join(outDir, `${id}-${String(frame).padStart(4, '0')}.png`);
  await renderStill({ composition, serveUrl, frame, output, browserExecutable, chromiumOptions, imageFormat: 'png', scale: 0.5 });
  files.push(output);
  console.log(`${s}s → ${output}`);
}
if (files.length === 1) process.exit(0);
const cols = Math.min(files.length, 5);
const rows = Math.ceil(files.length / cols);
const sheet = join(outDir, `${id}-sheet.jpg`);
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  ...files.flatMap((f) => ['-i', f]),
  '-filter_complex',
  files.map((_, i) => `[${i}:v]drawtext=text='${times[i]}s':x=12:y=12:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6[v${i}]`).join(';') +
    ';' + files.map((_, i) => `[v${i}]`).join('') +
    `xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 540}_${Math.floor(i / cols) * 960}`).join('|')}:fill=black`,
  '-frames:v', '1', '-q:v', '3', sheet,
]);
console.log(`sheet → ${sheet} (${cols}×${rows})`);
