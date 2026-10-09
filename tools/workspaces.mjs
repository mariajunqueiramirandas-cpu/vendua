// Runs a script in every workspace that has one: what CI's `check` job did in two shell loops,
// now shared with the root package.json (`bun run check`, `bun run test`).
//   bun tools/workspaces.mjs check [--keep-going] [--list] [--jobs N]
//   bun tools/workspaces.mjs test  [--keep-going] [--list] [--jobs N] [--core]
//
// check: `bun run check` in every dir of `packages/* site apps/* storefronts/*` whose package.json
//        has a `check` script, so a new package needs no CI edit.
// test:  `bun test --parallel` (not the package's `test` script) in `packages/* apps/status tools`
//        that have a `test` script, except packages/core: CI runs it in its own job against Postgres
//        (`cd packages/core && bun test`; --core adds it here).
// --jobs N runs N workspaces at once (default: one per CPU), each one's output printed whole when it
// ends. Like CI's `bash -e`, the first failure stops the run with that command's exit code (the
// workspaces still running are stopped); --keep-going runs everything and fails at the end.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const KINDS = {
  check: {
    globs: ['packages/*', 'site', 'apps/*', 'storefronts/*'],
    script: 'check',
    run: ['run', 'check'],
  },
  // --parallel: one worker per file, each in a fresh global (kernel's suite 26 s → 9 s)
  test: {
    globs: ['packages/*', 'apps/status', 'tools'],
    script: 'test',
    run: ['test', '--parallel'],
  },
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

/** One workspace's command; with `buffer` its output is held and printed whole at the end. */
function runOne(kind, root, dir, buffer, children) {
  return new Promise((done) => {
    if (!buffer) console.log(`${kind} ${dir}`);
    // buffered runs lead their own process group: stopping one stops what its script started
    const child = spawn(process.execPath, KINDS[kind].run, {
      cwd: join(root, dir),
      stdio: buffer ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      detached: buffer,
    });
    children.add(child);
    const out = [];
    child.stdout?.on('data', (b) => out.push(b));
    child.stderr?.on('data', (b) => out.push(b));
    const finish = (code) => {
      children.delete(child);
      if (buffer) {
        process.stdout.write(`${kind} ${dir}\n`);
        process.stdout.write(Buffer.concat(out));
      }
      done(code);
    };
    child.on('error', (err) => {
      out.push(Buffer.from(`${err.message}\n`));
      finish(1);
    });
    child.on('close', (code, signal) => finish(code ?? (signal ? 1 : 0)));
  });
}

export async function runAll(
  kind,
  { root = ROOT, core = false, keepGoing = false, list = false, jobs = 1 } = {},
) {
  const dirs = select(kind, { root, core });
  if (list) {
    for (const d of dirs) console.log(d);
    return 0;
  }
  const children = new Set();
  const failed = [];
  let stopCode = 0;
  let next = 0;
  const worker = async () => {
    while (!stopCode && next < dirs.length) {
      const dir = dirs[next++];
      const code = await runOne(kind, root, dir, jobs > 1, children);
      if (code === 0) continue;
      failed.push(dir);
      if (!keepGoing && !stopCode) {
        stopCode = code;
        stopAll();
      }
    }
  };
  const stopAll = () => {
    for (const c of children)
      try {
        process.kill(jobs > 1 ? -c.pid : c.pid, 'SIGTERM');
      } catch {}
  };
  // detached groups don't get the terminal's Ctrl-C: pass it on
  const interrupt = () => {
    stopAll();
    process.exit(130);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, dirs.length)) }, worker));
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  if (stopCode) return stopCode;
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

export async function main(argv = process.argv.slice(2)) {
  const [kind, ...rest] = argv;
  const flags = [];
  let jobs = availableParallelism();
  let bad;
  for (let i = 0; i < rest.length; i++) {
    const f = rest[i];
    const jobsArg = f === '--jobs' ? rest[++i] : f.startsWith('--jobs=') ? f.slice(7) : null;
    if (jobsArg !== null) {
      jobs = Number(jobsArg);
      if (!Number.isInteger(jobs) || jobs < 1) bad ??= `${f}${f === '--jobs' ? ` ${jobsArg}` : ''}`;
    } else flags.push(f);
  }
  const known = ['--keep-going', '--list', ...(kind === 'test' ? ['--core'] : [])];
  bad ??= flags.find((f) => !known.includes(f));
  if (!KINDS[kind] || bad) {
    console.error(
      `${bad ? `unknown flag '${bad}'` : `unknown command '${kind ?? ''}'`}\nusage: bun tools/workspaces.mjs check [--keep-going] [--list] [--jobs N]\n       bun tools/workspaces.mjs test  [--keep-going] [--list] [--jobs N] [--core]`,
    );
    return 2;
  }
  return runAll(kind, {
    keepGoing: flags.includes('--keep-going'),
    list: flags.includes('--list'),
    core: flags.includes('--core'),
    jobs,
  });
}

if (import.meta.main) process.exit(await main());
