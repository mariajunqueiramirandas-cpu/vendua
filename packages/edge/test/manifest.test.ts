import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openArtifactStore, releaseKey } from '../src/artifacts.ts';
import { injectState, scriptJson } from '../src/inject.ts';
import {
  computeRelease,
  createManifest,
  entryAssets,
  parseManifest,
  sha256Hex,
  typeFor,
  uploadRelease,
} from '../src/manifest.ts';
import { BUILD_MANIFEST, makeDist, tempDir } from './helpers.ts';

describe('release id', () => {
  test('is deterministic: a rebuild that only changes builtAt keeps the id', () => {
    const a = makeDist();
    const b = makeDist({
      'vendua-manifest.json': JSON.stringify({
        ...BUILD_MANIFEST,
        builtAt: '2027-01-01T00:00:00Z',
      }),
    });
    const ra = computeRelease(a, '_template');
    expect(ra.release).toMatch(/^[0-9a-f]{20}$/);
    expect(computeRelease(a, '_template').release).toBe(ra.release);
    expect(computeRelease(b, '_template').release).toBe(ra.release);
    // a stale storefront.manifest.json in dist never feeds the hash
    writeFileSync(join(a, 'storefront.manifest.json'), '{"old":true}');
    expect(computeRelease(a, '_template').release).toBe(ra.release);
  });

  test('changes with any file, the bundle or the rest of vendua-manifest.json', () => {
    const base = computeRelease(makeDist(), '_template').release;
    expect(computeRelease(makeDist({ 'robots.txt': 'x' }), '_template').release).not.toBe(base);
    expect(computeRelease(makeDist({ 'extra.txt': 'x' }), '_template').release).not.toBe(base);
    expect(computeRelease(makeDist(), '_examples/quero-pudim').release).not.toBe(base);
    const kernel = makeDist({
      'vendua-manifest.json': JSON.stringify({ ...BUILD_MANIFEST, kernel: '1.9.1' }),
    });
    expect(computeRelease(kernel, '_template').release).not.toBe(base);
  });

  test('matches the spec formula', () => {
    const dir = makeDist();
    const { release, files } = computeRelease(dir, '_template');
    const lines = Object.entries(files)
      .filter(([p]) => p !== 'vendua-manifest.json')
      .map(([p, f]) => `${p} ${f.sha256}\n`)
      .sort()
      .join('');
    const { builtAt: _b, ...rest } = BUILD_MANIFEST;
    const text = `_template\n${lines}vendua-manifest ${sha256Hex(JSON.stringify(rest))}\n`;
    expect(release).toBe(sha256Hex(text).slice(0, 20));
  });
});

