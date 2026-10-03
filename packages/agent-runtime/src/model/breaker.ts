export interface BreakerOpts {
  /** Consecutive failures that open the circuit. */
  failureThreshold?: number;
  /** How long an open circuit refuses before admitting one probe. */
  cooldownMs?: number;
}

export type BreakerState = 'closed' | 'open' | 'half_open';

interface Entry {
  failures: number;
  openedAt: number | null;
  probing: boolean;
}

/** Per-key circuit breaker (keyed by provider). */
export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly entries = new Map<string, Entry>();

  constructor(
    opts: BreakerOpts = {},
    private readonly now: () => number = Date.now,
  ) {
    this.threshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
  }

  state(key: string): BreakerState {
    const e = this.entries.get(key);
    if (!e || e.openedAt === null) return 'closed';
    return this.now() - e.openedAt < this.cooldownMs ? 'open' : 'half_open';
  }

  /** Whether a request may go now; half-open admits one probe at a time. */
  tryAcquire(key: string): boolean {
    const state = this.state(key);
    if (state === 'closed') return true;
    if (state === 'open') return false;
    const e = this.entries.get(key)!;
    if (e.probing) return false;
    e.probing = true;
    return true;
  }

  success(key: string): void {
    this.entries.delete(key);
  }

  failure(key: string): void {
    const e = this.entries.get(key) ?? { failures: 0, openedAt: null, probing: false };
    this.entries.set(key, e);
    if (e.probing) {
      e.probing = false;
      e.openedAt = this.now();
      return;
    }
    e.failures++;
    if (e.failures >= this.threshold) e.openedAt = this.now();
  }
}

export interface LatencyOpts {
  /** Samples kept per key. */
  window?: number;
  /** Below this many samples `p95` is null. */
  minSamples?: number;
}

/** Rolling latency window per key (keyed by route). */
export class LatencyTracker {
  private readonly window: number;
  private readonly minSamples: number;
  private readonly samples = new Map<string, number[]>();

  constructor(opts: LatencyOpts = {}) {
    this.window = opts.window ?? 100;
    this.minSamples = opts.minSamples ?? 20;
  }

  record(key: string, ms: number): void {
    const list = this.samples.get(key) ?? [];
    list.push(ms);
    if (list.length > this.window) list.splice(0, list.length - this.window);
    this.samples.set(key, list);
  }

  p95(key: string): number | null {
    const list = this.samples.get(key);
    if (!list || list.length < this.minSamples) return null;
    const sorted = [...list].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
  }
}
