import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

  test('a single storefront change runs conformance for that slug, not the ci-smoke scaffold', () => {
    const r = mapFiles(['storefronts/acme/routes/index.tsx'], undefined, () => true);
    expect(r.conformance).toBe(true);
    expect(r.smoke).toBe(false);
    expect(r.storefronts).toEqual(['acme']);
  });

  test('storefronts lists touched slugs, sorted and deduplicated, never _-prefixed dirs', () => {
    const r = mapFiles(
      [
        'storefronts/zeta/a.ts',
        'storefronts/acme/b.ts',
        'storefronts/acme/c/d.ts',
        'storefronts/_template/routes/index.tsx',
      ],
      undefined,
      () => true,
    );
    expect(r.storefronts).toEqual(['acme', 'zeta']);
    expect(mapFiles(['storefronts/_template/routes/index.tsx']).storefronts).toEqual([]);
    expect(mapFiles(['docs/roadmap.md']).storefronts).toEqual([]);
  });

  test('a deleted storefront is not checked', () => {
    expect(mapFiles(['storefronts/gone/a.ts'], undefined, () => false).storefronts).toEqual([]);
  });

  test('allStorefronts expands to every non-underscore storefront with a package.json', () => {
    const r = mapFiles(['packages/kernel/src/api.ts'], () => ['a', 'b']);
    expect(r.storefronts).toEqual(['a', 'b']);
    const real = mapFiles(['bun.lock']).storefronts;
    expect(real).toContain('quero-pudim');
    expect(real.some((s) => s.startsWith('_'))).toBe(false);
  });

  test('smoke keeps the old conformance rule: template, shared packages and CI only', () => {
    for (const f of [
      'storefronts/_template/routes/index.tsx',
      'packages/kernel/src/a.ts',
      '.github/workflows/ci.yml',
    ])
      expect(mapFiles([f]).smoke).toBe(true);
    expect(mapFiles(['apps/control/src/App.tsx']).smoke).toBe(false);
    expect(mapFiles(['apps/control/src/App.tsx']).conformance).toBe(false);
  });

  test('workflow, CI action or root dependency changes run everything', () => {
    for (const f of [
      '.github/workflows/ci.yml',
      '.github/actions/playwright-chromium/action.yml',
      'bun.lock',
    ]) {
      const r = mapFiles([f]);
      expect([r.coreTests, r.conformance, r.smoke]).toEqual([true, true, true]);
    }
  });
});

describe('agent-runtime mapping', () => {
  test('agent-runtime flips Core-dependent gates but not allStorefronts', () => {
    const r = mapFiles(['packages/agent-runtime/src/index.ts']);
    expect(r.packages).toEqual(['packages/agent-runtime']);
    expect(r.allStorefronts).toBe(false);
    expect([r.coreTests, r.conformance, r.adminGate, r.edgeSmoke]).toEqual([
      true,
      true,
      true,
      true,
    ]);
  });

  test('a docs-only diff next to agent-runtime churn elsewhere stays quiet', () => {
    const r = mapFiles(['packages/agent-runtime/README.md', 'docs/roadmap.md']);
    expect(r.coreTests).toBe(true);
    expect(mapFiles(['docs/roadmap.md']).coreTests).toBe(false);
  });
});

describe('check-agent-runtime-boundary', () => {
  const checker = join(import.meta.dir, 'check-agent-runtime-boundary.mjs');
  const run = (args: string[] = []) => spawnSync('bun', [checker, ...args], { encoding: 'utf8' });
  const dirs: string[] = [];

  // `pkg` is the fixture root; a sibling `core/` lets '../../core/…' escape it
  function fixture(files: Record<string, string>) {
    const base = mkdtempSync(join(tmpdir(), 'ar-boundary-'));
    dirs.push(base);
    const root = join(base, 'pkg');
    mkdirSync(root);
    for (const [name, body] of Object.entries(files)) {
      const full = join(root, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    return root;
  }
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('allowed imports pass', () => {
    const root = fixture({
      'src/x.ts': `import { x } from './y.ts';\nimport { createHash } from 'node:crypto';\nimport { test } from 'bun:test';\nexport * from '../src/y.ts';\n`,
      'src/y.ts': `import { z } from '@vendua/agent-runtime/testing';\n// import 'postgres'\nexport const x = 1;\n`,
      'node_modules/dep/index.js': `import 'left-pad';\n`,
    });
    const r = run(['--root', root]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  test('@vendua/* other than agent-runtime fails with file:line', () => {
    const root = fixture({
      'src/a.ts': `export const a = 1;\nimport { db } from '@vendua/core';\n`,
    });
    const r = run(['--root', root]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('src/a.ts:2 @vendua/core');
  });

  test('a relative path escaping the package root fails', () => {
    const root = fixture({
      'src/deep/b.ts': `import { sql } from '../../../core/src/platform/db.ts';\n`,
      'src/ok.ts': `import { y } from './deep/b.ts';\n`,
    });
    const r = run(['--root', root]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('src/deep/b.ts:1 ../../../core/src/platform/db.ts');
    expect(r.stderr).not.toContain('src/ok.ts');
    const shallow = fixture({ 'c.ts': `import { sql } from '../../core/src/platform/db.ts';\n` });
    expect(run(['--root', shallow]).status).toBe(1);
  });

  test('npm packages fail', () => {
    const root = fixture({
      'src/c.ts': `import postgres from 'postgres';\nexport { z } from 'zod';\n`,
    });
    const r = run(['--root', root]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('src/c.ts:1 postgres');
    expect(r.stderr).toContain('src/c.ts:2 zod');
  });

  test('dynamic import() and require() are caught', () => {
    const root = fixture({
      'd.ts': `export async function f() {\n  return await import('@vendua/kernel');\n}\n`,
      'e.mjs': `const x = require('@vendua/core/src/app.ts');\n`,
    });
    const r = run(['--root', root]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('d.ts:2 @vendua/kernel');
    expect(r.stderr).toContain('e.mjs:1 @vendua/core/src/app.ts');
  });

  test('multi-line import clauses and side-effect imports are caught', () => {
    const root = fixture({
      'f.ts': `import {\n  a,\n  b,\n} from '@vendua/templates';\nimport 'dotenv/config';\n`,
    });
    const r = run(['--root', root]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('f.ts:4 @vendua/templates');
    expect(r.stderr).toContain('f.ts:5 dotenv/config');
  });

  test('the real package passes', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
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
