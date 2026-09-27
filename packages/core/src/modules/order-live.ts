import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { ORDER_CHANNEL } from './orders.ts';

// Realtime order updates (roadmap 2a) as a long poll: the Kernel asks "anything
// after version N?" and Core holds the request until the order changes or the
// wait times out. Wake-ups come from pg_notify on commit (transitionOrder), so an
// idle order costs nothing, it works across Core replicas, and it needs no
// EventSource (storefronts can't open one; a header-authed fetch is enough).

const liveLog = log.child({ mod: 'order-live' });

type Waiter = () => void;

export class OrderHub {
  private waiters = new Map<string, Set<Waiter>>();
  private started: Promise<void> | null = null;
  private listening = false;

  constructor(private sql: Sql) {}

  /** LISTEN once, lazily; on failure waits still end by timeout and re-read. */
  private ensure(): Promise<void> {
    this.started ??= this.sql
      .listen(
        ORDER_CHANNEL,
        (orderId) => this.wake(orderId),
        // (re)subscribed — anything sent while we weren't listening is lost: wake everyone to re-read
        () => {
          this.listening = true;
          for (const id of [...this.waiters.keys()]) this.wake(id);
        },
      )
      .then(() => undefined)
      .catch((err) => {
        liveLog.error({ err }, 'order LISTEN failed — waits fall back to their timeout');
        this.started = null;
      });
    return this.started;
  }

  get isListening() {
    return this.listening;
  }

  wake(orderId: string) {
    const set = this.waiters.get(orderId);
    if (!set) return;
    this.waiters.delete(orderId);
    for (const w of set) w();
  }

  /** Resolves true when the order is notified, false on timeout/abort. */
  async wait(orderId: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    await this.ensure();
    return new Promise<boolean>((resolve) => {
      let set = this.waiters.get(orderId);
      if (!set) this.waiters.set(orderId, (set = new Set()));
      const done = (hit: boolean) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.waiters.get(orderId)?.delete(waiter);
        if (this.waiters.get(orderId)?.size === 0) this.waiters.delete(orderId);
        resolve(hit);
      };
      const waiter: Waiter = () => done(true);
      const onAbort = () => done(false);
      const timer = setTimeout(() => done(false), timeoutMs);
      set.add(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** open waits (tests + ops) */
  get size() {
    let n = 0;
    for (const s of this.waiters.values()) n += s.size;
    return n;
  }
}
