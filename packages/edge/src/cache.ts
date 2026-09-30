/** Insertion-ordered map that drops its least recently used key past `max`. */
export class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly max: number) {}
  get size() {
    return this.map.size;
  }
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  peek(key: K): V | undefined {
    return this.map.get(key);
  }
  set(key: K, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }
  delete(key: K): void {
    this.map.delete(key);
  }
  entries(): [K, V][] {
    return [...this.map.entries()];
  }
}

export interface Slot<T> {
  value: T;
  at: number;
  ttl: number;
}

const FAIL_BACKOFF_MS = 1000;

/**
 * Stale-while-revalidate: a fresh slot is returned as is; an expired one is returned too while a
 * single background load replaces it. A failed load (it throws) never evicts what we have, so a
 * value keeps being served for as long as its source is down.
 */
export class SwrCache<T> {
  private slots: Lru<string, Slot<T>>;
  private inflight = new Map<string, Promise<Slot<T>>>();
  private failedAt = new Map<string, number>();

  constructor(
    max: number,
    private readonly loader: (key: string) => Promise<{ value: T; ttl: number }>,
    private readonly onChange: () => void = () => {},
    private readonly now: () => number = Date.now,
  ) {
    this.slots = new Lru(max);
  }

  get size() {
    return this.slots.size;
  }

  /** Throws only when there is nothing cached and the load fails. */
  async get(key: string): Promise<{ value: T; stale: boolean }> {
    const slot = this.slots.get(key);
    if (slot && this.now() - slot.at < slot.ttl) return { value: slot.value, stale: false };
    if (slot) {
      const failed = this.failedAt.get(key) ?? 0;
      if (this.now() - failed >= FAIL_BACKOFF_MS) this.refresh(key).catch(() => {});
      return { value: slot.value, stale: true };
    }
    const fresh = await this.refresh(key);
    return { value: fresh.value, stale: false };
  }

  delete(key: string): void {
    this.slots.delete(key);
    this.onChange();
  }

  /** The cached value (fresh or stale) without loading. */
  peek(key: string): T | undefined {
    return this.slots.peek(key)?.value;
  }

  refresh(key: string): Promise<Slot<T>> {
    let p = this.inflight.get(key);
    if (p) return p;
    p = this.loader(key)
      .then(({ value, ttl }) => {
        const slot = { value, ttl, at: this.now() };
        this.slots.set(key, slot);
        this.failedAt.delete(key);
        this.onChange();
        return slot;
      })
      .catch((e) => {
        this.failedAt.set(key, this.now());
        if (this.failedAt.size > 10_000) this.failedAt.clear();
        throw e;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  dump(keep: (v: T) => boolean = () => true): [string, Slot<T>][] {
    return this.slots.entries().filter(([, s]) => keep(s.value));
  }

  restore(entries: [string, Slot<T>][]): void {
    for (const [k, s] of entries) this.slots.set(k, s);
  }
}

/** Byte-bounded cache for small bodies (served files, gzip variants). */
export class ByteCache {
  private map = new Lru<string, Uint8Array>(Number.MAX_SAFE_INTEGER);
  private bytes = 0;
  constructor(private readonly maxBytes: number) {}
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, body: Uint8Array) {
    if (body.length > this.maxBytes / 8) return;
    const old = this.map.peek(key);
    if (old) this.bytes -= old.length;
    this.map.set(key, body);
    this.bytes += body.length;
    if (this.bytes > this.maxBytes)
      for (const [k, v] of this.map.entries()) {
        if (this.bytes <= this.maxBytes) break;
        this.map.delete(k);
        this.bytes -= v.length;
      }
  }
}
