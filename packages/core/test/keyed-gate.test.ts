import { describe, expect, test } from 'bun:test';
import { HttpError } from '../src/platform/http.ts';
import { keyedGate } from '../src/platform/keyed-gate.ts';

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('keyedGate', () => {
  test('runs at most `concurrency` per key, in arrival order; other keys never wait', async () => {
    const gate = keyedGate({ concurrency: 2, maxQueued: 10 });
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const job = (i: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      order.push(i);
      running--;
      return i;
    };
    let otherDone = false;
    const busy = Promise.all(Array.from({ length: 8 }, (_, i) => gate('a', job(i))));
    await gate('b', async () => {
      otherDone = true;
    });
    expect(otherDone).toBe(true);
    expect(await busy).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(2);
    expect(order.slice(2)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  test('a full queue refuses with 429; a throw frees the slot', async () => {
    const gate = keyedGate({ concurrency: 1, maxQueued: 1 });
    let release!: () => void;
    const first = gate('a', () => new Promise<void>((r) => (release = r)));
    const second = gate('a', async () => 'second');
    const third = gate('a', async () => 'third');
    await expect(third).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
    release();
    await first;
    expect(await second).toBe('second');
    await expect(
      gate('a', async () => {
        throw new HttpError(409, 'CART_NOT_OPEN', 'x');
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await gate('a', async () => 'after')).toBe('after');
  });

  test('a waiter whose client left drops out of the queue', async () => {
    const gate = keyedGate({ concurrency: 1, maxQueued: 5 });
    let release!: () => void;
    const first = gate('a', () => new Promise<void>((r) => (release = r)));
    const ac = new AbortController();
    let ran = false;
    const gone = gate(
      'a',
      async () => {
        ran = true;
      },
      ac.signal,
    );
    ac.abort();
    await expect(gone).rejects.toBeInstanceOf(HttpError);
    release();
    await first;
    expect(ran).toBe(false);
    expect(await gate('a', async () => 'next')).toBe('next');
  });
});
