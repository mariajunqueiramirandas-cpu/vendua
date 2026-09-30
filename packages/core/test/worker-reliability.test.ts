import { afterEach, describe, expect, jest, test } from 'bun:test';
import { startAdminSweeper, sweepAdmin } from '../src/admin/workers.ts';
import { AdminHub } from '../src/admin/live.ts';
import { startInstagramReconcile } from '../src/agent/channels/instagram.ts';
import type { Sql } from '../src/platform/db.ts';

// Fake postgres.js handles — enough surface for the worker loops, no database.
type Query = Promise<unknown[]> & { execute: () => Promise<unknown[]> };
const q = (p: Promise<unknown[]>): Query => Object.assign(p, { execute: () => p });
const text = (strings: TemplateStringsArray) => strings.join('?');
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
  jest.useRealTimers();
});

describe('admin sweeper', () => {
  test('a slow pass is never stacked, and stop prevents new passes', async () => {
    jest.useFakeTimers();
    const pending: ((rows: unknown[]) => void)[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      expect(text(strings)).toContain('from tenants');
      return q(new Promise((r) => pending.push(r)));
    }) as unknown as Sql;

    const stop = startAdminSweeper(sql);
    jest.advanceTimersByTime(60_000);
    expect(pending.length).toBe(1);
    jest.advanceTimersByTime(180_000);
    expect(pending.length).toBe(1);

    pending[0]!([]);
    await flush();
    jest.advanceTimersByTime(60_000);
    expect(pending.length).toBe(2);

    pending[1]!([]);
    await flush();
    stop();
    jest.advanceTimersByTime(300_000);
    expect(pending.length).toBe(2);
  });

  test("one tenant's failure doesn't skip the tenants after it", async () => {
    const swept: string[] = [];
    const sql = Object.assign(
      (strings: TemplateStringsArray) => {
        expect(text(strings)).toContain('from tenants');
        return q(Promise.resolve([{ id: 'broken' }, { id: 'ok' }]));
      },
      {
        begin: async (fn: (tx: Sql) => Promise<unknown>) => {
          let tenant = '';
          const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
            if (text(strings).includes('set_config')) tenant = String(values[0]);
            else if (tenant === 'broken') return q(Promise.reject(new Error('boom')));
            if (text(strings).includes('delete from push_attempts')) swept.push(tenant);
            return q(Promise.resolve([]));
          }) as unknown as Sql;
          return fn(tx);
        },
      },
    ) as unknown as Sql;

    await sweepAdmin(sql);
    expect(swept).toEqual(['ok']);
  });
});

describe('admin hub LISTEN', () => {
  test('a failed LISTEN retries with backoff until it holds', async () => {
    jest.useFakeTimers();
    let calls = 0;
    let onPayload: ((p: string) => void) | null = null;
    const sql = {
      listen: (_ch: string, fn: (p: string) => void) => {
        calls++;
        if (calls < 3) return Promise.reject(new Error('no connection'));
        onPayload = fn;
        return Promise.resolve({ unlisten: async () => undefined });
      },
    } as unknown as Sql;
    const hub = new AdminHub(sql);
    const seen: string[] = [];
    await hub.onAny((tenantId, e) => seen.push(`${tenantId}:${e.topic}`));
    expect(calls).toBe(1);

    jest.advanceTimersByTime(999);
    expect(calls).toBe(1);
    jest.advanceTimersByTime(1);
    expect(calls).toBe(2);
    await flush();
    // doubled
    jest.advanceTimersByTime(1_999);
    expect(calls).toBe(2);
    jest.advanceTimersByTime(1);
    expect(calls).toBe(3);
    await flush();

    onPayload!('t1|order.placed|o1');
    expect(seen).toEqual(['t1:order.placed']);
    jest.advanceTimersByTime(120_000);
    expect(calls).toBe(3);
  });
});

describe('instagram reconcile loop', () => {
  test('skips ticks while one is pending; stop clears the interval', async () => {
    jest.useFakeTimers();
    let begins = 0;
    const sql = {
      begin: () => {
        begins++;
        return new Promise(() => undefined);
      },
    } as unknown as Sql;
    const stop = startInstagramReconcile(sql);
    expect(typeof stop).toBe('function');
    expect(begins).toBe(1);
    jest.advanceTimersByTime(300_000);
    expect(begins).toBe(1);
    stop();
    expect(jest.getTimerCount()).toBe(0);
  });
});
