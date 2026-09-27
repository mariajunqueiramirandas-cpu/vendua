import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply, diff, findCodemod, plan } from '../src/index.ts';

const made: string[] = [];
function store(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'codemod-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const CFG = `import { defineStorefront } from '@vendua/kernel/config';

export default defineStorefront({
  contract: 2,
  // set by the Control Plane
  ring: 'stable',
  tokens: TOKENS,
  overrides: {
    'system.StorePausedNotice': () => import('./overrides/Paused.tsx'),
    'system.Notice': () => import('./overrides/Notice.tsx'),
  },
});
`;
const OVERRIDE = `import type { SlotProps } from '@vendua/kernel';
export default function Paused(p: SlotProps['system.StorePausedNotice']) { return null; }
`;

const c3 = findCodemod('c3-rehearsal')!;

describe('c3-rehearsal', () => {
  test('renames the slot everywhere and drops ring, with a readable dry-run diff', () => {
    const dir = store({ 'vendua.config.ts': CFG, 'overrides/Paused.tsx': OVERRIDE });
    const r = plan(c3, dir);
    expect(r.status).toBe('changed');
    expect(r.edits.map((e) => e.file).sort()).toEqual(['overrides/Paused.tsx', 'vendua.config.ts']);
    const cfg = r.edits.find((e) => e.file === 'vendua.config.ts')!;
    expect(cfg.after).toContain("'system.PauseNotice': () => import('./overrides/Paused.tsx')");
    expect(cfg.after).not.toContain('ring');
    expect(cfg.after).not.toContain('set by the Control Plane');
    expect(diff(cfg)).toContain("-  ring: 'stable',");
    // dry run wrote nothing
    expect(readFileSync(join(dir, 'vendua.config.ts'), 'utf8')).toBe(CFG);
  });

  test('is idempotent once applied', () => {
    const dir = store({ 'vendua.config.ts': CFG, 'overrides/Paused.tsx': OVERRIDE });
    apply(plan(c3, dir));
    expect(readFileSync(join(dir, 'overrides/Paused.tsx'), 'utf8')).toContain(
      "SlotProps['system.PauseNotice']",
    );
    expect(plan(c3, dir).status).toBe('unchanged');
  });

  test('refuses what it cannot prove (failure tail, not a partial edit)', () => {
    const dynamic = store({
      'vendua.config.ts': CFG.replace(/overrides: \{[\s\S]*?\n  \},/, 'overrides: brandOverrides,'),
      'overrides/map.ts': `export const brandOverrides = { 'system.StorePausedNotice': () => import('./P.tsx') };`,
    });
    const r1 = plan(c3, dynamic);
    expect(r1.status).toBe('failed');
    expect(r1.reason).toContain('not an object literal');

    const both = store({
      'vendua.config.ts': CFG.replace("'system.Notice'", "'system.PauseNotice'"),
    });
    expect(plan(c3, both)).toMatchObject({ status: 'failed' });

    const spread = store({
      'vendua.config.ts': CFG.replace('overrides: {', 'overrides: {\n    ...base,'),
    });
    expect(plan(c3, spread).reason).toContain('spreads');
  });

  test('a store with nothing to migrate is unchanged', () => {
    const dir = store({ 'vendua.config.ts': 'export default { contract: 2, tokens: T };\n' });
    expect(plan(c3, dir).status).toBe('unchanged');
  });
});
