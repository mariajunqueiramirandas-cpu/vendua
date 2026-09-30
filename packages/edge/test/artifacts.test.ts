import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Server } from 'bun';
import { isSafeKey, openArtifactStore, releaseKey, type ArtifactStore } from '../src/artifacts.ts';
import { tempDir } from './helpers.ts';

const ID = '0123456789abcdef0123';

describe('keys', () => {
  test('releaseKey builds the layout and validates its parts', () => {
    expect(releaseKey('_template', ID)).toBe(`storefronts/_template/${ID}`);
    expect(releaseKey('_examples/quero-pudim', ID, 'assets/a.js')).toBe(
      `storefronts/_examples/quero-pudim/${ID}/assets/a.js`,
    );
    expect(() => releaseKey('../x', ID)).toThrow(/bundle/);
    expect(() => releaseKey('_template', 'ABC')).toThrow(/release/);
    expect(() => releaseKey('_template', ID, '../../x')).toThrow(/invalid artifact key/);
  });

  test('isSafeKey', () => {
    for (const k of ['a', 'a/b.js', 'assets/x y.png']) expect(isSafeKey(k)).toBe(true);
    for (const k of ['', '/a', 'a/../b', '..', 'a//b', 'a\\b', 'a\0b', './a'])
      expect(isSafeKey(k)).toBe(false);
  });
});

async function roundTrip(store: ArtifactStore) {
  const key = releaseKey('_template', ID, 'assets/a.js');
  expect(await store.get(key)).toBeNull();
  expect(await store.exists(key)).toBe(false);
  const body = new TextEncoder().encode('console.log(1)');
  await store.put(key, body, 'text/javascript');
  expect(await store.exists(key)).toBe(true);
  expect(await store.get(key)).toEqual(body);
  await expect(store.get('../escape')).rejects.toThrow(/invalid artifact key/);
}

describe('fs store', () => {
  test('file:// and plain absolute paths', async () => {
    const dir = tempDir('edge-fs-');
    const a = openArtifactStore(`file://${dir}`);
    expect(a.uri).toBe(`file://${dir}`);
    await roundTrip(a);
    const b = openArtifactStore(dir);
    expect(await b.exists(releaseKey('_template', ID, 'assets/a.js'))).toBe(true);
  });

  test('rejects relative and unknown uris', () => {
    expect(() => openArtifactStore('relative/dir')).toThrow(/unsupported/);
    expect(() => openArtifactStore('gs://bucket')).toThrow(/unsupported/);
  });
});

describe('s3 store (path-style, against an in-process mock)', () => {
  const objects = new Map<string, { body: Uint8Array; type: string }>();
  let s3: Server<unknown>;
  const saved = { ...process.env };

  beforeAll(() => {
    s3 = Bun.serve({
      port: 0,
      async fetch(req) {
        const path = decodeURIComponent(new URL(req.url).pathname);
        if (req.method === 'PUT') {
          objects.set(path, {
            body: new Uint8Array(await req.arrayBuffer()),
            type: req.headers.get('content-type') ?? '',
          });
          return new Response(null, { headers: { etag: '"1"' } });
        }
        const o = objects.get(path);
        if (!o)
          return new Response('<Error><Code>NoSuchKey</Code></Error>', {
            status: 404,
            headers: { 'content-type': 'application/xml' },
          });
        const headers = { 'content-length': String(o.body.length), etag: '"1"' };
        return new Response(req.method === 'HEAD' ? null : o.body, { headers });
      },
    });
    Object.assign(process.env, {
      S3_ENDPOINT: `http://127.0.0.1:${s3.port}`,
      S3_REGION: 'auto',
      S3_ACCESS_KEY_ID: 'test',
      S3_SECRET_ACCESS_KEY: 'test',
    });
  });

  afterAll(() => {
    s3.stop(true);
    for (const k of ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'])
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  });

  test('round-trips under bucket/prefix', async () => {
    const store = openArtifactStore('s3://vendua-artifacts/prod/');
    expect(store.uri).toBe('s3://vendua-artifacts/prod');
    await roundTrip(store);
    const stored = objects.get(`/vendua-artifacts/prod/storefronts/_template/${ID}/assets/a.js`);
    expect(stored?.type).toStartWith('text/javascript');
  });

  test('a bucket without a prefix', async () => {
    const store = openArtifactStore('s3://bare');
    expect(store.uri).toBe('s3://bare');
    await store.put('x/y.txt', new Uint8Array([1]), 'text/plain');
    expect(objects.has('/bare/x/y.txt')).toBe(true);
  });
});
