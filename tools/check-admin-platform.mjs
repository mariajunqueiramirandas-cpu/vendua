#!/usr/bin/env bun
// Enforces the merchant admin's platform seam (ADR 0044 §1): one React app is the website and
// the iOS/Android app, and everything that differs between them lives in apps/admin/src/platform/.
//   - Capacitor (and the app's plugins) is imported only inside src/platform/, and only by the
//     app's side of it (native*), so the web bundle carries none of it;
//   - the website's side (web*) is never imported by the app's, so the app carries no service worker;
//   - the rest of src/ reaches either side only through src/platform/index.ts;
//   - browser calls that break inside the app (a relative fetch, EventSource, location.origin,
//     printing, vibration, the share sheet, speech, the wake lock, the service worker) appear
//     only in src/platform/ (and lib/api.ts, the one client that builds Core URLs through it).
//   check-admin-platform.mjs [--root <dir>]   (default: apps/admin/src)
// Exit 0 = pass, 1 = offences (one `file:line what` per line) or usage error.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_RE = /\.(?:ts|tsx|mts|js|mjs)$/;
const NATIVE_PKG = /^@(?:capacitor|capacitor-community|capgo)\//;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function parseArgs(argv) {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'admin', 'src');
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--root') {
      const value = argv[++i];
      if (!value) fail('--root requires a value');
      root = resolve(value);
    } else if (arg === '-h' || arg === '--help') {
      console.log('usage: check-admin-platform.mjs [--root <dir>]');
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg} (see --help)`);
    }
  }
  return root;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && SOURCE_RE.test(entry.name)) yield full;
  }
}

// comments blanked (newlines kept) so a commented-out call neither fails nor shifts line numbers
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(,])\/\/[^\n]*/g, (m, pre) => pre + ' '.repeat(m.length - pre.length));
}

const SPECIFIER_RES = [
  /\b(?:import|export)\b[^;'"`]*?\bfrom\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*(['"])([^'"\n]+)\1/g,
  /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
];

/** what only src/platform/ may call, and what to use instead */
const WEB_ONLY = [
  [/\bfetch\(\s*['"`]\//, 'a relative fetch: use lib/api.ts or platform.http.url()'],
  [/\bnew\s+EventSource\s*\(|\bEventSource\s*\(/, 'EventSource: use platform.stream()'],
  [/\blocation\.origin\b/, 'location.origin: use platform.publicUrl() or platform.http.url()'],
  [/\bwindow\.print\s*\(/, 'window.print: use platform.print()'],
  [/\bnavigator\.vibrate\b/, 'navigator.vibrate: use lib/haptics.ts'],
  [/\bnavigator\.(?:share|canShare)\b/, 'navigator.share: use platform.share'],
  [/\bspeechSynthesis\b/, 'speechSynthesis: use platform.speech'],
  [/\bnavigator\.wakeLock\b/, 'the wake lock: use lib/wakeLock.ts'],
  [/\bnavigator\.serviceWorker\b/, 'the service worker: the website side of src/platform/ owns it'],
];

const line = (text, at) => text.slice(0, at).split('\n').length;

const root = parseArgs(process.argv.slice(2));
try {
  if (!statSync(root).isDirectory()) throw new Error('not a directory');
} catch {
  fail(`--root ${root} is not a readable directory`);
}

const platformDir = join(root, 'platform') + sep;
const offences = [];
let files = 0;
for (const file of walk(root)) {
  files++;
  const rel = relative(root, file).split(sep).join('/');
  const text = stripComments(readFileSync(file, 'utf8'));
  const inPlatform = file.startsWith(platformDir);
  const side = !inPlatform
    ? null
    : /^platform\/(?:native\.ts|native\/)/.test(rel)
      ? 'native'
      : /^platform\/(?:web\.ts|web\/)/.test(rel)
        ? 'web'
        : 'shared';
  const seen = new Set();
  for (const re of SPECIFIER_RES) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].lastIndexOf(m[2]);
      if (seen.has(at)) continue;
      seen.add(at);
      const spec = m[2];
      const where = `${rel}:${line(text, at)}`;
      if (NATIVE_PKG.test(spec) && side !== 'native')
        offences.push(`${where} ${spec}: Capacitor belongs to src/platform/native*`);
      if (spec === '@platform-impl' && rel !== 'platform/index.ts')
        offences.push(`${where} ${spec}: import src/platform/index.ts instead`);
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        const t = relative(root, target).split(sep).join('/');
        const toSide = /^platform\/(?:native(?:\.ts)?$|native\/)/.test(t)
          ? 'native'
          : /^platform\/(?:web(?:\.ts)?$|web\/)/.test(t)
            ? 'web'
            : null;
        if (toSide && !inPlatform)
          offences.push(`${where} ${spec}: import src/platform/index.ts instead`);
        else if (toSide && side && side !== 'shared' && toSide !== side)
          offences.push(`${where} ${spec}: the ${side} side never loads the ${toSide} side`);
      }
    }
  }
  if (inPlatform || rel === 'lib/api.ts') continue;
  for (const [re, what] of WEB_ONLY) {
    const g = new RegExp(re.source, 'g');
    for (const m of text.matchAll(g)) offences.push(`${rel}:${line(text, m.index)} ${what}`);
  }
}

if (offences.length > 0) {
  console.error(
    'the admin runs as a website and as the iOS/Android app: what differs goes through src/platform/ (ADR 0044):',
  );
  for (const o of offences) console.error(o);
  process.exit(1);
}
console.log(`admin platform boundary OK: ${files} file(s)`);
