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
      'packages/templates/src/model.ts',
      'packages/ui-defaults/src/styles.css',
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
    const r = mapFiles(['storefronts/acme/routes/index.tsx']);
    expect(r.packages).toEqual(['storefronts/acme']);
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

  test('apps map to their own dir', () => {
    expect(mapFiles(['apps/control/src/App.tsx']).packages).toEqual(['apps/control']);
    expect(mapFiles(['apps/control/src/App.tsx']).allStorefronts).toBe(false);
    // a file directly under apps/ is not a workspace
    expect(mapFiles(['apps/README.md']).packages).toEqual([]);
  });

  test('the admin gate runs for the admin, Core, the Kernel and CI changes only', () => {
    expect(mapFiles(['apps/admin/src/main.tsx']).adminGate).toBe(true);
    expect(mapFiles(['packages/core/src/app.ts']).adminGate).toBe(true);
    expect(mapFiles(['packages/kernel/src/api.ts']).adminGate).toBe(true);
    expect(mapFiles(['.github/workflows/ci.yml']).adminGate).toBe(true);
    expect(mapFiles(['apps/control/src/App.tsx', 'docs/roadmap.md']).adminGate).toBe(false);
    expect(mapFiles(['storefronts/acme/routes/index.tsx']).adminGate).toBe(false);
  });

  test('the edge smoke runs for Core, the edge, the CLI, the template and CI changes', () => {
    for (const f of [
      'packages/edge/src/server.ts',
      'packages/core/src/modules/fleet/deploy.ts',
      'packages/cli/src/release.ts',
      'storefronts/_template/sections/Hero.tsx',
      '.github/workflows/ci.yml',
    ])
      expect(mapFiles([f]).edgeSmoke).toBe(true);
    expect(mapFiles(['apps/control/src/App.tsx', 'docs/roadmap.md']).edgeSmoke).toBe(false);
    expect(mapFiles(['storefronts/acme/routes/index.tsx']).edgeSmoke).toBe(false);
  });

  test('CRM/site/docs-only diffs skip core tests and conformance', () => {
    const r = mapFiles(['apps/control/src/App.tsx', 'site/src/app.css', 'docs/roadmap.md']);
    expect(r.coreTests).toBe(false);
    expect(r.conformance).toBe(false);
  });

  test('core change runs both; kernel/template change runs conformance only', () => {
    const core = mapFiles(['packages/core/src/index.ts']);
    expect([core.coreTests, core.conformance]).toEqual([true, true]);
    for (const f of ['packages/kernel/src/a.ts', 'storefronts/_template/routes/index.tsx']) {
      const r = mapFiles([f]);
      expect([r.coreTests, r.conformance]).toEqual([false, true]);
    }
  });

  test('a single storefront change skips conformance', () => {
    expect(mapFiles(['storefronts/acme/routes/index.tsx']).conformance).toBe(false);
  });

  test('workflow, CI action or root dependency changes run everything', () => {
    for (const f of [
      '.github/workflows/ci.yml',
      '.github/actions/playwright-chromium/action.yml',
      'bun.lock',
    ]) {
      const r = mapFiles([f]);
      expect([r.coreTests, r.conformance]).toEqual([true, true]);
    }
  });
});

describe('check-storefront-paths', () => {
  const checker = join(import.meta.dir, 'check-storefront-paths.mjs');
  const run = (args: string[]) => spawnSync('bun', [checker, ...args], { encoding: 'utf8' });

  test('in-scope files pass', () => {
    const r = run([
      '--slug',
      'acme',
      '--files',
      'storefronts/acme/a.ts',
      'storefronts/acme/sub/b.ts',
    ]);
    expect(r.status).toBe(0);
  });

  test('out-of-scope file fails and names it', () => {
    const r = run([
      '--slug',
      'acme',
      '--files',
      'storefronts/acme/a.ts',
      'packages/core/src/app.ts',
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('packages/core/src/app.ts');
  });

  test('prefix confusion fails: storefronts/acme-x is not storefronts/acme/', () => {
    const r = run(['--slug', 'acme', '--files', 'storefronts/acme-x/a.ts']);
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

  test('unlabelled diffs that touch NO storefront pass', () => {
    expect(run(['--files', 'docs/x.md', 'packages/core/app.ts']).status).toBe(0);
    expect(run(['--files', 'storefronts/_template/a.ts']).status).toBe(0); // platform-owned dir
  });

  test('unlabelled mixed diff (storefront + platform) fails — the label hole', () => {
    const r = run(['--files', 'storefronts/acme/routes/i.tsx', 'packages/core/src/app.ts']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('platform');
  });

  test('unlabelled multi-storefront diff fails', () => {
    const r = run(['--files', 'storefronts/a/x.ts', 'storefronts/b/y.ts']);
    expect(r.status).toBe(1);
  });

  test("'platform' label is the deliberate bypass for fleet-wide changes", () => {
    const r = run([
      '--slug',
      'platform',
      '--files',
      'storefronts/acme/routes/i.tsx',
      'packages/kernel/src/api.ts',
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('platform');
  });
});
