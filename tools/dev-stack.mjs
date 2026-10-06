// The local stack in one command (the commands of .claude/skills/local-stack/SKILL.md):
//   bun run dev:stack [--seed] [--dry-run] [--only core,admin,control]
//   bun run dev:stack status
//   bun run dev:stop [--dry-run]
// Core :8787, the merchant admin :5196 and the CRM :5195 each run in their own process group,
// with a pidfile and a log under one directory (default <tmp>/vendua-dev, VENDUA_DEV_DIR to
// move it). A service whose port already answers is left alone. Stopping signals the process
// group named by the pidfile — never `pkill -f`, so only what this script started goes down.
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVICES = ['core', 'admin', 'control'];
const FLAGS = ['--seed', '--dry-run', '--only'];
const DEMO_ORDERS = 40; // what the CI admin-gate seeds

export const stateDir = (env = process.env) => env.VENDUA_DEV_DIR || join(tmpdir(), 'vendua-dev');

/**
 * The dev secrets of the local-stack skill. They are fixed on purpose: the CRM login key is
 * `dev`, and whatever secrets the shell happens to carry must neither reach this stack nor be
 * printed by --dry-run.
 */
export function devEnv() {
  return {
    CONTROL_SECRET: 'dev',
    SESSION_SECRET: 'devsecret',
    VENDUA_WEBHOOK_SECRET: 'devhook',
    // the sign-in code comes back in the response, so the admin works without WhatsApp
    VENDUA_ADMIN_DEV_OTP: '1',
  };
}

/** @param {string} dir the state directory */
export function services(dir) {
  const dev = devEnv();
  return [
    {
      name: 'core',
      title: 'Core API',
      port: 8787,
      cwd: 'packages/core',
      cmd: ['bun', 'run', 'dev'],
      // the proxies of both apps point at :8787, so the port is not negotiable
      env: { ...dev, PORT: '8787' },
      ready: 'http://127.0.0.1:8787/healthz',
      url: 'http://localhost:8787',
      hint: 'dev sign-in codes are on (VENDUA_ADMIN_DEV_OTP=1)',
    },
    {
      name: 'admin',
      title: 'Merchant admin',
      port: 5196,
      cwd: 'apps/admin',
      cmd: ['bun', 'run', 'dev'],
      env: {},
      url: 'http://localhost:5196/admin/',
      hint: 'sign in as the seed owner, phone 22999990001 (the code comes back on screen)',
    },
    {
      name: 'control',
      title: 'CRM',
      port: 5195,
      cwd: 'apps/control',
      cmd: ['bun', 'run', 'dev'],
      env: {},
      url: 'http://localhost:5195/control/',
      hint: `login key: ${dev.CONTROL_SECRET}`,
    },
  ];
}

/**
 * The seeds in dependency order. `before` runs ahead of Core (CI does the same: the fixtures rewrite
 * rows Core would otherwise have cached), `after` needs Core answering. The demo orders go through
 * checkout, so they need the menu the fixtures create.
 */
export function seeds() {
  const dev = devEnv();
  return [
    {
      name: 'migrate',
      phase: 'before',
      cwd: 'packages/core',
      cmd: ['bun', 'run', 'migrate'],
      env: {},
    },
    {
      name: 'fixtures (menu, zones, canary tenants)',
      phase: 'before',
      cwd: 'packages/core',
      cmd: ['bun', 'run', 'seed:fixtures'],
      env: {},
    },
    {
      name: 'CRM leads',
      phase: 'after',
      cwd: 'apps/control',
      cmd: ['bun', 'scripts/dev-seed.ts'],
      env: { CONTROL_KEY: dev.CONTROL_SECRET, WEBHOOK_KEY: dev.VENDUA_WEBHOOK_SECRET },
    },
    {
      name: `demo orders (${DEMO_ORDERS})`,
      phase: 'after',
      cwd: 'apps/admin',
      cmd: ['bun', 'scripts/demo-orders.ts', String(DEMO_ORDERS)],
      env: {},
      // additive: a second --seed would pile another batch on the board
      skipWhen: 'orders',
    },
  ];
}