describe('createManifest', () => {
  test('records files, budgets, build and passing QA', () => {
    const dir = makeDist();
    const m = createManifest({ dir, bundle: '_template', tenant: 'loja-modelo', commit: 'abc' });
    expect(parseManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(m.kernelVersion).toBe('1.9.0');
    expect(m.contract).toBe(1);
    expect(m.files['index.html']!.type).toBe('text/html; charset=utf-8');
    expect(m.files['vendua-manifest.json']).toBeDefined();
    expect(m.budgets.files).toBe(Object.keys(m.files).length);
    expect(m.budgets.jsBytes).toBe(m.files['assets/index-abc123.js']!.size);
    expect(m.budgets.entryGzipBytes).toBeGreaterThan(0);
    expect(m.qa.checks.map((c) => c.id)).toEqual(['manifest', 'entry', 'budget']);
    expect(m.qa.status).toBe('passed');
    expect(m.build).toEqual(BUILD_MANIFEST);
  });

  test('extra checks come first and any failure fails QA', () => {
    const dir = makeDist({ 'index.html': '<html><head></head><body></body></html>' });
    const m = createManifest({
      dir,
      bundle: '_template',
      tenant: 't',
      commit: 'c',
      checks: () => [{ id: 'compat', ok: true }],
    });
    expect(m.qa.checks[0]!.id).toBe('compat');
    expect(m.qa.checks.find((c) => c.id === 'entry')!.ok).toBe(false);
    expect(m.qa.status).toBe('failed');
  });

  test('no vendua-manifest.json fails the manifest check', () => {
    const dir = makeDist({ 'vendua-manifest.json': 'not json' });
    const m = createManifest({ dir, bundle: '_template', tenant: 't', commit: 'c' });
    expect(m.qa.checks.find((c) => c.id === 'manifest')!.ok).toBe(false);
  });

  test('entryAssets follows scripts, stylesheets and modulepreloads only', () => {
    const files = { 'assets/a.js': 1, 'assets/b.css': 1, 'assets/c.js': 1, 'assets/d.png': 1 };
    const html = `<script type="module" src="/assets/a.js"></script>
      <link rel="stylesheet" href="./assets/b.css?v=1"><link rel="modulepreload" href="/assets/c.js">
      <link rel="icon" href="/assets/d.png"><script src="https://cdn.x/y.js"></script>
      <script src="/v1/v.js"></script>`;
    expect(entryAssets(html, files)).toEqual(['assets/a.js', 'assets/b.css', 'assets/c.js']);
  });
});

describe('parseManifest', () => {
  const good = () =>
    JSON.parse(
      JSON.stringify(
        createManifest({ dir: makeDist(), bundle: '_template', tenant: 't', commit: 'c' }),
      ),
    );

  test.each([
    ['release', (m: any) => (m.release = 'XYZ')],
    ['bundle', (m: any) => (m.bundle = '../etc')],
    ['manifestVersion', (m: any) => (m.manifestVersion = 2)],
    ['entry', (m: any) => (m.entry = 'main.html')],
    ['file path', (m: any) => (m.files['../x'] = m.files['index.html'])],
    ['sha256', (m: any) => (m.files['index.html'].sha256 = 'nope')],
    ['files without entry', (m: any) => delete m.files['index.html']],
    ['budgets', (m: any) => (m.budgets.totalBytes = -1)],
    ['qa', (m: any) => (m.qa.status = 'maybe')],
    ['builtAt', (m: any) => (m.builtAt = 'yesterday')],
  ])('rejects a bad %s', (_name, mutate) => {
    const m = good();
    mutate(m);
    expect(() => parseManifest(m)).toThrow(/invalid storefront manifest/);
  });

  test('rejects non-objects', () => {
    expect(() => parseManifest(null)).toThrow(/not an object/);
    expect(() => parseManifest([])).toThrow(/not an object/);
  });
});

test('typeFor', () => {
  expect(typeFor('index.html')).toBe('text/html; charset=utf-8');
  expect(typeFor('assets/x.JS')).toBe('text/javascript; charset=utf-8');
  expect(typeFor('a/b.woff2')).toBe('font/woff2');
  expect(typeFor('icon.svg')).toBe('image/svg+xml');
  expect(typeFor('LICENSE')).toBe('application/octet-stream');
  expect(typeFor('.env')).toBe('application/octet-stream');
});

describe('uploadRelease', () => {
  test('uploads every file then the manifest, and is idempotent', async () => {
    const dir = makeDist();
    const root = tempDir('edge-up-');
    const store = openArtifactStore(root);
    const m = createManifest({ dir, bundle: '_examples/quero-pudim', tenant: 't', commit: 'c' });
    expect(await uploadRelease(store, dir, m)).toBe('uploaded');
    const key = releaseKey(m.bundle, m.release, 'storefront.manifest.json');
    expect(parseManifest(JSON.parse(new TextDecoder().decode((await store.get(key))!)))).toEqual(m);
    for (const p of Object.keys(m.files))
      expect(await store.get(releaseKey(m.bundle, m.release, p))).toEqual(
        new Uint8Array(readFileSync(join(dir, p))),
      );
    expect(await uploadRelease(store, dir, m)).toBe('exists');
  });
});

describe('injectState', () => {
  test('escapes everything that could end the script', () => {
    const json = scriptJson({ s: '</script><!--<![CDATA[&\u2028\u2029' });
    expect(json).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(json)).toEqual({ s: '</script><!--<![CDATA[&\u2028\u2029' });
  });

  test('goes before the first </head>, case-insensitively; no head → unchanged', () => {
    expect(injectState('<html><HEAD></HEAD ><body></head></body>', 1)).toBe(
      '<html><HEAD><script id="vendua-state">window.__VENDUA_STATE__=1</script></HEAD ><body></head></body>',
    );
    expect(injectState('<p>no head</p>', { a: 1 })).toBe('<p>no head</p>');
  });
});
