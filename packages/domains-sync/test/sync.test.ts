import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderConfig, routerName } from '../src/render.ts';
import { createSync, isSound, repair, type FetchImpl, type SyncOptions } from '../src/sync.ts';

process.env.DOMAINS_SYNC_QUIET = '1';

let dir: string;
let out: string;
let answer: () => Response | Promise<Response>;
const seen: { url: string; secret: string | null }[] = [];

const fetchImpl: FetchImpl = async (input, init) => {
  seen.push({
    url: String(input),
    secret: new Headers(init?.headers).get('x-vendua-sync'),
  });
  return answer();
};

const ok = (hosts: unknown[]) => Response.json({ hosts, generatedAt: '2026-10-08T00:00:00.000Z' });

function sync(o: Partial<SyncOptions> = {}) {
  return createSync({
    coreUrl: 'http://core.test/',
    secret: 'sync-secret',
    out,
    timeoutMs: 50,
    fetchImpl,
    storeDomain: 'vendua.com.br',
    deny: ['painel.example.com'],
    service: 'vendua-edge@docker',
    middleware: 'vendua-edge-https@docker',
    resolver: 'letsencrypt',
    ...o,
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'domains-sync-'));
  out = join(dir, 'dynamic', 'vendua-custom-domains.yml');
  seen.length = 0;
  answer = () => ok(['loja.com.br', 'www.loja.com.br']);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('tick', () => {
  test('asks Core with the secret and writes the rendered file', async () => {
    const tick = sync();
    expect(await tick()).toEqual({ status: 'written', hosts: 2 });
    expect(seen).toEqual([{ url: 'http://core.test/sync/v1/custom-hosts', secret: 'sync-secret' }]);
    const yml = readFileSync(out, 'utf8');
    expect(yml).toContain(`"${routerName('www.loja.com.br')}-web":`);
    expect(statSync(out).mode & 0o777).toBe(0o644);
    expect(readdirSync(join(dir, 'dynamic'))).toEqual(['vendua-custom-domains.yml']);
  });

  test('rewrites only when the content changes, by rename', async () => {
    const tick = sync();
    await tick();
    const ino = statSync(out).ino;
    expect(await tick()).toEqual({ status: 'unchanged', hosts: 2 });
    expect(statSync(out).ino).toBe(ino);

    answer = () => ok(['loja.com.br', 'outra.com']);
    expect(await tick()).toEqual({ status: 'written', hosts: 2 });
    expect(statSync(out).ino).not.toBe(ino); // a new file renamed over the old one
    expect(readFileSync(out, 'utf8')).toContain('Host(`outra.com`)');
    expect(readFileSync(out, 'utf8')).not.toContain('www.loja.com.br');
    expect(existsSync(`${out}.tmp`)).toBe(false);
  });

  test('a hand-edited or deleted file is put back', async () => {
    const tick = sync();
    await tick();
    writeFileSync(out, 'http: {}\n');
    expect((await tick()).status).toBe('written');
    rmSync(out);
    expect((await tick()).status).toBe('written');
    expect(readFileSync(out, 'utf8')).toContain('Host(`loja.com.br`)');
  });

  test('Core errors, timeouts and malformed bodies keep the current file', async () => {
    const tick = sync();
    await tick();
    const before = readFileSync(out, 'utf8');
    const ino = statSync(out).ino;
    const failures: (() => Response | Promise<Response>)[] = [
      () => new Response('boom', { status: 503 }),
      () => Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 }),
      () => new Response(null, { status: 302, headers: { location: '/login' } }),
      () => new Response('{"hosts": ["loja.com.br"', { status: 200 }),
      () => Response.json({ hosts: 'loja.com.br', generatedAt: 'x' }),
      () => Response.json({ hosts: [] }),
      () => Response.json(null),
      () => Promise.reject(new TypeError('Unable to connect')),
    ];
    for (const f of failures) {
      answer = f;
      const r = await tick();
      expect(r.status).toBe('failed');
    }
    expect(readFileSync(out, 'utf8')).toBe(before);
    expect(statSync(out).ino).toBe(ino);
  });

  test('the timeout aborts the request', async () => {
    let aborted = false;
    const tick = sync({
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(init.signal!.reason);
          }),
        ),
    });
    expect((await tick()).status).toBe('failed');
    expect(aborted).toBe(true);
    expect(existsSync(out)).toBe(false);
  });

  test('an empty list from Core is a valid, empty file; dropped hosts never reach it', async () => {
    answer = () => ok(['painel.example.com', 'x.vendua.com.br', 'BAD.com', 'loja.com.br']);
    const tick = sync();
    expect(await tick()).toEqual({ status: 'written', hosts: 1 });
    const yml = readFileSync(out, 'utf8');
    expect(yml).not.toContain('painel');
    expect(yml).not.toContain('vendua.com.br');
    expect(yml).not.toContain('BAD');

    answer = () => ok([]);
    expect(await tick()).toEqual({ status: 'written', hosts: 0 });
    expect(readFileSync(out, 'utf8')).toBe(
      renderConfig([], {
        storeDomain: 'vendua.com.br',
        deny: [],
        service: 'vendua-edge@docker',
        middleware: 'vendua-edge-https@docker',
        resolver: 'letsencrypt',
      }),
    );
  });
});

describe('repair', () => {
  const opts = () => ({
    out,
    storeDomain: 'vendua.com.br',
    deny: [],
    service: 'vendua-edge@docker',
    middleware: 'vendua-edge-https@docker',
    resolver: 'letsencrypt',
  });

  test('isSound: comments only or routers present; never an empty or unparsable file', () => {
    expect(isSound(renderConfig([], opts()))).toBe(true);
    expect(isSound(renderConfig(['loja.com.br'], opts()))).toBe(true);
    expect(isSound('# old\nhttp:\n  routers: {}\n')).toBe(false);
    expect(isSound('http: {}\n')).toBe(false);
    expect(isSound('http:\n  routers:\n')).toBe(false);
    expect(isSound('http: [\n')).toBe(false);
  });

  test('a file an older image left is replaced while Core is down', async () => {
    const tick = sync();
    await tick();
    writeFileSync(out, '# old\nhttp:\n  routers: {}\n');
    answer = () => new Response('boom', { status: 503 });
    expect((await tick()).status).toBe('failed');
    expect(readFileSync(out, 'utf8')).toBe(renderConfig([], opts()));
  });

  test('a sound file, or none, is left alone', async () => {
    expect(await repair(opts())).toBe(false);
    expect(existsSync(out)).toBe(false);
    const tick = sync();
    await tick();
    const ino = statSync(out).ino;
    expect(await repair(opts())).toBe(false);
    expect(statSync(out).ino).toBe(ino);
  });
});