export function parseArgs(argv) {
  const out = { command: 'start', seed: false, dryRun: false, only: [...SERVICES] };
  // `--only=core,admin` and `--only core,admin` both work
  const args = argv.flatMap((a) => (a.startsWith('--only=') ? ['--only', a.slice(7)] : [a]));
  if (args[0] && !args[0].startsWith('-')) out.command = args.shift();
  if (!['start', 'stop', 'status'].includes(out.command))
    throw new Error(`unknown command '${out.command}' (start | stop | status)`);
  while (args.length) {
    const a = args.shift();
    if (a === '--seed') out.seed = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--only') {
      const names = (args.shift() ?? '').split(',').filter(Boolean);
      const bad = names.find((n) => !SERVICES.includes(n));
      if (!names.length || bad)
        throw new Error(
          `--only takes a comma list of ${SERVICES.join(', ')}${bad ? `, not '${bad}'` : ''}`,
        );
      out.only = names;
    } else {
      const bare = a.replace(/^-+/, '');
      const near = FLAGS.find(
        (f) => bare.length >= 3 && (f.includes(bare) || bare.includes(f.slice(2))),
      );
      throw new Error(`unknown argument '${a}'${near ? ` (did you mean '${near}'?)` : ''}`);
    }
  }
  if (out.command !== 'start' && out.seed) throw new Error('--seed only goes with start');
  if (out.command === 'status' && out.dryRun)
    throw new Error('--dry-run only goes with start and stop');
  return out;
}

// ── process helpers ─────────────────────────────────────────────────────────────────────────

/** True when something accepts connections on the loopback port (IPv4 or IPv6). */
export function listening(port, timeoutMs = 400) {
  const probe = (host) =>
    new Promise((done) => {
      const s = connect({ port, host });
      const end = (v) => {
        s.destroy();
        done(v);
      };
      s.setTimeout(timeoutMs, () => end(false));
      s.once('connect', () => end(true));
      s.once('error', () => end(false));
    });
  return Promise.all([probe('127.0.0.1'), probe('::1')]).then(([a, b]) => a || b);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** The process group of a pid, or null when it is gone. */
function groupOf(pid) {
  const r = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  const n = Number(r.stdout?.trim());
  return r.status === 0 && Number.isInteger(n) ? n : null;
}

/** A pidfile names a process of ours only while it still leads the group we gave it. */
function ours(pid) {
  return alive(pid) && groupOf(pid) === pid;
}

const pidFile = (dir, name) => join(dir, `${name}.pid`);
const logFile = (dir, name) => join(dir, `${name}.log`);

function readPid(dir, name) {
  try {
    const pid = Number(readFileSync(pidFile(dir, name), 'utf8').trim());
    return Number.isInteger(pid) && pid > 1 ? pid : null;
  } catch {
    return null;
  }
}

const shell = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);
const line = (cwd, env, cmd) =>
  `(cd ${cwd} && ${[...Object.entries(env).map(([k, v]) => `${k}=${shell(v)}`), ...cmd].join(' ')})`;

function run(step) {
  const r = spawnSync(process.execPath, step.cmd.slice(1), {
    cwd: join(ROOT, step.cwd),
    env: { ...process.env, ...step.env },
    stdio: 'inherit',
  });
  return r.status === 0;
}

/** Orders already in the demo store (null when the database can't be asked). */
export async function ordersInDemoStore() {
  try {
    const mod = createRequire(join(ROOT, 'packages/core/package.json'))('postgres');
    const postgres = mod.default ?? mod;
    const sql = postgres(
      process.env.DATABASE_URL ?? 'postgres://vendua:vendua@localhost:5433/vendua',
      {
        onnotice: () => {},
        max: 1,
        connect_timeout: 5,
      },
    );
    try {
      const [{ n }] = await sql`
        select count(*)::int as n from orders o join tenants t on t.id = o.tenant_id
        where t.slug = 'quero-pudim'`;
      return n;
    } finally {
      await sql.end({ timeout: 2 });
    }
  } catch {
    return null;
  }
}

function tail(file, n = 25) {
  try {
    return readFileSync(file, 'utf8').split('\n').slice(-n).join('\n');
  } catch {
    return '(no log)';
  }
}

