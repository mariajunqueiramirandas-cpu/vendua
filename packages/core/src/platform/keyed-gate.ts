import { HttpError } from './http.ts';

type Lane = { active: number; waiters: Array<() => void> };

/**
 * In-process limit on how many calls per key run at once; the rest wait here, in memory.
 *
 * Checkout takes a per-store advisory lock (place-order.ts), so one store's checkouts run one at
 * a time in Postgres. Without this gate each queued checkout waits for that lock holding a
 * connection of the request pool, and a burst on one store stalls every other store's requests
 * behind it. Waiting here costs no connection. The DB lock stays the guarantee across processes.
 */
export function keyedGate(opts: { concurrency: number; maxQueued: number }) {
  const lanes = new Map<string, Lane>();
  const release = (key: string, lane: Lane) => {
    const next = lane.waiters.shift();
    if (next) return next();
    lane.active--;
    if (lane.active === 0) lanes.delete(key);
  };
  return async function run<T>(
    key: string,
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let lane = lanes.get(key);
    if (!lane) lanes.set(key, (lane = { active: 0, waiters: [] }));
    if (lane.active < opts.concurrency) {
      lane.active++;
    } else {
      if (lane.waiters.length >= opts.maxQueued) {
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'the store is taking many orders — retry in a moment',
        );
      }
      if (signal?.aborted) throw new HttpError(499, 'BAD_REQUEST', 'client closed the request');
      const l = lane;
      await new Promise<void>((resolve, reject) => {
        // a waiter handed the slot keeps `active` as it was: the slot passes from one to the next
        const go = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          const i = l.waiters.indexOf(go);
          if (i >= 0) l.waiters.splice(i, 1);
          reject(new HttpError(499, 'BAD_REQUEST', 'client closed the request'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        l.waiters.push(go);
      });
    }
    try {
      return await fn();
    } finally {
      release(key, lane);
    }
  };
}
