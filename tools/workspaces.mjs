// Runs a script in every workspace that has one: what CI's `check` job did in two shell loops,
// now shared with the root package.json (`bun run check`, `bun run test`).
//   bun tools/workspaces.mjs check [--keep-going] [--list]
//   bun tools/workspaces.mjs test  [--keep-going] [--list] [--core]
//
// check: `bun run check` in every dir of `packages/* site apps/* storefronts/*` whose package.json
//        has a `check` script, so a new package needs no CI edit.
// test:  `bun test` (not the package's `test` script) in `packages/* apps/status tools` that have a
//        `test` script, except packages/core: CI runs it in its own job against Postgres
//        (`cd packages/core && bun test`; --core adds it here).
// Like CI's `bash -e`, the first failure stops the run with that command's exit code;
// --keep-going runs everything and fails at the end.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const KINDS = {
  check: {
    globs: ['packages/*', 'site', 'apps/*', 'storefronts/*'],
    script: 'check',
    run: ['run', 'check'],
  },
  test: { globs: ['packages/*', 'apps/status', 'tools'], script: 'test', run: ['test'] },
};

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** `packages/*` → its directories, `site` → itself; sorted like a shell glob in the C locale. */
function expand(root, glob) {
  if (!glob.endsWith('/*')) return [glob];
  const base = glob.slice(0, -2);
  if (!isDir(join(root, base))) return [];
  return readdirSync(join(root, base))
    .filter((n) => !n.startsWith('.'))
    .sort()
    .map((n) => `${base}/${n}`);
}

/** jq -e '.scripts.<name>' is true for anything but null, false and a missing key. */
function hasScript(root, dir, name) {
  try {
    const v = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).scripts?.[name];
    return v !== undefined && v !== null && v !== false;
  } catch {
    return false;
  }
}

/** The workspace dirs `kind` runs in, in run order. */
export function select(kind, { root = ROOT, core = false } = {}) {
  const spec = KINDS[kind];
  const dirs = [];
  for (const glob of spec.globs)
    for (const dir of expand(root, glob)) {
      if (kind === 'test' && dir === 'packages/core' && !core) continue;
      if (!isDir(join(root, dir)) || !existsSync(join(root, dir, 'package.json'))) continue;
      if (hasScript(root, dir, spec.script)) dirs.push(dir);
    }
  return dirs;
}

export function runAll(kind, { root = ROOT, core = false, keepGoing = false, list = false } = {}) {
  const dirs = select(kind, { root, core });
  if (list) {
    for (const d of dirs) console.log(d);
    return 0;
  }
  const failed = [];
  for (const dir of dirs) {
    console.log(`${kind} ${dir}`);
    const r = spawnSync(process.execPath, KINDS[kind].run, {
      cwd: join(root, dir),
      stdio: 'inherit',
    });
    if (r.status === 0) continue;
    const code = r.status ?? 1;
    if (!keepGoing) return code;
    failed.push(dir);
  }
  if (failed.length) {
    console.error(`\n${kind} failed in: ${failed.join(', ')}`);
    return 1;
  }
  if (kind === 'test' && !core)
    console.log(
      '\npackages/core is not in this run: `cd packages/core && bun test` (needs TEST_DATABASE_URL), or pass --core',
    );
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  const [kind, ...flags] = argv;
  const known = ['--keep-going', '--list', ...(kind === 'test' ? ['--core'] : [])];
  const bad = flags.find((f) => !known.includes(f));
  if (!KINDS[kind] || bad) {
    console.error(
      `${bad ? `unknown flag '${bad}'` : `unknown command '${kind ?? ''}'`}\nusage: bun tools/workspaces.mjs check [--keep-going] [--list]\n       bun tools/workspaces.mjs test  [--keep-going] [--list] [--core]`,
    );
    return 2;
  }
  return runAll(kind, {
    keepGoing: flags.includes('--keep-going'),
    list: flags.includes('--list'),
    core: flags.includes('--core'),
  });
}

if (import.meta.main) process.exit(main());
