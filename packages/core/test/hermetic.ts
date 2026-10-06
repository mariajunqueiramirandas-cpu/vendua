// Core's suite runs in the environment CI gives it: TEST_DATABASE_URL and nothing else Core reads.
// A developer or cloud shell may carry live integration keys (Google Calendar, Tinyfish, OpenRouter,
// Resend…), seed overrides (SEED_OWNER_*) or deployment switches (VENDUA_*); tests then reach real
// services or see other defaults and fail only there. Every variable Core's source reads is cleared
// before any test loads; a test that needs one sets it itself.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const KEEP = new Set(['TEST_DATABASE_URL', 'TEST_APP_DATABASE_URL', 'NODE_ENV', 'LOG_LEVEL', 'TZ']);
const src = join(import.meta.dir, '../src');

for (const file of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
  if (!file.endsWith('.ts')) continue;
  for (const [, name] of readFileSync(join(src, file), 'utf8').matchAll(
    /process\.env\.([A-Z][A-Z0-9_]*)/g,
  ))
    if (!KEEP.has(name!)) delete process.env[name!];
}

// The database the DB-backed tests run on. Their describe blocks use `skipIf(!TEST_DATABASE_URL)`,
// and a skip prints nothing: say so once, here, instead of letting a green run mean "not run".
// The suite also rewrites tables and queues agent runs, and a dev Core on the same database would
// claim those runs, so only a database named *_test is accepted.
const dbName = (url: string): string | null => {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
};
const where = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable URL)';
  }
};
const CREATE_HINT = [
  '    Use a throwaway database whose name ends in _test. Create it once with',
  '      createdb -h localhost -p 5433 -U vendua vendua_test',
  '    then run',
  '      TEST_DATABASE_URL=postgres://vendua:vendua@localhost:5433/vendua_test bun test',
].join('\n');

if (!process.env.TEST_DATABASE_URL) {
  let blocks = 0;
  let files = 0;
  for (const file of readdirSync(import.meta.dir)) {
    if (!file.endsWith('.test.ts')) continue;
    const n = readFileSync(join(import.meta.dir, file), 'utf8').match(/\.skipIf\(/g)?.length ?? 0;
    blocks += n;
    if (n) files++;
  }
  const banner = [
    '',
    '!!! TEST_DATABASE_URL is not set: the database tests will be SKIPPED, not run !!!',
    `    ${blocks} describe blocks in ${files} files skip without a word, so a green run here does not cover them.`,
    CREATE_HINT,
    '',
  ].join('\n');
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.error(banner);
    process.exit(1);
  }
  console.warn(banner);
} else {
  for (const key of ['TEST_DATABASE_URL', 'TEST_APP_DATABASE_URL'] as const) {
    const url = process.env[key];
    if (!url) continue;
    const name = dbName(url);
    if (name?.endsWith('_test')) continue;
    console.error(
      [
        '',
        `Refusing to run: ${key} points at "${where(url)}", and a test database's name must end in _test.`,
        '    The suite wipes and rewrites tables, and a dev Core running on the same database claims the',
        '    agent runs the tests queue.',
        CREATE_HINT,
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
}
