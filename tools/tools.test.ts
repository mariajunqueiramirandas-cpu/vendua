import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { mapFiles } from './affected.mjs';

describe('mapFiles', () => {
  test('shared packages flip allStorefronts and keep their own dir', () => {
    for (const f of [
      'packages/kernel/src/api.ts',
      'packages/core/src/app.ts' /* core is NOT shared */,
      'packages/cli/src/bin.ts',
      'bun.lock',
    ]) {
      const r = mapFiles([f]);
      if (f.startsWith('packages/core')) {
        expect(r.allStorefronts).toBe(false); // core is server-side, storefronts don't depend
        expect(r.packages).toEqual(['packages/core']);
      } else if (f === 'bun.lock') {
        expect(r.allStorefronts).toBe(true);
        expect(r.packages).toEqual([]);
      } else {
        expect(r.allStorefronts).toBe(true);
        expect(r.packages).toHaveLength(1);
      }
    }
  });

  test('a storefront file only rebuilds its own slug', () => {
    const r = mapFiles(['storefronts/brasa/routes/index.tsx']);
    expect(r.packages).toEqual(['storefronts/brasa']);
    expect(r.allStorefronts).toBe(false);
  });

  test('shared storefront infra (depth ≤ 2) rebuilds all storefronts', () => {
    const r = mapFiles(['storefronts/Dockerfile']);
    expect(r.allStorefronts).toBe(true);
    expect(r.packages).toEqual([]);
  });

  test('_examples maps to its own dir', () => {
    expect(mapFiles(['storefronts/_examples/queryshop/Dockerfile']).packages).toEqual([
      'storefronts/_examples/queryshop',
    ]);
  });

  test('docs/ci churn rebuilds nothing', () => {
    const r = mapFiles(['docs/roadmap.md', '.github/workflows/ci.yml']);
    expect(r.allStorefronts).toBe(false);
    expect(r.packages).toEqual([]);
  });

  test('site teaser maps to site', () => {
    expect(mapFiles(['site/src/routes/+page.svelte']).packages).toEqual(['site']);
  });
});

describe('check-storefront-paths', () => {
  const checker = join(import.meta.dir, 'check-storefront-paths.mjs');
  const run = (args: string[]) => spawnSync('bun', [checker, ...args], { encoding: 'utf8' });

  test('in-scope files pass', () => {
    const r = run([
      '--slug',
      'brasa',
      '--files',
      'storefronts/brasa/a.ts',
      'storefronts/brasa/sub/b.ts',
    ]);
    expect(r.status).toBe(0);
  });

  test('out-of-scope file fails and names it', () => {
    const r = run([
      '--slug',
      'brasa',
      '--files',
      'storefronts/brasa/a.ts',
      'packages/core/src/app.ts',
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('packages/core/src/app.ts');
  });

  test('prefix confusion fails: storefronts/brasa-x is not storefronts/brasa/', () => {
    const r = run(['--slug', 'brasa', '--files', 'storefronts/brasa-x/a.ts']);
    expect(r.status).toBe(1);
  });

  test('two different slugs fail', () => {
    const r = run(['--slug', 'a', '--slug', 'b', '--files', 'x']);
    expect(r.status).toBe(1);
  });

  test('same slug labelled twice is fine; bad slug fails', () => {
    expect(
      run(['--slug', 'a', '--slug', 'storefront:a', '--files', 'storefronts/a/f']).status,
    ).toBe(0);
    expect(run(['--slug', 'evil slug', '--files', 'x']).status).toBe(1);
  });

  test('unlabelled diff confined to one storefront fails (label bypass hole)', () => {
    const r = run(['--files', 'storefronts/quero-pudim/a.ts', 'storefronts/quero-pudim/b/c.ts']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('storefront:quero-pudim');
  });

  test('unlabelled diffs that are NOT single-storefront pass', () => {
    expect(run(['--files', 'docs/x.md', 'packages/core/app.ts']).status).toBe(0);
    expect(run(['--files', 'storefronts/_template/a.ts']).status).toBe(0); // platform-owned dir
    expect(run(['--files', 'storefronts/a/x.ts', 'storefronts/b/y.ts']).status).toBe(0);
  });
});
