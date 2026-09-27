import { describe, expect, test } from 'bun:test';
import { LOADER_JS, LOADER_VERSION } from '../src/index.ts';

describe('v.js', () => {
  test('is a self-contained script stamped with its own version', () => {
    expect(LOADER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(LOADER_JS).toContain(`version: '${LOADER_VERSION}'`);
    expect(LOADER_JS).not.toContain('__LOADER_VERSION__');
    expect(() => new Function(LOADER_JS)).not.toThrow();
  });

  test('stays small and dependency-free', () => {
    expect(new TextEncoder().encode(LOADER_JS).length).toBeLessThan(6 * 1024);
    expect(LOADER_JS).not.toMatch(/\bimport\b|\brequire\(/);
  });

  test('checks maintenance before yielding to a mounted Kernel', () => {
    expect(LOADER_JS.indexOf("'maintenance'")).toBeLessThan(
      LOADER_JS.indexOf('__VENDUA_KERNEL_MOUNTED__'),
    );
  });
});
