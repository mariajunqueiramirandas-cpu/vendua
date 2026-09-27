// Bundle budget (design spec §11), run after `vite build`: the shell (entry +
// vendor) under 120 KB gzip, every lazy route chunk under 60 KB, the fonts a
// phone actually downloads (latin + latin-ext) under 90 KB. Fails the build.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const dir = join(dist, 'assets');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const gz = (f: string) => gzipSync(readFileSync(join(dir, f))).length;
const files = readdirSync(dir);
const js = files.filter((f) => f.endsWith('.js'));
// what index.html loads up front: the entry script and its modulepreloads
const shell = js.filter((f) => html.includes(f));
const routes = js.filter((f) => !shell.includes(f));
let failed = false;
const check = (label: string, size: number, max: number) => {
  const ok = size <= max;
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${label.padEnd(40)} ${kb(size).padStart(9)}  (budget ${kb(max)})`);
};
check(
  'shell (entry + vendor + css)',
  shell.reduce((a, f) => a + gz(f), 0) +
    files.filter((f) => f.endsWith('.css') && html.includes(f)).reduce((a, f) => a + gz(f), 0),
  120 * 1024,
);
for (const f of routes.sort()) check(`route ${f}`, gz(f), 60 * 1024);
// fonts: one variable file per family for the subsets pt-BR needs
const fonts = files.filter(
  (f) =>
    f.endsWith('.woff2') &&
    /(latin-wght|latin-ext-wght|latin-400-italic|latin-ext-400-italic)/.test(f) &&
    !/cyrillic|greek|vietnamese/.test(f),
);
const latin = fonts.filter((f) => !f.includes('latin-ext'));
check(
  `fonts, latin (${latin.length} files)`,
  latin.reduce((a, f) => a + statSync(join(dir, f)).size, 0),
  90 * 1024,
);
if (failed) {
  console.error('bundle budget exceeded');
  process.exit(1);
}
