import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPublicHost, slugFromStoreHost } from '../src/platform/store-origin.ts';

describe('store origin', () => {
  test('dev and loopback hosts are never a public address', () => {
    for (const h of ['quero-pudim.localhost', 'localhost:5174', '127.0.0.1:5174', 'localhost'])
      expect(isPublicHost(h)).toBe(false);
    expect(isPublicHost('pudim.vendua.com.br')).toBe(true);
  });

  test('only a single label under the store domain is a slug', () => {
    expect(slugFromStoreHost('quero-pudim.vendua.com.br', 'vendua.com.br')).toBe('quero-pudim');
    expect(slugFromStoreHost('a.b.vendua.com.br', 'vendua.com.br')).toBeNull();
    expect(slugFromStoreHost('vendua.com.br', 'vendua.com.br')).toBeNull();
    expect(slugFromStoreHost('evilvendua.com.br', 'vendua.com.br')).toBeNull();
    expect(slugFromStoreHost('x.vendua.com.br', undefined)).toBeNull();
  });

  // the bug this guards: admin links built as `https://${slug}.${domain}` while the store
  // was served elsewhere. storeOrigin is the one builder; nothing else may interpolate it.
  test('no Core source builds a store URL from slug + storeDomain', () => {
    const root = join(import.meta.dir, '../src');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('store-origin.ts'),
    );
    const offenders = files.filter((f) =>
      /\$\{[^}]*slug\}\.\$\{[^}]*(storeDomain|domain)\}/i.test(readFileSync(join(root, f), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
