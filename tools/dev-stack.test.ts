import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context, listening, parseArgs, seeds, services, start, stop } from './dev-stack.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'dev-stack-test-'));
  dirs.push(d);
  return d;
};
const capture = () => {
  const lines: string[] = [];
  return { lines, out: (s: string) => lines.push(s), text: () => lines.join('\n') };
};
const freePort = () =>
  new Promise<number>((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => res(port));
    });
  });

describe('parseArgs', () => {
  test('defaults to starting the whole stack', () => {
    expect(parseArgs([])).toEqual({
      command: 'start',
      seed: false,
      dryRun: false,
      only: ['core', 'admin', 'control'],
    });
  });

  test('flags, in any order, with --only in both spellings', () => {
    expect(parseArgs(['--dry-run', '--seed', '--only', 'core,admin'])).toMatchObject({
      seed: true,
      dryRun: true,
      only: ['core', 'admin'],
    });
    expect(parseArgs(['--only=control']).only).toEqual(['control']);
    expect(parseArgs(['stop', '--dry-run'])).toMatchObject({ command: 'stop', dryRun: true });
  });

  test('a misspelled flag is an error with a hint, not a silent plain start', () => {
    expect(() => parseArgs(['--sead'])).toThrow(/unknown argument '--sead'/);
    expect(() => parseArgs(['--dry'])).toThrow("did you mean '--dry-run'?");
    expect(() => parseArgs(['--only', 'core,crm'])).toThrow("not 'crm'");
    expect(() => parseArgs(['--only'])).toThrow('--only takes');
    expect(() => parseArgs(['restart'])).toThrow("unknown command 'restart'");
    expect(() => parseArgs(['stop', '--seed'])).toThrow('--seed only goes with start');
  });
});

describe('the stack definition', () => {
  const svcs = services('/x');
  const by = Object.fromEntries(svcs.map((s: { name: string }) => [s.name, s]));

  test('Core :8787 with dev sign-in codes, the apps on the ports their proxies expect', () => {
    expect(by.core.port).toBe(8787);
    expect(by.core.env).toMatchObject({
      PORT: '8787',
      VENDUA_ADMIN_DEV_OTP: '1',
      CONTROL_SECRET: 'dev',
      SESSION_SECRET: 'devsecret',
      VENDUA_WEBHOOK_SECRET: 'devhook',
    });
    expect([by.admin.port, by.control.port]).toEqual([5196, 5195]);
    // the ports are the vite configs' own
    expect(readFileSync(join(ROOT, 'apps/admin/vite.config.ts'), 'utf8')).toContain('port: 5196');
    expect(readFileSync(join(ROOT, 'apps/control/vite.config.ts'), 'utf8')).toContain('port: 5195');
    for (const s of svcs) {
      expect(existsSync(join(ROOT, s.cwd, 'package.json'))).toBe(true);
      expect(
        JSON.parse(readFileSync(join(ROOT, s.cwd, 'package.json'), 'utf8')).scripts.dev,
      ).toBeTruthy();
    }
  });

  test('the shell’s own secrets neither reach the stack nor its printed commands', () => {
    const before = process.env.CONTROL_SECRET;
    process.env.CONTROL_SECRET = 'ambient-secret-value';
    try {
      expect(JSON.stringify([services('/x'), seeds()])).not.toContain('ambient-secret-value');
    } finally {
      if (before === undefined) delete process.env.CONTROL_SECRET;
      else process.env.CONTROL_SECRET = before;
    }
  });

  test('seeds run in dependency order and point at scripts that exist', () => {
    const list = seeds() as { name: string; phase: string; cwd: string; cmd: string[] }[];
    const names = list.map((s) => s.name);
    const at = (needle: string) => names.findIndex((n) => n.includes(needle));
    expect(at('migrate')).toBeLessThan(at('fixtures'));
    // checkout needs the menu the fixtures create, and Core must be up for both of the last two
    expect(at('fixtures')).toBeLessThan(at('demo orders'));
    expect(list[at('fixtures')]!.phase).toBe('before');
    expect(list[at('CRM leads')]!.phase).toBe('after');
    expect(list[at('demo orders')]!.phase).toBe('after');
    const core = JSON.parse(readFileSync(join(ROOT, 'packages/core/package.json'), 'utf8')).scripts;
    expect(core['seed:fixtures']).toBeTruthy();
    expect(core.migrate).toBeTruthy();
    for (const s of list) {
      const file = s.cmd.find((c) => c.startsWith('scripts/'));
      if (file) expect(existsSync(join(ROOT, s.cwd, file))).toBe(true);
    }
  });
});

