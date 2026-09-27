import type { Sql } from '../platform/db.ts';
import { log } from '../platform/log.ts';
import { ORDER_CHANNEL } from './orders.ts';

// Realtime order updates (roadmap 2a). Two transports share one hub: an SSE
// stream (`GET /orders/:id/events`, the Kernel's default) and a long poll
// (`GET /orders/:id?since&wait`, the fallback). Wake-ups come from pg_notify on
// commit (transitionOrder), so an idle order costs nothing and it works across
// Core replicas. The Kernel reads the stream with a header-authed fetch —
// EventSource can't send the session token.

const liveLog = log.child({ mod: 'order-live' });

type Waiter = () => void;

export class OrderHub {
  private waiters = new Map<string, Set<Waiter>>();
  /** long-lived listeners (SSE streams) — survive wake-ups, unlike waiters */
  private listeners = new Map<string, Set<Waiter>>();
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
          for (const id of new Set([...this.waiters.keys(), ...this.listeners.keys()]))
            this.wake(id);
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
    for (const l of this.listeners.get(orderId) ?? []) l();
    const set = this.waiters.get(orderId);
    if (!set) return;
    this.waiters.delete(orderId);
    for (const w of set) w();
  }

  /** Calls `fn` on every notification for the order until unsubscribed. */
  async subscribe(orderId: string, fn: () => void): Promise<() => void> {
    await this.ensure();
    let set = this.listeners.get(orderId);
    if (!set) this.listeners.set(orderId, (set = new Set()));
    set.add(fn);
    return () => {
      const cur = this.listeners.get(orderId);
      cur?.delete(fn);
      if (cur?.size === 0) this.listeners.delete(orderId);
    };
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
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}
