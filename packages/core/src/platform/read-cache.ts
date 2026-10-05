import type { Sql } from './db.ts';
import { log } from './log.ts';

const cacheLog = log.child({ mod: 'read-cache' });
const HEARTBEAT_MS = 15_000;

/** What the store_cache triggers (migration 0088) notify on commit: `<tenant id or *>|<table>`. */
export const STORE_CACHE_CHANNEL = 'vendua_store_cache';

export interface ReadOpts<T> {
  /** tables the value is read from: a committed write to any of them for this store drops it */
  deps: readonly string[];
  /** when the value goes stale by itself (epoch ms): a schedule turning, a token expiring */
  until?: (value: T) => number | null | undefined;
  /** false: hand the value back without keeping it (a 404's null, say) */
  keep?: (value: T) => boolean;
}

interface Entry {
  value: unknown;
  deps: readonly string[];
  at: number;
  until: number;
}

interface Store {
  gen: number;
  entries: Map<string, Entry>;
}

export interface ReadCacheOptions {
  /** an entry this old is refreshed behind the request that reads it */
  ttlMs?: number;
  /** ...and served while that refresh runs, up to this much older (a missed notify's bound) */
  maxStaleMs?: number;
  maxStores?: number;
  maxEntriesPerStore?: number;
  /** every read first waits for the notifies of writes already committed (one round trip),
   *  so a read right after a write sees it — tests; production takes the notify's ~ms lag */
  strict?: boolean;
}

/**
 * Public storefront reads (store profile, catalog, zones, design) kept in memory per store.
 * A trigger on every table they read notifies on commit and drops the store's entries that
 * depend on it; a value read while such a write committed is never kept. Time-bound values
 * carry their own `until`. LISTEN down (boot, reconnect) means no caching until it is back,
 * and each (re)subscribe drops everything, since notifies sent meanwhile were lost.
 * Values are frozen: a handler that mutated one would leak into every later response.
 */
export class StoreReadCache {
  private stores = new Map<string, Store>();
  private inflight = new Map<string, { store: Store; gen: string; p: Promise<unknown> }>();
  private allGen = 0;
  /** bumped by each subscribe: callbacks of an abandoned one become no-ops */
  private epoch = 0;
  private listening = false;
  private starting: Promise<void> | null = null;
  private unlisten: (() => Promise<void>) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private syncs = new Map<string, () => void>();
  private readonly ttl: number;
  private readonly maxStale: number;
  private readonly maxStores: number;
  private readonly maxEntries: number;

  constructor(
    private sql: Sql,
    private opts: ReadCacheOptions = {},
  ) {
    this.ttl = opts.ttlMs ?? 30_000;
    this.maxStale = opts.maxStaleMs ?? 5 * 60_000;
    this.maxStores = opts.maxStores ?? 5_000;
    this.maxEntries = opts.maxEntriesPerStore ?? 500;
  }

  async read<T>(tenantId: string, key: string, load: () => Promise<T>, o: ReadOpts<T>): Promise<T> {
    if (!this.listening) {
      const started = this.start();
      if (!this.opts.strict) return load();
      await started;
      if (!this.listening) return load();
    }
    if (this.opts.strict && !(await this.barrier())) return load();
    const store = this.store(tenantId);
    const hit = store.entries.get(key);
    const now = Date.now();
    if (hit && now < hit.until) {
      const age = now - hit.at;
      if (age < this.ttl) return hit.value as T;
      if (age < this.ttl + this.maxStale) {
        this.fill(tenantId, store, key, load, o).catch((err) =>
          cacheLog.warn({ err, tenantId, key }, 'refresh failed'),
        );
        return hit.value as T;
      }
    }
    return this.fill(tenantId, store, key, load, o);
  }

  /** drop what a write to `table` made stale — `*` for every store, `*` table for everything */
  invalidate(tenantId: string, table = '*') {
    if (tenantId === '*') {
      this.allGen++;
      for (const store of this.stores.values()) this.drop(store, table);
      this.inflight.clear();
      return;
    }
    // a load in flight for an evicted store must not be joined either
    for (const k of this.inflight.keys())
      if (k.startsWith(`${tenantId}\u0000`)) this.inflight.delete(k);
    const store = this.stores.get(tenantId);
    if (store) this.drop(store, table);
  }

  /** subscribes now rather than on the first read; true once reads are being kept */
  async ready(): Promise<boolean> {
    await this.start();
    return this.listening;
  }

