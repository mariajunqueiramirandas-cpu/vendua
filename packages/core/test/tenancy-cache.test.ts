import { describe, expect, setSystemTime, test } from 'bun:test';
import { TenantResolver, type Tenant } from '../src/platform/tenancy.ts';

const store = (name: string): Tenant => ({ id: 't1', slug: 'loja', name, status: 'active' });

function fakeSql(answer: () => Tenant[]) {
  const calls = { n: 0 };
  const release: (() => void)[] = [];
  const sql = Object.assign(async () => {
    calls.n++;
    await new Promise<void>((r) => release.push(r));
    return answer();
  }) as never;
  const settle = async () => {
    while (release.length) release.shift()!();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sql, calls, settle };
}

describe('tenant cache', () => {
  test('a burst on a cold host shares one lookup', async () => {
    const db = fakeSql(() => [store('Loja')]);
    const r = new TenantResolver(db.sql);
    const all = Promise.all([1, 2, 3, 4, 5].map(() => r.resolve('loja.example.com')));
    await db.settle();
    expect((await all).map((t) => t?.name)).toEqual(['Loja', 'Loja', 'Loja', 'Loja', 'Loja']);
    expect(db.calls.n).toBe(1);
  });

  test('an expired hit is served while one refresh runs; a very old one waits', async () => {
    let name = 'Antes';
    const db = fakeSql(() => [store(name)]);
    const r = new TenantResolver(db.sql);
    const t0 = new Date('2026-09-30T12:00:00Z');
    setSystemTime(t0);
    try {
      const first = r.resolve('loja.example.com');
      await db.settle();
      expect((await first)?.name).toBe('Antes');

      name = 'Depois';
      setSystemTime(new Date(t0.getTime() + 31_000));
      // answered from the stale entry without waiting on the (still pending) lookup
      expect((await r.resolve('loja.example.com'))?.name).toBe('Antes');
      expect((await r.resolve('loja.example.com'))?.name).toBe('Antes');
      expect(db.calls.n).toBe(2);
      await db.settle();
      expect((await r.resolve('loja.example.com'))?.name).toBe('Depois');
      expect(db.calls.n).toBe(2);

      name = 'Bem depois';
      setSystemTime(new Date(t0.getTime() + 31_000 + 6 * 60_000));
      const late = r.resolve('loja.example.com');
      await db.settle();
      expect((await late)?.name).toBe('Bem depois');
      expect(db.calls.n).toBe(3);
    } finally {
      setSystemTime();
    }
  });
});
