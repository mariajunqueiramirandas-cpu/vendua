// app-version.json → the native projects (ADR 0044 §2). Android's Gradle reads the file itself;
// iOS keeps the version in the Xcode project (MARKETING_VERSION) and the native level in
// Info.plist (VenduaNative), so this writes them. `--check` fails when they differ (CI).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = JSON.parse(readFileSync(`${root}app-version.json`, 'utf8')) as {
  version: string;
  native: number;
};
if (!/^\d+\.\d+\.\d+$/.test(app.version) || !Number.isInteger(app.native) || app.native < 1)
  throw new Error('app-version.json: version must be x.y.z and native a positive integer');

const edits: [string, (s: string) => string][] = [
  [
    'ios/App/App.xcodeproj/project.pbxproj',
    (s) => s.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${app.version};`),
  ],
  [
    'ios/App/App/Info.plist',
    (s) => s.replace(/(<key>VenduaNative<\/key>\s*<integer>)\d+(<\/integer>)/, `$1${app.native}$2`),
  ],
];

const check = process.argv.includes('--check');
let stale = false;
for (const [file, edit] of edits) {
  const before = readFileSync(`${root}${file}`, 'utf8');
  const after = edit(before);
  if (after === before) continue;
  stale = true;
  if (check) console.error(`${file} is behind app-version.json: run bun scripts/native-version.ts`);
  else writeFileSync(`${root}${file}`, after);
}
if (check && stale) process.exit(1);
console.log(`app ${app.version}, native ${app.native}${check ? ': in sync' : ''}`);
