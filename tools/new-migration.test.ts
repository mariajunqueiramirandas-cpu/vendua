import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create, lastNumber, skeleton } from './new-migration.mjs';

const made: string[] = [];
const dir = (files: string[]) => {
  const d = mkdtempSync(join(tmpdir(), 'migration-new-'));
  made.push(d);
  for (const f of files) writeFileSync(join(d, f), '-- x\n');
  return d;
};
afterAll(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

describe('migration:new', () => {
  test('takes the number after the highest one, gaps included', () => {
    const d = dir([
      '0000_baseline_thru_0017.sql',
      '0001_init.sql',
      '0092_vendedor_qol.sql',
      '0094_crm_saved_views.sql',
      'README.md',
      '0099.sql',
    ]);
    const path = create('add_coupon_limits', d);
    expect(path).toBe(join(d, '0095_add_coupon_limits.sql'));
    expect(create('second_one', d)).toBe(join(d, '0096_second_one.sql'));
  });

  test('an empty directory starts at 0000', () => {
    expect(lastNumber([])).toBe(-1);
    expect(create('first', dir([]))).toMatch(/0000_first\.sql$/);
  });

  test('refuses names the ledger or a shell would trip on, and writes nothing', () => {
    const d = dir(['0001_init.sql']);
    for (const bad of ['', 'Bad-Name', '../x', 'a b', '1abc', 'x', 'a'.repeat(61), undefined])
      expect(() => create(bad as string, d)).toThrow('not a migration name');
    expect(readdirSync(d)).toEqual(['0001_init.sql']);
  });

  test('the skeleton names its file, carries the tenant RLS pattern, and runs as a no-op', () => {
    const d = dir(['0001_init.sql']);
    const body = readFileSync(create('thing', d), 'utf8');
    expect(body.startsWith('-- 0002_thing.sql — ')).toBe(true);
    expect(body).toContain("current_setting('vendua.tenant_id', true)");
    expect(body).toContain('enable row level security');
    expect(body).toContain('grant select, insert, update, delete on example to vendua_app');
    // everything is commented out, so forgetting to fill it in cannot create a table named `example`
    for (const line of skeleton('0002_thing.sql').split('\n'))
      expect(line === '' || line.startsWith('--')).toBe(true);
  });
});
