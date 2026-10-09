import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { storefrontLockScope } from '../src/lockfile.ts';

const BASE = readFileSync(join(import.meta.dir, '../../../bun.lock'), 'utf8');

type Lock = {
  workspaces: Record<string, Record<string, unknown>>;
  packages: Record<string, unknown>;
};
const parse = () => Bun.JSONC.parse(BASE) as Lock;

// what `bun install` writes for a scaffolded store: its workspace entry and its self-link
function addStore(lock: Lock, slug: string, name = `@vendua/storefront-${slug}`) {
  lock.workspaces[`storefronts/${slug}`] = {
    ...lock.workspaces['storefronts/_template'],
    name,
  };
  lock.packages[name] = [`${name}@workspace:storefronts/${slug}`];
  return lock;
}
const text = (lock: Lock) => JSON.stringify(lock, null, 2);

describe('storefrontLockScope', () => {
  test('a new store registering its workspace touches only that store', () => {
    expect(storefrontLockScope(BASE, text(addStore(parse(), 'acme')))).toEqual(['acme']);
  });

  test('an unchanged (or reformatted) lock touches nothing', () => {
    expect(storefrontLockScope(BASE, BASE)).toEqual([]);
    expect(storefrontLockScope(BASE, text(parse()))).toEqual([]);
  });

  test('a store changing its own declared deps stays scoped to it', () => {
    const lock = parse();
    const ws = lock.workspaces['storefronts/quero-pudim']!;
    ws.dependencies = { ...(ws.dependencies as object), react: '18.3.1' };
    delete (ws.dependencies as Record<string, string>)['lucide-react'];
    expect(storefrontLockScope(BASE, text(lock))).toEqual(['quero-pudim']);
  });

  test('two stores at once are both reported', () => {
    expect(storefrontLockScope(BASE, text(addStore(addStore(parse(), 'b'), 'a')))).toEqual([
      'a',
      'b',
    ]);
  });

  test('a new third-party package is not a store-only change', () => {
    const lock = addStore(parse(), 'acme');
    lock.packages['left-pad'] = ['left-pad@1.3.0', '', {}, 'sha512-x'];
    expect(storefrontLockScope(BASE, text(lock))).toBeNull();
  });

  test('a store pinning another version (a nested package) is not store-only', () => {
    const lock = addStore(parse(), 'acme');
    lock.packages['@vendua/storefront-acme/react'] = ['react@19.0.0', '', {}, 'sha512-x'];
    expect(storefrontLockScope(BASE, text(lock))).toBeNull();
  });

  test('platform-owned dirs and other workspaces are not store-only', () => {
    const tpl = parse();
    tpl.workspaces['storefronts/_template']!.version = '0.0.1';
    expect(storefrontLockScope(BASE, text(tpl))).toBeNull();

    const kernel = parse();
    kernel.workspaces['packages/kernel']!.version = '9.9.9';
    expect(storefrontLockScope(BASE, text(kernel))).toBeNull();
  });

  test("a store can't take over another workspace's self-link", () => {
    expect(storefrontLockScope(BASE, text(addStore(parse(), 'acme', '@vendua/kernel')))).toBeNull();
  });

  test('a lock that does not parse fails closed', () => {
    expect(storefrontLockScope(BASE, '{ nope')).toBeNull();
    expect(storefrontLockScope('[]', BASE)).toBeNull();
  });
});