describe('--dry-run', () => {
  test('prints every command, starts nothing and leaves no files', async () => {
    const dir = join(tmp(), 'state');
    const o = capture();
    const code = await start(
      { command: 'start', seed: true, dryRun: true, only: ['core', 'admin', 'control'] },
      context({ dir, out: o.out }),
    );
    expect(code).toBe(0);
    const text = o.text();
    for (const needle of [
      'packages/core && bun run migrate',
      'bun run seed:fixtures',
      'VENDUA_ADMIN_DEV_OTP=1',
      'PORT=8787',
      'cd apps/admin && bun run dev',
      'cd apps/control && bun run dev',
      'bun scripts/dev-seed.ts',
      'bun scripts/demo-orders.ts 40',
      `${dir}/core.pid`,
      `${dir}/admin.log`,
    ])
      expect(text).toContain(needle);
    expect(text.indexOf('seed:fixtures')).toBeLessThan(text.indexOf('dev-seed.ts'));
    expect(text.indexOf('dev-seed.ts')).toBeLessThan(text.indexOf('demo-orders.ts'));
    expect(existsSync(dir)).toBe(false);
  });

  test('stop --dry-run touches no pidfile', async () => {
    const dir = tmp();
    // a pidfile of a process that is gone: stop would clean it, a dry run must not
    writeFileSync(join(dir, 'core.pid'), '999999\n');
    const o = capture();
    await stop(
      { command: 'stop', seed: false, dryRun: true, only: [] },
      context({ dir, out: o.out }),
    );
    expect(o.text()).toContain('core  pid 999999 is gone');
    expect(readdirSync(dir)).toEqual(['core.pid']);
  });
});

describe('lifecycle with a stand-in service', () => {
  let port = 0;
  const dir = tmp();
  const svc = () => ({
    name: 'fake',
    title: 'Fake',
    port,
    cwd: '.',
    cmd: [
      'bun',
      '-e',
      'Bun.serve({ port: Number(process.env.FAKE_PORT), fetch: () => new Response("ok") }); setInterval(() => {}, 1e6)',
    ],
    env: { FAKE_PORT: String(port) },
    url: `http://localhost:${port}`,
    hint: '',
  });
  const opts = (over = {}) => ({
    command: 'start',
    seed: false,
    dryRun: false,
    only: ['fake'],
    ...over,
  });
  const pid = () => Number(readFileSync(join(dir, 'fake.pid'), 'utf8'));
  const gone = async (p: number) => {
    for (let i = 0; i < 50; i++) {
      try {
        process.kill(p, 0);
      } catch {
        return true;
      }
      await Bun.sleep(100);
    }
    return false;
  };

  afterAll(async () => {
    port = port || (await freePort());
    await stop(opts({ command: 'stop' }), context({ dir, svcs: [svc()], out: () => {} }));
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('starts it, writes the pidfile and log, and a second start leaves it alone', async () => {
    port = await freePort();
    const o = capture();
    expect(await start(opts(), context({ dir, svcs: [svc()], seedList: [], out: o.out }))).toBe(0);
    expect(await listening(port)).toBe(true);
    const first = pid();
    expect(first).toBeGreaterThan(1);
    expect(existsSync(join(dir, 'fake.log'))).toBe(true);

    const o2 = capture();
    expect(await start(opts(), context({ dir, svcs: [svc()], seedList: [], out: o2.out }))).toBe(0);
    expect(o2.text()).toContain('already answers, left alone');
    expect(pid()).toBe(first);
  }, 30_000);

  test('stop signals the process group from the pidfile and removes it', async () => {
    const first = pid();
    const o = capture();
    expect(await stop(opts({ command: 'stop' }), context({ dir, svcs: [svc()], out: o.out }))).toBe(
      0,
    );
    expect(o.text()).toContain(`fake  stopped (pid ${first})`);
    expect(await gone(first)).toBe(true);
    expect(await listening(port)).toBe(false);
    expect(existsSync(join(dir, 'fake.pid'))).toBe(false);

    const again = capture();
    await stop(opts({ command: 'stop' }), context({ dir, svcs: [svc()], out: again.out }));
    expect(again.text()).toContain('nothing to stop');
  }, 30_000);

  test('something else on the port is neither replaced nor killed', async () => {
    const other = Bun.serve({ port: 0, fetch: () => new Response('not ours') });
    try {
      port = other.port as number;
      const o = capture();
      expect(await start(opts(), context({ dir, svcs: [svc()], seedList: [], out: o.out }))).toBe(
        0,
      );
      expect(o.text()).toContain('already answers, left alone');
      expect(existsSync(join(dir, 'fake.pid'))).toBe(false);
      const s = capture();
      await stop(opts({ command: 'stop' }), context({ dir, svcs: [svc()], out: s.out }));
      expect(s.text()).toContain('not started by dev:stack');
      expect(await listening(port)).toBe(true);
    } finally {
      other.stop(true);
    }
  }, 30_000);
});
