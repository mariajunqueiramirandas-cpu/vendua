import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runStatic } from '../src/static.ts';

const REPO = join(import.meta.dir, '../../..');
const TMP_ROOT = join(import.meta.dir, '.tmp');

/** A minimal fixture storefront inside the repo tree so node_modules
 *  resolution (@vendua/kernel, bunx tsc) works offline. */
const made: string[] = [];
function fixture(files: Record<string, string>): string {
  mkdirSync(TMP_ROOT, { recursive: true });
  const dir = mkdtempSync(join(TMP_ROOT, 'kcheck-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, content);
  }
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GOOD_BASE = {
  'vendua.config.ts': 'export default { contract: 1, overrides: {} };\n',
  'index.html':
    '<html><body><script type="module" src="main.tsx"></script><script src="/v1/v.js"></script></body></html>',
  'main.tsx':
    'import { VenduaProvider, SystemSurfaces } from "@vendua/kernel";\n' +
    'import { BrowserRouter } from "react-router-dom";\n' +
    'export const App = () =>\n' +
    '  <VenduaProvider api=""><SystemSurfaces /><BrowserRouter /></VenduaProvider>;\n',
  'package.json': JSON.stringify({
    name: '@vendua/storefront-fixture',
    dependencies: { react: '18.3.1', '@vendua/kernel': 'workspace:*' },
    devDependencies: { vite: '5.4.19' },
  }),
  'vite.config.ts':
    'export default { server: { proxy: { "/checkout/v1": { target: "http://localhost:8787" } } } };\n',
};

describe('runStatic', () => {
  test('storefronts/_template passes all K-checks', async () => {
    const results = await runStatic(join(REPO, 'storefronts/_template'));
    const failed = results.filter((r) => r.status !== 'pass');
    expect(failed.map((r) => `${r.id} ${r.detail ?? ''}`)).toEqual([]);
  }, 120_000);

  test('a route under /control fails K04', async () => {
    const dir = fixture({
      ...GOOD_BASE,
      'routes/control.tsx':
        'export const route = { path: "/control/panel" };\n' +
        'export default function P() { return null; }\n',
    });
    const results = await runStatic(dir);
    const k04 = results.find((r) => r.id === 'K04');
    expect(k04?.status).toBe('fail');
    expect(k04?.detail).toContain('control');
  }, 120_000);

  test('an entry with no router mount fails K02', async () => {
    const dir = fixture({
      ...GOOD_BASE,
      'main.tsx':
        'import { VenduaProvider, SystemSurfaces } from "@vendua/kernel";\n' +
        'export const App = () => <VenduaProvider api=""><SystemSurfaces /></VenduaProvider>;\n',
    });
    const k02 = (await runStatic(dir)).find((r) => r.id === 'K02');
    expect(k02?.status).toBe('fail');
    expect(k02?.detail).toContain('router');
  }, 120_000);

  test('an aliased router import passes K02', async () => {
    const dir = fixture({
      ...GOOD_BASE,
      'main.tsx':
        'import { VenduaProvider, SystemSurfaces } from "@vendua/kernel";\n' +
        'import { BrowserRouter as $Router } from "react-router-dom";\n' +
        'export const App = () =>\n' +
        '  <VenduaProvider api=""><SystemSurfaces /><$Router /></VenduaProvider>;\n',
    });
    const k02 = (await runStatic(dir)).find((r) => r.id === 'K02');
    expect(k02?.status, k02?.detail).toBe('pass');
  }, 120_000);

  test('string-shorthand and bare-prefix proxies fail K06', async () => {
    for (const key of ['/checkout', '/storefront']) {
      const dir = fixture({
        ...GOOD_BASE,
        'vite.config.ts': `export default { server: { proxy: { "${key}": "http://localhost:8787" } } };\n`,
      });
      const k06 = (await runStatic(dir)).find((r) => r.id === 'K06');
      expect(k06?.status).toBe('fail');
      expect(k06?.detail).toContain(key);
    }
  }, 120_000);
});
