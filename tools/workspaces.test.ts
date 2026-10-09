import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, runAll, select } from './workspaces.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const made: string[] = [];
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function tree(pkgs: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'workspaces-test-'));
  made.push(root);
  for (const [dir, scripts] of Object.entries(pkgs)) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(
      join(root, dir, 'package.json'),
      typeof scripts === 'string' ? scripts : JSON.stringify({ name: dir, scripts }),
    );
  }
  writeFileSync(join(root, 'packages/README.md'), 'not a workspace');
  mkdirSync(join(root, 'tools'), { recursive: true }); // no package.json, like the real tools/
  return root;
}

describe('select', () => {
  const root = tree({
    'packages/a': { check: 'touch ran', test: 'x' },
    'packages/b': {},
    'packages/broken': '{ not json',
    'packages/core': { check: 'x', test: 'x' },
    'packages/z-no-scripts': { build: 'x' },
    site: { check: 'x' },
    'apps/status': { test: 'x' },
    'apps/web': { check: 'x' },
    'storefronts/_t': { check: 'x' },
    'storefronts/shop': { check: 'x' },
  });

  test('check: packages, site, apps, storefronts that have a check script, in that order', () => {
    expect(select('check', { root })).toEqual([
      'packages/a',
      'packages/core',
      'site',
      'apps/web',
      'storefronts/_t',
      'storefronts/shop',
    ]);
  });

  test('--skip leaves a workspace out', () => {
    expect(select('check', { root, skip: ['packages/core', 'site'] })).toEqual([
      'packages/a',
      'apps/web',
      'storefronts/_t',
      'storefronts/shop',
    ]);
  });

  test('test: packages and apps/status with a test script, core only when asked', () => {
    expect(select('test', { root })).toEqual(['packages/a', 'apps/status']);
    expect(select('test', { root, core: true })).toEqual([
      'packages/a',
      'packages/core',
      'apps/status',
    ]);
  });

  test('the real repo: what CI used to loop over', () => {
    const check = select('check');
    expect(check).toContain('packages/core');
    expect(check).toContain('site');
    expect(check).toContain('apps/admin');
    expect(check).toContain('storefronts/_template');
    const test = select('test');
    expect(test).not.toContain('packages/core');
    expect(test).toContain('packages/kernel');
    expect(test).toContain('packages/cli');
    expect(test).toContain('apps/status');
    // tools/ has no package.json: its tests are CI's own `bun test tools/` step
    expect(test).not.toContain('tools');
  });
});

describe('runAll', () => {
  const run = async (kind: 'check' | 'test', opts = {}) => {
    const root = tree({
      'packages/a': { check: 'touch ran-a' },
      'packages/c': { check: 'exit 3' },
      'packages/d': { check: 'touch ran-d' },
    });
    const code = await runAll(kind, { root, ...opts });
    return { code, ran: (n: string) => existsSync(join(root, 'packages', n.slice(4), n)) };
  };

  test('runs the script in each workspace', async () => {
    const root = tree({
      'packages/a': { check: 'touch ran-a' },
      'packages/d': { check: 'touch ran-d' },
    });
    expect(await runAll('check', { root })).toBe(0);
    expect(existsSync(join(root, 'packages/a/ran-a'))).toBe(true);
    expect(existsSync(join(root, 'packages/d/ran-d'))).toBe(true);
  });

  test('the first failure stops the run with that exit code, like CI', async () => {
    const r = await run('check');
    expect(r.code).toBe(3);
    expect(r.ran('ran-a')).toBe(true);
    expect(r.ran('ran-d')).toBe(false);
  });

  test('--keep-going finishes the rest and still fails', async () => {
    const r = await run('check', { keepGoing: true });
    expect(r.code).toBe(1);
    expect(r.ran('ran-d')).toBe(true);
  });

  test('jobs > 1 runs workspaces at once', async () => {
    // each waits for the other's marker: only a concurrent run finishes both
    const wait = (other: string) =>
      `touch started; for i in $(seq 1 100); do [ -f ../${other}/started ] && exit 0; sleep 0.05; done; exit 4`;
    const root = tree({
      'packages/a': { check: wait('b') },
      'packages/b': { check: wait('a') },
    });
    expect(await runAll('check', { root, jobs: 2 })).toBe(0);
  });

  test('jobs > 1: a failure stops the others with its exit code; --keep-going does not', async () => {
    const root = tree({
      'packages/a': { check: 'exit 3' },
      'packages/b': { check: 'sleep 5; touch ran-b' },
      'packages/c': { check: 'touch ran-c' },
    });
    expect(await runAll('check', { root, jobs: 2 })).toBe(3);
    expect(existsSync(join(root, 'packages/b/ran-b'))).toBe(false);
    expect(existsSync(join(root, 'packages/c/ran-c'))).toBe(false);
    const all = tree({
      'packages/a': { check: 'exit 3' },
      'packages/b': { check: 'touch ran-b' },
      'packages/c': { check: 'touch ran-c' },
    });
    expect(await runAll('check', { root: all, jobs: 2, keepGoing: true })).toBe(1);
    expect(existsSync(join(all, 'packages/b/ran-b'))).toBe(true);
    expect(existsSync(join(all, 'packages/c/ran-c'))).toBe(true);
  });

  test('--jobs takes a positive integer', async () => {
    expect(await main(['check', '--jobs', '0'])).toBe(2);
    expect(await main(['check', '--jobs=x'])).toBe(2);
    expect(await main(['check', '--list', '--jobs', '3'])).toBe(0);
  });

  test('--skip takes a directory', async () => {
    expect(await main(['check', '--skip'])).toBe(2);
    expect(await main(['check', '--skip='])).toBe(2);
    expect(await main(['check', '--list', '--skip', 'packages/core/', '--skip=site'])).toBe(0);
  });

  test('test runs `bun test`, not the package’s test script', async () => {
    const root = tree({
      'packages/a': { test: 'touch script-ran' },
    });
    writeFileSync(
      join(root, 'packages/a/a.test.ts'),
      `import {test} from 'bun:test'; import {writeFileSync} from 'node:fs'; test('x', () => writeFileSync('bun-test-ran', ''));`,
    );
    expect(await runAll('test', { root })).toBe(0);
    expect(existsSync(join(root, 'packages/a/bun-test-ran'))).toBe(true);
    expect(existsSync(join(root, 'packages/a/script-ran'))).toBe(false);
  });
});

describe('the CI job and the root package.json use it', () => {
  const ci = readFileSync(join(REPO, '.github/workflows/ci.yml'), 'utf8');
  const root = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts;

  test('root scripts', () => {
    expect(root.check).toBe('bun tools/workspaces.mjs check');
    expect(root.test).toBe('bun tools/workspaces.mjs test');
  });

  test('ci.yml calls the same script instead of its own loops', () => {
    expect(ci).toContain('run: bun tools/workspaces.mjs check');
    // the one it skips is typechecked in the builds part
    expect(ci).toContain('bun tools/workspaces.mjs check --skip packages/core');
    expect(ci).toContain('cd packages/core && bun run check');
    expect(ci).toContain('run: bun tools/workspaces.mjs test');
    expect(ci).not.toContain('for dir in packages/*');
  });
});