async function waitReady(svc, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return `${svc.title} exited while starting`;
    if (svc.ready) {
      const ok = await fetch(svc.ready, { signal: AbortSignal.timeout(1500) })
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) return null;
    } else if (await listening(svc.port)) return null;
    await sleep(500);
  }
  return `${svc.title} did not answer on :${svc.port} within ${Math.round(timeoutMs / 1000)} s`;
}

// ── start ───────────────────────────────────────────────────────────────────────────────────

/** What a command works on; tests hand in throwaway services and a directory of their own. */
export function context(overrides = {}) {
  const dir = overrides.dir ?? stateDir();
  return { dir, svcs: services(dir), seedList: seeds(), out: console.log, ...overrides };
}

export async function start(opts, ctx = context()) {
  const { dir, out } = ctx;
  const chosen = ctx.svcs.filter((s) => opts.only.includes(s.name));
  const wantSeeds = opts.seed ? ctx.seedList : [];

  out(`${opts.dryRun ? 'dev:stack (dry run, nothing is started)' : 'dev:stack'}  state in ${dir}`);
  const pg = await listening(5433);
  out(
    `postgres :5433  ${pg ? 'listening' : 'NOT listening, Core needs it (session hook, or `bun run --cwd packages/core db:up`)'}`,
  );

  const states = [];
  for (const svc of chosen) {
    const up = await listening(svc.port);
    const pid = readPid(dir, svc.name);
    const mine = pid !== null && ours(pid);
    const state = up ? 'listening' : mine ? 'starting' : 'down';
    states.push({ svc, state, pid: mine ? pid : null });
  }

  const before = wantSeeds.filter((s) => s.phase === 'before');
  const after = wantSeeds.filter((s) => s.phase === 'after');
  if (opts.dryRun) {
    for (const s of before) out(`seed ${s.name}\n  ${line(s.cwd, s.env, s.cmd)}`);
    for (const { svc, state } of states) {
      const verdict =
        state === 'down'
          ? 'would start'
          : `would skip: ${state === 'listening' ? `:${svc.port} already answers` : 'already starting'}`;
      out(`${svc.name} :${svc.port}  ${verdict}`);
      out(
        `  ${line(svc.cwd, svc.env, svc.cmd)} > ${logFile(dir, svc.name)} 2>&1   # pid -> ${pidFile(dir, svc.name)}`,
      );
    }
    for (const s of after)
      out(
        `seed ${s.name}${s.skipWhen ? ' (skipped when the store already has orders)' : ''}\n  ${line(s.cwd, s.env, s.cmd)}`,
      );
    return 0;
  }
  if (process.platform === 'win32') {
    console.error('dev:stack needs a POSIX shell (use WSL or the dev container)');
    return 1;
  }

  const needsDb =
    wantSeeds.length > 0 || states.some((s) => s.svc.name === 'core' && s.state === 'down');
  if (needsDb && !pg) {
    console.error(
      'Postgres is not listening on :5433: start it first (the session hook, or `bun run --cwd packages/core db:up`)',
    );
    return 1;
  }

  if (after.length && !chosen.some((s) => s.name === 'core') && !(await listening(8787))) {
    console.error('the seeds need Core: start it too (drop --only, or include core)');
    return 1;
  }

  for (const s of before) {
    out(`==> seed ${s.name}`);
    if (!run(s)) {
      console.error(`seed '${s.name}' failed`);
      return 1;
    }
  }

  mkdirSync(dir, { recursive: true });
  for (const { svc, state, pid } of states) {
    if (state === 'listening') {
      out(`${svc.name} :${svc.port}  already answers, left alone`);
      continue;
    }
    if (state === 'starting') {
      out(`${svc.name}  pid ${pid} is still starting, not starting another`);
      continue;
    }
    rmSync(pidFile(dir, svc.name), { force: true });
    const fd = openSync(logFile(dir, svc.name), 'w');
    const child = spawn(process.execPath, svc.cmd.slice(1), {
      cwd: join(ROOT, svc.cwd),
      env: { ...process.env, ...svc.env },
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    child.unref();
    writeFileSync(pidFile(dir, svc.name), `${child.pid}\n`);
    out(`${svc.name} :${svc.port}  started, pid ${child.pid}`);
  }

  let failed = false;
  for (const { svc, state } of states) {
    const pid = readPid(dir, svc.name);
    if (state === 'listening' || pid === null) continue; // already up, not ours to wait for
    const problem = await waitReady(svc, pid, svc.name === 'core' ? 90_000 : 60_000);
    if (problem) {
      failed = true;
      console.error(
        `${problem}. Last of ${logFile(dir, svc.name)}:\n${tail(logFile(dir, svc.name))}`,
      );
    }
  }
  if (failed) return 1;

  for (const s of after) {
    if (s.skipWhen === 'orders') {
      const n = await ordersInDemoStore();
      if (n) {
        out(`==> seed ${s.name}: skipped, the store already has ${n} orders`);
        continue;
      }
    }
    out(`==> seed ${s.name}`);
    if (!run(s)) {
      console.error(`seed '${s.name}' failed`);
      return 1;
    }
  }

  out('');
  for (const svc of chosen) out(`${svc.title.padEnd(15)} ${svc.url}   ${svc.hint}`);
  const core = states.find((s) => s.svc.name === 'core');
  if (core?.state === 'listening')
    out(
      'Core was already running, so it keeps its own environment: the admin sign-in code only comes back in\nthe response when it was started with VENDUA_ADMIN_DEV_OTP=1.',
    );
  out(`logs and pidfiles: ${dir}\nstop: bun run dev:stop`);
  return 0;
}

// ── stop / status ───────────────────────────────────────────────────────────────────────────

export async function stop(opts, ctx = context()) {
  const { dir, out } = ctx;
  let any = false;
  for (const name of ctx.svcs.map((s) => s.name).reverse()) {
    const pid = readPid(dir, name);
    if (pid === null) continue;
    any = true;
    if (!ours(pid)) {
      out(`${name}  pid ${pid} is gone${opts.dryRun ? '' : ', removing its pidfile'}`);
      if (!opts.dryRun) rmSync(pidFile(dir, name), { force: true });
      continue;
    }
    if (opts.dryRun) {
      out(
        `${name}  would stop process group ${pid} (kill -TERM -- -${pid}), then remove ${pidFile(dir, name)}`,
      );
      continue;
    }
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
    const deadline = Date.now() + 8000;
    while (alive(pid) && Date.now() < deadline) await sleep(200);
    if (alive(pid)) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* gone */
      }
      out(`${name}  did not exit in time, killed (pid ${pid})`);
    } else out(`${name}  stopped (pid ${pid})`);
    rmSync(pidFile(dir, name), { force: true });
  }
  if (!any) out(`nothing to stop: no pidfiles in ${dir}`);
  if (!opts.dryRun)
    for (const svc of ctx.svcs)
      if (await listening(svc.port))
        out(
          `:${svc.port} (${svc.name}) still answers: it was not started by dev:stack, left alone`,
        );
  return 0;
}

async function status(ctx = context()) {
  const { dir, out } = ctx;
  for (const svc of ctx.svcs) {
    const up = await listening(svc.port);
    const pid = readPid(dir, svc.name);
    const mine = pid !== null && ours(pid);
    out(
      `${svc.name.padEnd(8)} :${svc.port}  ${up ? 'listening' : 'down'}  ${mine ? `pid ${pid} (dev:stack)` : up ? 'not started by dev:stack' : ''}  ${up ? svc.url : ''}`.trimEnd(),
    );
  }
  out(
    `state in ${dir}${existsSync(dir) ? `: ${readdirSync(dir).join(', ') || 'empty'}` : ' (not created yet)'}`,
  );
  return 0;
}

export async function main(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(
      `dev-stack: ${e.message}\nusage: bun run dev:stack [--seed] [--dry-run] [--only core,admin,control] | status | bun run dev:stop [--dry-run]`,
    );
    return 2;
  }
  if (opts.command === 'stop') return stop(opts);
  if (opts.command === 'status') return status();
  return start(opts);
}

if (import.meta.main) process.exit(await main());