  /** shutdown: no more heartbeats or re-subscribes (sql.end() closes the listener) */
  stop() {
    this.stopped = true;
    this.listening = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** entries held, across stores — for tests */
  get size(): number {
    let n = 0;
    for (const s of this.stores.values()) n += s.entries.size;
    return n;
  }

  private drop(store: Store, table: string) {
    store.gen++;
    if (table === '*') return store.entries.clear();
    for (const [k, e] of store.entries) if (e.deps.includes(table)) store.entries.delete(k);
  }

  private store(tenantId: string): Store {
    let s = this.stores.get(tenantId);
    if (!s) {
      if (this.stores.size >= this.maxStores) {
        // oldest-created store goes first; it reloads on its next read
        const oldest = this.stores.keys().next().value;
        if (oldest !== undefined) this.stores.delete(oldest);
      }
      s = { gen: 0, entries: new Map() };
      this.stores.set(tenantId, s);
    }
    return s;
  }

  private fill<T>(
    tenantId: string,
    store: Store,
    key: string,
    load: () => Promise<T>,
    o: ReadOpts<T>,
  ): Promise<T> {
    const id = `${tenantId}\u0000${key}`;
    const gen = `${this.allGen}.${store.gen}`;
    const running = this.inflight.get(id);
    if (running && running.store === store && running.gen === gen) return running.p as Promise<T>;
    const slot = { store, gen, p: Promise.resolve() as Promise<unknown> };
    const p = (async () => {
      try {
        const value = await load();
        // a write committed while this read ran: its notify bumped a generation — don't keep it
        if (`${this.allGen}.${store.gen}` !== gen || this.stores.get(tenantId) !== store)
          return value;
        if (o.keep && !o.keep(value)) return value;
        const until = o.until?.(value) ?? Infinity;
        if (until <= Date.now()) return value;
        if (!store.entries.has(key) && store.entries.size >= this.maxEntries) store.entries.clear();
        store.entries.set(key, { value: deepFreeze(value), deps: o.deps, at: Date.now(), until });
        return value;
      } finally {
        if (this.inflight.get(id) === slot) this.inflight.delete(id);
      }
    })();
    slot.p = p;
    this.inflight.set(id, slot);
    return p;
  }

  private start(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.starting) return this.starting;
    const epoch = ++this.epoch;
    this.starting = this.sql
      .listen(
        STORE_CACHE_CHANNEL,
        (payload) => epoch === this.epoch && this.onNotify(payload),
        () => {
          if (epoch !== this.epoch) return;
          // first subscribe, or a reconnect that may have missed notifies: start clean
          this.invalidate('*');
          this.listening = !this.stopped;
        },
      )
      .then((sub) => {
        this.unlisten = sub.unlisten;
        // strict reads check the listener themselves; otherwise a periodic probe catches a
        // listener that died without a reconnect, which would leave stale entries in service
        if (!this.opts.strict && !this.heartbeat) {
          this.heartbeat = setInterval(() => void this.probe(), HEARTBEAT_MS);
          this.heartbeat.unref?.();
        }
      })
      .catch((err) => {
        cacheLog.warn({ err }, 'listen failed — reads go to the database');
        setTimeout(() => (this.starting = null), 5_000).unref?.();
      });
    return this.starting;
  }

  private async probe() {
    if (!this.listening || this.stopped) return;
    if (await this.barrier()) return;
    if (this.stopped) return;
    cacheLog.warn('listener missed its probe — dropping the cache and subscribing again');
    this.listening = false;
    this.invalidate('*');
    const unlisten = this.unlisten;
    this.unlisten = null;
    this.starting = null;
    await unlisten?.().catch(() => undefined);
    void this.start();
  }

  private onNotify(payload: string) {
    const bar = payload.indexOf('|');
    if (bar < 0) return;
    const tenant = payload.slice(0, bar);
    const rest = payload.slice(bar + 1);
    if (tenant === 'sync') {
      this.syncs.get(rest)?.();
      return;
    }
    this.invalidate(tenant, rest);
  }

  /** resolves once the listener has seen a notify sent now: notifies arrive in commit order,
   *  so every write committed before this call has been applied */
  private async barrier(): Promise<boolean> {
    const nonce = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let answer!: (seen: boolean) => void;
    const seen = new Promise<boolean>((resolve) => (answer = resolve));
    this.syncs.set(nonce, () => answer(true));
    try {
      await this.sql`select pg_notify(${STORE_CACHE_CHANNEL}, ${`sync|${nonce}`})`;
      // the clock starts once the notify is committed: a saturated pool isn't a dead listener
      timer = setTimeout(() => answer(false), 2_000);
      return await seen;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      this.syncs.delete(nonce);
    }
  }
}

function deepFreeze<T>(v: T): T {
  if (v === null || typeof v !== 'object' || Object.isFrozen(v)) return v;
  if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}
